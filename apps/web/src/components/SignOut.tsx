/**
 * Signing out.
 *
 * Signed-in editors can hold unsaved changes and recovery drafts in this
 * browser. Signing out deletes them (so the next person at this browser
 * cannot read them), which is why it asks first whenever there is something
 * to lose. Order of operations:
 *   1. the server ends the session; if that fails nothing local is touched;
 *   2. local data of the account is deleted;
 *   3. cached API data is dropped and the sign-in screen opens.
 */
import { ConfirmDialog, useToast } from '@realtimedocs/ui';
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNavigate } from 'react-router';
import {
  clearLocalDataForAccount,
  hasLocalDataForAccount,
  listRecoveryDrafts,
} from '../features/drafts/draftsApi';
import { api } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { forgetAccountData, useSession } from '../lib/session';
import { useRouterLink } from './links';

export interface SignOutControls {
  /** Starts the flow: asks first if local work would be deleted. */
  requestSignOut: () => void;
  /** True from the click until the flow has finished or was cancelled. */
  pending: boolean;
}

const SignOutContext = createContext<SignOutControls | null>(null);

interface Prompt {
  accountId: string;
  draftCount: number;
}

export function SignOutProvider({ children }: { children?: ReactNode }) {
  const session = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const draftsLink = useRouterLink('/settings#recovery-drafts');
  const { clear } = session;

  const finish = useCallback(
    async (accountId: string): Promise<void> => {
      await api.auth.logout();
      let localDataCleared = true;
      try {
        await clearLocalDataForAccount(accountId);
      } catch {
        localDataCleared = false;
      }
      forgetAccountData(queryClient);
      clear();
      void navigate('/login', { replace: true });
      if (localDataCleared) {
        toast.show({ title: 'Signed out' });
      } else {
        toast.show({
          tone: 'warning',
          title: 'Signed out, but local drafts are still in this browser',
          description:
            'They could not be deleted. Clear the site data for this address in your browser settings.',
          durationMs: 0,
        });
      }
    },
    [queryClient, clear, navigate, toast],
  );

  const requestSignOut = useCallback(() => {
    const user = session.user;
    if (!user || busy.current) return;
    busy.current = true;
    setPending(true);
    void (async () => {
      try {
        let hasLocalData: boolean;
        try {
          hasLocalData = await hasLocalDataForAccount(user.id);
        } catch {
          // If the local store cannot be read, assume there is something to lose.
          hasLocalData = true;
        }
        if (hasLocalData) {
          const drafts = await listRecoveryDrafts(user.id).catch(() => []);
          setPrompt({ accountId: user.id, draftCount: drafts.length });
          return;
        }
        await finish(user.id);
      } catch (error) {
        toast.show({
          tone: 'danger',
          title: 'Could not sign out',
          description: `${errorMessage(error)} You are still signed in.`,
        });
      } finally {
        busy.current = false;
        setPending(false);
      }
    })();
  }, [session.user, finish, toast]);

  const controls = useMemo<SignOutControls>(
    () => ({ requestSignOut, pending }),
    [requestSignOut, pending],
  );

  return (
    <SignOutContext value={controls}>
      {children}
      {prompt ? (
        <ConfirmDialog
          danger
          data-testid="sign-out-confirm"
          title="Sign out and delete unsaved work on this device?"
          message={
            <>
              This browser holds work of yours that has not reached the server
              {prompt.draftCount > 0
                ? `, including ${prompt.draftCount} recovery ${prompt.draftCount === 1 ? 'draft' : 'drafts'}`
                : ''}
              . Signing out deletes it from this device, so the next person to use this browser
              cannot read it. Everything already saved on the server stays.{' '}
              <a
                className="rd-link"
                href={draftsLink.href}
                onClick={(event) => {
                  setPrompt(null);
                  draftsLink.onClick(event);
                }}
              >
                Review recovery drafts first
              </a>
            </>
          }
          confirmLabel="Sign out and delete"
          cancelLabel="Stay signed in"
          onCancel={() => setPrompt(null)}
          onConfirm={async () => {
            try {
              await finish(prompt.accountId);
              setPrompt(null);
            } catch (error) {
              throw new Error(`${errorMessage(error)} You are still signed in.`, { cause: error });
            }
          }}
        />
      ) : null}
    </SignOutContext>
  );
}

export function useSignOut(): SignOutControls {
  const value = useContext(SignOutContext);
  if (!value) throw new Error('useSignOut() must be used inside <SignOutProvider>.');
  return value;
}
