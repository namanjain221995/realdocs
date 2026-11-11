/**
 * Fixture data for the mocked API. Everything is built from the contract
 * types; `mockApi.ts` additionally validates each response against the zod
 * schema before sending it, so a fixture that drifts from the contract fails
 * the test that uses it.
 */
import type {
  AuditEvent,
  DocumentSummary,
  Invitation,
  Member,
  Participant,
  ShareGrant,
  Snapshot,
  User,
} from '@realtimedocs/contracts';

/** The tests freeze the browser clock at this instant. */
export const NOW = '2026-11-10T12:00:00.000Z';
export const NOW_MS = Date.parse(NOW);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const ago = (ms: number): string => new Date(NOW_MS - ms).toISOString();
export const ahead = (ms: number): string => new Date(NOW_MS + ms).toISOString();
export const minutes = (n: number): number => n * MINUTE;
export const hours = (n: number): number => n * HOUR;
export const days = (n: number): number => n * DAY;

function uuid(group: string, n: number): string {
  return `${group}-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

export const USER_IDS = {
  asha: uuid('a0000001', 1),
  ben: uuid('a0000001', 2),
  chen: uuid('a0000001', 3),
  dana: uuid('a0000001', 4),
} as const;

export const DOC_IDS = {
  launch: uuid('d0000001', 1),
  board: uuid('d0000001', 2),
  onboarding: uuid('d0000001', 3),
  pricing: uuid('d0000001', 4),
  allHands: uuid('d0000001', 5),
  retro: uuid('d0000001', 6),
  oldPlan: uuid('d0000001', 7),
  scratch: uuid('d0000001', 8),
  missing: uuid('d0000001', 99),
} as const;

export const SHARE_IDS = {
  press: uuid('5a000001', 1),
  reviewers: uuid('5a000001', 2),
  expired: uuid('5a000001', 3),
  revoked: uuid('5a000001', 4),
} as const;

export const INVITATION_IDS = {
  pending: uuid('1e000001', 1),
  open: uuid('1e000001', 2),
  accepted: uuid('1e000001', 3),
  expired: uuid('1e000001', 4),
} as const;

/** 43 base64url characters each: the shape of real capability secrets. Test values only. */
export const SECRETS = {
  share: 'kT3vQ9xLm2Zr8Wb5Yc1Nd7Hf4Jg6Pa0SeUiOoXyVtRw',
  shareOther: 'Zx9Cv8Bn7Mq6Wl5Kj4Hg3Fd2Sa1Po0IuYtReWqLkJhG',
  invite: 'Hy6Tg5Rf4Ed3Ws2Qa1Zx0Cv9Bn8Mj7Ku6Li5Oo4Pp3Y',
  handoff: 'Qw1Er2Ty3Ui4Op5As6Df7Gh8Jk9Lz0Xc1Vb2Nm3Qa4W',
} as const;

export const USERS: Record<keyof typeof USER_IDS, User> = {
  asha: {
    id: USER_IDS.asha,
    email: 'asha.rao@northwind.example',
    displayName: 'Asha Rao',
    role: 'admin',
    status: 'active',
    createdAt: ago(days(120)),
  },
  ben: {
    id: USER_IDS.ben,
    email: 'ben.ortiz@northwind.example',
    displayName: 'Ben Ortiz',
    role: 'member',
    status: 'active',
    createdAt: ago(days(64)),
  },
  chen: {
    id: USER_IDS.chen,
    email: 'chen.wei@northwind.example',
    displayName: 'Chen Wei',
    role: 'member',
    status: 'active',
    createdAt: ago(days(20)),
  },
  dana: {
    id: USER_IDS.dana,
    email: 'dana.kovacs@northwind.example',
    displayName: 'Dana Kovács',
    role: 'member',
    status: 'disabled',
    createdAt: ago(days(200)),
  },
};

/** Sign-in credentials the mock accepts. */
export const PASSWORDS: Record<string, string> = {
  [USERS.asha.email]: 'correct horse battery staple',
  [USERS.ben.email]: 'another long passphrase 42',
  [USERS.chen.email]: 'chen keeps a third passphrase',
};

export type StoredDocument = Omit<DocumentSummary, 'access'>;

function doc(
  id: string,
  title: string,
  editedAgo: number,
  overrides: Partial<StoredDocument> = {},
): StoredDocument {
  return {
    id,
    title,
    status: 'active',
    generation: 1,
    schemaVersion: 1,
    createdAt: ago(editedAgo + days(9)),
    updatedAt: ago(editedAgo),
    contentUpdatedAt: ago(editedAgo),
    archivedAt: null,
    trashedAt: null,
    purgeAfter: null,
    createdByName: 'Asha Rao',
    ...overrides,
  };
}

export function seedDocuments(): StoredDocument[] {
  return [
    doc(DOC_IDS.launch, 'Q4 launch plan', minutes(5), { generation: 2 }),
    doc(DOC_IDS.board, 'Board meeting notes, November', hours(3)),
    doc(DOC_IDS.onboarding, 'Onboarding checklist for new editors', hours(26)),
    doc(DOC_IDS.pricing, 'Pricing questions and answers (draft)', days(4)),
    doc(
      DOC_IDS.allHands,
      'Speaker notes for the all-hands: what changed this quarter and what we are asking of every team',
      days(12),
    ),
    doc(DOC_IDS.retro, 'Incident review: checkout outage', days(40), {
      status: 'archived',
      archivedAt: ago(days(6)),
    }),
    doc(DOC_IDS.oldPlan, 'Launch plan (superseded)', days(50), {
      status: 'trashed',
      trashedAt: ago(days(2)),
      purgeAfter: ahead(days(28)),
    }),
    doc(DOC_IDS.scratch, 'Scratch notes', days(90), {
      status: 'trashed',
      trashedAt: ago(days(28) + hours(2)),
      purgeAfter: ahead(days(2) - hours(2)),
    }),
  ];
}

export function seedMembers(): Record<string, Member[]> {
  return {
    [DOC_IDS.launch]: [
      {
        userId: USER_IDS.ben,
        email: USERS.ben.email,
        displayName: USERS.ben.displayName,
        role: 'editor',
        userStatus: 'active',
        grantedAt: ago(days(8)),
      },
    ],
    [DOC_IDS.board]: [
      {
        userId: USER_IDS.ben,
        email: USERS.ben.email,
        displayName: USERS.ben.displayName,
        role: 'viewer',
        userStatus: 'active',
        grantedAt: ago(days(3)),
      },
    ],
    [DOC_IDS.retro]: [
      {
        userId: USER_IDS.ben,
        email: USERS.ben.email,
        displayName: USERS.ben.displayName,
        role: 'editor',
        userStatus: 'active',
        grantedAt: ago(days(41)),
      },
    ],
  };
}

function share(id: string, documentId: string, overrides: Partial<ShareGrant> = {}): ShareGrant {
  return {
    id,
    documentId,
    role: 'viewer',
    label: '',
    state: 'active',
    createdAt: ago(days(2)),
    createdByName: 'Asha Rao',
    expiresAt: ahead(days(5)),
    revokedAt: null,
    lastUsedAt: null,
    activeSessions: 0,
    liveConnections: 0,
    ...overrides,
  };
}

export function seedShares(): Record<string, ShareGrant[]> {
  return {
    [DOC_IDS.launch]: [
      share(SHARE_IDS.press, DOC_IDS.launch, {
        label: 'Press preview',
        lastUsedAt: ago(minutes(4)),
        activeSessions: 3,
        liveConnections: 2,
      }),
      share(SHARE_IDS.reviewers, DOC_IDS.launch, {
        label: 'External reviewers',
        role: 'editor',
        expiresAt: null,
        createdAt: ago(days(6)),
        lastUsedAt: ago(days(1)),
        activeSessions: 1,
      }),
      share(SHARE_IDS.expired, DOC_IDS.launch, {
        label: 'Agency, first round',
        state: 'expired',
        createdAt: ago(days(20)),
        expiresAt: ago(days(6)),
        lastUsedAt: ago(days(7)),
      }),
      share(SHARE_IDS.revoked, DOC_IDS.launch, {
        state: 'revoked',
        createdAt: ago(days(15)),
        expiresAt: ahead(days(15)),
        revokedAt: ago(days(9)),
      }),
    ],
  };
}

export function seedLive(): Record<string, Participant[]> {
  return {
    [DOC_IDS.launch]: [
      { id: 'conn-1', name: 'Asha Rao', color: '#6fd6a0', role: 'admin', kind: 'user' },
      { id: 'conn-2', name: 'Ben Ortiz', color: '#74c5ee', role: 'editor', kind: 'user' },
      { id: 'conn-3', name: 'Guest 4821', color: '#f0b072', role: 'viewer', kind: 'guest' },
      { id: 'conn-4', name: 'Guest 1177', color: '#c4a8f2', role: 'viewer', kind: 'guest' },
    ],
  };
}

export function seedSnapshots(): Record<string, Snapshot[]> {
  return {
    [DOC_IDS.launch]: [
      {
        id: uuid('5b000001', 1),
        documentId: DOC_IDS.launch,
        name: 'Before the pricing rewrite',
        kind: 'named',
        generation: 2,
        sizeBytes: 48_213,
        createdAt: ago(hours(5)),
        createdByName: 'Asha Rao',
      },
      {
        id: uuid('5b000001', 2),
        documentId: DOC_IDS.launch,
        name: 'Before restoring “First full draft”',
        kind: 'pre_restore',
        generation: 1,
        sizeBytes: 51_902,
        createdAt: ago(days(3)),
        createdByName: 'Asha Rao',
      },
      {
        id: uuid('5b000001', 3),
        documentId: DOC_IDS.launch,
        name: 'First full draft',
        kind: 'named',
        generation: 1,
        sizeBytes: 39_077,
        createdAt: ago(days(9)),
        createdByName: 'Ben Ortiz',
      },
    ],
  };
}

export function seedInvitations(): Invitation[] {
  return [
    {
      id: INVITATION_IDS.pending,
      email: 'priya.nair@northwind.example',
      role: 'member',
      state: 'pending',
      createdAt: ago(hours(20)),
      createdByName: 'Asha Rao',
      expiresAt: ahead(days(6)),
      acceptedAt: null,
      acceptedByName: null,
    },
    {
      id: INVITATION_IDS.open,
      email: null,
      role: 'member',
      state: 'pending',
      createdAt: ago(days(2)),
      createdByName: 'Asha Rao',
      expiresAt: ahead(days(1)),
      acceptedAt: null,
      acceptedByName: null,
    },
    {
      id: INVITATION_IDS.accepted,
      email: 'chen.wei@northwind.example',
      role: 'member',
      state: 'accepted',
      createdAt: ago(days(21)),
      createdByName: 'Asha Rao',
      expiresAt: ago(days(14)),
      acceptedAt: ago(days(20)),
      acceptedByName: 'Chen Wei',
    },
    {
      id: INVITATION_IDS.expired,
      email: 'old.contact@northwind.example',
      role: 'admin',
      state: 'expired',
      createdAt: ago(days(60)),
      createdByName: 'Asha Rao',
      expiresAt: ago(days(53)),
      acceptedAt: null,
      acceptedByName: null,
    },
  ];
}

export function seedAudit(): AuditEvent[] {
  return [
    {
      id: uuid('ae000001', 1),
      at: ago(minutes(12)),
      actorName: 'Asha Rao',
      actorKind: 'user',
      action: 'share.create',
      targetType: 'document',
      targetId: DOC_IDS.launch,
      details: { role: 'viewer', expires: 'in 7 days' },
    },
    {
      id: uuid('ae000001', 2),
      at: ago(hours(2)),
      actorName: null,
      actorKind: 'guest',
      action: 'share.exchange',
      targetType: 'share',
      targetId: SHARE_IDS.press,
      details: { ok: true },
    },
    {
      id: uuid('ae000001', 3),
      at: ago(days(1)),
      actorName: 'Ben Ortiz',
      actorKind: 'user',
      action: 'auth.login',
      targetType: null,
      targetId: null,
      details: {},
    },
    {
      id: uuid('ae000001', 4),
      at: ago(days(3)),
      actorName: null,
      actorKind: 'system',
      action: 'document.purge',
      targetType: 'document',
      targetId: uuid('d0000001', 50),
      details: { reason: 'retention', afterDays: 30 },
    },
  ];
}
