import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectEnvironment, electronEnvironmentSource } from '../../src/main/privacy/environment';
import { InvalidRecordError, PrivacyRecordStore } from '../../src/main/privacy/record-store';
import { PrivacyService } from '../../src/main/privacy/service';
import type { VerificationRecord } from '../../src/shared/privacy/status';

const ID = '11111111-1111-4111-8111-111111111111';
function record(id = ID, overrides: Partial<VerificationRecord> = {}): VerificationRecord {
  return {
    id,
    testedAt: '2026-11-10T10:00:00.000Z',
    appVersion: '0.1.0',
    electronVersion: '45.2.3',
    platform: 'win32',
    osVersion: '10.0.26100',
    meetingApp: 'zoom',
    meetingAppVersion: '6.2.0',
    client: { kind: 'native' },
    captureMode: 'window',
    monitors: { count: 1 },
    protectionEnabled: true,
    localResult: 'ok',
    remote: { observedBy: 'second_device', outcome: 'omitted' },
    ...overrides,
  };
}

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rd-privacy-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('privacy record store', () => {
  it('returns nothing for a directory that does not exist yet', async () => {
    const store = new PrivacyRecordStore(path.join(dir, 'missing'));
    expect(await store.list()).toEqual({ records: [], quarantined: [] });
  });

  it('round-trips a record and removes it', async () => {
    const store = new PrivacyRecordStore(path.join(dir, 'privacy'));
    await store.save(record());
    expect((await store.list()).records).toEqual([record()]);
    expect(await store.remove(ID)).toBe(true);
    expect(await store.remove(ID)).toBe(false);
    expect((await store.list()).records).toEqual([]);
  });

  it('overwrites by id and leaves no temp file behind', async () => {
    const store = new PrivacyRecordStore(dir);
    await store.save(record());
    await store.save(record(ID, { localResult: 'changed' }));
    const names = await fs.readdir(dir);
    expect(names).toEqual([`${ID}.json`]);
    expect((await store.list()).records[0]?.localResult).toBe('changed');
  });

  it('writes through a temp file and a rename (a crash leaves the old record whole)', async () => {
    const store = new PrivacyRecordStore(dir);
    await store.save(record());
    // Simulate an interrupted write: a leftover temp file must never be read as a record.
    await fs.writeFile(path.join(dir, `${ID}.json.abc.tmp`), '{"id":');
    const listed = await store.list();
    expect(listed.records).toHaveLength(1);
    expect(listed.quarantined).toEqual([]);
    expect((await fs.readdir(dir)).some((n) => n.endsWith('.tmp'))).toBe(false);
  });

  it('rejects an invalid record on write and writes nothing', async () => {
    const store = new PrivacyRecordStore(dir);
    const { remote: _remote, ...without } = record();
    await expect(store.save(without)).rejects.toBeInstanceOf(InvalidRecordError);
    await expect(store.save({ ...record(), id: 'not-a-uuid' })).rejects.toBeInstanceOf(
      InvalidRecordError,
    );
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it('quarantines corrupt and schema-invalid files and reports them', async () => {
    const store = new PrivacyRecordStore(dir, { now: () => new Date('2026-11-11T00:00:00Z') });
    await store.save(record());
    const badJson = '22222222-2222-4222-8222-222222222222.json';
    const noRemote = '33333333-3333-4333-8333-333333333333.json';
    const mismatch = '44444444-4444-4444-8444-444444444444.json';
    await fs.writeFile(path.join(dir, badJson), '{ not json');
    const { remote: _remote, ...without } = record('33333333-3333-4333-8333-333333333333');
    await fs.writeFile(path.join(dir, noRemote), JSON.stringify(without));
    await fs.writeFile(
      path.join(dir, mismatch),
      JSON.stringify(record('55555555-5555-4555-8555-555555555555')),
    );
    const listed = await store.list();
    expect(listed.records.map((r) => r.id)).toEqual([ID]);
    expect(listed.quarantined.map((q) => q.file).sort()).toEqual(
      [badJson, noRemote, mismatch].sort(),
    );
    expect(
      listed.quarantined.every((q) => q.movedTo?.includes(`${path.sep}quarantine${path.sep}`)),
    ).toBe(true);
    expect(listed.quarantined.find((q) => q.file === noRemote)?.reason).toContain('remote');
    const moved = await fs.readdir(path.join(dir, 'quarantine'));
    expect(moved).toHaveLength(3);
    // Reported once: the next listing is clean.
    expect((await store.list()).quarantined).toEqual([]);
  });

  it('refuses a path-like id on remove', async () => {
    const store = new PrivacyRecordStore(dir);
    await expect(store.remove('../../etc/passwd')).rejects.toBeInstanceOf(InvalidRecordError);
  });
});

describe('privacy environment', () => {
  it('maps injected sources and clamps the display count', () => {
    const env = detectEnvironment({
      appVersion: () => '0.1.0',
      electronVersion: () => '45.2.3',
      platform: () => 'darwin',
      systemVersion: () => '15.1',
      displayCount: () => 0,
    });
    expect(env).toEqual({
      appVersion: '0.1.0',
      electronVersion: '45.2.3',
      platform: 'darwin',
      osVersion: '15.1',
      displayCount: 1,
    });
  });

  it('refuses a platform the product does not ship on', () => {
    expect(() =>
      detectEnvironment({
        appVersion: () => 'x',
        electronVersion: () => 'x',
        platform: () => 'freebsd',
        systemVersion: () => 'x',
        displayCount: () => 1,
      }),
    ).toThrow(RangeError);
  });

  it('reads only the app, the process and the display list', () => {
    const source = electronEnvironmentSource(
      { app: { getVersion: () => '1.2.3' }, screen: { getAllDisplays: () => [{}, {}] } },
      { versions: { electron: '45.2.3' }, platform: 'win32', getSystemVersion: () => '10.0.1' },
    );
    expect(detectEnvironment(source)).toMatchObject({ appVersion: '1.2.3', displayCount: 2 });
  });
});

describe('privacy service', () => {
  it('stamps detected fields so a renderer cannot claim another environment', async () => {
    const store = new PrivacyRecordStore(dir);
    const env = {
      appVersion: '9.9.9',
      electronVersion: '45.2.3',
      platform: 'win32' as const,
      osVersion: '10.0.1',
      displayCount: 1,
    };
    const service = new PrivacyService(store, () => env);
    const snapshot = await service.save(record(ID, { appVersion: '0.0.1', osVersion: 'fake' }));
    expect(snapshot.records[0]).toMatchObject({ appVersion: '9.9.9', osVersion: '10.0.1' });
    expect((await service.exportText('json')).text).toContain('"records"');
    expect((await service.exportText('markdown')).filename).toBe('realtimedocs-privacy-records.md');
    expect((await service.remove(ID)).records).toEqual([]);
  });
});
