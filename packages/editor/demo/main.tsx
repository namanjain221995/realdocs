/**
 * Harness page of the editor package: mounts one `DocumentEditor` per pane
 * (by default an editor and a view-only guest) against the fixture server.
 *
 * URL parameters
 *   scene=<name>     document to join (created on first use), default "default"
 *   kind=sample|long|empty   content of a newly created scene
 *   panes=editor,viewer      principals to show: editor, editor2, viewer
 *   variant=panel            render every pane as the compact desktop panel
 *   theme=light|dark         app theme (data-theme on <html>)
 *   tone=dark|light, scale=<0.8–1.8>, width=narrow|normal|wide|full
 *   follow=1                 start with Follow Latest on (viewer pane)
 *   guest=1                  open the editor pane without an account id
 */
// First, before anything constructs a zod schema (see src/contract-additions.ts).
import '../src/contract-additions';
import '@realtimedocs/ui/styles.css';
import '../src/styles.css';
import './demo.css';
import { Y_FRAGMENT_FIELD, createApiClient, type ApiClient } from '@realtimedocs/contracts';
import { yDocToProsemirrorJSON } from '@tiptap/y-tiptap';
import { Profiler, StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { processPastedHtml } from '../src/clipboard/process';
import { buildSampleDocument } from '../src/schema/index';
import {
  DocumentEditor,
  ParticipantStack,
  SessionBanners,
  SessionStatusIndicator,
  StaticDocument,
  createCollabSession,
  loadRecoveryDraftJSON,
  type CollabSession,
  type DisplayPreferences,
} from '../src/index';

interface SceneInfo {
  documentId: string;
  tokens: Record<string, string>;
  accounts: Record<string, string | null>;
}

interface Pane {
  name: string;
  api: ApiClient;
  session: CollabSession;
}

declare global {
  interface Window {
    /** Hooks for the Playwright script. Not part of the product. */
    __rd: {
      panes: Record<string, Pane>;
      violations: string[];
      /** React commits per profiled region since the page loaded. */
      commits: Record<string, number>;
      status: (pane: string) => unknown;
      json: (pane: string) => unknown;
      draft: (id: string) => Promise<unknown>;
      processPaste: (html: string) => unknown;
      control: (command: Record<string, unknown>) => Promise<unknown>;
    };
  }
}

const params = new URLSearchParams(location.search);
const sceneName = params.get('scene') ?? 'default';

async function control(command: Record<string, unknown>): Promise<unknown> {
  const response = await fetch('/control', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scene: sceneName, ...command }),
  });
  return response.json();
}

const violations: string[] = [];
document.addEventListener('securitypolicyviolation', (event) => {
  const where = event.sourceFile
    ? ` at ${event.sourceFile.split('/').pop() ?? ''}:${event.lineNumber}:${event.columnNumber}`
    : '';
  violations.push(`${event.violatedDirective} blocked ${event.blockedURI || 'inline'}${where}`);
});

document.documentElement.dataset.theme = params.get('theme') === 'light' ? 'light' : 'dark';

function display(): Partial<DisplayPreferences> {
  const tone = params.get('tone');
  const width = params.get('width');
  const scale = Number(params.get('scale'));
  return {
    ...(tone === 'dark' || tone === 'light' ? { tone } : {}),
    ...(width === 'narrow' || width === 'normal' || width === 'wide' || width === 'full'
      ? { readingWidth: width }
      : {}),
    ...(Number.isFinite(scale) && scale > 0 ? { fontScale: scale } : {}),
  };
}

function countCommit(id: string): void {
  window.__rd.commits[id] = (window.__rd.commits[id] ?? 0) + 1;
}

/** `?static=1`: the print / draft renderer with the sample document. */
function StaticView() {
  const [api] = useState(() => createApiClient({ baseUrl: `${location.origin}/p/none` }));
  return (
    <main className="demo demo--static" data-testid="demo-ready">
      <StaticDocument
        content={buildSampleDocument({ imageAssetId: null })}
        api={api}
        documentId="00000000-0000-4000-8000-000000000000"
        display={display()}
      />
    </main>
  );
}

function PaneView({ pane }: { pane: Pane }) {
  const readOnly = pane.name === 'viewer';
  const variant = params.get('variant') === 'panel' ? 'panel' : readOnly ? 'viewer' : 'editor';
  const [follow, setFollow] = useState(params.get('follow') === '1' && readOnly);
  return (
    <section className="demo-pane" data-pane={pane.name}>
      <header className="demo-pane__head">
        <span className="demo-pane__name">{pane.name}</span>
        <span className="demo-pane__meta">
          <ParticipantStack session={pane.session} max={3} />
          <Profiler id={`status:${pane.name}`} onRender={countCommit}>
            <SessionStatusIndicator session={pane.session} />
          </Profiler>
        </span>
      </header>
      <div className="demo-pane__banners">
        <SessionBanners
          session={pane.session}
          onOpenDraft={(id) => {
            void loadRecoveryDraftJSON(id).then((json) => {
              console.info('draft', id, JSON.stringify(json).slice(0, 200));
            });
          }}
        />
      </div>
      <div className="demo-pane__body">
        <Profiler id={`editor:${pane.name}`} onRender={countCommit}>
          <DocumentEditor
            session={pane.session}
            api={pane.api}
            variant={variant}
            display={display()}
            followLatest={follow}
            onFollowLatestChange={setFollow}
          />
        </Profiler>
      </div>
    </section>
  );
}

function App() {
  const [panes, setPanes] = useState<Pane[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let created: Pane[] = [];
    let cancelled = false;
    void (async () => {
      try {
        const info = (await control({
          action: 'scene',
          kind: params.get('kind') ?? 'sample',
        })) as SceneInfo;
        if (cancelled) return;
        const names = (params.get('panes') ?? 'editor,viewer').split(',').filter(Boolean);
        created = names.map((name) => {
          const token = info.tokens[name];
          if (!token) throw new Error(`unknown principal ${name}`);
          const api = createApiClient({ baseUrl: `${location.origin}/p/${token}` });
          const session = createCollabSession({
            api,
            documentId: info.documentId,
            accountId: params.get('guest') === '1' ? null : (info.accounts[name] ?? null),
            documentTitle: 'Demo document',
          });
          return { name, api, session };
        });
        window.__rd.panes = Object.fromEntries(created.map((pane) => [pane.name, pane]));
        setPanes(created);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'The fixture server is not reachable.');
      }
    })();
    return () => {
      cancelled = true;
      for (const pane of created) pane.session.destroy();
    };
  }, []);

  if (error) return <p className="demo__message">Harness error: {error}</p>;
  if (!panes) return <p className="demo__message">Starting…</p>;
  return (
    <main className="demo" data-testid="demo-ready">
      <div className="demo__panes">
        {panes.map((pane) => (
          <PaneView key={pane.name} pane={pane} />
        ))}
      </div>
    </main>
  );
}

window.__rd = {
  panes: {},
  violations,
  commits: {},
  status: (pane) => window.__rd.panes[pane]?.session.getStatus(),
  json: (pane) => {
    const session = window.__rd.panes[pane]?.session;
    return session ? yDocToProsemirrorJSON(session.ydoc, Y_FRAGMENT_FIELD) : null;
  },
  draft: (id) => loadRecoveryDraftJSON(id),
  // Runs the real clipboard pipeline in this browser (sanitizer included).
  processPaste: (html) => {
    let counter = 0;
    const result = processPastedHtml(html, {
      documentId: '00000000-0000-4000-8000-000000000000',
      createUploadId: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`,
      acceptImage: ({ mime }) => mime.startsWith('image/'),
    });
    return {
      html: result.html,
      report: result.report,
      images: result.images.map((image) => ({ ...image, bytes: image.bytes.byteLength })),
    };
  },
  control,
};

const root = document.getElementById('root');
if (root) {
  const strict = params.get('strict') !== '0';
  const app = params.get('static') === '1' ? <StaticView /> : <App />;
  createRoot(root).render(strict ? <StrictMode>{app}</StrictMode> : app);
}
