/**
 * Link editor. Every address passes `sanitizeLinkHref` before it is stored
 * or opened: only http(s), mailto and tel links exist in a document.
 */
import { Button, Popover, TextField, copyText, type PopoverVirtualAnchor } from '@realtimedocs/ui';
import type { Editor } from '@tiptap/core';
import { Check, Copy, ExternalLink, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { sanitizeLinkHref } from '../schema';

export interface LinkPopoverProps {
  editor: Editor;
  open: boolean;
  /** The clicked link, if the popover was opened from one. */
  anchor: HTMLElement | null;
  onClose: () => void;
  openLink: (href: string) => void;
}

export const LINK_ERROR =
  'Enter a web address (https://…), an email (mailto:) or a phone link (tel:).';

/** Validates user input for a link; returns the normalised href or null. */
export function normalizeLinkInput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  // A bare email address is a mail link.
  if (/^[^\s@/:]+@[^\s@/:]+\.[^\s@/:]+$/.test(trimmed))
    return sanitizeLinkHref(`mailto:${trimmed}`);
  return sanitizeLinkHref(trimmed);
}

export function LinkPopover({ editor, open, anchor, onClose, openLink }: LinkPopoverProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    const href: unknown = editor.getAttributes('link').href;
    const current = typeof href === 'string' ? href : '';
    setValue(current);
    setExisting(current !== '');
    setError(null);
    setCopied(false);
  }, [open, editor]);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  // Anchored to the clicked link, else to the selection.
  const position = useMemo<HTMLElement | PopoverVirtualAnchor | null>(() => {
    if (!open) return null;
    if (anchor?.isConnected) return anchor;
    return {
      contextElement: editor.view.dom,
      getBoundingClientRect: () => {
        const { from, to } = editor.state.selection;
        const start = editor.view.coordsAtPos(from);
        const end = editor.view.coordsAtPos(to);
        const top = Math.min(start.top, end.top);
        const bottom = Math.max(start.bottom, end.bottom);
        const left = Math.min(start.left, end.left);
        const right = Math.max(start.right, end.right);
        return {
          x: left,
          y: top,
          top,
          bottom,
          left,
          right,
          width: right - left,
          height: bottom - top,
        };
      },
    };
  }, [open, anchor, editor]);

  const apply = (event: FormEvent): void => {
    event.preventDefault();
    const href = normalizeLinkInput(value);
    if (!href) {
      setError(LINK_ERROR);
      return;
    }
    const chain = editor.chain().focus();
    if (editor.state.selection.empty && !editor.isActive('link')) {
      // Nothing selected: insert the address itself as the link text.
      chain
        .insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] })
        .run();
    } else {
      chain.extendMarkRange('link').setLink({ href }).run();
    }
    onClose();
  };

  const remove = (): void => {
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    onClose();
  };

  const safeCurrent = normalizeLinkInput(value);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      anchor={position}
      placement="bottom-start"
      aria-label="Edit link"
    >
      <form className="rd-popover-form rd-link-form" onSubmit={apply} noValidate>
        <TextField
          label="Link address"
          type="url"
          inputMode="url"
          placeholder="https://example.com"
          value={value}
          error={error ?? undefined}
          autoComplete="off"
          spellCheck={false}
          data-testid="rd-link-input"
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
        />
        <div className="rd-popover-form__actions">
          {existing ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                iconLeft={<ExternalLink size={14} />}
                disabled={!safeCurrent}
                onClick={() => {
                  if (safeCurrent) openLink(safeCurrent);
                }}
              >
                Open
              </Button>
              <Button
                size="sm"
                variant="ghost"
                iconLeft={copied ? <Check size={14} /> : <Copy size={14} />}
                disabled={!safeCurrent}
                data-testid="rd-link-copy"
                onClick={() => {
                  // Only the sanitized address is ever copied.
                  if (safeCurrent) void copyText(safeCurrent).then((ok) => setCopied(ok));
                }}
              >
                {copied ? 'Copied' : 'Copy link'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                iconLeft={<Trash2 size={14} />}
                onClick={remove}
                data-testid="rd-link-remove"
              >
                Remove
              </Button>
            </>
          ) : null}
          <Button size="sm" variant="primary" type="submit" data-testid="rd-link-apply">
            {existing ? 'Update' : 'Add link'}
          </Button>
        </div>
      </form>
    </Popover>
  );
}
