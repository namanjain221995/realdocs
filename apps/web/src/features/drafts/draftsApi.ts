/**
 * Recovery drafts and pending local changes of the signed-in account.
 *
 * They live in the editor package's device store (IndexedDB, one database per
 * account). This file is the web app's only door to that store. The store is
 * reached through a dynamic import, so opening Settings or signing out does
 * not pull the editor into the first page load; the functions keep the names
 * and meanings of the editor's own (`docs/notes/editor-api.md`).
 */
import type { DocJSON, RecoveryDraft } from '@realtimedocs/editor';

export type { RecoveryDraft };
/** ProseMirror JSON of a draft. */
export type DraftContent = DocJSON;

const store = () => import('@realtimedocs/editor');

/** Recovery drafts kept on this device for one account, newest first. */
export async function listRecoveryDrafts(accountId: string): Promise<RecoveryDraft[]> {
  return (await store()).listRecoveryDrafts(accountId);
}

/** The draft's content as ProseMirror JSON, or null if it no longer exists. */
export async function loadRecoveryDraftJSON(draftId: string): Promise<DraftContent | null> {
  return (await store()).loadRecoveryDraftJSON(draftId);
}

export async function deleteRecoveryDraft(draftId: string): Promise<void> {
  await (await store()).deleteRecoveryDraft(draftId);
}

/**
 * Removes everything this device holds for one account: the offline copies of
 * documents, unsent changes and recovery drafts. Called on sign-out.
 */
export async function clearLocalDataForAccount(accountId: string): Promise<void> {
  await (await store()).clearLocalDataForAccount(accountId);
}

/** True if the account has unsent local changes or drafts on this device. */
export async function hasLocalDataForAccount(accountId: string): Promise<boolean> {
  return (await store()).hasLocalDataForAccount(accountId);
}
