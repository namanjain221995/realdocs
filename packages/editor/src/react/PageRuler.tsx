/**
 * Horizontal ruler above the page: tick marks in the document's preferred
 * unit and two margin markers.
 *
 * The markers are sliders (`role="slider"`). Dragging only previews locally
 * (`onPreview`); the value is written to the shared document once, on release
 * (`onCommit`), so a drag is one transaction and one undo step. Keyboard: Left
 * and Right move the marker one step on screen, Up and Down raise or lower the
 * margin, Shift makes the step ten times larger, Home and End jump to the
 * smallest and largest margin. Escape while dragging cancels.
 *
 * First-line and hanging indent markers are not offered: they need a paragraph
 * attribute in the document schema (a schema version).
 */
import {
  formatMeasurement,
  maxMarginMm,
  pageDimensionsMm,
  PAGE_MARGIN_MIN_MM,
  snapMm,
  snapStepMm,
  type PageMarginKey,
  type PageSettings,
  type PageUnit,
} from '@realtimedocs/contracts';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

export interface PageRulerProps {
  /** Settings to draw, including any local drag preview. */
  settings: PageSettings;
  /** False draws the ruler without handles. */
  canEdit: boolean;
  /** Local preview while dragging; `null` ends it. */
  onPreview: (patch: Partial<PageSettings> | null) => void;
  /** One change of the shared settings. */
  onCommit: (patch: Partial<PageSettings>) => void;
  onUndo?: () => void;
  onRedo?: () => void;
}

const HEIGHT = 24;

interface Drag {
  key: PageMarginKey;
  pointerId: number;
  startX: number;
  startMm: number;
  pxPerMm: number;
  maxMm: number;
  mm: number;
}

interface Tick {
  mm: number;
  height: number;
  label?: string;
}

/** Tick marks along the page, for the pixel density in use. */
export function rulerTicks(widthMm: number, pxPerMm: number, unit: PageUnit): Tick[] {
  const ticks: Tick[] = [];
  if (unit === 'mm') {
    const fine = pxPerMm >= 2.5;
    const labelEvery = pxPerMm * 10 >= 26 ? 10 : 50;
    for (let mm = 0; mm <= widthMm; mm += fine ? 1 : 5) {
      if (mm % labelEvery === 0) {
        ticks.push({ mm, height: 12, label: mm === 0 ? '0' : String(mm / 10) });
      } else if (mm % 10 === 0) ticks.push({ mm, height: 9 });
      else if (mm % 5 === 0) ticks.push({ mm, height: 6 });
      else ticks.push({ mm, height: 3 });
    }
    return ticks;
  }
  const inch = 25.4;
  const sixteenth = inch / 16;
  const fine = pxPerMm * inch >= 120;
  const stepSixteenths = fine ? 1 : 4;
  for (let n = 0; n * sixteenth <= widthMm; n += stepSixteenths) {
    const mm = n * sixteenth;
    if (n % 16 === 0) ticks.push({ mm, height: 12, label: String(n / 16) });
    else if (n % 8 === 0) ticks.push({ mm, height: 9 });
    else if (n % 4 === 0) ticks.push({ mm, height: 6 });
    else ticks.push({ mm, height: 3 });
  }
  return ticks;
}

const LABELS: Record<PageMarginKey, string> = {
  marginLeft: 'Left margin',
  marginRight: 'Right margin',
  marginTop: 'Top margin',
  marginBottom: 'Bottom margin',
};

export function PageRuler({
  settings,
  canEdit,
  onPreview,
  onCommit,
  onUndo,
  onRedo,
}: PageRulerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const widthMm = pageDimensionsMm(settings).width;
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    const element = rootRef.current;
    if (!element) return undefined;
    const measure = (): void => setWidth(element.clientWidth);
    measure();
    if (typeof ResizeObserver !== 'function') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const pxPerMm = width > 0 ? width / widthMm : 0;
  const ticks = useMemo(
    () => (pxPerMm > 0 ? rulerTicks(widthMm, pxPerMm, settings.unit) : []),
    [widthMm, pxPerMm, settings.unit],
  );

  const finish = (commit: boolean): void => {
    const current = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    onPreview(null);
    if (commit && current && current.mm !== current.startMm)
      onCommit({ [current.key]: current.mm });
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>, key: PageMarginKey): void => {
    if (!canEdit || event.button !== 0 || pxPerMm <= 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus();
    const startMm = settingsRef.current[key];
    const next: Drag = {
      key,
      pointerId: event.pointerId,
      startX: event.clientX,
      startMm,
      pxPerMm,
      maxMm: maxMarginMm(settingsRef.current, key),
      mm: startMm,
    };
    dragRef.current = next;
    setDrag(next);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const current = dragRef.current;
    if (!current || event.pointerId !== current.pointerId) return;
    const direction = current.key === 'marginLeft' ? 1 : -1;
    const raw = current.startMm + (direction * (event.clientX - current.startX)) / current.pxPerMm;
    const mm = Math.min(
      current.maxMm,
      Math.max(PAGE_MARGIN_MIN_MM, snapMm(raw, settingsRef.current.unit)),
    );
    if (mm === current.mm) return;
    const updated = { ...current, mm };
    dragRef.current = updated;
    setDrag(updated);
    onPreview({ [current.key]: mm });
  };

  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>, commit: boolean): void => {
    const current = dragRef.current;
    if (!current || event.pointerId !== current.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    finish(commit);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>, key: PageMarginKey): void => {
    const mod = event.metaKey || event.ctrlKey;
    if (mod && !event.altKey && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) onRedo?.();
      else onUndo?.();
      return;
    }
    if (mod && !event.altKey && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      onRedo?.();
      return;
    }
    if (event.key === 'Escape' && dragRef.current) {
      event.preventDefault();
      finish(false);
      return;
    }
    if (!canEdit || event.altKey || mod) return;
    const current = settingsRef.current[key];
    const max = maxMarginMm(settingsRef.current, key);
    const step = snapStepMm(settingsRef.current.unit) * (event.shiftKey ? 10 : 1);
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
        next = current + (key === 'marginLeft' ? step : -step);
        break;
      case 'ArrowLeft':
        next = current + (key === 'marginLeft' ? -step : step);
        break;
      case 'ArrowUp':
        next = current + step;
        break;
      case 'ArrowDown':
        next = current - step;
        break;
      case 'Home':
        next = PAGE_MARGIN_MIN_MM;
        break;
      case 'End':
        next = max;
        break;
      default:
        return;
    }
    event.preventDefault();
    const snapped = Math.min(
      max,
      Math.max(
        PAGE_MARGIN_MIN_MM,
        event.key === 'End' ? max : snapMm(next, settingsRef.current.unit),
      ),
    );
    if (snapped !== current) onCommit({ [key]: snapped });
  };

  const marker = (key: 'marginLeft' | 'marginRight') => {
    const value = settings[key];
    const left = key === 'marginLeft' ? (value / widthMm) * 100 : 100 - (value / widthMm) * 100;
    const dragging = drag?.key === key;
    const text = formatMeasurement(value, settings.unit);
    return (
      <div
        key={key}
        className={`rd-ruler__marker rd-ruler__marker--${key === 'marginLeft' ? 'left' : 'right'}`}
        style={{ left: `${left}%` }}
        role="slider"
        tabIndex={0}
        aria-label={LABELS[key]}
        aria-orientation="horizontal"
        aria-valuemin={PAGE_MARGIN_MIN_MM}
        aria-valuemax={maxMarginMm(settings, key)}
        aria-valuenow={value}
        aria-valuetext={text}
        data-testid={key === 'marginLeft' ? 'rd-ruler-left' : 'rd-ruler-right'}
        data-dragging={dragging ? 'true' : undefined}
        onPointerDown={(event) => onPointerDown(event, key)}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => onPointerEnd(event, true)}
        onPointerCancel={(event) => onPointerEnd(event, false)}
        onKeyDown={(event) => onKeyDown(event, key)}
      >
        {dragging ? (
          <span className="rd-ruler__tip" data-testid="rd-ruler-tip">
            {text}
          </span>
        ) : null}
      </div>
    );
  };

  return (
    <div className="rd-editor__ruler" data-testid="rd-ruler-bar">
      <div
        ref={rootRef}
        className="rd-ruler"
        data-testid="rd-ruler"
        data-unit={settings.unit}
        data-editable={canEdit ? 'true' : 'false'}
      >
        <svg
          className="rd-ruler__scale"
          width={width}
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          aria-hidden="true"
          focusable="false"
        >
          {ticks.map((tick) => {
            const x = Math.round(tick.mm * pxPerMm) + 0.5;
            return (
              <g key={tick.mm}>
                <line x1={x} x2={x} y1={HEIGHT} y2={HEIGHT - tick.height} />
                {tick.label !== undefined ? (
                  <text x={x + 2} y={HEIGHT - 12}>
                    {tick.label}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
        <div
          className="rd-ruler__shade rd-ruler__shade--left"
          style={{ width: `${(settings.marginLeft / widthMm) * 100}%` }}
        />
        <div
          className="rd-ruler__shade rd-ruler__shade--right"
          style={{ width: `${(settings.marginRight / widthMm) * 100}%` }}
        />
        {canEdit ? marker('marginLeft') : null}
        {canEdit ? marker('marginRight') : null}
      </div>
    </div>
  );
}
