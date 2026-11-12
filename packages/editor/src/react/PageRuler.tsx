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
 * Three more markers belong to the paragraphs of the selection, as in a word
 * processor: first-line indent (top), left indent (bottom left; the first line
 * moves with it, because it is stored relative to it) and right indent (bottom
 * right). They are sliders with the same keyboard model. A pointer drag never
 * takes the focus or the selection away from the text, so typing continues in
 * the paragraph that was just indented; while dragging only the marker moves,
 * and the paragraphs change once, on release.
 */
import {
  contentWidthMm,
  formatMeasurement,
  maxMarginMm,
  normalizeParagraphIndents,
  PARAGRAPH_MIN_TEXT_MM,
  pageDimensionsMm,
  PAGE_MARGIN_MIN_MM,
  snapMm,
  snapStepMm,
  type PageMarginKey,
  type PageSettings,
  type PageUnit,
  type ParagraphIndents,
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
  /**
   * Ruler indents of the selection's paragraphs (those of the first one); `null` or absent when
   * the selection holds no paragraph or heading, which hides the indent markers.
   */
  indents?: ParagraphIndents | null;
  /** One change of the indents of every selected paragraph and heading. */
  onIndentCommit?: (patch: Partial<ParagraphIndents>) => void;
}

const HEIGHT = 24;

export type IndentKey = keyof ParagraphIndents;

const INDENT_LABELS: Record<IndentKey, string> = {
  firstLine: 'First line indent',
  left: 'Left indent',
  right: 'Right indent',
};

/** Smallest and largest value of one indent, given the other two and the text area. */
export function indentRange(
  key: IndentKey,
  indents: ParagraphIndents,
  contentMm: number,
): { min: number; max: number } {
  const room = Math.max(0, Math.floor((contentMm - PARAGRAPH_MIN_TEXT_MM) * 10) / 10);
  const round = (value: number): number => Math.max(0, Math.round(value * 10) / 10);
  if (key === 'left') {
    return { min: 0, max: round(room - Math.max(0, indents.firstLine) - indents.right) };
  }
  if (key === 'right') {
    return { min: 0, max: round(room - indents.left - Math.max(0, indents.firstLine)) };
  }
  return { min: -indents.left, max: round(room - indents.left - indents.right) };
}

/** Distance of an indent marker from the left edge of the paper, in millimetres. */
export function indentMarkerMm(
  key: IndentKey,
  indents: ParagraphIndents,
  settings: PageSettings,
): number {
  if (key === 'right') {
    return pageDimensionsMm(settings).width - settings.marginRight - indents.right;
  }
  return settings.marginLeft + indents.left + (key === 'firstLine' ? indents.firstLine : 0);
}

interface IndentDrag {
  key: IndentKey;
  pointerId: number;
  startX: number;
  startMm: number;
  pxPerMm: number;
  min: number;
  max: number;
  mm: number;
}

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
  indents,
  onIndentCommit,
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

  // ── Paragraph indents ──────────────────────────────────────────────────────
  const [indentDrag, setIndentDrag] = useState<IndentDrag | null>(null);
  const indentDragRef = useRef<IndentDrag | null>(null);
  const indentsRef = useRef(indents ?? null);
  indentsRef.current = indents ?? null;
  const contentMm = contentWidthMm(settings);

  const finishIndent = (commit: boolean): void => {
    const current = indentDragRef.current;
    indentDragRef.current = null;
    setIndentDrag(null);
    if (commit && current && current.mm !== current.startMm) {
      onIndentCommit?.({ [current.key]: current.mm });
    }
  };

  const onIndentPointerDown = (event: ReactPointerEvent<HTMLDivElement>, key: IndentKey): void => {
    const current = indentsRef.current;
    if (!canEdit || !current || event.button !== 0 || pxPerMm <= 0) return;
    // Cancelling the pointer event also cancels the mouse events that would move the focus:
    // the text keeps its selection and its caret.
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const range = indentRange(key, current, contentWidthMm(settingsRef.current));
    const next: IndentDrag = {
      key,
      pointerId: event.pointerId,
      startX: event.clientX,
      startMm: current[key],
      pxPerMm,
      min: range.min,
      max: range.max,
      mm: current[key],
    };
    indentDragRef.current = next;
    setIndentDrag(next);
  };

  const onIndentPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const current = indentDragRef.current;
    if (!current || event.pointerId !== current.pointerId) return;
    const direction = current.key === 'right' ? -1 : 1;
    const raw = current.startMm + (direction * (event.clientX - current.startX)) / current.pxPerMm;
    const mm = Math.min(current.max, Math.max(current.min, snapMm(raw, settingsRef.current.unit)));
    if (mm === current.mm) return;
    const updated = { ...current, mm };
    indentDragRef.current = updated;
    setIndentDrag(updated);
  };

  const onIndentPointerEnd = (event: ReactPointerEvent<HTMLDivElement>, commit: boolean): void => {
    const current = indentDragRef.current;
    if (!current || event.pointerId !== current.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    finishIndent(commit);
  };

  const onIndentKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>, key: IndentKey): void => {
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
    if (event.key === 'Escape' && indentDragRef.current) {
      event.preventDefault();
      finishIndent(false);
      return;
    }
    const values = indentsRef.current;
    if (!canEdit || !values || event.altKey || mod) return;
    const current = values[key];
    const { min, max } = indentRange(key, values, contentWidthMm(settingsRef.current));
    const step = snapStepMm(settingsRef.current.unit) * (event.shiftKey ? 10 : 1);
    // On screen the right indent grows towards the left.
    const screen = key === 'right' ? -1 : 1;
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
        next = current + screen * step;
        break;
      case 'ArrowLeft':
        next = current - screen * step;
        break;
      case 'ArrowUp':
        next = current + step;
        break;
      case 'ArrowDown':
        next = current - step;
        break;
      case 'Home':
        next = min;
        break;
      case 'End':
        next = max;
        break;
      default:
        return;
    }
    event.preventDefault();
    const snapped =
      event.key === 'Home' || event.key === 'End'
        ? next
        : Math.min(max, Math.max(min, snapMm(next, settingsRef.current.unit)));
    if (snapped !== current) onIndentCommit?.({ [key]: snapped });
  };

  const indentMarker = (key: IndentKey) => {
    if (!indents) return null;
    const dragging = indentDrag?.key === key;
    // While dragging, the marker (and the first-line marker with the left one) follows the pointer.
    const shown = indentDrag
      ? normalizeParagraphIndents({ ...indents, [indentDrag.key]: indentDrag.mm })
      : indents;
    const value = shown[key];
    const range = indentRange(key, indents, contentMm);
    const text = formatMeasurement(value, settings.unit);
    return (
      <div
        key={key}
        className={`rd-ruler__indent rd-ruler__indent--${key === 'firstLine' ? 'first' : key}`}
        style={{ left: `${(indentMarkerMm(key, shown, settings) / widthMm) * 100}%` }}
        role="slider"
        tabIndex={0}
        aria-label={INDENT_LABELS[key]}
        aria-orientation="horizontal"
        aria-valuemin={range.min}
        aria-valuemax={range.max}
        aria-valuenow={value}
        aria-valuetext={text}
        data-testid={`rd-ruler-indent-${key === 'firstLine' ? 'first' : key}`}
        data-value={value}
        data-dragging={dragging ? 'true' : undefined}
        onPointerDown={(event) => onIndentPointerDown(event, key)}
        onPointerMove={onIndentPointerMove}
        onPointerUp={(event) => onIndentPointerEnd(event, true)}
        onPointerCancel={(event) => onIndentPointerEnd(event, false)}
        // Belt and braces for engines that still send the mouse event: never take the focus.
        onMouseDown={(event) => event.preventDefault()}
        onKeyDown={(event) => onIndentKeyDown(event, key)}
      >
        {dragging ? (
          <span className="rd-ruler__tip" data-testid="rd-ruler-tip">
            {text}
          </span>
        ) : null}
      </div>
    );
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
        {canEdit && onIndentCommit ? indentMarker('firstLine') : null}
        {canEdit && onIndentCommit ? indentMarker('left') : null}
        {canEdit && onIndentCommit ? indentMarker('right') : null}
      </div>
    </div>
  );
}
