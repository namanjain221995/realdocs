# Webhooks

Register endpoints at `/admin/webhooks` or with the `webhooks:manage` scope (`POST /api/v1/webhooks`
`{url, events[], enabled?}`). The signing secret (`whsec_…`) is shown once and stored encrypted
(AES-256-GCM, key derived from `SESSION_SECRET`; rotating `SESSION_SECRET` makes stored secrets unreadable,
so recreate endpoints after such a rotation).

## Events

`session.created` (its `roundNumber` is a string of digits, like `round.number` in the API), `participant.joined` (first join of each participant, `role` is `candidate` or
`interviewer`), `document.first_edited`, `session.started`, `session.completed`, `session.cancelled`,
`access.revoked` (`reason`: `participant_removed`, `links_rotated`, `session_completed`, `session_cancelled`,
`session_archived`).

`document.first_edited` is produced by `emitDocumentFirstEdited(ctx, documentId)` in
`apps/server/src/service/sessions.ts`. The collaboration server calls it with the first edit applied to a document after it was
loaded; a claim in the database (`interview_sessions.first_edited_at`) makes the event fire once per session,
whatever the number of reloads or instances.

Body (`WebhookEventPayload`): `{"id": "<event uuid>", "type": "...", "createdAt": "<ISO>", "data": {...}}`.
`data` holds ids, statuses, timestamps and roles (`sessionId`, `documentId`, `participantId(s)`,
`externalInterviewId` when set). Never document content, links, secrets or e-mail addresses.

## Request

`POST` JSON with headers `RD-Webhook-Id` (delivery id, the same on every retry), `RD-Webhook-Event`,
`RD-Webhook-Timestamp` (unix seconds, fresh per attempt) and
`RD-Webhook-Signature: v1=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>`. Timeout 10 s; redirects are
not followed (a redirect is a failure). Any 2xx is success.

Verify with the **raw** body, a constant-time comparison and a 5-minute tolerance:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';
function verify(secret: string, timestamp: string, rawBody: string, header: string): boolean {
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = Buffer.from(
    'v1=' + createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex'),
  );
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
```

```python
import hmac, hashlib, time
def verify(secret, timestamp, raw_body, header):
    if abs(time.time() - int(timestamp)) > 300: return False
    expected = "v1=" + hmac.new(secret.encode(), f"{timestamp}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header)
```

Deduplicate on the event `id`: delivery is at least once.

## Retries

After attempt 1, 2, … failing, the next attempt is after 1 min, 5 min, 30 min, 2 h, 6 h, 24 h; one more
failure marks the delivery `dead` (7 attempts in total). Override with `WEBHOOK_RETRY_SCHEDULE_SECONDS`
(comma-separated seconds; total attempts = entries + 1). `GET /webhooks/:id/deliveries` lists deliveries
(`pending`, `failed`, `delivered`, `dead`); `POST /webhooks/deliveries/:deliveryId/retry` requeues one with a
fresh schedule. The worker runs inside every server process and claims work with `FOR UPDATE SKIP LOCKED`,
so several instances can share the queue (`WEBHOOK_POLL_MS`, `WEBHOOK_TIMEOUT_MS`).

## Target rules

`https://` only. `http://localhost` and `http://127.0.0.1` are accepted only when `NODE_ENV` is not
`production`. In production the host is resolved when the endpoint is saved and again when connecting; any
loopback, private, link-local, multicast or reserved address is refused. URLs with credentials or fragments
are refused.
