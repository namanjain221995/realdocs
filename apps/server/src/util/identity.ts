/** Server-generated presence identities: guest names and participant colours. */
import { randomInt } from 'node:crypto';
import { sha256 } from '../auth/tokens';

const ADJECTIVES = [
  'Amber',
  'Azure',
  'Brisk',
  'Calm',
  'Clever',
  'Coral',
  'Golden',
  'Hazel',
  'Indigo',
  'Jade',
  'Lively',
  'Maple',
  'Olive',
  'Quiet',
  'Silver',
  'Sunny',
];

const ANIMALS = [
  'Badger',
  'Crane',
  'Dolphin',
  'Falcon',
  'Heron',
  'Ibis',
  'Koala',
  'Lynx',
  'Otter',
  'Panda',
  'Quokka',
  'Robin',
  'Seal',
  'Tapir',
  'Wren',
  'Yak',
];

/** Display name for a share-link guest, e.g. "Guest Amber Otter". */
export function guestName(): string {
  const adjective = ADJECTIVES[randomInt(ADJECTIVES.length)];
  const animal = ANIMALS[randomInt(ANIMALS.length)];
  return `Guest ${adjective} ${animal}`;
}

/** Cursor colours with enough contrast on both light and dark document surfaces. */
export const PARTICIPANT_COLORS = [
  '#2563eb',
  '#db2777',
  '#059669',
  '#d97706',
  '#7c3aed',
  '#dc2626',
  '#0891b2',
  '#65a30d',
  '#c026d3',
  '#ea580c',
  '#0d9488',
  '#4f46e5',
] as const;

/** Stable colour for an identity (account id or guest session id). */
export function colorFor(identity: string): string {
  const index = sha256(identity).readUInt32BE(0) % PARTICIPANT_COLORS.length;
  return PARTICIPANT_COLORS[index] ?? PARTICIPANT_COLORS[0];
}
