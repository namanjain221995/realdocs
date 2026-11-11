/**
 * Demo / browser-check backend: the fixture collaboration server
 * (test/fixture-server.ts — a real Hocuspocus server with an in-memory
 * "database" and asset store) on 127.0.0.1:4421, plus a control endpoint the
 * Playwright script uses to steer it. Not the production server.
 *
 *   pnpm --filter @realtimedocs/editor run demo:server
 */
import { buildSampleDocument, type DocJSON } from '../src/schema/index';
import { startFixtureServer, type FixtureServer, type Principal } from '../test/fixture-server';

const PORT = Number(process.env.RD_DEMO_SERVER_PORT ?? 4421);

interface DemoState {
  documentId: string;
  principals: Record<string, Principal>;
}

function longDocument(): DocJSON {
  const sample = buildSampleDocument({ imageAssetId: null });
  const filler: DocJSON[] = Array.from({ length: 40 }, (_, index) => ({
    type: 'paragraph',
    content: [
      {
        type: 'text',
        text: `Filler paragraph ${index + 1}. This text only exists to make the document long enough to scroll, so that Follow Latest and scroll stability can be observed.`,
      },
    ],
  }));
  return { type: 'doc', content: [...(sample.content ?? []), ...filler] };
}

function createScene(fixture: FixtureServer, content: DocJSON): DemoState {
  const documentId = fixture.createDocument({ title: 'Demo document', content });
  const principals: Record<string, Principal> = {
    editor: fixture.addPrincipal({ name: 'Asha Rao' }),
    editor2: fixture.addPrincipal({ name: 'Miguel Santos' }),
    viewer: fixture.addPrincipal({ name: 'Guest Reader', accountId: null }),
  };
  fixture.grant(principals.editor as Principal, documentId, 'editor');
  fixture.grant(principals.editor2 as Principal, documentId, 'editor');
  fixture.grant(principals.viewer as Principal, documentId, 'viewer');
  return { documentId, principals };
}

const scenes = new Map<string, DemoState>();

function describe(scene: DemoState): unknown {
  return {
    documentId: scene.documentId,
    tokens: Object.fromEntries(
      Object.entries(scene.principals).map(([name, principal]) => [name, principal.token]),
    ),
    accounts: Object.fromEntries(
      Object.entries(scene.principals).map(([name, principal]) => [name, principal.accountId]),
    ),
  };
}

const fixture = await startFixtureServer({
  port: PORT,
  extraRoute: async (request, response, readJson) => {
    const url = request.url ?? '';
    if (!url.startsWith('/control')) return false;
    const reply = (status: number, body: unknown): true => {
      response.writeHead(status, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      });
      response.end(JSON.stringify(body));
      return true;
    };
    if (request.method !== 'POST') return reply(405, { error: 'POST only' });
    const command = (await readJson()) as {
      action?: string;
      scene?: string;
      kind?: 'sample' | 'long' | 'empty';
      principal?: string;
      role?: 'viewer' | 'editor' | 'admin';
      filename?: string;
      ms?: number;
      count?: number;
      value?: boolean;
    } | null;
    if (!command?.action) return reply(400, { error: 'action required' });
    const sceneName = command.scene ?? 'default';

    if (command.action === 'scene') {
      // Get or create: a document with its own principals, addressed by name,
      // so several pages (and browser contexts) can join the same one.
      const existing = scenes.get(sceneName);
      if (existing) return reply(200, describe(existing));
      const content =
        command.kind === 'long'
          ? longDocument()
          : command.kind === 'empty'
            ? { type: 'doc', content: [{ type: 'paragraph' }] }
            : buildSampleDocument({ imageAssetId: null });
      const scene = createScene(fixture, content);
      scenes.set(sceneName, scene);
      return reply(200, describe(scene));
    }

    const scene = scenes.get(sceneName);
    if (!scene) return reply(404, { error: 'unknown scene' });
    const principal = command.principal ? scene.principals[command.principal] : undefined;
    switch (command.action) {
      case 'uploadDelay':
        if (command.filename) fixture.uploadDelays.set(command.filename, command.ms ?? 0);
        else fixture.uploadDelayMs = command.ms ?? 0;
        return reply(200, { ok: true });
      case 'failUploads':
        fixture.failUploads = command.count ?? 1;
        return reply(200, { ok: true });
      case 'holdDatabase':
        if (command.value === false) fixture.db.release();
        else fixture.db.hold();
        return reply(200, { ok: true });
      case 'failDatabase':
        fixture.db.failing = command.value !== false;
        return reply(200, { ok: true });
      case 'setRole':
        if (!principal || !command.role)
          return reply(400, { error: 'principal and role required' });
        fixture.setRole(principal, scene.documentId, command.role);
        return reply(200, { ok: true });
      case 'revoke':
        if (!principal) return reply(400, { error: 'principal required' });
        fixture.revoke(principal);
        return reply(200, { ok: true });
      case 'dropConnections':
        fixture.dropConnections();
        return reply(200, { ok: true });
      case 'restore':
        fixture.restore(scene.documentId, {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Restored from a snapshot.' }] },
          ],
        });
        return reply(200, { ok: true });
      case 'durable': {
        // What is actually committed, for "Saved is truthful" checks.
        const doc = fixture.db.durableDoc(fixture.room(scene.documentId));
        const fragment = doc.getXmlFragment('default');
        return reply(200, { text: fragment.toString(), commits: fixture.db.commits });
      }
      default:
        return reply(400, { error: `unknown action ${command.action}` });
    }
  },
});

const initial = createScene(fixture, buildSampleDocument({ imageAssetId: null }));
scenes.set('default', initial);

console.log(`RealtimeDocs editor fixture server listening on ${fixture.origin}`);
console.log(`  document ${initial.documentId}`);

const shutdown = (): void => {
  void fixture.stop().then(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
