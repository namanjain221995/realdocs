import { Button, IconButton } from '@realtimedocs/ui';
import { ArrowLeft, Minus, Moon, Plus, Sun } from 'lucide-react';
import type { RefCallback } from 'react';
import { RouterLinkButton } from '../../components/links';
import {
  clampReadingScale,
  READING_SCALE_MAX,
  READING_SCALE_MIN,
  READING_SCALE_STEP,
  type ReadingMode,
} from '../../lib/readingMode';
import type { WakeLockStatus } from '../../lib/wakeLock';

export interface ReadingBarProps {
  title: string;
  signedIn: boolean;
  reading: ReadingMode;
  onChange: (patch: Partial<ReadingMode>) => void;
  wakeLock: WakeLockStatus;
  /** The editor portals its connection and save indicator here, so the state stays visible. */
  statusSlotRef: RefCallback<HTMLElement>;
}

function wakeLockNote(status: WakeLockStatus): string | null {
  if (status === 'active') return 'Screen kept awake';
  if (status === 'unsupported' || status === 'denied') return 'Your screen may sleep';
  return null;
}

/** The only chrome in reading mode: where you are, how big the text is, and the way out. */
export function ReadingBar({
  title,
  signedIn,
  reading,
  onChange,
  wakeLock,
  statusSlotRef,
}: ReadingBarProps) {
  const note = wakeLockNote(wakeLock);
  const step = (direction: 1 | -1): void =>
    onChange({ fontScale: clampReadingScale(reading.fontScale + direction * READING_SCALE_STEP) });
  return (
    <header className="doc-reading-bar" data-testid="reading-bar">
      <div className="doc-reading-bar__row">
        {signedIn ? (
          <RouterLinkButton
            to="/"
            variant="ghost"
            className="doc-back"
            aria-label="Back to documents"
            iconLeft={<ArrowLeft />}
            data-testid="back-to-documents"
          />
        ) : null}
        <h1 className="doc-reading-bar__title">{title}</h1>
        <Button size="sm" onClick={() => onChange({ enabled: false })} data-testid="reading-exit">
          Exit reading mode
        </Button>
      </div>
      <div className="doc-reading-bar__row doc-reading-bar__row--tools">
        <div className="doc-slot doc-slot--status" ref={statusSlotRef} data-testid="status-slot" />
        <span className="doc-reading-bar__tools">
          <IconButton
            label="Smaller text"
            variant="solid"
            disabled={reading.fontScale <= READING_SCALE_MIN}
            onClick={() => step(-1)}
            data-testid="reading-smaller"
          >
            <Minus />
          </IconButton>
          <span className="doc-reading-bar__scale" data-testid="reading-scale">
            {Math.round(reading.fontScale * 100)}%
          </span>
          <IconButton
            label="Larger text"
            variant="solid"
            disabled={reading.fontScale >= READING_SCALE_MAX}
            onClick={() => step(1)}
            data-testid="reading-larger"
          >
            <Plus />
          </IconButton>
          <IconButton
            label={reading.light ? 'Use dark colours' : 'Use light colours'}
            variant="solid"
            onClick={() => onChange({ light: !reading.light })}
            data-testid="reading-theme"
          >
            {reading.light ? <Moon /> : <Sun />}
          </IconButton>
        </span>
        {note ? (
          <span className="doc-reading-bar__note" data-testid="wake-lock-note" role="status">
            {note}
          </span>
        ) : null}
      </div>
    </header>
  );
}
