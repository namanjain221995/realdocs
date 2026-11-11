/**
 * A panel beside the document (Share, Snapshots).
 *
 * Wide screens: docked to the right of the document, not modal, so the
 * document stays readable next to it. Narrow screens: the same element
 * becomes a full-screen sheet and behaves like a modal dialog (focus stays
 * inside, the page behind does not scroll). The markup is identical in both
 * modes so nothing inside loses its state when the window is resized or a
 * phone is rotated, which matters for a share link that is shown only once.
 *
 * Built on the UI kit's overlay hooks, so it shares one layer stack with the
 * kit's dialogs, menus and popovers: Escape always goes to the top-most one.
 */
import {
  IconButton,
  OverlayProvider,
  useFocusTrap,
  useOverlayFocus,
  useOverlayLayer,
  useScrollLock,
} from '@realtimedocs/ui';
import { X } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { useMediaQuery } from '../lib/hooks';

export const SHEET_QUERY = '(max-width: 959px)';

export interface SidePanelProps {
  title: string;
  /** One or two sentences under the title. */
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  'data-testid'?: string;
}

export function SidePanel({ title, description, onClose, children, ...rest }: SidePanelProps) {
  const sheet = useMediaQuery(SHEET_QUERY);
  const [panel, setPanel] = useState<HTMLElement | null>(null);
  const titleId = useId();

  const layer = useOverlayLayer(panel, {
    onEscape: (event) => {
      // Docked: react only while focus is inside the panel, so Escape in the
      // document (closing its find bar, for example) does not close the panel.
      // Returning false offers the key to whatever is below.
      if (!sheet && !(event.target instanceof Node && panel?.contains(event.target))) return false;
      onClose();
      return undefined;
    },
  });
  useFocusTrap(layer, { enabled: sheet });
  useScrollLock(sheet);
  // Focus moves into the panel when it opens and back to the opener when it closes.
  useOverlayFocus(layer, { initialFocus: 'container' });

  return (
    <aside
      {...rest}
      ref={setPanel}
      className="app-panel"
      role={sheet ? 'dialog' : 'complementary'}
      aria-modal={sheet ? true : undefined}
      aria-labelledby={titleId}
      tabIndex={-1}
      data-mode={sheet ? 'sheet' : 'docked'}
    >
      <OverlayProvider layer={layer}>
        <header className="app-panel__header">
          <div className="app-panel__heading">
            <h2 id={titleId} className="app-panel__title">
              {title}
            </h2>
            {description ? <p className="app-panel__description">{description}</p> : null}
          </div>
          <IconButton label={`Close ${title.toLowerCase()}`} onClick={onClose}>
            <X />
          </IconButton>
        </header>
        <div className="app-panel__body">{children}</div>
      </OverlayProvider>
    </aside>
  );
}

export interface PanelSectionProps {
  title: string;
  /** What this section is, in a sentence. */
  description?: ReactNode;
  /** A control aligned with the title, such as a refresh button. */
  aside?: ReactNode;
  children: ReactNode;
  'data-testid'?: string;
}

/** A titled block inside a side panel; sections are separated by a rule. */
export function PanelSection({ title, description, aside, children, ...rest }: PanelSectionProps) {
  const headingId = useId();
  return (
    <section {...rest} className="app-panel-section" aria-labelledby={headingId}>
      <div className="app-panel-section__header">
        <div>
          <h3 id={headingId} className="app-panel-section__title">
            {title}
          </h3>
          {description ? <p className="app-panel-section__description">{description}</p> : null}
        </div>
        {aside ? <div className="app-panel-section__aside">{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}
