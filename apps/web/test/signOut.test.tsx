/**
 * The sign-out flow and the recovery-drafts list, with the local draft store
 * replaced by a stub. In the app that store is the editor's
 * (`features/drafts/draftsApi.ts` delegates to `@realtimedocs/editor`); the
 * stub lets every "you have unsaved local work" path be exercised here
 * without IndexedDB. The same paths run against the real store, the real
 * editor and the real server in `test-real/people.spec.ts`.
 */
import { ToastProvider } from '@realtimedocs/ui';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignOutProvider, useSignOut } from '../src/components/SignOut';
import * as draftsApi from '../src/features/drafts/draftsApi';
import { RecoveryDrafts } from '../src/features/settings/RecoveryDrafts';
import { getCsrfToken, setCsrfToken } from '../src/lib/api';
import { createQueryClient } from '../src/lib/queryClient';
import { SessionProvider, useSession } from '../src/lib/session';

vi.mock('../src/features/drafts/draftsApi', () => ({
  listRecoveryDrafts: vi.fn(),
  loadRecoveryDraftJSON: vi.fn(),
  deleteRecoveryDraft: vi.fn(),
  clearLocalDataForAccount: vi.fn(),
  hasLocalDataForAccount: vi.fn(),
}));

const drafts = vi.mocked(draftsApi);

const USER = {
  id: '11111111-2222-4333-8444-555555555555',
  email: 'asha@example.test',
  displayName: 'Asha Rao',
  role: 'admin',
  status: 'active',
  createdAt: '2026-10-01T09:00:00.000Z',
} as const;

const DRAFT: draftsApi.RecoveryDraft = {
  id: 'draft-1',
  accountId: USER.id,
  documentId: '5e6f7a8b-9c0d-4e1f-a2b3-c4d5e6f7a8b9',
  documentTitle: 'Q4 launch plan',
  generation: 2,
  reason: 'generation_restored',
  createdAt: Date.parse('2026-11-10T11:00:00.000Z'),
};

/** What the fake server did, in order, interleaved with local-store calls. */
let events: string[];
let logoutFails: boolean;
let root: Root;
let container: HTMLElement;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  if (url === '/api/auth/session') {
    return Promise.resolve(json(200, { user: USER, csrfToken: 'csrf-1', expiresAt: null }));
  }
  if (url === '/api/auth/logout' && init?.method === 'POST') {
    events.push('server:logout');
    if (logoutFails) return Promise.reject(new TypeError('Failed to fetch'));
    return Promise.resolve(new Response(null, { status: 204 }));
  }
  return Promise.resolve(json(404, { error: { code: 'not_found', message: 'not mocked' } }));
}

function Probe() {
  const { user, endReason } = useSession();
  const { requestSignOut } = useSignOut();
  return (
    <div>
      <p data-testid="who">{user ? user.displayName : `signed out (${endReason ?? 'none'})`}</p>
      <button type="button" data-testid="sign-out" onClick={requestSignOut}>
        Sign out
      </button>
    </div>
  );
}

async function settle(): Promise<void> {
  // Lets promises, query notifications and effects run.
  for (let turn = 0; turn < 8; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function render(children: ReactNode, path = '/'): Promise<{ location: () => string }> {
  const queryClient = createQueryClient();
  const router = createMemoryRouter(
    [
      { path: '/', element: children },
      { path: '/settings', element: <p data-testid="settings-page">Settings</p> },
      { path: '/login', element: <p data-testid="login-page">Sign in</p> },
    ],
    { initialEntries: [path] },
  );
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <SessionProvider>
            <RouterProvider router={router} />
          </SessionProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
  });
  await settle();
  return { location: () => router.state.location.pathname + router.state.location.hash };
}

function byTestId(id: string): HTMLElement | null {
  return document.body.querySelector<HTMLElement>(`[data-testid="${id}"]`);
}

function buttonNamed(scope: ParentNode, name: string): HTMLButtonElement {
  const button = [...scope.querySelectorAll('button')].find(
    (each) => each.textContent?.trim() === name,
  );
  if (!button) throw new Error(`No button named "${name}"`);
  return button;
}

async function click(element: Element | null): Promise<void> {
  if (!element) throw new Error('Nothing to click');
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await settle();
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  events = [];
  logoutFails = false;
  setCsrfToken(null);
  vi.stubGlobal('fetch', fakeFetch);
  drafts.hasLocalDataForAccount.mockResolvedValue(false);
  drafts.listRecoveryDrafts.mockResolvedValue([]);
  drafts.loadRecoveryDraftJSON.mockResolvedValue(null);
  drafts.deleteRecoveryDraft.mockImplementation((id) => {
    events.push(`local:delete:${id}`);
    return Promise.resolve();
  });
  drafts.clearLocalDataForAccount.mockImplementation((accountId) => {
    events.push(`local:clear:${accountId}`);
    return Promise.resolve();
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const signedInTree = (
  <SignOutProvider>
    <Probe />
  </SignOutProvider>
);

describe('signing out', () => {
  it('signs out at once when this device holds nothing unsaved', async () => {
    const page = await render(signedInTree);
    expect(byTestId('who')?.textContent).toBe('Asha Rao');
    expect(getCsrfToken()).toBe('csrf-1');

    await click(byTestId('sign-out'));

    expect(byTestId('sign-out-confirm')).toBeNull();
    // The server first, then the local data of exactly this account.
    expect(events).toEqual(['server:logout', `local:clear:${USER.id}`]);
    expect(page.location()).toBe('/login');
    expect(getCsrfToken()).toBeNull();
  });

  it('asks first when unsaved work would be deleted, and does nothing on cancel', async () => {
    drafts.hasLocalDataForAccount.mockResolvedValue(true);
    drafts.listRecoveryDrafts.mockResolvedValue([DRAFT, { ...DRAFT, id: 'draft-2' }]);
    const page = await render(signedInTree);

    await click(byTestId('sign-out'));

    const dialog = byTestId('sign-out-confirm');
    expect(dialog?.textContent).toContain('Sign out and delete unsaved work on this device?');
    expect(dialog?.textContent).toContain('including 2 recovery drafts');
    expect(dialog?.textContent).toContain('Everything already saved on the server stays');
    expect(events).toEqual([]);

    await click(buttonNamed(dialog as HTMLElement, 'Stay signed in'));
    expect(byTestId('sign-out-confirm')).toBeNull();
    expect(events).toEqual([]);
    expect(byTestId('who')?.textContent).toBe('Asha Rao');
    expect(page.location()).toBe('/');
  });

  it('deletes the local work only after the server has ended the session', async () => {
    drafts.hasLocalDataForAccount.mockResolvedValue(true);
    drafts.listRecoveryDrafts.mockResolvedValue([DRAFT]);
    const page = await render(signedInTree);

    await click(byTestId('sign-out'));
    const dialog = byTestId('sign-out-confirm');
    expect(dialog?.textContent).toContain('including 1 recovery draft');
    await click(buttonNamed(dialog as HTMLElement, 'Sign out and delete'));

    expect(events).toEqual(['server:logout', `local:clear:${USER.id}`]);
    expect(page.location()).toBe('/login');
  });

  it('keeps the local work and the session when the server cannot be reached', async () => {
    drafts.hasLocalDataForAccount.mockResolvedValue(true);
    drafts.listRecoveryDrafts.mockResolvedValue([DRAFT]);
    logoutFails = true;
    const page = await render(signedInTree);

    await click(byTestId('sign-out'));
    await click(buttonNamed(byTestId('sign-out-confirm') as HTMLElement, 'Sign out and delete'));

    // The dialog stays open and says what happened; nothing was deleted.
    const dialog = byTestId('sign-out-confirm');
    expect(dialog?.querySelector('[role="alert"]')?.textContent).toContain(
      'You are still signed in',
    );
    expect(events).toEqual(['server:logout']);
    expect(drafts.clearLocalDataForAccount).not.toHaveBeenCalled();
    expect(byTestId('who')?.textContent).toBe('Asha Rao');
    expect(page.location()).toBe('/');
  });

  it('treats an unreadable local store as "there may be something to lose"', async () => {
    drafts.hasLocalDataForAccount.mockRejectedValue(new Error('IndexedDB is blocked'));
    await render(signedInTree);
    await click(byTestId('sign-out'));
    expect(byTestId('sign-out-confirm')).not.toBeNull();
    expect(events).toEqual([]);
  });

  it('offers a way to review the drafts before deciding', async () => {
    drafts.hasLocalDataForAccount.mockResolvedValue(true);
    drafts.listRecoveryDrafts.mockResolvedValue([DRAFT]);
    const page = await render(signedInTree);
    await click(byTestId('sign-out'));
    const link = byTestId('sign-out-confirm')?.querySelector('a');
    expect(link?.textContent).toBe('Review recovery drafts first');
    await click(link ?? null);
    expect(page.location()).toBe('/settings#recovery-drafts');
    expect(events).toEqual([]);
  });
});

describe('recovery drafts in settings', () => {
  it('lists the drafts of the account with the reason each one was kept', async () => {
    drafts.listRecoveryDrafts.mockResolvedValue([
      DRAFT,
      { ...DRAFT, id: 'draft-2', documentTitle: 'Board notes', reason: 'access_removed' },
    ]);
    await render(<RecoveryDrafts accountId={USER.id} />);

    expect(drafts.listRecoveryDrafts).toHaveBeenCalledWith(USER.id);
    const rows = document.body.querySelectorAll('[data-testid="draft-row"]');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('Q4 launch plan');
    expect(rows[0]?.textContent).toContain('A snapshot was restored while this work was unsaved');
    expect(rows[1]?.textContent).toContain('Your edit access ended while this work was unsaved');
  });

  it('shows an empty state when there are none', async () => {
    await render(<RecoveryDrafts accountId={USER.id} />);
    expect(byTestId('drafts-empty')?.textContent).toContain('No recovery drafts on this device');
  });

  it('deletes a draft only after confirmation', async () => {
    drafts.listRecoveryDrafts.mockResolvedValue([DRAFT]);
    await render(<RecoveryDrafts accountId={USER.id} />);

    await click(document.body.querySelector('[aria-label="Delete the draft of Q4 launch plan"]'));
    const dialog = byTestId('delete-draft-confirm');
    expect(dialog?.textContent).toContain('It was never uploaded, so it cannot be recovered');
    expect(events).toEqual([]);

    drafts.listRecoveryDrafts.mockResolvedValue([]);
    await click(buttonNamed(dialog as HTMLElement, 'Delete draft'));
    expect(events).toEqual(['local:delete:draft-1']);
    expect(byTestId('delete-draft-confirm')).toBeNull();
    expect(byTestId('drafts-empty')).not.toBeNull();
  });

  it('says so when the local store cannot be read', async () => {
    drafts.listRecoveryDrafts.mockRejectedValue(new Error('blocked'));
    await render(<RecoveryDrafts accountId={USER.id} />);
    expect(document.body.textContent).toContain('Recovery drafts could not be read');
  });
});
