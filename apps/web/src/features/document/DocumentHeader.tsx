import type { DocumentSummary } from '@realtimedocs/contracts';
import {
  Badge,
  Button,
  Dialog,
  DropdownMenu,
  IconButton,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  Popover,
} from '@realtimedocs/ui';
import {
  ALargeSmall,
  ArrowLeft,
  Download,
  Ellipsis,
  FileArchive,
  FileText,
  FileType,
  History,
  LogOut,
  MonitorUp,
  Pencil,
  Printer,
  UserPlus,
} from 'lucide-react';
import { type KeyboardEvent, type RefCallback, useEffect, useRef, useState } from 'react';
import { RouterLinkButton } from '../../components/links';
import { RoleBadge } from '../../components/RoleBadge';
import { api } from '../../lib/api';
import { useMediaQuery } from '../../lib/hooks';
import { documentPrintPath } from '../../lib/navigation';
import type { DocumentCapabilities } from '../../lib/permissions';
import { useLimits } from '../../lib/useLimits';
import { DisplayPreferencesForm } from './DisplayPreferences';

export type WorkspacePanel = 'share' | 'snapshots';

/* ----------------------------------------------------------------- title */

function DocumentTitle({
  title,
  canRename,
  onRename,
}: {
  title: string;
  canRename: boolean;
  onRename: (title: string) => void;
}) {
  const limits = useLimits();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  // Escape must not be followed by the save that blur would otherwise do.
  const cancelled = useRef(false);
  const restoreFocus = useRef(false);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else if (restoreFocus.current) {
      restoreFocus.current = false;
      editButtonRef.current?.focus();
    }
  }, [editing]);

  const start = (): void => {
    if (!canRename) return;
    cancelled.current = false;
    setDraft(title);
    setEditing(true);
  };

  const finish = (save: boolean, viaKeyboard: boolean): void => {
    restoreFocus.current = viaKeyboard;
    setEditing(false);
    const next = draft.trim();
    // An empty title is not saved; the previous one stays.
    if (save && next !== '' && next !== title) onRename(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      cancelled.current = true;
      finish(true, true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancelled.current = true;
      finish(false, true);
    }
  };

  if (editing) {
    return (
      <div className="doc-title doc-title--editing">
        <input
          ref={inputRef}
          className="doc-title__input"
          aria-label="Document title"
          value={draft}
          maxLength={limits.titleMaxLength}
          autoComplete="off"
          spellCheck
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => {
            if (!cancelled.current) finish(true, false);
          }}
          data-testid="document-title-input"
        />
      </div>
    );
  }

  return (
    <div className="doc-title">
      <h1
        className="doc-title__text"
        title={title}
        data-editable={canRename ? '' : undefined}
        onClick={start}
        data-testid="document-title"
      >
        {title}
      </h1>
      {canRename ? (
        <IconButton
          ref={editButtonRef}
          size="sm"
          label="Rename document"
          className="doc-title__edit"
          onClick={start}
          data-testid="rename-document"
        >
          <Pencil />
        </IconButton>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------- actions */

function ExportItems({ documentId }: { documentId: string }) {
  return (
    <>
      <MenuLabel>Download</MenuLabel>
      <MenuItem
        icon={<FileText />}
        href={api.exportUrl(documentId, 'txt')}
        download
        data-testid="export-txt"
      >
        Plain text (.txt)
      </MenuItem>
      <MenuItem
        icon={<FileType />}
        href={api.exportUrl(documentId, 'md')}
        download
        data-testid="export-md"
      >
        Markdown (.md)
      </MenuItem>
      <MenuItem
        icon={<FileArchive />}
        href={api.exportUrl(documentId, 'md-zip')}
        download
        data-testid="export-md-zip"
      >
        Markdown with images (.zip)
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        icon={<Printer />}
        href={documentPrintPath(documentId)}
        target="_blank"
        data-testid="export-print"
      >
        Print view (save as PDF)
      </MenuItem>
    </>
  );
}

export interface DocumentHeaderProps {
  document: DocumentSummary;
  capabilities: DocumentCapabilities;
  signedIn: boolean;
  /** Phone layout: two rows and one overflow menu. */
  narrow: boolean;
  panel: WorkspacePanel | null;
  onPanel: (panel: WorkspacePanel | null) => void;
  onRename: (title: string) => void;
  onOpenInDesktop: () => void;
  onLeave: () => void;
  leaving: boolean;
  /** The editor portals its connection and save indicator into this element. */
  statusSlotRef: RefCallback<HTMLElement>;
  /** The editor portals the participant avatars into this element. */
  participantsSlotRef: RefCallback<HTMLElement>;
}

export function DocumentHeader({
  document,
  capabilities,
  signedIn,
  narrow,
  panel,
  onPanel,
  onRename,
  onOpenInDesktop,
  onLeave,
  leaving,
  statusSlotRef,
  participantsSlotRef,
}: DocumentHeaderProps) {
  // Between phone and wide: icons without labels, except for Share.
  const iconsOnly = useMediaQuery('(max-width: 1179px)');
  const [displayOpen, setDisplayOpen] = useState(false);
  const toggle = (which: WorkspacePanel): void => onPanel(panel === which ? null : which);

  const identity = (
    <>
      <RoleBadge role={document.access.role} data-testid="document-role" />
      {capabilities.canLeave ? <Badge data-testid="via-share-link">Shared by link</Badge> : null}
    </>
  );
  const slots = (
    <>
      <div className="doc-slot doc-slot--status" ref={statusSlotRef} data-testid="status-slot" />
      <div
        className="doc-slot doc-slot--participants"
        ref={participantsSlotRef}
        data-testid="participants-slot"
      />
    </>
  );

  const back = signedIn ? (
    <RouterLinkButton
      to="/"
      variant="ghost"
      className="doc-back"
      aria-label="Back to documents"
      iconLeft={<ArrowLeft />}
      data-testid="back-to-documents"
    />
  ) : null;

  const title = (
    <DocumentTitle title={document.title} canRename={capabilities.canRename} onRename={onRename} />
  );

  if (narrow) {
    return (
      <header className="doc-header doc-header--narrow" data-testid="document-header">
        <div className="doc-header__row">
          {back}
          {title}
          <div className="doc-actions">
            {capabilities.canManage ? (
              <IconButton
                variant="solid"
                label="Share"
                pressed={panel === 'share'}
                onClick={() => toggle('share')}
                data-testid="open-sharing"
              >
                <UserPlus />
              </IconButton>
            ) : null}
            <DropdownMenu
              placement="bottom-end"
              trigger={
                <IconButton label="More actions" data-testid="document-more">
                  <Ellipsis />
                </IconButton>
              }
            >
              {capabilities.canManage ? (
                <MenuItem
                  icon={<History />}
                  onSelect={() => toggle('snapshots')}
                  data-testid="open-snapshots"
                >
                  Snapshots
                </MenuItem>
              ) : null}
              <MenuItem
                icon={<MonitorUp />}
                onSelect={onOpenInDesktop}
                data-testid="open-in-desktop"
              >
                Open in Desktop
              </MenuItem>
              <MenuItem
                icon={<ALargeSmall />}
                onSelect={() => setDisplayOpen(true)}
                data-testid="open-display-preferences"
              >
                Display preferences
              </MenuItem>
              <MenuSeparator />
              <ExportItems documentId={document.id} />
              {capabilities.canLeave ? (
                <>
                  <MenuSeparator />
                  <MenuItem
                    icon={<LogOut />}
                    onSelect={onLeave}
                    disabled={leaving}
                    data-testid="leave-document"
                  >
                    Leave document
                  </MenuItem>
                </>
              ) : null}
            </DropdownMenu>
          </div>
        </div>
        <div className="doc-header__row doc-header__row--meta">
          {identity}
          {slots}
        </div>
        <Dialog
          open={displayOpen}
          onOpenChange={setDisplayOpen}
          size="sm"
          title="Display preferences"
          footer={
            <Button variant="primary" onClick={() => setDisplayOpen(false)}>
              Done
            </Button>
          }
        >
          <DisplayPreferencesForm />
        </Dialog>
      </header>
    );
  }

  return (
    <header className="doc-header" data-testid="document-header">
      <div className="doc-header__row">
        {back}
        {title}
        <div className="doc-header__identity">{identity}</div>
        <div className="doc-header__live">{slots}</div>
        <div className="doc-actions">
          {capabilities.canManage ? (
            <>
              <Button
                variant="primary"
                iconLeft={<UserPlus />}
                pressed={panel === 'share'}
                onClick={() => toggle('share')}
                data-testid="open-sharing"
              >
                Share
              </Button>
              {iconsOnly ? (
                <IconButton
                  variant="solid"
                  label="Snapshots"
                  pressed={panel === 'snapshots'}
                  onClick={() => toggle('snapshots')}
                  data-testid="open-snapshots"
                >
                  <History />
                </IconButton>
              ) : (
                <Button
                  iconLeft={<History />}
                  pressed={panel === 'snapshots'}
                  onClick={() => toggle('snapshots')}
                  data-testid="open-snapshots"
                >
                  Snapshots
                </Button>
              )}
            </>
          ) : null}
          <DropdownMenu
            placement="bottom-end"
            trigger={
              iconsOnly ? (
                <IconButton variant="solid" label="Export" data-testid="open-export">
                  <Download />
                </IconButton>
              ) : (
                <Button iconLeft={<Download />} data-testid="open-export">
                  Export
                </Button>
              )
            }
          >
            <ExportItems documentId={document.id} />
          </DropdownMenu>
          {iconsOnly ? (
            <IconButton
              variant="solid"
              label="Open in Desktop"
              onClick={onOpenInDesktop}
              data-testid="open-in-desktop"
            >
              <MonitorUp />
            </IconButton>
          ) : (
            <Button
              iconLeft={<MonitorUp />}
              onClick={onOpenInDesktop}
              data-testid="open-in-desktop"
            >
              Open in Desktop
            </Button>
          )}
          <Popover
            open={displayOpen}
            onOpenChange={setDisplayOpen}
            placement="bottom-end"
            aria-label="Display preferences"
            className="doc-display-popover"
            trigger={
              <IconButton
                variant="solid"
                label="Display preferences"
                data-testid="open-display-preferences"
              >
                <ALargeSmall />
              </IconButton>
            }
          >
            <DisplayPreferencesForm />
          </Popover>
          {capabilities.canLeave ? (
            <Button
              variant="ghost"
              iconLeft={<LogOut />}
              loading={leaving}
              onClick={onLeave}
              data-testid="leave-document"
            >
              Leave
            </Button>
          ) : null}
        </div>
      </div>
    </header>
  );
}
