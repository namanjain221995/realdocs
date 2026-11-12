/**
 * Version history: what a change is called, who it is attributed to, and that
 * a revision can be rebuilt from the recorded rows alone.
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  DurableLog,
  type HistoryCheckpoint,
  type HistorySegment,
  type LogStore,
} from '../../src/collab/durable-log';
import {
  HistoryRecorder,
  classify,
  collectAssetIdsFromDoc,
  emptySummary,
  type HistoryActor,
} from '../../src/collab/history';

const ASSET_A = '11111111-1111-4111-8111-111111111111';
const ASSET_B = '22222222-2222-4222-8222-222222222222';

function actor(name: string, connectionId: string): HistoryActor {
  return {
    kind: 'user',
    userId: null,
    grantId: null,
    name,
    participantRole: 'editor',
    sessionId: null,
    connectionId,
    clientId: null,
  };
}

function paragraph(text: string): Y.XmlElement {
  const element = new Y.XmlElement('paragraph');
  const run = new Y.XmlText();
  run.insert(0, text);
  element.insert(0, [run]);
  return element;
}

function image(assetId: string | null): Y.XmlElement {
  const element = new Y.XmlElement('image');
  if (assetId) element.setAttribute('assetId', assetId);
  return element;
}

/** A document with a recorder; `change` returns the summary of one transaction. */
function recorded() {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment('default');
  const recorder = new HistoryRecorder(doc);
  const change = (fn: () => void) => {
    doc.transact(fn);
    return recorder.take();
  };
  return { doc, fragment, change };
}

describe('change summaries', () => {
  it('counts typed and deleted characters without keeping any text', () => {
    const { fragment, change } = recorded();
    change(() => fragment.insert(0, [paragraph('Hello')]));
    const text = (fragment.get(0) as Y.XmlElement).get(0) as Y.XmlText;

    const typed = change(() => text.insert(5, ' world'));
    expect(typed).toMatchObject({ insertedChars: 6, deletedChars: 0 });
    expect(classify(typed)).toBe('text_inserted');

    const deleted = change(() => text.delete(0, 4));
    expect(deleted).toMatchObject({ insertedChars: 0, deletedChars: 4 });
    expect(classify(deleted)).toBe('text_deleted');
    expect(JSON.stringify([typed, deleted])).not.toMatch(/Hello|world/);
  });

  it('sees an image arrive when its upload finishes, and leave with its block', () => {
    const { fragment, change } = recorded();
    const placeholder = change(() => fragment.insert(0, [image(null), paragraph('x')]));
    expect(placeholder.attachmentsAdded).toEqual([]);

    const finished = change(() =>
      (fragment.get(0) as Y.XmlElement).setAttribute('assetId', ASSET_A),
    );
    expect(finished.attachmentsAdded).toEqual([ASSET_A]);
    expect(classify(finished)).toBe('image_inserted');

    const removed = change(() => fragment.delete(0, 1));
    expect(removed.attachmentsRemoved).toEqual([ASSET_A]);
    expect(removed.removedBlocks).toEqual({ image: 1 });
    expect(classify(removed)).toBe('image_removed');
  });

  it('finds assets inside a removed container', () => {
    const { fragment, change } = recorded();
    change(() => {
      const callout = new Y.XmlElement('callout');
      callout.insert(0, [paragraph('note'), image(ASSET_B)]);
      fragment.insert(0, [callout]);
    });
    const removed = change(() => fragment.delete(0, 1));
    expect(removed.attachmentsRemoved).toEqual([ASSET_B]);
    expect(removed.deletedChars).toBe(4);
  });

  it('records page setting changes with their old and new value', () => {
    const { doc, change } = recorded();
    const page = doc.getMap('page');
    change(() => page.set('marginLeft', 25.4));
    const summary = change(() => page.set('marginLeft', 30));
    expect(summary.pageSettings).toEqual({ marginLeft: { from: 25.4, to: 30 } });
    expect(classify(summary)).toBe('page_settings_changed');
  });

  it('labels a paste by the client hint or by its size, and formatting as formatting', () => {
    const { fragment, change } = recorded();
    change(() => fragment.insert(0, [paragraph('abc')]));
    const text = (fragment.get(0) as Y.XmlElement).get(0) as Y.XmlText;

    const hinted = change(() => text.insert(3, 'def'));
    hinted.clientHint = 'paste';
    expect(classify(hinted)).toBe('paste');

    const bulk = change(() => fragment.insert(1, [paragraph('x'.repeat(500))]));
    expect(classify(bulk)).toBe('paste');

    const bold = change(() => text.format(0, 3, { bold: true }));
    expect(classify(bold)).toBe('formatting_changed');
    expect(classify(emptySummary())).toBe('edit');
  });

  it('ignores ids that are not asset ids and survives hostile shapes', () => {
    const { fragment, change } = recorded();
    const summary = change(() => {
      const hostile = image(null);
      hostile.setAttribute('assetId', '../../etc/passwd');
      fragment.insert(0, [hostile]);
    });
    expect(summary.attachmentsAdded).toEqual([]);
    expect(collectAssetIdsFromDoc(fragment.doc!)).toEqual([]);
  });
});

/** Store that keeps what PostgreSQL would: the working log and the history rows. */
class HistoryStore implements LogStore {
  headSeq = 0;
  history: (
    | { kind: 'update'; seq: number; segment: HistorySegment }
    | { kind: 'checkpoint'; seq: number; state: Uint8Array; operationType: string }
  )[] = [];

  async append(input: { expectedHeadSeq: number; history?: HistorySegment[] }): Promise<number> {
    expect(input.expectedHeadSeq).toBe(this.headSeq);
    this.headSeq += 1;
    for (const segment of input.history ?? []) {
      this.history.push({ kind: 'update', seq: this.headSeq, segment });
    }
    return this.headSeq;
  }

  async compact(input: {
    uptoSeq: number;
    state: Uint8Array;
    checkpoint?: HistoryCheckpoint;
  }): Promise<void> {
    if (input.checkpoint) {
      this.history.push({
        kind: 'checkpoint',
        seq: input.uptoSeq,
        state: input.state,
        operationType: input.checkpoint.operationType,
      });
    }
  }

  async baseline(input: { headSeq: number; state: Uint8Array }): Promise<void> {
    this.history.push({
      kind: 'checkpoint',
      seq: input.headSeq,
      state: input.state,
      operationType: 'baseline',
    });
  }

  /** The document as it was after history row `index`, from history rows alone. */
  rebuild(index: number): Y.Doc {
    const doc = new Y.Doc();
    let start = index;
    while (start > 0 && this.history[start]?.kind !== 'checkpoint') start -= 1;
    for (let i = start; i <= index; i += 1) {
      const row = this.history[i];
      if (!row) continue;
      Y.applyUpdate(doc, row.kind === 'checkpoint' ? row.state : row.segment.update);
    }
    return doc;
  }
}

const textOf = (doc: Y.Doc): string =>
  doc
    .getXmlFragment('default')
    .toArray()
    .map((node) => (node instanceof Y.XmlElement ? node.toArray().join('') : ''))
    .join('|');

describe('attributed durable log', () => {
  function setup(checkpointEvery = 1000) {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment('default');
    fragment.insert(0, [paragraph('start')]);
    const store = new HistoryStore();
    const recorder = new HistoryRecorder(doc);
    const log = new DurableLog({
      documentId: 'd',
      generation: 1,
      headSeq: 0,
      store,
      maxQueueBytes: 1 << 20,
      history: {
        baseline: { state: Y.encodeStateAsUpdate(doc), attachmentIds: [] },
        rowsSinceCheckpoint: 0,
        checkpointEvery,
        assetIds: () => collectAssetIdsFromDoc(doc),
      },
    });
    let current: HistoryActor = actor('Ada', 'c1');
    doc.on('update', (update: Uint8Array) => {
      log.enqueue(update, { actor: current, summary: recorder.take() });
    });
    const as = (who: HistoryActor, fn: () => void) => {
      current = who;
      doc.transact(fn);
    };
    return { doc, fragment, store, log, as };
  }

  it('writes the starting state first, then one row per actor of a batch', async () => {
    const { fragment, store, log, as } = setup();
    const ada = actor('Ada', 'c1');
    const bob = actor('Bob', 'c2');
    // Three transactions in one event-loop turn: one commit, two people.
    as(ada, () => fragment.insert(1, [paragraph('from ada')]));
    as(bob, () => fragment.insert(2, [paragraph('from bob')]));
    as(ada, () => fragment.insert(3, [paragraph('ada again')]));
    expect(await log.flush(1000)).toBe(true);

    expect(store.headSeq).toBe(1);
    expect(store.history.map((row) => row.kind)).toEqual(['checkpoint', 'update', 'update']);
    const [, first, second] = store.history;
    if (first?.kind !== 'update' || second?.kind !== 'update') throw new Error('unexpected rows');
    expect(first.segment.actor.name).toBe('Ada');
    expect(first.segment.summary.transactions).toBe(2);
    expect(first.segment.contentSizeDelta).toBe('from ada'.length + 'ada again'.length);
    expect(second.segment.actor.name).toBe('Bob');
    expect(second.segment.receivedAt).toBeInstanceOf(Date);

    // Every revision is reproducible from history alone.
    expect(textOf(store.rebuild(0))).toBe('start');
    expect(textOf(store.rebuild(2))).toBe('start|from ada|from bob|ada again');
  });

  it('adds a checkpoint at compaction once enough rows exist, and rebuilds from it', async () => {
    const { doc, fragment, store, log, as } = setup(2);
    const ada = actor('Ada', 'c1');
    for (const word of ['one', 'two', 'three']) {
      as(ada, () => fragment.insert(fragment.length, [paragraph(word)]));
      expect(await log.flush(1000)).toBe(true);
    }
    log.requestCompaction(() => Y.encodeStateAsUpdate(doc));
    expect(await log.flush(1000)).toBe(true);
    expect(store.history.at(-1)).toMatchObject({ kind: 'checkpoint', operationType: 'checkpoint' });

    as(ada, () => fragment.delete(1, 1));
    expect(await log.flush(1000)).toBe(true);
    expect(textOf(store.rebuild(store.history.length - 1))).toBe('start|two|three');
    // The next compaction has too few new rows for another checkpoint.
    log.requestCompaction(() => Y.encodeStateAsUpdate(doc));
    expect(await log.flush(1000)).toBe(true);
    expect(store.history.filter((row) => row.kind === 'checkpoint')).toHaveLength(2);
  });
});

describe('diff of hostile content', () => {
  it('clamps a heading level taken from the shared document', async () => {
    const { blockTexts, diffDocuments } = await import('../../src/history/diff');
    const heading = (level: unknown) => ({
      type: 'doc',
      content: [{ type: 'heading', attrs: { level }, content: [{ type: 'text', text: 'T' }] }],
    });
    expect(blockTexts(heading(-1) as never)).toEqual(['# T']);
    expect(blockTexts(heading(Infinity) as never)).toEqual(['###### T']);
    expect(blockTexts(heading(500_000_000) as never)).toEqual(['###### T']);
    expect(blockTexts(heading('x') as never)).toEqual(['# T']);
    expect(diffDocuments(heading(-1) as never, heading(3) as never).lines).toEqual([
      { op: 'delete', text: '# T' },
      { op: 'insert', text: '### T' },
    ]);
  });
});
