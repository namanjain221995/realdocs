# Interview session integration guide

This is the guide for a system (an HR tool, a scheduler) that creates interview documents through the
service API. The same material, with a live reference and a "try it" form, is at `/docs` on every
deployment for a signed-in account; the machine-readable contract is `GET /api/openapi.json` (OpenAPI
3.1, generated from the schemas the server validates with). Neither is public: the document is served
to a signed-in account (the browser session) or to any valid API key
(`Authorization: Bearer rdk_…`, whatever its scopes), and answers 401 otherwise:

```sh
curl -sS https://docs.example.com/api/openapi.json -H "Authorization: Bearer $RDK_KEY"
```

## Model

One **interview session** = one document = one collaboration room. The candidate and each interviewer get
a personal link `https://<origin>/s/<grantId>#<secret>` (an ordinary share link; the secret is in the
fragment and is exchanged for an HttpOnly cookie). Links are returned **once**, at creation and rotation.
Identifiers are bare UUIDs.

## Authentication

An administrator creates a key at `/admin/api-keys` (name, scopes, optional expiry, optional CIDR
allow-list). The key `rdk_<8 chars>_<43 chars>` is shown once. Send `Authorization: Bearer rdk_…`.
Keys are valid only on `/api/v1/*`, never honour cookies and cannot reach admin routes.

| Scope                    | Allows                                                   |
| ------------------------ | -------------------------------------------------------- |
| `sessions:create`        | `POST /interview-sessions`                               |
| `sessions:read`          | `GET /interview-sessions`, `GET /interview-sessions/:id` |
| `sessions:update`        | `PATCH /:id`, participants, `rotate-links`               |
| `sessions:close`         | `start`, `complete`, `cancel`, `DELETE /:id` (archive)   |
| `documents:read`         | `GET /:id/document`                                      |
| `documents:history:read` | `GET /:id/audit`                                         |
| `webhooks:manage`        | webhook endpoints and deliveries                         |

Rate limit: `RATE_API_KEY_PER_MINUTE` (default 600) per key; `429 RATE_LIMITED` with `Retry-After`.
Failed authentications are throttled per address and audited (without the secret).

## Create a session

```bash
curl -sS https://docs.example.com/api/v1/interview-sessions \
  -H "Authorization: Bearer $RDK_KEY" -H "Idempotency-Key: interview-84721-create" \
  -H "Content-Type: application/json" -d '{
    "candidate": {"name": "Aarav Sharma", "email": "aarav@example.com"},
    "interviewers": [{"name": "Meera Iyer", "email": "meera@acme.example"}],
    "companyName": "Acme Corp", "round": {"number": "2", "name": "System design"},
    "scheduledAt": "2030-03-14T15:30:00+05:30", "timezone": "Asia/Kolkata",
    "expiresAt": "2030-03-21T00:00:00Z",
    "permissions": {"candidateCanEdit": true, "interviewerCanEdit": true,
      "candidateCanExport": false, "candidateCanShare": false, "candidateCanViewHistory": false},
    "metadata": {"externalInterviewId": "int_84721"} }'
```

Rules: 1 to 20 interviewers; `round.number` a string of digits from `"1"` to `"99"` (every value in the
request is a string, an object or a boolean; a JSON number is still accepted for `round.number` and answered
as a string); `scheduledAt` ISO 8601 with offset; `timezone` an IANA
name; `expiresAt` in the future and at most 90 days away; `metadata` string values (at most 20 keys, 256
characters each, keys `[A-Za-z0-9_.-]{1,64}`). Permission defaults are as shown above.

Response `201`: `sessionId`, `documentId`, `title`, `status: "scheduled"`, `candidateAccess`,
`interviewerAccess` (the first interviewer), `participants[]` (each with `access: {url, expiresAt}`),
`adminUrl` (`/admin/interview-sessions/<id>`), `createdAt`.

The document title is `{Candidate_Name}_{Company_Name}_Round_{N}_{YYYY-MM-DD_HH-mm}` with the date in the
session's time zone: Unicode letters and digits kept (NFC), whitespace becomes `_`, `/\:*?"<>|` and control
characters are removed, repeated `_` collapse, total at most 120 characters (names are shortened, never the
round or date). If another non-trashed document already has the title, `_XXXX` (four base32 characters) is
appended. The original title is stored as `generatedTitle`; administrators may rename the document.

## Idempotency

`Idempotency-Key` (1 to 128 visible ASCII characters) on `POST /interview-sessions`. Same key and same
canonical body (key order is irrelevant) within 24 hours: the stored response is returned with the same
status and `Idempotency-Replayed: true`, links included (stored encrypted). Same key, different body:
`409 IDEMPOTENCY_CONFLICT`. A concurrent duplicate waits up to 5 s for the first, then
`409 IDEMPOTENCY_IN_PROGRESS` (`Retry-After: 1`). A failed request releases its key.

## Access flow and permissions

Candidate and interviewer open their links, share the room, edit together, and see each other as
"Aarav — Candidate" / "Meera — Interviewer" (names and labels are set by the server from the participant
record). Enforced on the server: a candidate cannot export (`403`), cannot use the desktop handoff or the
desktop app link (`403`), and is a viewer when `candidateCanEdit` is false. The document access payload
carries `participant` and `capabilities` (`canExport`, `canViewHistory`, `canShare`, `canUseDesktop`), which
the web app uses to hide the controls. `candidateCanShare` is reserved: no participant can create share links.

Lifecycle (`409 CONFLICT` for anything else): `scheduled → in_progress` (start); `in_progress → completed`
(complete); `scheduled|in_progress → cancelled` (cancel); any non-archived → `archived` (`DELETE /:id`).
Completing or cancelling revokes the candidate's links, disconnects them, and they see "This interview has
ended" (`session_closed`, 410). Interviewers keep read-only access until their links expire. Archiving revokes
every link and archives the document; nothing is deleted. `PATCH`, adding participants and rotating links work
only while `scheduled` or `in_progress`.

Other operations: `PATCH` (`scheduledAt`, `timezone`, `expiresAt` (moves every active link), `permissions`
(applied to open connections), `round`, `companyName`, `metadata` (replaces)); `POST /:id/participants`
(interviewer, max 20); `DELETE /:id/participants/:participantId` (revokes, disconnects); `POST
/:id/rotate-links` (`{participantIds?}`; old links stop, open connections are disconnected, new links
returned once).

## Reading

`GET /interview-sessions` — newest first; `limit` (1 to 100, default 25), `cursor`, filters `status`,
`candidateEmail`, `interviewerEmail` (match e-mail or name, substring), `company`, `round`, `from`/`to` (on
`scheduledAt`), `q` (title). Returns `{items, nextCursor}`. `GET /:id/document` returns ProseMirror JSON;
`GET /:id/audit` returns events of the session and its document. Reads by administrators in the admin UI
write `admin.session_viewed`.

Every session response gives `round.number` as a string, and each participant has `accountLinked`
(see "Interviewers with an account").

### Version history of the document

With the scope `documents:history:read`, by session id or by document id:

| Request                                                                | Answer                                                                                |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `GET /interview-sessions/{sessionId}/version-history`                  | `doc.txt` as `text/plain`; `?format=json` for the same content as data                |
| `GET /interview-sessions/{sessionId}/version-history/images`           | the images that appeared, each with `id`, `fileName`, `sha256`, `firstVersion`, `url` |
| `GET /interview-sessions/{sessionId}/version-history/images/{imageId}` | the image file                                                                        |
| `GET /interview-sessions/{sessionId}/version-history/archive`          | a zip with `docs/doc.txt`, `images/<file name>` and `manifest.json`                   |
| `GET /documents/{documentId}/version-history` and the three below it   | the same for any document of the workspace                                            |

```bash
curl -sS -H "Authorization: Bearer $RDK_KEY" \
  "https://docs.example.com/api/v1/interview-sessions/$SESSION_ID/version-history" -o doc.txt
curl -sS -H "Authorization: Bearer $RDK_KEY" \
  "https://docs.example.com/api/v1/interview-sessions/$SESSION_ID/version-history/archive" -o history.zip
```

The layout of `doc.txt`, what a version is, the time zone and grouping parameters (`timezone`,
`gapSeconds`, `maxSpanSeconds`) and the limits are in [version-history.md](version-history.md). The
document names every editor with role and e-mail address and every pasted image as
`[IMAGE <id>] images/<file name>`; the `url` of an image is a path on the same server and needs the
same key.

## Interviewers with an account

An interviewer always receives a personal link. When the interviewer's e-mail address is also the
address of an active account of the workspace, the server additionally makes that account a member of
the session's document: after signing in, the person finds the document in their own documents list
(marked as an interview session, with company, round, candidate and time) and opens it with their
account, without the link. `accountLinked` on the participant says whether that happened.

- The role follows the session: editor when `interviewerCanEdit`, viewer otherwise; viewer once the
  session is completed or cancelled; the membership is removed when the session is archived or the
  interviewer is removed from it.
- A membership an administrator gave the person by hand is never changed or removed by any of this
  (`accountLinked` is then `false`: the account already had the document).
- An account that is created later is linked at that moment to the open sessions that name its
  address, when the administrator wrote that address into the invitation.
- **Only addresses an administrator fixed count.** The product sends no e-mail and cannot verify an
  address. An account whose address was typed in by the person (self sign-up, or an invitation that
  named no address) is never linked by its address: otherwise anyone could obtain interview documents
  by claiming an interviewer's address. Invite interviewers with their address filled in.
- Addresses are compared without regard to case. Candidates are never linked. Disabled accounts are
  not linked.
- Each automatic membership is written to the audit trail (`member.added`, `member.role_changed`,
  `member.removed` with `via: interview_session`).

## Errors

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Some fields are not valid.",
    "requestId": "req_…",
    "details": [{ "path": "candidate.email", "message": "Invalid email address" }]
  }
}
```

Codes: `UNAUTHENTICATED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `VALIDATION_ERROR` 400, `CONFLICT` 409,
`IDEMPOTENCY_CONFLICT` 409, `IDEMPOTENCY_IN_PROGRESS` 409, `RATE_LIMITED` 429, `PAYLOAD_TOO_LARGE` 413,
`SESSION_CLOSED` 410, `SERVICE_UNAVAILABLE` 503, `INTERNAL` 500. No stack traces. `X-Request-Id` is echoed
only if it matches `^[A-Za-z0-9_-]{8,64}$`, otherwise a `req_…` id is generated.

## Webhooks

See [webhooks.md](webhooks.md).

## Security guidance

Keep keys on servers only; one key per integration with the fewest scopes; set an expiry and a CIDR
allow-list; rotate on staff changes (rotation revokes the old key immediately); never log links (the secret
is part of them); treat `Idempotency-Key` values as non-secret.
