/** Examples shown in the OpenAPI document and the developer portal; validated against the schemas by tests. */
const DAY = 86_400_000;

const sessionId = '7d0f6a5e-3c1b-4a52-9d57-2f4a1c8e9b10';
const documentId = '3b9a6a52-1f0e-4c7d-8a2b-5d6e7f809a1b';
const candidateId = 'c1f2a3b4-0000-4000-8000-00000000c001';
const interviewerId = 'c1f2a3b4-0000-4000-8000-00000000c002';
export const EXAMPLE_ORIGIN = 'https://docs.example.com';

export function exampleCreateRequest() {
  return {
    candidate: { name: 'Aarav Sharma', email: 'aarav@example.com' },
    interviewers: [{ name: 'Meera Iyer', email: 'meera@acme.example' }],
    companyName: 'Acme Corp',
    round: { number: 2, name: 'System design' },
    scheduledAt: '2030-03-14T15:30:00+05:30',
    timezone: 'Asia/Kolkata',
    expiresAt: new Date(Date.now() + 14 * DAY).toISOString(),
    permissions: {
      candidateCanEdit: true,
      interviewerCanEdit: true,
      candidateCanExport: false,
      candidateCanShare: false,
      candidateCanViewHistory: false,
    },
    metadata: { externalInterviewId: 'int_84721' },
  };
}

export function exampleCreateResponse() {
  const expiresAt = new Date(Date.now() + 14 * DAY).toISOString();
  const link = (grant: string) => ({
    url: `${EXAMPLE_ORIGIN}/s/${grant}#Z0n3q9bQy1uXJ7mYf2m0yq2Zp6l3d1H5aV8cT4rWk9E`,
    expiresAt,
  });
  return {
    sessionId,
    documentId,
    title: 'Aarav_Sharma_Acme_Corp_Round_2_2030-03-14_15-30',
    status: 'scheduled' as const,
    candidateAccess: link('9a1b2c3d-0000-4000-8000-000000000001'),
    interviewerAccess: link('9a1b2c3d-0000-4000-8000-000000000002'),
    participants: [
      {
        participantId: candidateId,
        role: 'candidate' as const,
        name: 'Aarav Sharma',
        email: 'aarav@example.com',
        access: link('9a1b2c3d-0000-4000-8000-000000000001'),
      },
      {
        participantId: interviewerId,
        role: 'interviewer' as const,
        name: 'Meera Iyer',
        email: 'meera@acme.example',
        access: link('9a1b2c3d-0000-4000-8000-000000000002'),
      },
    ],
    adminUrl: `/admin/interview-sessions/${sessionId}`,
    createdAt: new Date().toISOString(),
  };
}

export function exampleSession() {
  const now = new Date().toISOString();
  return {
    sessionId,
    documentId,
    title: 'Aarav_Sharma_Acme_Corp_Round_2_2030-03-14_15-30',
    generatedTitle: 'Aarav_Sharma_Acme_Corp_Round_2_2030-03-14_15-30',
    status: 'scheduled' as const,
    companyName: 'Acme Corp',
    round: { number: 2, name: 'System design' as string | null },
    scheduledAt: '2030-03-14T10:00:00.000Z',
    timezone: 'Asia/Kolkata',
    expiresAt: new Date(Date.now() + 14 * DAY).toISOString(),
    permissions: exampleCreateRequest().permissions,
    metadata: { externalInterviewId: 'int_84721' },
    participants: [
      {
        participantId: candidateId,
        role: 'candidate' as const,
        name: 'Aarav Sharma',
        email: 'aarav@example.com',
        firstJoinedAt: null,
        lastJoinedAt: null,
        removedAt: null,
        linkState: 'active' as const,
        liveConnections: 0,
      },
    ],
    adminUrl: `/admin/interview-sessions/${sessionId}`,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    archivedAt: null,
  };
}

export const exampleIds = { sessionId, documentId, candidateId, interviewerId };

export function exampleWebhookEndpoint() {
  return {
    id: '5e6f7a8b-0000-4000-8000-00000000d001',
    url: 'https://hooks.example.com/realtimedocs',
    events: ['session.created', 'session.completed'] as const,
    enabled: true,
    createdAt: new Date().toISOString(),
    disabledAt: null,
  };
}

export function exampleDelivery() {
  return {
    id: '5e6f7a8b-0000-4000-8000-00000000e001',
    endpointId: '5e6f7a8b-0000-4000-8000-00000000d001',
    eventId: '5e6f7a8b-0000-4000-8000-00000000f001',
    eventType: 'session.created',
    status: 'delivered' as const,
    attempts: 1,
    nextAttemptAt: null,
    lastStatusCode: 200,
    lastError: null,
    createdAt: new Date().toISOString(),
    deliveredAt: new Date().toISOString(),
  };
}
