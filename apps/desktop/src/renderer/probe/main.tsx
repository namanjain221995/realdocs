import '@realtimedocs/ui/styles.css';
import './probe.css';
import { Button, TextField } from '@realtimedocs/ui';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ProbeResult } from '../../shared/preferences';
import { attempt, desktop, useAppState } from '../shared/desktop';

/**
 * Diagnostics-only window: transparent, frameless and — unlike the panel —
 * natively resizable. The user drags its edges, watches what the operating
 * system does, and records the outcome.
 */
function Probe() {
  const state = useAppState();
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [resizes, setResizes] = useState(0);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onResize = () => {
      setSize({ width: window.innerWidth, height: window.innerHeight });
      setResizes((count) => count + 1);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const record = async (result: ProbeResult) => {
    const message = await attempt(desktop?.diagnostics.recordProbe(result, notes));
    setError(message);
    if (!message) void desktop?.diagnostics.closeProbe();
  };

  return (
    <div className="rdb-root" data-testid="rd-probe">
      <div className="rdb-drag">Resize probe — drag here to move</div>
      <div className="rdb-body">
        <p>
          Drag an edge or corner of this window. Watch for flicker, black bars, a lost see-through
          background or a window that will not resize.
        </p>
        <p className="rdb-size" data-testid="rd-probe-size">
          {size.width} × {size.height} · {resizes} resize {resizes === 1 ? 'event' : 'events'}
        </p>
        <TextField
          label="Notes"
          hideLabel
          placeholder="Optional notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          maxLength={500}
          error={error ?? undefined}
        />
        <div className="rdb-actions">
          <Button
            size="sm"
            variant="primary"
            onClick={() => void record('works')}
            data-testid="rd-probe-works"
          >
            Resized cleanly
          </Button>
          <Button size="sm" onClick={() => void record('glitches')}>
            Resized with glitches
          </Button>
          <Button size="sm" onClick={() => void record('broken')}>
            Would not resize
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void desktop?.diagnostics.closeProbe()}>
            Close
          </Button>
        </div>
        {state?.probe.record && (
          <p className="rdb-previous">Last recorded: {state.probe.record.result}</p>
        )}
      </div>
    </div>
  );
}

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <Probe />
    </StrictMode>,
  );
}
