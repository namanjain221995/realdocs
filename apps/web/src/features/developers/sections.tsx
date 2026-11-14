/**
 * The written sections of the developer portal. Every value shown here that
 * the server defines (scopes, error codes, webhook events) is imported from
 * `@realtimedocs/contracts`, so the page cannot drift from the API.
 */
import {
  SERVICE_SCOPE_DESCRIPTIONS,
  SERVICE_SCOPES,
  WEBHOOK_EVENTS,
  type V1ErrorCode,
  type WebhookEventType,
} from '@realtimedocs/contracts';
import type { ComponentType, ReactNode } from 'react';
import { Link } from 'react-router';
import {
  createSnippet,
  ERROR_EXAMPLE,
  LANGUAGES,
  retrySnippet,
  verifySnippet,
  WEBHOOK_PAYLOAD_EXAMPLE,
} from './snippets';
import { Callout, CodeBlock, CodeTabs, DataTable } from './widgets';

const origin = () =>
  typeof window === 'undefined' ? 'https://your-server' : window.location.origin;

const ERROR_TABLE: Record<V1ErrorCode, { status: number; meaning: string }> = {
  UNAUTHENTICATED: {
    status: 401,
    meaning: 'The API key is missing, malformed, unknown, revoked or expired.',
  },
  FORBIDDEN: {
    status: 403,
    meaning:
      'The key lacks the scope this endpoint needs, or the caller address is outside the key allow-list.',
  },
  NOT_FOUND: { status: 404, meaning: 'The resource does not exist in this workspace.' },
  VALIDATION_ERROR: {
    status: 400,
    meaning: 'The request is not valid. `details` lists the offending fields.',
  },
  CONFLICT: {
    status: 409,
    meaning:
      'The request conflicts with the current state, for example completing a session that is not in progress.',
  },
  IDEMPOTENCY_CONFLICT: {
    status: 409,
    meaning: 'The Idempotency-Key was already used with a different request.',
  },
  IDEMPOTENCY_IN_PROGRESS: {
    status: 409,
    meaning: 'A request with this Idempotency-Key is still being processed. Retry shortly.',
  },
  RATE_LIMITED: {
    status: 429,
    meaning: 'The key exceeded its request budget. Wait for Retry-After seconds.',
  },
  PAYLOAD_TOO_LARGE: {
    status: 413,
    meaning: 'The request body is larger than the server accepts.',
  },
  UNSUPPORTED_MEDIA_TYPE: { status: 415, meaning: 'Send the body as application/json.' },
  SESSION_CLOSED: {
    status: 410,
    meaning: 'The interview session has ended, so the operation is no longer possible.',
  },
  SERVICE_UNAVAILABLE: {
    status: 503,
    meaning: 'The server is busy or storage is briefly unavailable. Retry with backoff.',
  },
  RELEASE_NOT_AVAILABLE: {
    status: 404,
    meaning: 'No desktop release is published for the requested platform, architecture or channel.',
  },
  INTERNAL: {
    status: 500,
    meaning: 'Unexpected server error. Quote the requestId when you report it.',
  },
};

const EVENT_TABLE: Record<WebhookEventType, string> = {
  'session.created': 'A session was created through the API or the admin pages.',
  'participant.joined':
    'A participant opened their link for the first time (data: sessionId, documentId, participantId, role).',
  'document.first_edited':
    'The first edit was committed to the session document (sent once per session).',
  'session.started': 'The session moved to in_progress.',
  'session.completed': 'The session was completed. Candidate access is closed.',
  'session.cancelled': 'The session was cancelled. Candidate access is closed.',
  'access.revoked':
    'Links were revoked: participant removed, links rotated, or the session closed or archived (data includes participantIds, roles and reason).',
};

function Code({ children }: { children: ReactNode }) {
  return <code>{children}</code>;
}

function Overview() {
  const o = origin();
  return (
    <>
      <p>
        The service API lets your applicant tracking system or scheduling tool create a
        collaborative interview document for each interview, hand out personal links to the
        candidate and the interviewers, and follow the interview through webhooks. Everything is
        plain JSON over HTTPS under <Code>/api/v1</Code>.
      </p>
      <h3>Quick start</h3>
      <ol>
        <li>
          A workspace administrator creates an API key in{' '}
          <Link to="/admin/api-keys">Admin &rarr; API keys</Link>, picks the scopes it needs (at
          least <Code>sessions:create</Code>) and copies the key. It is shown once.
        </li>
        <li>Your server creates a session. The response contains one link per participant:</li>
      </ol>
      <CodeBlock
        label="cURL"
        code={`export RD_API_KEY='rdk_...'   # from the admin page
${createSnippet('curl', o)}`}
      />
      <ol start={3}>
        <li>
          Send <Code>candidateAccess.url</Code> to the candidate and the interviewer links to the
          interviewers. Links look like <Code>{o}/s/&lt;grantId&gt;#&lt;secret&gt;</Code> and are
          only returned in this response.
        </li>
        <li>
          Optionally register a webhook (<Code>POST /api/v1/webhooks</Code>) to hear when people
          join, when the first edit happens and when the interview ends, and call{' '}
          <Code>POST /api/v1/interview-sessions/&#123;id&#125;/complete</Code> when it is over.
        </li>
      </ol>
      <p>
        You can try every endpoint from the <Link to="/docs/api-reference">API reference</Link>. The
        machine-readable description is at <a href="/api/openapi.json">/api/openapi.json</a>{' '}
        (OpenAPI 3.1).
      </p>
    </>
  );
}

function Authentication() {
  return (
    <>
      <p>
        Send the key in the <Code>Authorization</Code> header of every request:
      </p>
      <CodeBlock label="Header" code="Authorization: Bearer rdk_AbCd1234..." />
      <p>
        Keys start with <Code>rdk_</Code>. The first characters (the key prefix) are shown in the
        admin pages and written to audit records so you can tell keys apart; the rest is a secret
        that the server stores only as a hash. Lost keys cannot be recovered: rotate the key
        instead.
      </p>
      <h3>Scopes</h3>
      <p>
        Each key carries a list of scopes. A request to an endpoint whose scope the key lacks is
        answered with <Code>403 FORBIDDEN</Code>. Give a key only what its integration needs.
      </p>
      <DataTable
        caption="Scopes"
        head={['Scope', 'Allows']}
        rows={SERVICE_SCOPES.map((scope) => [
          <code key="s">{scope}</code>,
          SERVICE_SCOPE_DESCRIPTIONS[scope],
        ])}
      />
      <h3>Key handling</h3>
      <ul>
        <li>
          <strong>Shown once.</strong> The secret appears when the key is created or rotated and
          never again. Store it in your secret manager immediately.
        </li>
        <li>
          <strong>IP allow-list.</strong> A key can be limited to CIDR ranges (for example{' '}
          <Code>203.0.113.0/24</Code>). Requests from other addresses get <Code>403 FORBIDDEN</Code>
          .
        </li>
        <li>
          <strong>Expiry.</strong> A key can have an expiry date; after it the key answers{' '}
          <Code>401 UNAUTHENTICATED</Code>.
        </li>
        <li>
          <strong>Rotation.</strong> Rotating creates a new key with the same name and scopes and
          retires the old one. Deploy the new secret, then confirm in the admin page that the old
          key shows no recent use.
        </li>
        <li>
          <strong>Revocation</strong> takes effect immediately.
        </li>
        <li>
          <strong>Never in a browser.</strong> Keys belong on your servers. Do not ship one in a web
          page, mobile app or public repository. The try-it forms on this page keep a key in memory
          only and never store it.
        </li>
      </ul>
    </>
  );
}

function CreatingSessions() {
  return (
    <>
      <p>
        <Code>POST /api/v1/interview-sessions</Code> (scope <Code>sessions:create</Code>) creates
        the document, the session record and one personal link per participant in one step.
      </p>
      <h3>Request</h3>
      <CodeBlock label="JSON" code={createSnippetBody()} />
      <DataTable
        caption="Request fields"
        head={['Field', 'Notes']}
        rows={[
          [<code key="a">candidate</code>, 'Name and email of the candidate.'],
          [<code key="b">interviewers</code>, '1 to 20 people with name and email.'],
          [<code key="c">companyName</code>, 'Used in the document title.'],
          [
            <code key="d">round</code>,
            '{ number: "1"-"99" (a string), name?: string }. A number is still accepted on input; responses always carry a string.',
          ],
          [<code key="e">scheduledAt</code>, 'ISO 8601 date-time with offset.'],
          [
            <code key="f">timezone</code>,
            'IANA zone, for example Asia/Kolkata. Used for the title date and time.',
          ],
          [
            <code key="g">expiresAt</code>,
            'When all links stop working. In the future, at most 90 days from now.',
          ],
          [<code key="h">permissions</code>, 'Optional; see the defaults below.'],
          [
            <code key="i">metadata</code>,
            'Optional string map for your own ids. At most 20 keys; keys match [A-Za-z0-9_.-] up to 64 characters; values up to 256 characters.',
          ],
        ]}
      />
      <p>
        An interviewer whose e-mail address belongs to an existing member account is given access to
        the document in their own account automatically; the response marks that participant with{' '}
        <Code>accountLinked: true</Code>.
      </p>
      <h3>Document title</h3>
      <p>
        The document is named{' '}
        <Code>{'{Candidate_Name}_{Company_Name}_Round_{N}_{YYYY-MM-DD_HH-mm}'}</Code>, with the date
        and time of <Code>scheduledAt</Code> shown in the session&rsquo;s time zone, for example{' '}
        <Code>Aarav_Sharma_Acme_Corp_Round_2_2030-03-14_15-30</Code>. Spaces become underscores and
        characters that are unsafe in file names are removed. If a document with that title already
        exists, a short suffix such as <Code>_K7QM</Code> is added so titles stay unique; the
        response and <Code>generatedTitle</Code> show the final title.
      </p>
      <h3>Permissions</h3>
      <DataTable
        caption="Permission defaults"
        head={['Flag', 'Default', 'Effect']}
        rows={[
          [
            <code key="1">candidateCanEdit</code>,
            'true',
            'The candidate can type in the document.',
          ],
          [
            <code key="2">interviewerCanEdit</code>,
            'true',
            'Interviewers can type in the document.',
          ],
          [
            <code key="3">candidateCanExport</code>,
            'false',
            'The candidate can export or download the document.',
          ],
          [
            <code key="4">candidateCanShare</code>,
            'false',
            'The candidate can create share links.',
          ],
          [
            <code key="5">candidateCanViewHistory</code>,
            'false',
            'The candidate can open version history.',
          ],
        ]}
      />
      <h3>Response (201)</h3>
      <p>
        The body has <Code>sessionId</Code>, <Code>documentId</Code>, <Code>title</Code>,{' '}
        <Code>status: &quot;scheduled&quot;</Code>, <Code>candidateAccess</Code>,{' '}
        <Code>interviewerAccess</Code> (the first interviewer), <Code>participants</Code> (every
        participant with their own <Code>access.url</Code>), <Code>adminUrl</Code> and{' '}
        <Code>createdAt</Code>. Each link is <Code>{'{ url, expiresAt }'}</Code> and the URL is
        returned only now; to get a fresh one use{' '}
        <Code>POST /interview-sessions/&#123;id&#125;/rotate-links</Code>.
      </p>
      <p>
        Session lifecycle: <Code>scheduled</Code> &rarr; <Code>in_progress</Code> (start) &rarr;{' '}
        <Code>completed</Code> (complete) or <Code>cancelled</Code> (cancel from scheduled or in
        progress); <Code>archived</Code> (DELETE) is final. Use <Code>PATCH</Code> to change times,
        permissions, metadata or expiry while the session is scheduled or in progress.
      </p>
    </>
  );
}

function createSnippetBody(): string {
  return `{
  "candidate": { "name": "Aarav Sharma", "email": "aarav@example.com" },
  "interviewers": [{ "name": "Meera Iyer", "email": "meera@acme.example" }],
  "companyName": "Acme Corp",
  "round": { "number": "2", "name": "System design" },
  "scheduledAt": "2030-03-14T15:30:00+05:30",
  "timezone": "Asia/Kolkata",
  "expiresAt": "2030-03-28T15:30:00+05:30",
  "permissions": { "candidateCanEdit": true, "interviewerCanEdit": true },
  "metadata": { "externalInterviewId": "int_84721" }
}`;
}

const DOC_LAYOUT = `==================================================
VERSION 1
Edited At: 2026-06-30 02:21:18 AM IST
Edited By: Aarav Sharma (Candidate, aarav@example.com)
Action: Pasted

ADDED:
- [02:21:18 AM] First line of the answer
- [02:21:18 AM] [IMAGE 3f6c…] image pasted (images/3f6c….png)

REMOVED:
- (nothing removed)

CURRENT SNAPSHOT:
First line of the answer
[IMAGE 3f6c…] images/3f6c….png`;

function VersionHistoryDocument() {
  const o = origin();
  return (
    <>
      <p>
        The version history document is a text file, <Code>doc.txt</Code>, that lists every version
        of a document with who edited it and when, the lines added and removed, and the current
        snapshot. The images pasted into the document come with it. All endpoints are read-only and
        need a key with the scope <Code>documents:history:read</Code>.
      </p>
      <h3>Endpoints</h3>
      <DataTable
        caption="Version history endpoints"
        head={['Endpoint', 'Returns']}
        rows={[
          [
            <code key="1">GET /api/v1/documents/&#123;documentId&#125;/version-history</code>,
            <>
              <Code>?format=txt</Code> (default) is <Code>doc.txt</Code> as <Code>text/plain</Code>;{' '}
              <Code>?format=json</Code> is the same data as JSON. Optional{' '}
              <Code>timezone=&lt;IANA name&gt;</Code> for the times.
            </>,
          ],
          [
            <code key="2">
              GET /api/v1/documents/&#123;documentId&#125;/version-history/images
            </code>,
            <>
              The list of images: <Code>id</Code>, <Code>fileName</Code>, <Code>mime</Code>,{' '}
              <Code>sizeBytes</Code>, <Code>sha256</Code>, <Code>firstVersion</Code>,{' '}
              <Code>lastVersion</Code> and <Code>url</Code>.
            </>,
          ],
          [
            <code key="3">
              GET
              /api/v1/documents/&#123;documentId&#125;/version-history/images/&#123;imageId&#125;
            </code>,
            'The bytes of one image.',
          ],
          [
            <code key="4">
              GET /api/v1/documents/&#123;documentId&#125;/version-history/archive
            </code>,
            <>
              A zip with <Code>docs/doc.txt</Code>, <Code>images/&lt;fileName&gt;</Code> and{' '}
              <Code>manifest.json</Code>.
            </>,
          ],
          [
            <code key="5">
              GET /api/v1/interview-sessions/&#123;sessionId&#125;/version-history
            </code>,
            <>
              The same three endpoints (and <Code>/images</Code>,{' '}
              <Code>/images/&#123;imageId&#125;</Code>, <Code>/archive</Code>) for the document of
              an interview session.
            </>,
          ],
        ]}
      />
      <h3>Examples</h3>
      <CodeBlock
        label="Download doc.txt"
        code={`curl -sS -o doc.txt \\
  -H "Authorization: Bearer $RD_API_KEY" \\
  '${o}/api/v1/documents/<documentId>/version-history?format=txt&timezone=Asia/Kolkata'`}
      />
      <CodeBlock
        label="List the images"
        code={`curl -sS \\
  -H "Authorization: Bearer $RD_API_KEY" \\
  '${o}/api/v1/documents/<documentId>/version-history/images'`}
      />
      <CodeBlock
        label="Download one image"
        code={`curl -sS -o image.png \\
  -H "Authorization: Bearer $RD_API_KEY" \\
  '${o}/api/v1/documents/<documentId>/version-history/images/<imageId>'`}
      />
      <h3>Document layout</h3>
      <CodeBlock label="doc.txt" code={DOC_LAYOUT} />
      <p>
        Every version has its own block with a number, the time and the person, then the lines{' '}
        <Code>ADDED</Code> and <Code>REMOVED</Code> in that version and the{' '}
        <Code>CURRENT SNAPSHOT</Code> of the whole document at that point. A pasted image appears as
        a line that starts with <Code>[IMAGE &lt;id&gt;]</Code> and the file is in{' '}
        <Code>images/</Code> of the archive.
      </p>
    </>
  );
}

function AccessFlow() {
  return (
    <>
      <p>
        A participant link has the form <Code>{origin()}/s/&lt;grantId&gt;#&lt;secret&gt;</Code>.
        The secret is in the fragment, which browsers never send to servers or put in referrer
        headers.
      </p>
      <ol>
        <li>
          The participant opens the link. The page reads the secret from the fragment, removes it
          from the address bar and sends it once to the server.
        </li>
        <li>
          The server checks it and answers with an <Code>HttpOnly</Code>, <Code>Secure</Code>,{' '}
          <Code>SameSite</Code> cookie that is valid for that document until the link expires. The
          secret itself is not usable again from the address bar.
        </li>
        <li>
          The participant lands in the session document. Everyone in the session edits the same
          document in the same real-time room, and presence shows who is there with their role, for
          example &ldquo;Aarav &mdash; Candidate&rdquo; and &ldquo;Meera &mdash; Interviewer&rdquo;.
        </li>
      </ol>
      <h3>What each role can do</h3>
      <ul>
        <li>
          Editing follows <Code>candidateCanEdit</Code> and <Code>interviewerCanEdit</Code>; a
          participant without edit permission can read and follow along.
        </li>
        <li>
          Candidates cannot use <strong>Open in Desktop</strong> and cannot export unless{' '}
          <Code>candidateCanExport</Code> is true; sharing and version history follow{' '}
          <Code>candidateCanShare</Code> and <Code>candidateCanViewHistory</Code>.
        </li>
        <li>
          <strong>Complete</strong> and <strong>cancel</strong> close the candidate out at once:
          their links are revoked, an open editor is disconnected and the page shows a clear message
          that the interview has ended. Interviewers keep read access until their links expire, so
          they can review the notes.
        </li>
        <li>
          Removing a participant or rotating links revokes the old link immediately and disconnects
          anyone using it.
        </li>
      </ul>
      <Callout title="Links are credentials">
        Anyone holding a link can enter as that participant until it expires or is revoked. Send
        links over a channel you trust, keep them out of logs, and set <Code>expiresAt</Code> to
        shortly after the interview.
      </Callout>
    </>
  );
}

function Idempotency() {
  const o = origin();
  return (
    <>
      <p>
        Networks fail after a request was processed. To retry safely, send an{' '}
        <Code>Idempotency-Key</Code> header on <Code>POST /interview-sessions</Code>: 1 to 128
        visible ASCII characters, unique per operation (a UUID, or your own interview id plus the
        action).
      </p>
      <ul>
        <li>
          The key is remembered for <strong>24 hours</strong>.
        </li>
        <li>
          Same key, same request: the original response (status and body, including the links) is
          returned again with the header <Code>Idempotency-Replayed: true</Code>. No second session
          is created.
        </li>
        <li>
          Same key, different request: <Code>409 IDEMPOTENCY_CONFLICT</Code>.
        </li>
        <li>
          Same key while the first request is still running:{' '}
          <Code>409 IDEMPOTENCY_IN_PROGRESS</Code>. Wait a moment and retry with the same key.
        </li>
      </ul>
      <CodeTabs
        label="Retry example language"
        tabs={LANGUAGES.map((l) => ({ id: l.id, label: l.label, code: retrySnippet(l.id, o) }))}
      />
    </>
  );
}

function Errors() {
  return (
    <>
      <p>
        Every error under <Code>/api/v1</Code> has the same envelope:
      </p>
      <CodeBlock label="JSON" code={ERROR_EXAMPLE} />
      <p>
        <Code>code</Code> is stable and meant for programs; <Code>message</Code> is for people and
        may change. <Code>details</Code> appears for validation errors, with a field{' '}
        <Code>path</Code> and a message for each problem.
      </p>
      <DataTable
        caption="Error codes"
        head={['Code', 'HTTP status', 'Meaning']}
        rows={(
          Object.entries(ERROR_TABLE) as Array<[V1ErrorCode, { status: number; meaning: string }]>
        ).map(([code, info]) => [<code key="c">{code}</code>, String(info.status), info.meaning])}
      />
      <h3>Request ids</h3>
      <p>
        Every response carries <Code>X-Request-Id</Code>, and the same value is in{' '}
        <Code>error.requestId</Code>. You may send your own <Code>X-Request-Id</Code> to correlate
        calls with your logs; it must match <Code>^[A-Za-z0-9_-]&#123;8,64&#125;$</Code>, otherwise
        the server ignores it and generates one (<Code>req_&hellip;</Code>). Quote the id when you
        contact an administrator.
      </p>
    </>
  );
}

function Pagination() {
  return (
    <>
      <p>
        List endpoints return <Code>{'{ "items": [...], "nextCursor": "..." | null }'}</Code>,
        newest first. Pass <Code>limit</Code> (1 to 100, default 25 for sessions and deliveries, 50
        for the audit trail) and, to continue, the previous <Code>nextCursor</Code> as{' '}
        <Code>cursor</Code>. A <Code>null</Code> <Code>nextCursor</Code> means you have everything.
        Treat cursors as opaque strings and keep the same filters while paging.
      </p>
      <CodeBlock
        label="cURL"
        code={`curl -sS "${origin()}/api/v1/interview-sessions?limit=100&status=completed" \\
  -H "Authorization: Bearer $RD_API_KEY"
# then: ...&cursor=<nextCursor>`}
      />
    </>
  );
}

function RateLimits() {
  return (
    <>
      <p>
        Each API key has its own request budget per minute. The default is{' '}
        <strong>600 requests per minute</strong> per key (the administrator sets it with{' '}
        <Code>RATE_API_KEY_PER_MINUTE</Code>). Going over it gives <Code>429 RATE_LIMITED</Code>{' '}
        with a <Code>Retry-After</Code> header (seconds). Wait that long, then retry; use
        exponential backoff with jitter for repeated failures, and keep the same{' '}
        <Code>Idempotency-Key</Code> when you retry a create.
      </p>
    </>
  );
}

function Webhooks() {
  return (
    <>
      <p>
        Register an endpoint with <Code>POST /api/v1/webhooks</Code> (scope{' '}
        <Code>webhooks:manage</Code>) or in <Link to="/admin/webhooks">Admin &rarr; Webhooks</Link>.
        The signing secret is shown once. The URL must be <Code>https</Code> and resolve to a public
        address: private, loopback, link-local and other internal addresses are refused, also at
        delivery time, so the delivery worker cannot be used to reach your internal network.
      </p>
      <h3>Events</h3>
      <DataTable
        caption="Webhook events"
        head={['Event', 'Sent when']}
        rows={WEBHOOK_EVENTS.map((event) => [<code key="e">{event}</code>, EVENT_TABLE[event]])}
      />
      <h3>Payload</h3>
      <p>
        Every delivery is a <Code>POST</Code> with <Code>Content-Type: application/json</Code> and
        the body <Code>{'{ id, type, createdAt, data }'}</Code>. <Code>id</Code> is the event id:
        the same event is always delivered with the same id, so use it to de-duplicate. The payload
        never contains document content or access secrets.
      </p>
      <CodeBlock label="session.created" code={WEBHOOK_PAYLOAD_EXAMPLE} />
      <h3>Headers</h3>
      <DataTable
        caption="Webhook headers"
        head={['Header', 'Value']}
        rows={[
          [<code key="1">RD-Webhook-Id</code>, 'Identifier of this delivery.'],
          [<code key="2">RD-Webhook-Event</code>, 'The event type.'],
          [
            <code key="3">RD-Webhook-Timestamp</code>,
            'Unix time in seconds when this attempt was signed.',
          ],
          [
            <code key="4">RD-Webhook-Signature</code>,
            <>
              <code>v1=</code> followed by the lowercase hex HMAC-SHA256 of{' '}
              <code>&quot;&lt;timestamp&gt;.&lt;raw body&gt;&quot;</code> with the endpoint secret.
            </>,
          ],
        ]}
      />
      <h3>Verifying a delivery</h3>
      <ol>
        <li>Read the raw request body as bytes/text, before any JSON parsing.</li>
        <li>Reject the request if the timestamp is more than 5 minutes from your clock.</li>
        <li>
          Compute <Code>v1=</Code> + hex HMAC-SHA256(secret,{' '}
          <Code>timestamp + &quot;.&quot; + rawBody</Code>).
        </li>
        <li>Compare with the header in constant time. Reject on mismatch.</li>
      </ol>
      <CodeTabs
        label="Verification language"
        tabs={LANGUAGES.map((l) => ({ id: l.id, label: l.label, code: verifySnippet(l.id) }))}
      />
      <h3>Delivery and retries</h3>
      <ul>
        <li>
          Answer with any <Code>2xx</Code> status within <strong>10 seconds</strong>. Do the real
          work after answering.
        </li>
        <li>Redirects are not followed and count as a failure.</li>
        <li>
          A failed delivery is retried after{' '}
          <strong>1 minute, 5 minutes, 30 minutes, 2 hours, 6 hours and 24 hours</strong>; after the
          last attempt it is marked <Code>dead</Code>. Deliveries and their last error are visible
          in the admin page and through <Code>GET /api/v1/webhooks/&#123;id&#125;/deliveries</Code>;
          retry one with <Code>POST /api/v1/webhooks/deliveries/&#123;deliveryId&#125;/retry</Code>.
        </li>
        <li>
          Delivery is at least once and ordering is not guaranteed: make your handler idempotent.
        </li>
      </ul>
    </>
  );
}

function SecurityGuidance() {
  return (
    <ul>
      <li>
        Keep API keys and webhook secrets in a secret manager; give each integration its own key
        with the fewest scopes.
      </li>
      <li>
        Restrict keys to your server addresses with the CIDR allow-list and set an expiry; rotate on
        a schedule and when people leave.
      </li>
      <li>
        Never call the API from a browser or mobile app, and never log the{' '}
        <Code>Authorization</Code> header or participant links.
      </li>
      <li>
        Always verify webhook signatures and timestamps on the raw body, with a constant-time
        comparison.
      </li>
      <li>
        Serve your webhook endpoint over HTTPS only; do not make it reachable without the signature
        check.
      </li>
      <li>
        Treat participant links like passwords: short expiry, rotate if they leak, deliver by a
        private channel.
      </li>
      <li>
        Use <Code>Idempotency-Key</Code> on every create so a retry cannot hand out a second set of
        links.
      </li>
      <li>
        Watch the audit trail (<Code>GET /interview-sessions/&#123;id&#125;/audit</Code>) and the
        key&rsquo;s last-used time for surprises.
      </li>
    </ul>
  );
}

function Versioning() {
  return (
    <>
      <p>
        The version is part of the path: <Code>/api/v1</Code>. Within v1 changes are additive only:
        new endpoints, new optional request fields, new response fields, new webhook event types and
        new enum values may appear. Write clients that ignore fields and unknown event types they do
        not understand.
      </p>
      <p>
        A breaking change (removing or renaming a field, changing a meaning or a required input)
        ships as <Code>/api/v2</Code>. When v2 is released, v1 keeps working for at least{' '}
        <strong>12 months</strong> alongside it, and the deprecation is announced in the changelog
        before it takes effect.
      </p>
    </>
  );
}

function Changelog() {
  return (
    <>
      <h3>1.0.0</h3>
      <p>Initial release of the service API.</p>
      <ul>
        <li>API keys with scopes, CIDR allow-lists, expiry and rotation.</li>
        <li>
          Interview sessions: create, list, read, change, start, complete, cancel, archive;
          participants and link rotation; document read and audit trail.
        </li>
        <li>Idempotent session creation.</li>
        <li>Webhooks with HMAC-SHA256 signatures, retries and delivery history.</li>
        <li>
          OpenAPI 3.1 document at <a href="/api/openapi.json">/api/openapi.json</a>.
        </li>
      </ul>
    </>
  );
}

function Examples() {
  const o = origin();
  return (
    <>
      <h3>Create a session</h3>
      <CodeTabs
        label="Create example language"
        tabs={LANGUAGES.map((l) => ({ id: l.id, label: l.label, code: createSnippet(l.id, o) }))}
      />
      <h3>Retry safely with an idempotency key</h3>
      <CodeTabs
        label="Retry example language"
        tabs={LANGUAGES.map((l) => ({ id: l.id, label: l.label, code: retrySnippet(l.id, o) }))}
      />
      <h3>Verify a webhook</h3>
      <CodeTabs
        label="Verify example language"
        tabs={LANGUAGES.map((l) => ({ id: l.id, label: l.label, code: verifySnippet(l.id) }))}
      />
    </>
  );
}

export interface PortalSection {
  id: string;
  title: string;
  summary: string;
  Component: ComponentType;
}

/** Sub-route ids under `/docs/`. None may equal a guide slug (those redirect to `/guides/`). */
export const PORTAL_SECTIONS: readonly PortalSection[] = [
  {
    id: 'overview',
    title: 'Overview and quick start',
    summary: 'Create a key, create a session, open the links.',
    Component: Overview,
  },
  {
    id: 'authentication',
    title: 'Authentication',
    summary: 'API keys, scopes and key handling.',
    Component: Authentication,
  },
  {
    id: 'sessions',
    title: 'Creating a session',
    summary: 'Request, response, title format, permissions, limits.',
    Component: CreatingSessions,
  },
  {
    id: 'version-history',
    title: 'Version history document',
    summary: 'doc.txt, images and the archive for a document or a session.',
    Component: VersionHistoryDocument,
  },
  {
    id: 'access',
    title: 'Candidate and interviewer access',
    summary: 'How links become a signed-in room.',
    Component: AccessFlow,
  },
  {
    id: 'idempotency',
    title: 'Idempotency',
    summary: 'Retry creates without duplicates.',
    Component: Idempotency,
  },
  {
    id: 'errors',
    title: 'Errors',
    summary: 'The error envelope and every code.',
    Component: Errors,
  },
  {
    id: 'pagination',
    title: 'Pagination',
    summary: 'limit, cursor and nextCursor.',
    Component: Pagination,
  },
  {
    id: 'rate-limits',
    title: 'Rate limits',
    summary: 'Per-key budget and Retry-After.',
    Component: RateLimits,
  },
  {
    id: 'webhooks',
    title: 'Webhooks',
    summary: 'Events, signatures, retries.',
    Component: Webhooks,
  },
  {
    id: 'security-guidance',
    title: 'Security guidance',
    summary: 'Keeping keys, links and webhooks safe.',
    Component: SecurityGuidance,
  },
  {
    id: 'versioning',
    title: 'Versioning',
    summary: 'What stays stable, and for how long.',
    Component: Versioning,
  },
  {
    id: 'changelog',
    title: 'Changelog',
    summary: 'What changed in each version.',
    Component: Changelog,
  },
  {
    id: 'examples',
    title: 'Code examples',
    summary: 'cURL, TypeScript and Python.',
    Component: Examples,
  },
];
