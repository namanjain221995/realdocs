/**
 * Lifecycle actions on documents (administrators), shared by the dashboard
 * and the document header.
 *
 * Optimistic where a wrong guess is cheap to undo: renaming and moving a
 * document between Active, Archived and Trash update the lists at once and
 * roll back if the server refuses. Creating, duplicating and deleting
 * permanently wait for the server.
 */
import type { DocumentResponse, DocumentsResponse, DocumentSummary } from '@realtimedocs/contracts';
import { useToast } from '@realtimedocs/ui';
import {
  type QueryClient,
  type QueryKey,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { api } from '../../lib/api';
import { errorMessage, requestIdOf } from '../../lib/errors';
import { documentPath } from '../../lib/navigation';
import { queryKeys } from '../../lib/queryKeys';

type ListSnapshot = [QueryKey, DocumentsResponse | undefined][];

/** Titles in toasts are cut so one long title cannot fill the screen. */
export function shortTitle(title: string, max = 48): string {
  const trimmed = title.trim() || 'Untitled document';
  return trimmed.length > max ? `${trimmed.slice(0, max - 1).trimEnd()}…` : trimmed;
}

function snapshotLists(queryClient: QueryClient): ListSnapshot {
  return queryClient.getQueriesData<DocumentsResponse>({ queryKey: queryKeys.documentLists });
}

function restoreLists(queryClient: QueryClient, snapshot: ListSnapshot): void {
  for (const [key, data] of snapshot) queryClient.setQueryData(key, data);
}

function updateLists(
  queryClient: QueryClient,
  update: (documents: DocumentSummary[]) => DocumentSummary[],
): void {
  queryClient.setQueriesData<DocumentsResponse>({ queryKey: queryKeys.documentLists }, (data) =>
    data ? { documents: update(data.documents) } : data,
  );
}

function describeFailure(error: unknown): string {
  const requestId = requestIdOf(error);
  return requestId ? `${errorMessage(error)} Reference ${requestId}` : errorMessage(error);
}

export type StatusChange = 'archive' | 'unarchive' | 'trash' | 'restore';

const STATUS_CALL: Record<StatusChange, (id: string) => Promise<DocumentResponse>> = {
  archive: api.documents.archive,
  unarchive: api.documents.unarchive,
  trash: api.documents.trash,
  restore: api.documents.restore,
};

const STATUS_DONE: Record<StatusChange, (title: string) => string> = {
  archive: (title) => `Archived “${title}”`,
  unarchive: (title) => `Unarchived “${title}”`,
  trash: (title) => `Moved “${title}” to trash`,
  restore: (title) => `Restored “${title}”`,
};

const STATUS_FAILED: Record<StatusChange, string> = {
  archive: 'Could not archive the document',
  unarchive: 'Could not unarchive the document',
  trash: 'Could not move the document to trash',
  restore: 'Could not restore the document',
};

/** The opposite action, offered as Undo in the confirmation toast. */
const STATUS_UNDO: Partial<Record<StatusChange, StatusChange>> = {
  archive: 'unarchive',
  trash: 'restore',
};

export function useDocumentActions() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();

  const refreshLists = (): void => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.documentLists });
  };

  const create = useMutation({
    mutationFn: () => api.documents.create({}),
    onSuccess: ({ document }) => {
      queryClient.setQueryData(queryKeys.document(document.id), { document });
      refreshLists();
      void navigate(documentPath(document.id));
    },
    onError: (error) => {
      toast.show({
        tone: 'danger',
        title: 'Could not create the document',
        description: describeFailure(error),
      });
    },
  });

  const rename = useMutation({
    mutationFn: ({ document, title }: { document: DocumentSummary; title: string }) =>
      api.documents.rename(document.id, { title }),
    onMutate: async ({ document, title }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.documentLists });
      const lists = snapshotLists(queryClient);
      const detailKey = queryKeys.document(document.id);
      const detail = queryClient.getQueryData<DocumentResponse>(detailKey);
      updateLists(queryClient, (documents) =>
        documents.map((each) => (each.id === document.id ? { ...each, title } : each)),
      );
      if (detail) {
        queryClient.setQueryData<DocumentResponse>(detailKey, {
          document: { ...detail.document, title },
        });
      }
      return { lists, detail };
    },
    onError: (error, { document }, context) => {
      if (context) {
        restoreLists(queryClient, context.lists);
        if (context.detail)
          queryClient.setQueryData(queryKeys.document(document.id), context.detail);
      }
      toast.show({
        tone: 'danger',
        title: 'Could not rename the document',
        description: describeFailure(error),
      });
    },
    onSuccess: (response) => {
      queryClient.setQueryData(queryKeys.document(response.document.id), response);
    },
    onSettled: refreshLists,
  });

  /** Undo from a toast: the opposite call, without another toast on success. */
  const undoStatusChange = (document: DocumentSummary, change: StatusChange): void => {
    void STATUS_CALL[change](document.id).then(
      (response) => {
        queryClient.setQueryData(queryKeys.document(response.document.id), response);
        refreshLists();
      },
      (error: unknown) => {
        toast.show({
          tone: 'danger',
          title: STATUS_FAILED[change],
          description: describeFailure(error),
        });
      },
    );
  };

  const changeStatus = useMutation({
    mutationFn: ({ document, change }: { document: DocumentSummary; change: StatusChange }) =>
      STATUS_CALL[change](document.id),
    onMutate: async ({ document }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.documentLists });
      const lists = snapshotLists(queryClient);
      // The document leaves the list it is shown in; the refetch that follows
      // puts it wherever it belongs now.
      updateLists(queryClient, (documents) => documents.filter((each) => each.id !== document.id));
      return { lists };
    },
    onError: (error, { change }, context) => {
      if (context) restoreLists(queryClient, context.lists);
      toast.show({
        tone: 'danger',
        title: STATUS_FAILED[change],
        description: describeFailure(error),
      });
    },
    onSuccess: (response, { change }) => {
      queryClient.setQueryData(queryKeys.document(response.document.id), response);
      const undo = STATUS_UNDO[change];
      toast.show({
        title: STATUS_DONE[change](shortTitle(response.document.title)),
        action: undo
          ? { label: 'Undo', onClick: () => undoStatusChange(response.document, undo) }
          : undefined,
      });
    },
    onSettled: refreshLists,
  });

  const duplicate = useMutation({
    mutationFn: (document: DocumentSummary) => api.documents.duplicate(document.id),
    onSuccess: ({ document }) => {
      queryClient.setQueryData(queryKeys.document(document.id), { document });
      refreshLists();
      toast.show({
        title: `Duplicated as “${shortTitle(document.title)}”`,
        action: { label: 'Open', onClick: () => void navigate(documentPath(document.id)) },
      });
    },
    onError: (error) => {
      toast.show({
        tone: 'danger',
        title: 'Could not duplicate the document',
        description: describeFailure(error),
      });
    },
  });

  /** Resolves once deleted; rejects with a readable message for the confirm dialog. */
  const deletePermanently = async (document: DocumentSummary): Promise<void> => {
    try {
      await api.documents.deletePermanently(document.id);
    } catch (error) {
      throw new Error(describeFailure(error), { cause: error });
    }
    updateLists(queryClient, (documents) => documents.filter((each) => each.id !== document.id));
    queryClient.removeQueries({ queryKey: queryKeys.document(document.id) });
    refreshLists();
    toast.show({ title: `Deleted “${shortTitle(document.title)}” permanently` });
  };

  return { create, rename, changeStatus, duplicate, deletePermanently };
}
