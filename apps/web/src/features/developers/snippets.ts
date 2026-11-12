/**
 * The worked examples of the portal: create a session, retry it safely and
 * verify a webhook, in cURL, TypeScript and Python. Plain strings, so they are
 * shown as text and copied as text.
 */
export type Language = 'curl' | 'typescript' | 'python';

export const LANGUAGES: ReadonlyArray<{ id: Language; label: string }> = [
  { id: 'curl', label: 'cURL' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'python', label: 'Python' },
];

export const CREATE_BODY = `{
  "candidate": { "name": "Aarav Sharma", "email": "aarav@example.com" },
  "interviewers": [{ "name": "Meera Iyer", "email": "meera@acme.example" }],
  "companyName": "Acme Corp",
  "round": { "number": 2, "name": "System design" },
  "scheduledAt": "2030-03-14T15:30:00+05:30",
  "timezone": "Asia/Kolkata",
  "expiresAt": "2030-03-28T15:30:00+05:30",
  "permissions": { "candidateCanEdit": true, "candidateCanExport": false },
  "metadata": { "externalInterviewId": "int_84721" }
}`;

export function createSnippet(language: Language, origin: string): string {
  switch (language) {
    case 'curl':
      return `curl -sS -X POST '${origin}/api/v1/interview-sessions' \\
  -H "Authorization: Bearer $RD_API_KEY" \\
  -H 'Content-Type: application/json' \\
  -H 'Idempotency-Key: hr-int_84721-create' \\
  -d '${CREATE_BODY.replace(/\n\s*/g, ' ')}'`;
    case 'typescript':
      return `const origin = '${origin}';
const apiKey = process.env.RD_API_KEY!; // server side only

const response = await fetch(\`\${origin}/api/v1/interview-sessions\`, {
  method: 'POST',
  headers: {
    Authorization: \`Bearer \${apiKey}\`,
    'Content-Type': 'application/json',
    'Idempotency-Key': 'hr-int_84721-create',
  },
  body: JSON.stringify(${CREATE_BODY.replace(/\n/g, '\n  ')}),
});

if (!response.ok) {
  const { error } = await response.json();
  throw new Error(\`\${error.code}: \${error.message} (request \${error.requestId})\`);
}
const session = await response.json();
console.log(session.candidateAccess.url); // shown once: send it to the candidate`;
    case 'python':
      return `import os
import requests

ORIGIN = "${origin}"
API_KEY = os.environ["RD_API_KEY"]  # server side only

payload = ${pythonLiteral(CREATE_BODY)}

response = requests.post(
    f"{ORIGIN}/api/v1/interview-sessions",
    headers={
        "Authorization": f"Bearer {API_KEY}",
        "Idempotency-Key": "hr-int_84721-create",
    },
    json=payload,
    timeout=30,
)
if not response.ok:
    error = response.json()["error"]
    raise RuntimeError(f"{error['code']}: {error['message']} (request {error['requestId']})")
session = response.json()
print(session["candidateAccess"]["url"])  # shown once: send it to the candidate`;
  }
}

/** JSON with Python's spellings of true/false/null. Only used on the fixed example body. */
function pythonLiteral(json: string): string {
  return json
    .replace(/\btrue\b/g, 'True')
    .replace(/\bfalse\b/g, 'False')
    .replace(/\bnull\b/g, 'None');
}

export function retrySnippet(language: Language, origin: string): string {
  switch (language) {
    case 'curl':
      return `# Same Idempotency-Key and the same body: the first response comes back again.
curl -i -sS -X POST '${origin}/api/v1/interview-sessions' \\
  -H "Authorization: Bearer $RD_API_KEY" \\
  -H 'Content-Type: application/json' \\
  -H 'Idempotency-Key: hr-int_84721-create' \\
  -d @create-session.json
# HTTP/2 201
# idempotency-replayed: true`;
    case 'typescript':
      return `async function createWithRetry(body: unknown, key: string) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const response = await fetch(\`${origin}/api/v1/interview-sessions\`, {
        method: 'POST',
        headers: {
          Authorization: \`Bearer \${process.env.RD_API_KEY}\`,
          'Content-Type': 'application/json',
          'Idempotency-Key': key, // the SAME key on every attempt
        },
        body: JSON.stringify(body),
      });
      if (response.status === 429 || response.status === 503) {
        const wait = Number(response.headers.get('retry-after') ?? 2 ** attempt);
        await new Promise((resolve) => setTimeout(resolve, wait * 1000));
        continue;
      }
      if (response.status === 409) {
        const { error } = await response.clone().json();
        if (error.code === 'IDEMPOTENCY_IN_PROGRESS') {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          continue;
        }
      }
      return response; // replayed responses carry "Idempotency-Replayed: true"
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 500)); // network error
    }
  }
  throw new Error('Giving up after 5 attempts');
}`;
    case 'python':
      return `import os
import time
import requests

def create_with_retry(payload, key, origin="${origin}"):
    for attempt in range(5):
        try:
            response = requests.post(
                f"{origin}/api/v1/interview-sessions",
                headers={
                    "Authorization": f"Bearer {os.environ['RD_API_KEY']}",
                    "Idempotency-Key": key,  # the SAME key on every attempt
                },
                json=payload,
                timeout=30,
            )
        except requests.RequestException:
            time.sleep(2**attempt * 0.5)  # network error: the first attempt may have succeeded
            continue
        if response.status_code in (429, 503):
            time.sleep(float(response.headers.get("Retry-After", 2**attempt)))
            continue
        if response.status_code == 409 and response.json()["error"]["code"] == "IDEMPOTENCY_IN_PROGRESS":
            time.sleep(1)
            continue
        return response  # replayed responses carry "Idempotency-Replayed: true"
    raise RuntimeError("Giving up after 5 attempts")`;
  }
}

export function verifySnippet(language: Language): string {
  switch (language) {
    case 'curl':
      return `# Compute the expected signature by hand (for debugging only):
TIMESTAMP=1893456000
BODY='{"id":"...","type":"session.created","createdAt":"...","data":{}}'
printf '%s.%s' "$TIMESTAMP" "$BODY" \\
  | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" -hex \\
  | sed 's/^.* /v1=/'
# Compare with the RD-Webhook-Signature header.`;
    case 'typescript':
      return `import { createHmac, timingSafeEqual } from 'node:crypto';

const TOLERANCE_SECONDS = 300;

/** rawBody must be the exact bytes received, before any JSON parsing. */
export function verifyWebhook(
  secret: string,
  rawBody: string,
  timestamp: string, // RD-Webhook-Timestamp
  signature: string, // RD-Webhook-Signature, "v1=<hex>"
): boolean {
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds)) return false;
  if (Math.abs(Date.now() / 1000 - seconds) > TOLERANCE_SECONDS) return false;

  const expected = Buffer.from(
    'v1=' + createHmac('sha256', secret).update(\`\${timestamp}.\${rawBody}\`).digest('hex'),
  );
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

// Express: app.post('/hooks', express.raw({ type: 'application/json' }), (req, res) => {
//   const ok = verifyWebhook(secret, req.body.toString('utf8'),
//     req.header('RD-Webhook-Timestamp') ?? '', req.header('RD-Webhook-Signature') ?? '');
//   if (!ok) return res.sendStatus(401);
//   res.sendStatus(204); // answer fast, process afterwards
// });`;
    case 'python':
      return `import hashlib
import hmac
import time

TOLERANCE_SECONDS = 300

def verify_webhook(secret: str, raw_body: bytes, timestamp: str, signature: str) -> bool:
    """raw_body must be the exact bytes received, before any JSON parsing."""
    try:
        seconds = float(timestamp)
    except ValueError:
        return False
    if abs(time.time() - seconds) > TOLERANCE_SECONDS:
        return False
    signed = timestamp.encode() + b"." + raw_body
    expected = "v1=" + hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)

# Flask:
# @app.post("/hooks")
# def hooks():
#     ok = verify_webhook(SECRET, request.get_data(),
#                         request.headers.get("RD-Webhook-Timestamp", ""),
#                         request.headers.get("RD-Webhook-Signature", ""))
#     if not ok:
#         return "", 401
#     return "", 204`;
  }
}

export const WEBHOOK_PAYLOAD_EXAMPLE = `{
  "id": "5e6f7a8b-0000-4000-8000-00000000f001",
  "type": "session.created",
  "createdAt": "2030-03-01T09:00:00.000Z",
  "data": {
    "sessionId": "7d0f6a5e-3c1b-4a52-9d57-2f4a1c8e9b10",
    "documentId": "3b9a6a52-1f0e-4c7d-8a2b-5d6e7f809a1b",
    "status": "scheduled",
    "scheduledAt": "2030-03-14T10:00:00.000Z",
    "roundNumber": 2,
    "participants": [
      { "participantId": "c1f2a3b4-0000-4000-8000-00000000c001", "role": "candidate" },
      { "participantId": "c1f2a3b4-0000-4000-8000-00000000c002", "role": "interviewer" }
    ],
    "externalInterviewId": "int_84721"
  }
}`;

export const ERROR_EXAMPLE = `{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request is not valid.",
    "requestId": "req_3f9c1a7e5b2d4c6a8e0f1b2c",
    "details": [
      { "path": "interviewers.0.email", "message": "Invalid email address" },
      { "path": "expiresAt", "message": "Must be at most 90 days from now." }
    ]
  }
}`;
