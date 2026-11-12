import { describe, expect, it } from 'vitest';
import { accessFlags, nameWithRole } from '../src/lib/accessCapabilities';

describe('accessFlags', () => {
  it('allows everything when the server sent no capabilities', () => {
    expect(accessFlags({})).toEqual({
      canExport: true,
      canViewHistory: true,
      canShare: true,
      canUseDesktop: true,
    });
    expect(accessFlags(null)).toEqual(accessFlags({}));
    expect(accessFlags(undefined).canExport).toBe(true);
  });

  it('turns off only what the server turned off', () => {
    const flags = accessFlags({
      capabilities: {
        canExport: false,
        canViewHistory: true,
        canShare: false,
        canUseDesktop: false,
      },
    });
    expect(flags).toEqual({
      canExport: false,
      canViewHistory: true,
      canShare: false,
      canUseDesktop: false,
    });
  });
});

describe('nameWithRole', () => {
  it('appends the role label when present', () => {
    expect(nameWithRole('Aarav', 'Candidate')).toBe('Aarav — Candidate');
    expect(nameWithRole('Aarav', undefined)).toBe('Aarav');
    expect(nameWithRole('Aarav', '')).toBe('Aarav');
  });
});
