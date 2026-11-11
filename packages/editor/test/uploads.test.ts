// @vitest-environment jsdom
/**
 * Upload pipeline: the manager's state machine and its connection to the
 * document (placeholders, completion by `uploadId`, undo and redo, deletion,
 * cancel, retry, failure, concurrency, composition).
 */
import { ApiError } from '@realtimedocs/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { findUploadNodes } from '../src/uploads/extension';
import { UPLOAD_CONCURRENCY, UploadManager, type UploadPhase } from '../src/uploads/manager';
import {
  DOCUMENT_ID,
  FakeUploadApi,
  createTestEditor,
  file,
  outline,
  settle,
  type TestEditor,
} from './editor-helpers';

let current: TestEditor | null = null;

function setup(options: Parameters<typeof createTestEditor>[0] = {}): TestEditor {
  current = createTestEditor(options);
  return current;
}

afterEach(() => {
  current?.destroy();
  current = null;
});

const PARAGRAPHS = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Before' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'After' }] },
  ],
};

/** Position right after the first paragraph. */
const afterFirstBlock = (t: TestEditor): number => t.editor.state.doc.child(0).nodeSize;

function uploadIds(t: TestEditor): string[] {
  const ids: string[] = [];
  t.editor.state.doc.descendants((node) => {
    const id: unknown = node.attrs.uploadId;
    if (typeof id === 'string') ids.push(id);
  });
  return ids;
}

function imageAttrs(t: TestEditor): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  t.editor.state.doc.descendants((node) => {
    if (node.type.name === 'image' || node.type.name === 'attachment') found.push(node.attrs);
  });
  return found;
}

describe('upload manager state machine', () => {
  const start = (manager: UploadManager, id: string, name = `${id}.png`): void => {
    manager.start(id, new Blob([new Uint8Array(100)]), name, 'image');
  };

  it('goes queued → uploading → done and reports honest, monotonic byte progress', async () => {
    const api = new FakeUploadApi();
    const manager = new UploadManager({ api: api.client, documentId: DOCUMENT_ID });
    const phases: UploadPhase[] = [];
    const progress: number[] = [];
    const completed: string[] = [];
    manager.onCompleted((id, asset) => completed.push(`${id}:${asset.id}`));

    start(manager, 'one');
    manager.subscribe('one', () => {
      const snapshot = manager.get('one');
      if (!snapshot) return;
      phases.push(snapshot.phase);
      progress.push(snapshot.progress);
    });
    expect(manager.get('one')).toMatchObject({ phase: 'uploading', progress: 0, sizeBytes: 100 });

    const call = api.call('one.png');
    call.progress(0.25);
    call.progress(0.2); // a late, lower report never moves the bar backwards
    call.progress(0.9);
    expect(manager.get('one')?.progress).toBe(0.9);
    // Nothing invents progress: without a report the value stays where it is.
    await settle();
    expect(manager.get('one')?.progress).toBe(0.9);

    const asset = call.succeed();
    await settle();
    expect(manager.get('one')).toMatchObject({ phase: 'done', progress: 1, error: null });
    expect(manager.completedAsset('one')?.id).toBe(asset.id);
    expect(completed).toEqual([`one:${asset.id}`]);
    expect(phases.at(-1)).toBe('done');
    expect([...progress].sort((a, b) => a - b)).toEqual(progress);
    manager.destroy();
  });

  it('runs at most the configured number of uploads and starts the rest in order', async () => {
    const api = new FakeUploadApi();
    const manager = new UploadManager({ api: api.client, documentId: DOCUMENT_ID });
    for (const id of ['a', 'b', 'c', 'd', 'e']) start(manager, id);

    expect(UPLOAD_CONCURRENCY).toBe(3);
    expect(api.calls.map((call) => call.name)).toEqual(['a.png', 'b.png', 'c.png']);
    expect(['d', 'e'].map((id) => manager.get(id)?.phase)).toEqual(['queued', 'queued']);
    expect(manager.activeCount).toBe(3);
    expect(manager.pendingCount).toBe(5);

    api.call('b.png').succeed();
    await settle();
    expect(api.calls.map((call) => call.name)).toEqual(['a.png', 'b.png', 'c.png', 'd.png']);
    expect(manager.get('e')?.phase).toBe('queued');

    api.call('a.png').fail(new ApiError('network_error', 'offline'));
    await settle();
    // A failure frees its slot as well.
    expect(api.calls.map((call) => call.name)).toContain('e.png');
    expect(manager.activeCount).toBe(3);
    manager.destroy();
  });

  it('cancels a queued upload without ever sending it, and an active one by aborting it', async () => {
    const api = new FakeUploadApi();
    const manager = new UploadManager({ api: api.client, documentId: DOCUMENT_ID, concurrency: 1 });
    start(manager, 'active');
    start(manager, 'waiting');

    manager.cancel('waiting');
    expect(manager.get('waiting')).toMatchObject({ phase: 'cancelled', retryable: true });

    manager.cancel('active');
    expect(api.call('active.png').signal?.aborted).toBe(true);
    await settle();
    expect(manager.get('active')).toMatchObject({
      phase: 'cancelled',
      error: 'The upload was cancelled.',
    });
    // The cancelled queue entry was not started when the slot became free.
    expect(api.calls.map((call) => call.name)).toEqual(['active.png']);
    expect(manager.completedAsset('active')).toBeNull();
    manager.destroy();
  });

  it('describes failures in words and only offers a retry when one can help', async () => {
    const api = new FakeUploadApi();
    const manager = new UploadManager({ api: api.client, documentId: DOCUMENT_ID });
    start(manager, 'busy');
    start(manager, 'rejected');
    start(manager, 'strange');
    api.call('busy.png').fail(new ApiError('storage_unavailable', 'x'));
    api
      .call('rejected.png')
      .fail(new ApiError('upload_rejected', 'x', { reason: 'content_mismatch' }));
    api.call('strange.png').fail(new TypeError('boom'));
    await settle();

    expect(manager.get('busy')).toMatchObject({
      phase: 'failed',
      retryable: true,
      error: 'The server could not store the file right now. Try again.',
    });
    expect(manager.get('rejected')).toMatchObject({
      phase: 'failed',
      retryable: false,
      error: 'The content of the file does not match its type.',
    });
    expect(manager.get('strange')).toMatchObject({ phase: 'failed', retryable: true });
    // No internal detail of an unexpected error reaches the user.
    expect(manager.get('strange')?.error).toBe('The upload failed unexpectedly.');
    manager.destroy();
  });

  it('retries a failed upload with the same id and the same bytes', async () => {
    const api = new FakeUploadApi();
    const manager = new UploadManager({ api: api.client, documentId: DOCUMENT_ID });
    start(manager, 'again');
    api.call('again.png').fail(new ApiError('server_busy', 'x'));
    await settle();
    expect(manager.get('again')?.phase).toBe('failed');

    manager.retry('again');
    expect(manager.get('again')).toMatchObject({ phase: 'uploading', progress: 0, error: null });
    expect(api.calls).toHaveLength(2);
    expect(api.calls[1]?.size).toBe(100);
    const asset = api.call('again.png').succeed();
    await settle();
    expect(manager.completedAsset('again')?.id).toBe(asset.id);

    // Retrying something that is not failed or cancelled does nothing.
    manager.retry('again');
    expect(api.calls).toHaveLength(2);
    manager.destroy();
  });

  it('reports nothing after it was destroyed', async () => {
    const api = new FakeUploadApi();
    const manager = new UploadManager({ api: api.client, documentId: DOCUMENT_ID });
    const completed: string[] = [];
    manager.onCompleted((id) => completed.push(id));
    start(manager, 'late');
    const call = api.call('late.png');
    manager.destroy();
    expect(call.signal?.aborted).toBe(true);
    await settle();
    expect(completed).toEqual([]);
    expect(manager.get('late')).toBeUndefined();
  });
});

describe('uploads in the document', () => {
  it('inserts placeholders in file order and completes each by its upload id, whatever finishes first', async () => {
    const t = setup({ content: PARAGRAPHS });
    t.editor.commands.insertFiles(
      [
        file('one.png', 'image/png'),
        file('notes.pdf', 'application/pdf'),
        file('three.png', 'image/png'),
      ],
      afterFirstBlock(t),
    );
    expect(outline(t.editor)).toEqual([
      'p:Before',
      'image:one.png:uploading',
      'attachment:notes.pdf:uploading',
      'image:three.png:uploading',
      'p:After',
    ]);
    expect(uploadIds(t)).toHaveLength(3);
    // Bytes never enter the document: only ids and metadata.
    expect(JSON.stringify(t.json())).not.toMatch(/data:|blob:|base64/);

    const third = t.api.call('three.png').succeed();
    await settle();
    expect(outline(t.editor)).toEqual([
      'p:Before',
      'image:one.png:uploading',
      'attachment:notes.pdf:uploading',
      'image:three.png:done',
      'p:After',
    ]);
    const first = t.api.call('one.png').succeed({ width: 800, height: 600 });
    const second = t.api.call('notes.pdf').succeed({ sizeBytes: 4321 });
    await settle();
    expect(outline(t.editor)).toEqual([
      'p:Before',
      'image:one.png:done',
      'attachment:notes.pdf:done',
      'image:three.png:done',
      'p:After',
    ]);
    const attrs = imageAttrs(t);
    expect(attrs.map((entry) => entry.assetId)).toEqual([first.id, second.id, third.id]);
    expect(attrs.every((entry) => entry.uploadId === null)).toBe(true);
    expect(attrs[0]).toMatchObject({ naturalWidth: 800, naturalHeight: 600 });
    expect(attrs[1]).toMatchObject({ sizeBytes: 4321, mime: 'application/pdf' });
  });

  it('updates the placeholder where it now is: the cursor and later typing do not matter', async () => {
    const t = setup({ content: PARAGRAPHS });
    t.editor.commands.insertFiles([file('moved.png', 'image/png')], afterFirstBlock(t));
    // The user keeps working somewhere else while the upload runs.
    t.editor.commands.insertContentAt(1, 'Typed first. ');
    t.editor.commands.insertContentAt(0, {
      type: 'paragraph',
      content: [{ type: 'text', text: 'New top' }],
    });
    t.editor.commands.setTextSelection(3);
    const selection = t.editor.state.selection.toJSON();

    const asset = t.api.call('moved.png').succeed();
    await settle();
    expect(outline(t.editor)).toEqual([
      'p:New top',
      'p:Typed first. Before',
      'image:moved.png:done',
      'p:After',
    ]);
    expect(imageAttrs(t)[0]?.assetId).toBe(asset.id);
    expect(t.editor.state.selection.toJSON()).toEqual(selection);
  });

  it('inserts nothing when the placeholder was undone, and completes it when it is redone', async () => {
    const t = setup({ content: PARAGRAPHS });
    t.editor.commands.insertFiles([file('undone.png', 'image/png')], afterFirstBlock(t));
    expect(outline(t.editor)).toContain('image:undone.png:uploading');

    expect(t.editor.commands.undo()).toBe(true);
    expect(outline(t.editor)).toEqual(['p:Before', 'p:After']);

    // The upload finishes while its placeholder does not exist.
    const asset = t.api.call('undone.png').succeed();
    await settle(20);
    expect(outline(t.editor)).toEqual(['p:Before', 'p:After']);

    // Redo brings the placeholder back; it then gets the finished asset.
    expect(t.editor.commands.redo()).toBe(true);
    await settle(20);
    expect(outline(t.editor)).toEqual(['p:Before', 'image:undone.png:done', 'p:After']);
    expect(imageAttrs(t)[0]).toMatchObject({ assetId: asset.id, uploadId: null });

    // The completion is not an undo step of its own: one undo removes the image.
    expect(t.editor.commands.undo()).toBe(true);
    expect(outline(t.editor)).toEqual(['p:Before', 'p:After']);
  });

  it('does not make the completion itself undoable', async () => {
    const t = setup({ content: PARAGRAPHS });
    t.editor.commands.insertFiles([file('kept.png', 'image/png')], afterFirstBlock(t));
    const asset = t.api.call('kept.png').succeed();
    await settle();
    expect(imageAttrs(t)[0]?.assetId).toBe(asset.id);

    // Undo goes straight back to "no image", never to "placeholder again".
    t.editor.commands.undo();
    expect(outline(t.editor)).toEqual(['p:Before', 'p:After']);
    t.editor.commands.redo();
    await settle(20);
    expect(imageAttrs(t)[0]).toMatchObject({ assetId: asset.id, uploadId: null });
  });

  it('inserts nothing when the placeholder was deleted before the upload finished', async () => {
    const t = setup({ content: PARAGRAPHS });
    t.editor.commands.insertFiles([file('deleted.png', 'image/png')], afterFirstBlock(t));
    const [id] = uploadIds(t);
    const target = findUploadNodes(t.editor.state.doc, id ?? '')[0];
    expect(target).toBeDefined();
    if (!target) return;
    t.editor.commands.deleteRange({ from: target.pos, to: target.pos + target.node.nodeSize });
    expect(outline(t.editor)).toEqual(['p:Before', 'p:After']);

    t.api.call('deleted.png').succeed();
    await settle(20);
    expect(outline(t.editor)).toEqual(['p:Before', 'p:After']);
    expect(JSON.stringify(t.json())).not.toContain('assetId":"aaaaaaaa');
  });

  it('cancel removes the placeholder without an undo step and nothing arrives later', async () => {
    const t = setup({ content: PARAGRAPHS });
    t.editor.commands.insertFiles([file('cancelled.png', 'image/png')], afterFirstBlock(t));
    const [id] = uploadIds(t);
    const call = t.api.call('cancelled.png');

    // What the placeholder's Cancel button does.
    t.manager.cancel(id ?? '');
    expect(t.editor.commands.removeUploadNode(id ?? '')).toBe(true);
    expect(call.signal?.aborted).toBe(true);
    await settle(20);
    expect(outline(t.editor)).toEqual(['p:Before', 'p:After']);
    expect(t.manager.get(id ?? '')?.phase).toBe('cancelled');

    // Removing a placeholder that is not there is a no-op.
    expect(t.editor.commands.removeUploadNode(id ?? '')).toBe(false);
  });

  it('keeps the placeholder on failure and completes the same node after a retry', async () => {
    const t = setup({ content: PARAGRAPHS });
    t.editor.commands.insertFiles([file('flaky.png', 'image/png')], afterFirstBlock(t));
    const [id] = uploadIds(t);
    t.api.call('flaky.png').fail(new ApiError('storage_unavailable', 'x'));
    await settle();
    expect(t.manager.get(id ?? '')).toMatchObject({ phase: 'failed', retryable: true });
    expect(outline(t.editor)).toEqual(['p:Before', 'image:flaky.png:uploading', 'p:After']);

    t.manager.retry(id ?? '');
    const asset = t.api.call('flaky.png').succeed();
    await settle();
    expect(outline(t.editor)).toEqual(['p:Before', 'image:flaky.png:done', 'p:After']);
    expect(imageAttrs(t)[0]).toMatchObject({ assetId: asset.id, uploadId: null });
  });

  it('completes every copy of a placeholder and leaves placeholders of other clients alone', async () => {
    const foreign = '99999999-9999-4999-8999-999999999999';
    const t = setup({
      content: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Before' }] },
          { type: 'image', attrs: { uploadId: foreign, name: 'theirs.png' } },
        ],
      },
    });
    t.editor.commands.insertFiles([file('mine.png', 'image/png')], afterFirstBlock(t));
    const mine = uploadIds(t).find((id) => id !== foreign) ?? '';
    // The same placeholder twice (copy and paste of a block that is still uploading).
    t.editor.commands.insertContentAt(t.editor.state.doc.content.size, {
      type: 'image',
      attrs: { uploadId: mine, name: 'mine.png' },
    });
    const asset = t.api.call('mine.png').succeed();
    await settle();
    const attrs = imageAttrs(t);
    expect(attrs.filter((entry) => entry.assetId === asset.id)).toHaveLength(2);
    expect(attrs.find((entry) => entry.name === 'theirs.png')).toMatchObject({
      uploadId: foreign,
      assetId: null,
    });
    // Nothing was requested for a placeholder this editor does not own.
    expect(t.api.calls.map((call) => call.name)).toEqual(['mine.png']);
  });

  it('rejects files the limits do not allow, in words, and inserts only the others', () => {
    const t = setup({
      content: PARAGRAPHS,
      limits: {
        maxImageBytes: 1000,
        maxAttachmentBytes: 2000,
        maxMermaidSourceLength: 20_000,
        imageMimeTypes: ['image/png'],
        attachmentExtensions: ['pdf'],
      },
    });
    const done = t.editor.commands.insertFiles(
      [
        file('ok.png', 'image/png', 500),
        file('setup.exe', 'application/x-msdownload', 10),
        file('huge.png', 'image/png', 1001),
        file('empty.pdf', 'application/pdf', 0),
      ],
      afterFirstBlock(t),
    );
    expect(done).toBe(true);
    expect(outline(t.editor)).toEqual(['p:Before', 'image:ok.png:uploading', 'p:After']);
    expect(t.api.calls.map((call) => call.name)).toEqual(['ok.png']);
    expect(t.rejected).toHaveLength(1);
    const messages = t.rejected[0] ?? [];
    expect(messages).toHaveLength(3);
    expect(messages[0]).toContain('setup.exe');
    expect(messages[0]).toContain('not a supported file type');
    expect(messages[1]).toContain('huge.png');
    expect(messages[1]).toContain('limit');
    expect(messages[2]).toContain('empty.pdf');
  });

  it('refuses to insert or remove anything for a reader', async () => {
    const t = setup({ content: PARAGRAPHS, canEdit: false });
    expect(t.editor.commands.insertFiles([file('no.png', 'image/png')])).toBe(false);
    expect(t.api.calls).toHaveLength(0);
    expect(outline(t.editor)).toEqual(['p:Before', 'p:After']);

    // Access removed while an upload is running: the finished asset is not written.
    t.setCanEdit(true);
    t.editor.commands.insertFiles([file('late.png', 'image/png')], afterFirstBlock(t));
    const [id] = uploadIds(t);
    t.setCanEdit(false);
    t.api.call('late.png').succeed();
    await settle(20);
    expect(outline(t.editor)).toEqual(['p:Before', 'image:late.png:uploading', 'p:After']);
    expect(t.editor.commands.removeUploadNode(id ?? '')).toBe(false);
  });

  it('adds a paragraph after an upload placed at the very end, so typing can continue', () => {
    const t = setup({
      content: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Only' }] }],
      },
    });
    t.editor.commands.setTextSelection(t.editor.state.doc.content.size - 1);
    t.editor.commands.insertFiles([file('last.png', 'image/png')]);
    const lines = outline(t.editor);
    expect(lines.at(-2)).toBe('image:last.png:uploading');
    expect(lines.at(-1)).toBe('p:');
    // The cursor is in that paragraph, after the image.
    expect(t.editor.state.selection.$from.parent.type.name).toBe('paragraph');
    expect(t.editor.state.selection.from).toBe(t.editor.state.doc.content.size - 1);
  });

  it('waits for the end of an IME composition before it changes the document', async () => {
    const t = setup({ content: PARAGRAPHS });
    t.editor.commands.insertFiles([file('ime.png', 'image/png')], afterFirstBlock(t));
    const view = t.editor.view;
    // What ProseMirror tracks between compositionstart and compositionend.
    const input = (view as unknown as { input: { composing: boolean } }).input;
    input.composing = true;
    expect(view.composing).toBe(true);

    const asset = t.api.call('ime.png').succeed();
    await settle(60);
    expect(outline(t.editor)).toEqual(['p:Before', 'image:ime.png:uploading', 'p:After']);

    input.composing = false;
    await settle(200);
    expect(outline(t.editor)).toEqual(['p:Before', 'image:ime.png:done', 'p:After']);
    expect(imageAttrs(t)[0]?.assetId).toBe(asset.id);
  });
});
