/**
 * Pure window/display geometry. All coordinates are Electron DIPs
 * (device-independent pixels), the unit used by `BrowserWindow.setBounds`,
 * `screen.getAllDisplays()` and pointer events. Nothing here touches Electron,
 * so every rule is unit-tested in plain Node.js.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

/** The subset of Electron's `Display` that placement decisions need. */
export interface DisplayInfo {
  id: number;
  bounds: Rect;
  workArea: Rect;
  scaleFactor: number;
  primary: boolean;
  internal?: boolean;
  label?: string;
  rotation?: number;
}

export interface SizeLimits {
  minWidth: number;
  minHeight: number;
  maxWidth: number;
  maxHeight: number;
}

/** Logical-pixel sizes of the floating panel. */
export const PANEL = {
  defaultWidth: 720,
  defaultHeight: 460,
  minWidth: 360,
  minHeight: 180,
  maxWidth: 2400,
  maxHeight: 1800,
  /** Height of the title strip, which is all that remains when collapsed. */
  collapsedHeight: 44,
  /** Gap kept between the panel and the work-area edge for default placement. */
  margin: 24,
} as const;

export const PANEL_LIMITS: SizeLimits = {
  minWidth: PANEL.minWidth,
  minHeight: PANEL.minHeight,
  maxWidth: PANEL.maxWidth,
  maxHeight: PANEL.maxHeight,
};

export const SIZE_PRESETS = {
  compact: { width: 480, height: 300 },
  standard: { width: PANEL.defaultWidth, height: PANEL.defaultHeight },
  wide: { width: 960, height: 460 },
  tall: { width: 560, height: 720 },
  large: { width: 1040, height: 680 },
} as const satisfies Record<string, Size>;

export type SizePreset = keyof typeof SIZE_PRESETS;
export const SIZE_PRESET_NAMES = Object.keys(SIZE_PRESETS) as SizePreset[];

export const RESIZE_EDGES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const;
export type ResizeEdge = (typeof RESIZE_EDGES)[number];

/** How much of the window must stay on a display before we call it lost. */
export const REACHABILITY = {
  minVisibleFraction: 0.5,
  /** Width of the drag strip that must remain grabbable. */
  minStripWidth: 120,
} as const;

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function roundRect(rect: Rect): Rect {
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

export function isUsableRect(rect: unknown): rect is Rect {
  if (typeof rect !== 'object' || rect === null) return false;
  const r = rect as Record<string, unknown>;
  return (
    [r.x, r.y, r.width, r.height].every((v) => typeof v === 'number' && Number.isFinite(v)) &&
    (r.width as number) > 0 &&
    (r.height as number) > 0
  );
}

export function area(rect: Rect): number {
  return Math.max(0, rect.width) * Math.max(0, rect.height);
}

export function intersection(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

function center(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** Squared distance from a point to the nearest point of a rectangle (0 inside). */
function distanceSquaredToRect(point: { x: number; y: number }, rect: Rect): number {
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width));
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height));
  return dx * dx + dy * dy;
}

/** Displays whose work area is unusable are ignored (defensive: seen during hot-plug). */
export function usableDisplays(displays: readonly DisplayInfo[]): DisplayInfo[] {
  return displays.filter((d) => isUsableRect(d.workArea) && isUsableRect(d.bounds));
}

export function primaryDisplay(displays: readonly DisplayInfo[]): DisplayInfo | null {
  const usable = usableDisplays(displays);
  return usable.find((d) => d.primary) ?? usable[0] ?? null;
}

/** Fraction (0–1) of the rectangle that lies inside the work area of any display. */
export function visibleFraction(rect: Rect, displays: readonly DisplayInfo[]): number {
  const total = area(rect);
  if (total <= 0) return 0;
  let visible = 0;
  for (const display of usableDisplays(displays)) {
    const overlap = intersection(rect, display.workArea);
    if (overlap) visible += area(overlap);
  }
  return Math.min(1, visible / total);
}

/**
 * The display that owns a rectangle: the one with the largest overlap, else
 * the one nearest to its centre, else the primary display.
 */
export function pickDisplayForRect(
  rect: Rect,
  displays: readonly DisplayInfo[],
): DisplayInfo | null {
  const usable = usableDisplays(displays);
  if (usable.length === 0) return null;
  let best: DisplayInfo | null = null;
  let bestArea = 0;
  for (const display of usable) {
    const overlap = intersection(rect, display.workArea);
    const overlapArea = overlap ? area(overlap) : 0;
    if (overlapArea > bestArea) {
      best = display;
      bestArea = overlapArea;
    }
  }
  if (best) return best;
  const point = center(rect);
  let nearest = usable[0] ?? null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const display of usable) {
    const distance = distanceSquaredToRect(point, display.workArea);
    if (distance < nearestDistance) {
      nearest = display;
      nearestDistance = distance;
    }
  }
  return nearest;
}

export function clampSize(size: Size, limits: SizeLimits, workArea?: Rect | null): Size {
  const maxWidth = workArea ? Math.min(limits.maxWidth, workArea.width) : limits.maxWidth;
  const maxHeight = workArea ? Math.min(limits.maxHeight, workArea.height) : limits.maxHeight;
  return {
    width: Math.round(
      clamp(
        finite(size.width, limits.minWidth),
        Math.min(limits.minWidth, maxWidth),
        Math.max(maxWidth, 1),
      ),
    ),
    height: Math.round(
      clamp(
        finite(size.height, limits.minHeight),
        Math.min(limits.minHeight, maxHeight),
        Math.max(maxHeight, 1),
      ),
    ),
  };
}

/** Moves (and if necessary shrinks) a rectangle so it lies fully inside `areaRect`. */
export function clampRectToArea(rect: Rect, areaRect: Rect): Rect {
  const width = Math.min(rect.width, areaRect.width);
  const height = Math.min(rect.height, areaRect.height);
  return roundRect({
    x: clamp(rect.x, areaRect.x, areaRect.x + areaRect.width - width),
    y: clamp(rect.y, areaRect.y, areaRect.y + areaRect.height - height),
    width,
    height,
  });
}

/** Default spot for a fresh panel: top-right of the work area, like a companion note. */
export function defaultPlacement(display: DisplayInfo, size: Size): Rect {
  const wa = display.workArea;
  const fitted = clampSize(size, PANEL_LIMITS, wa);
  const x = wa.x + wa.width - fitted.width - PANEL.margin;
  const y = wa.y + Math.max(PANEL.margin, Math.round(wa.height * 0.08));
  return clampRectToArea({ x, y, ...fitted }, wa);
}

/**
 * A window is reachable when enough of it is on a display AND a usable part
 * of its drag strip (the top `stripHeight` pixels) can be grabbed. A panel
 * whose body is visible but whose strip sits above the screen is still lost.
 */
export function isReachable(
  rect: Rect,
  displays: readonly DisplayInfo[],
  stripHeight: number = PANEL.collapsedHeight,
): boolean {
  if (!isUsableRect(rect)) return false;
  if (visibleFraction(rect, displays) < REACHABILITY.minVisibleFraction) return false;
  const strip: Rect = {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: Math.min(stripHeight, rect.height),
  };
  const needed = Math.min(REACHABILITY.minStripWidth, rect.width);
  return usableDisplays(displays).some((display) => {
    const overlap = intersection(strip, display.workArea);
    return overlap !== null && overlap.width >= needed && overlap.height >= strip.height - 0.5;
  });
}

export type RecoveryReason =
  'no_saved_bounds' | 'no_displays' | 'saved_display_missing' | 'off_screen' | 'size_adjusted';

export interface PlacementResult {
  bounds: Rect;
  /** Display the bounds were placed on; null when no display is known. */
  displayId: number | null;
  /** True when the saved bounds could not be used as they were. */
  recovered: boolean;
  reason: RecoveryReason | null;
}

export interface PlacementInput {
  saved: unknown;
  savedDisplayId: number | null;
  displays: readonly DisplayInfo[];
  /** Height used for the reachability check and minimum height (collapsed panels are short). */
  collapsed?: boolean;
  limits?: SizeLimits;
  defaultSize?: Size;
}

/**
 * Decides where the panel goes at startup and after every display change:
 * keeps a valid saved rectangle, pulls an unreachable one back onto a display
 * and falls back to the default spot when the saved monitor is gone.
 */
export function resolvePlacement(input: PlacementInput): PlacementResult {
  const limits = effectiveLimits(input.limits ?? PANEL_LIMITS, input.collapsed === true);
  const defaultSize = input.defaultSize ?? {
    width: PANEL.defaultWidth,
    height: input.collapsed ? PANEL.collapsedHeight : PANEL.defaultHeight,
  };
  const displays = usableDisplays(input.displays);
  const primary = primaryDisplay(displays);

  if (!primary) {
    // No display information at all (should not happen on a desktop session):
    // return something sane at the origin and let the next display event fix it.
    const size = clampSize(isUsableRect(input.saved) ? input.saved : defaultSize, limits);
    return {
      bounds: roundRect({ x: 0, y: 0, ...size }),
      displayId: null,
      recovered: true,
      reason: 'no_displays',
    };
  }

  if (!isUsableRect(input.saved)) {
    return {
      bounds: defaultPlacement(primary, clampSize(defaultSize, limits, primary.workArea)),
      displayId: primary.id,
      recovered: true,
      reason: 'no_saved_bounds',
    };
  }

  const original = roundRect(input.saved);
  const savedDisplay =
    input.savedDisplayId === null
      ? null
      : (displays.find((d) => d.id === input.savedDisplayId) ?? null);

  // Size first: a window that is merely too large for its display (resolution
  // or scale change) is a size problem, not a lost window.
  const sizeOwner = pickDisplayForRect(original, displays) ?? primary;
  const fitted = clampSize(original, limits, sizeOwner.workArea);
  const sizeChanged = fitted.width !== original.width || fitted.height !== original.height;
  const saved: Rect = { ...original, ...fitted };

  if (isReachable(saved, displays, PANEL.collapsedHeight)) {
    const owner = pickDisplayForRect(saved, displays) ?? primary;
    return {
      bounds: sizeChanged ? clampRectToArea(saved, owner.workArea) : saved,
      displayId: owner.id,
      recovered: sizeChanged,
      reason: sizeChanged ? 'size_adjusted' : null,
    };
  }

  // Unreachable. Prefer a display the window still touches, then the display it
  // was saved on (if it still exists), then the primary display.
  const touching = displays.find((d) => intersection(saved, d.workArea) !== null) ?? null;
  const target = touching ?? savedDisplay ?? primary;
  const size = clampSize(saved, limits, target.workArea);
  const missing = input.savedDisplayId !== null && savedDisplay === null;
  const bounds = touching
    ? clampRectToArea({ ...saved, ...size }, target.workArea)
    : defaultPlacement(target, size);
  return {
    bounds,
    displayId: target.id,
    recovered: true,
    reason: missing ? 'saved_display_missing' : 'off_screen',
  };
}

function effectiveLimits(limits: SizeLimits, collapsed: boolean): SizeLimits {
  if (!collapsed) return limits;
  return { ...limits, minHeight: PANEL.collapsedHeight, maxHeight: PANEL.collapsedHeight };
}

/**
 * Bounds while dragging a resize grip. `dx`/`dy` are the pointer movement
 * since the drag started. The edge opposite to the grip stays fixed, the size
 * respects the limits and the result stays inside the work area.
 */
export function computeResize(
  start: Rect,
  edge: ResizeEdge,
  dx: number,
  dy: number,
  limits: SizeLimits,
  workArea?: Rect | null,
): Rect {
  const moveX = finite(dx, 0);
  const moveY = finite(dy, 0);
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;

  if (edge.includes('e')) right += moveX;
  if (edge.includes('w')) left += moveX;
  if (edge.includes('s')) bottom += moveY;
  if (edge.includes('n')) top += moveY;

  if (workArea) {
    left = Math.max(left, workArea.x);
    top = Math.max(top, workArea.y);
    right = Math.min(right, workArea.x + workArea.width);
    bottom = Math.min(bottom, workArea.y + workArea.height);
  }

  const maxWidth = workArea ? Math.min(limits.maxWidth, workArea.width) : limits.maxWidth;
  const maxHeight = workArea ? Math.min(limits.maxHeight, workArea.height) : limits.maxHeight;
  const width = clamp(right - left, Math.min(limits.minWidth, maxWidth), maxWidth);
  const height = clamp(bottom - top, Math.min(limits.minHeight, maxHeight), maxHeight);

  // Re-anchor on the fixed edge so the limit never makes the window jump.
  if (edge.includes('w')) left = start.x + start.width - width;
  else left = start.x;
  if (edge.includes('n')) top = start.y + start.height - height;
  else top = start.y;

  const result = roundRect({ x: left, y: top, width, height });
  return workArea ? clampRectToArea(result, workArea) : result;
}

export interface Point {
  x: number;
  y: number;
}

export interface DragDeltaInput {
  /** Pointer position read by the main process when the drag started; null if unavailable. */
  startCursor: Point | null;
  /** Pointer position read by the main process now; null if unavailable. */
  cursor: Point | null;
  /** Whether the main process has already seen the pointer move during this drag. */
  cursorMoved: boolean;
  /** Movement reported by the page (fallback only). */
  reported: { dx: number; dy: number };
}

/**
 * How far the pointer has moved since a resize drag began.
 *
 * The main process's own reading of the pointer is authoritative: it is an
 * absolute screen position in the same units as `setBounds`, so it stays
 * correct while a top or left grip moves the window's origin. The movement
 * reported by the page is used only until the main process has seen the
 * pointer move at all (no pointer API on the platform, or synthetic input
 * that does not move the real pointer).
 */
export function chooseDragDelta(input: DragDeltaInput): {
  dx: number;
  dy: number;
  cursorMoved: boolean;
} {
  const { startCursor, cursor, reported } = input;
  if (startCursor && cursor && isFinitePoint(startCursor) && isFinitePoint(cursor)) {
    const dx = cursor.x - startCursor.x;
    const dy = cursor.y - startCursor.y;
    const cursorMoved = input.cursorMoved || dx !== 0 || dy !== 0;
    if (cursorMoved) return { dx, dy, cursorMoved: true };
  }
  return {
    dx: finite(reported.dx, 0),
    dy: finite(reported.dy, 0),
    cursorMoved: input.cursorMoved,
  };
}

function isFinitePoint(point: Point): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

/** Applies a size preset, keeping the top-right corner where it is. */
export function applySize(
  current: Rect,
  size: Size,
  limits: SizeLimits,
  workArea?: Rect | null,
): Rect {
  const fitted = clampSize(size, limits, workArea);
  const right = current.x + current.width;
  const next = { x: right - fitted.width, y: current.y, ...fitted };
  return workArea ? clampRectToArea(next, workArea) : roundRect(next);
}

/** Grows or shrinks from the bottom-right corner (keyboard resizing). */
export function nudgeSize(
  current: Rect,
  deltaWidth: number,
  deltaHeight: number,
  limits: SizeLimits,
  workArea?: Rect | null,
): Rect {
  const fitted = clampSize(
    {
      width: current.width + finite(deltaWidth, 0),
      height: current.height + finite(deltaHeight, 0),
    },
    limits,
    workArea,
  );
  const next = { x: current.x, y: current.y, ...fitted };
  return workArea ? clampRectToArea(next, workArea) : roundRect(next);
}

/** Moves the window by a delta, keeping it inside the work area. */
export function nudgePosition(
  current: Rect,
  deltaX: number,
  deltaY: number,
  workArea?: Rect | null,
): Rect {
  const next = {
    ...current,
    x: current.x + finite(deltaX, 0),
    y: current.y + finite(deltaY, 0),
  };
  return workArea ? clampRectToArea(next, workArea) : roundRect(next);
}

/**
 * Sanitises a rectangle requested over IPC: finite numbers only, size within
 * limits, and the result must remain reachable on some display; otherwise the
 * current bounds win.
 *
 * `stayOnDisplayOf`: the result must stay on the display that owns this
 * rectangle (the panel's current bounds). Used for requests from the panel
 * while private mode is on: content in the panel must not be able to move the
 * notes onto another display, which may be the one being shared.
 */
export function sanitizeRequestedBounds(
  requested: Partial<Rect>,
  current: Rect,
  displays: readonly DisplayInfo[],
  limits: SizeLimits,
  stayOnDisplayOf: Rect | null = null,
): Rect {
  const merged: Rect = {
    x: finite(requested.x, current.x),
    y: finite(requested.y, current.y),
    width: finite(requested.width, current.width),
    height: finite(requested.height, current.height),
  };
  const home = stayOnDisplayOf ? pickDisplayForRect(stayOnDisplayOf, displays) : null;
  if (home) {
    const size = clampSize(merged, limits, home.workArea);
    return clampRectToArea({ x: merged.x, y: merged.y, ...size }, home.workArea);
  }
  const owner = pickDisplayForRect(merged, displays) ?? primaryDisplay(displays);
  const size = clampSize(merged, limits, owner?.workArea ?? null);
  const candidate = roundRect({ x: merged.x, y: merged.y, ...size });
  if (!owner) return candidate;
  if (isReachable(candidate, displays)) return candidate;
  return clampRectToArea(candidate, owner.workArea);
}

export function collapsedBounds(current: Rect): Rect {
  return roundRect({ ...current, height: PANEL.collapsedHeight });
}

export function expandedBounds(
  current: Rect,
  expandedHeight: number,
  limits: SizeLimits,
  workArea?: Rect | null,
): Rect {
  const size = clampSize(
    { width: current.width, height: finite(expandedHeight, PANEL.defaultHeight) },
    limits,
    workArea,
  );
  const next = { x: current.x, y: current.y, ...size };
  return workArea ? clampRectToArea(next, workArea) : roundRect(next);
}

export function rectsEqual(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

// ── Display changes while private mode is on ────────────────────────────────

/** The display the panel was on when it was last placed or moved by the user. */
export interface KnownDisplay {
  id: number;
  /** Its bounds at that time, when known (ids can change when a dock reconnects). */
  bounds?: Rect | undefined;
}

export type DisplayChangeDecision =
  /** The panel is where it was; nothing to do. */
  | { action: 'keep' }
  /** Same display, but the bounds need correcting (resolution or scale changed). */
  | { action: 'adjust'; placement: PlacementResult }
  /** The panel would end up on another display: allowed, private mode is off. */
  | { action: 'move'; placement: PlacementResult }
  /**
   * The panel would end up on another display while private mode is on. It
   * must not go there by itself: that display may be the one being shared.
   * `placement` is where it would have gone (used only if it cannot be hidden).
   */
  | { action: 'park'; placement: PlacementResult };

export interface DisplayChangeInput {
  /** Where the panel is now (the operating system may already have moved it). */
  current: Rect;
  /** The display it was on before the change, if known. */
  previous: KnownDisplay | null;
  displays: readonly DisplayInfo[];
  collapsed?: boolean;
  /** Private mode is on. */
  protect: boolean;
}

function isSameDisplay(previous: KnownDisplay, candidate: DisplayInfo): boolean {
  if (candidate.id === previous.id) return true;
  // The same screen under a new id (some docks and drivers renumber on reconnect).
  return previous.bounds !== undefined && rectsEqual(previous.bounds, candidate.bounds);
}

/**
 * What to do with the panel after displays were added, removed or changed, or
 * when the app starts with bounds saved for a display.
 *
 * Without private mode the panel is simply pulled back to where it can be
 * reached, as before. With private mode on it never moves onto ANOTHER
 * display on its own, because nobody chose that display for the notes and it
 * may be the one a meeting sees. Corrections on the same display (a new
 * resolution or scale) are fine.
 */
export function decideDisplayChange(input: DisplayChangeInput): DisplayChangeDecision {
  const placement = resolvePlacement({
    saved: input.current,
    savedDisplayId: input.previous?.id ?? null,
    displays: input.displays,
    collapsed: input.collapsed === true,
  });
  const unchanged = rectsEqual(roundRect(input.current), placement.bounds);
  if (placement.displayId === null || input.previous === null) {
    // No display information, or no record of where the panel was.
    return unchanged ? { action: 'keep' } : { action: 'adjust', placement };
  }
  const target = usableDisplays(input.displays).find(
    (display) => display.id === placement.displayId,
  );
  const sameDisplay = target !== undefined && isSameDisplay(input.previous, target);
  if (sameDisplay) return unchanged ? { action: 'keep' } : { action: 'adjust', placement };
  return input.protect ? { action: 'park', placement } : { action: 'move', placement };
}
