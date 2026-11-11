import { describe, expect, it } from 'vitest';
import {
  PANEL,
  PANEL_LIMITS,
  SIZE_PRESETS,
  applySize,
  chooseDragDelta,
  clampRectToArea,
  clampSize,
  collapsedBounds,
  computeResize,
  defaultPlacement,
  expandedBounds,
  intersection,
  isReachable,
  nudgePosition,
  nudgeSize,
  pickDisplayForRect,
  resolvePlacement,
  sanitizeRequestedBounds,
  visibleFraction,
  type DisplayInfo,
  type Rect,
} from '../../src/shared/geometry';

function display(id: number, bounds: Rect, options: Partial<DisplayInfo> = {}): DisplayInfo {
  // A 40px taskbar/menu bar at the bottom unless a work area is given.
  const workArea = options.workArea ?? { ...bounds, height: bounds.height - 40 };
  return { id, bounds, workArea, scaleFactor: 1, primary: false, ...options };
}

const LAPTOP = display(1, { x: 0, y: 0, width: 1440, height: 900 }, { primary: true });
const EXTERNAL_RIGHT = display(2, { x: 1440, y: 0, width: 2560, height: 1440 });
const EXTERNAL_LEFT = display(3, { x: -1920, y: 0, width: 1920, height: 1080 });
const ABOVE = display(4, { x: 0, y: -1080, width: 1920, height: 1080 });

describe('rectangle helpers', () => {
  it('computes intersections and rejects touching edges', () => {
    expect(
      intersection({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 }),
    ).toEqual({
      x: 5,
      y: 5,
      width: 5,
      height: 5,
    });
    expect(
      intersection({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 }),
    ).toBeNull();
  });

  it('measures the visible fraction across several displays', () => {
    // Straddles the laptop/external boundary: fully visible in total.
    const straddling = { x: 1200, y: 100, width: 480, height: 300 };
    expect(visibleFraction(straddling, [LAPTOP, EXTERNAL_RIGHT])).toBeCloseTo(1, 5);
    // Without the external display only the left half remains.
    expect(visibleFraction(straddling, [LAPTOP])).toBeCloseTo(0.5, 5);
    expect(visibleFraction({ x: 9000, y: 9000, width: 100, height: 100 }, [LAPTOP])).toBe(0);
  });

  it('clamps sizes to the limits and to the work area', () => {
    expect(clampSize({ width: 10, height: 10 }, PANEL_LIMITS)).toEqual({
      width: PANEL.minWidth,
      height: PANEL.minHeight,
    });
    expect(clampSize({ width: 99999, height: 99999 }, PANEL_LIMITS)).toEqual({
      width: PANEL.maxWidth,
      height: PANEL.maxHeight,
    });
    const tiny = { x: 0, y: 0, width: 300, height: 160 };
    // A work area smaller than the minimum wins: the window must fit on screen.
    expect(clampSize({ width: 720, height: 460 }, PANEL_LIMITS, tiny)).toEqual({
      width: 300,
      height: 160,
    });
    expect(
      clampSize({ width: Number.NaN, height: Number.POSITIVE_INFINITY }, PANEL_LIMITS),
    ).toEqual({
      width: PANEL.minWidth,
      height: PANEL.minHeight,
    });
  });

  it('moves a rectangle fully inside an area', () => {
    const area = { x: 100, y: 50, width: 800, height: 600 };
    expect(clampRectToArea({ x: -500, y: -500, width: 400, height: 300 }, area)).toEqual({
      x: 100,
      y: 50,
      width: 400,
      height: 300,
    });
    expect(clampRectToArea({ x: 5000, y: 5000, width: 400, height: 300 }, area)).toEqual({
      x: 500,
      y: 350,
      width: 400,
      height: 300,
    });
    expect(clampRectToArea({ x: 0, y: 0, width: 5000, height: 5000 }, area)).toEqual(area);
  });
});

describe('display selection', () => {
  it('prefers the display with the largest overlap', () => {
    const mostlyRight = { x: 1400, y: 100, width: 600, height: 400 };
    expect(pickDisplayForRect(mostlyRight, [LAPTOP, EXTERNAL_RIGHT])?.id).toBe(2);
  });

  it('falls back to the nearest display for a rectangle in no-man’s-land', () => {
    const farLeft = { x: -5000, y: 200, width: 600, height: 400 };
    expect(pickDisplayForRect(farLeft, [LAPTOP, EXTERNAL_RIGHT, EXTERNAL_LEFT])?.id).toBe(3);
    expect(pickDisplayForRect(farLeft, [])).toBeNull();
  });

  it('ignores displays with unusable geometry', () => {
    const broken = display(
      9,
      { x: 0, y: 0, width: 0, height: 0 },
      {
        workArea: { x: 0, y: 0, width: 0, height: 0 },
      },
    );
    expect(
      pickDisplayForRect({ x: 10, y: 10, width: 100, height: 100 }, [broken, LAPTOP])?.id,
    ).toBe(1);
  });
});

describe('reachability', () => {
  it('accepts a window that is fully on screen', () => {
    expect(isReachable({ x: 100, y: 100, width: 720, height: 460 }, [LAPTOP])).toBe(true);
  });

  it('rejects a window that is mostly off screen', () => {
    expect(isReachable({ x: 1300, y: 100, width: 720, height: 460 }, [LAPTOP])).toBe(false);
  });

  it('rejects a window whose drag strip is above the screen even if most of it is visible', () => {
    // 70% of the body is visible, but the top 44px strip is off the top edge.
    expect(isReachable({ x: 100, y: -120, width: 720, height: 460 }, [LAPTOP])).toBe(false);
  });

  it('accepts a window on a display with negative coordinates', () => {
    expect(
      isReachable({ x: -1500, y: 200, width: 720, height: 460 }, [LAPTOP, EXTERNAL_LEFT]),
    ).toBe(true);
    expect(isReachable({ x: 200, y: -900, width: 720, height: 460 }, [LAPTOP, ABOVE])).toBe(true);
  });

  it('rejects non-finite or empty rectangles', () => {
    expect(isReachable({ x: Number.NaN, y: 0, width: 100, height: 100 }, [LAPTOP])).toBe(false);
    expect(isReachable({ x: 0, y: 0, width: 0, height: 100 }, [LAPTOP])).toBe(false);
  });
});

describe('placement and recovery', () => {
  it('places a first-run panel top-right on the primary display at the default size', () => {
    const result = resolvePlacement({
      saved: null,
      savedDisplayId: null,
      displays: [EXTERNAL_RIGHT, LAPTOP],
    });
    expect(result.reason).toBe('no_saved_bounds');
    expect(result.displayId).toBe(1);
    expect(result.bounds.width).toBe(720);
    expect(result.bounds.height).toBe(460);
    expect(result.bounds.x + result.bounds.width).toBe(1440 - PANEL.margin);
    expect(isReachable(result.bounds, [LAPTOP])).toBe(true);
  });

  it('keeps valid saved bounds exactly', () => {
    const saved = { x: 1600, y: 200, width: 800, height: 500 };
    const result = resolvePlacement({
      saved,
      savedDisplayId: 2,
      displays: [LAPTOP, EXTERNAL_RIGHT],
    });
    expect(result).toEqual({ bounds: saved, displayId: 2, recovered: false, reason: null });
  });

  it('recovers when the saved monitor was removed', () => {
    const saved = { x: 2000, y: 300, width: 800, height: 500 };
    const result = resolvePlacement({ saved, savedDisplayId: 2, displays: [LAPTOP] });
    expect(result.recovered).toBe(true);
    expect(result.reason).toBe('saved_display_missing');
    expect(result.displayId).toBe(1);
    expect(result.bounds.width).toBe(800);
    expect(isReachable(result.bounds, [LAPTOP])).toBe(true);
  });

  it('pulls a mostly off-screen window back onto the display it still touches', () => {
    const saved = { x: 1300, y: 500, width: 720, height: 460 };
    const result = resolvePlacement({ saved, savedDisplayId: 1, displays: [LAPTOP] });
    expect(result.reason).toBe('off_screen');
    expect(result.bounds).toEqual({ x: 720, y: 400, width: 720, height: 460 });
  });

  it('recovers absurd coordinates from a damaged preference file', () => {
    for (const saved of [
      { x: 50000, y: 50000, width: 720, height: 460 },
      { x: -50000, y: -50000, width: 720, height: 460 },
    ]) {
      const result = resolvePlacement({ saved, savedDisplayId: 77, displays: [LAPTOP] });
      expect(result.recovered).toBe(true);
      expect(isReachable(result.bounds, [LAPTOP])).toBe(true);
    }
  });

  it('treats malformed saved bounds as missing', () => {
    for (const saved of [
      'nope',
      { x: 1 },
      { x: 0, y: 0, width: -5, height: 10 },
      { x: 0, y: 0, width: Number.NaN, height: 5 },
    ]) {
      const result = resolvePlacement({ saved, savedDisplayId: null, displays: [LAPTOP] });
      expect(result.reason).toBe('no_saved_bounds');
    }
  });

  it('shrinks a window that no longer fits after a resolution or scale change', () => {
    // 4K at 100% → the same panel after switching to 200% scaling (1920x1080 DIP)
    // and then to a small projector.
    const saved = { x: 2800, y: 1500, width: 1000, height: 600 };
    const uhd = display(1, { x: 0, y: 0, width: 3840, height: 2160 }, { primary: true });
    expect(resolvePlacement({ saved, savedDisplayId: 1, displays: [uhd] }).recovered).toBe(false);

    const scaled = display(
      1,
      { x: 0, y: 0, width: 1920, height: 1080 },
      { primary: true, scaleFactor: 2 },
    );
    const afterScale = resolvePlacement({ saved, savedDisplayId: 1, displays: [scaled] });
    expect(afterScale.recovered).toBe(true);
    expect(isReachable(afterScale.bounds, [scaled])).toBe(true);

    const projector = display(1, { x: 0, y: 0, width: 800, height: 600 }, { primary: true });
    const afterProjector = resolvePlacement({
      saved: { x: 10, y: 10, width: 1000, height: 700 },
      savedDisplayId: 1,
      displays: [projector],
    });
    expect(afterProjector.bounds.width).toBeLessThanOrEqual(800);
    expect(afterProjector.bounds.height).toBeLessThanOrEqual(560);
    expect(isReachable(afterProjector.bounds, [projector])).toBe(true);
  });

  it('labels an oversized but on-screen window as a size adjustment, not a lost window', () => {
    const result = resolvePlacement({
      saved: { x: 0, y: 0, width: 5000, height: 4000 },
      savedDisplayId: 1,
      displays: [LAPTOP],
    });
    expect(result.reason).toBe('size_adjusted');
    expect(result.recovered).toBe(true);
    expect(result.bounds).toEqual({ x: 0, y: 0, width: 1440, height: 860 });
    // Oversized AND off screen is still a lost window.
    const lost = resolvePlacement({
      saved: { x: 9000, y: 9000, width: 5000, height: 4000 },
      savedDisplayId: 1,
      displays: [LAPTOP],
    });
    expect(lost.reason).toBe('off_screen');
    expect(isReachable(lost.bounds, [LAPTOP])).toBe(true);
  });

  it('keeps a collapsed panel at strip height', () => {
    const saved = { x: 100, y: 100, width: 720, height: PANEL.collapsedHeight };
    const result = resolvePlacement({
      saved,
      savedDisplayId: 1,
      displays: [LAPTOP],
      collapsed: true,
    });
    expect(result.bounds).toEqual(saved);
    expect(result.recovered).toBe(false);
  });

  it('still answers when no display is reported', () => {
    const result = resolvePlacement({ saved: null, savedDisplayId: null, displays: [] });
    expect(result.reason).toBe('no_displays');
    expect(result.bounds.width).toBe(720);
  });

  it('default placement never leaves the work area', () => {
    const small = display(1, { x: 0, y: 0, width: 640, height: 480 }, { primary: true });
    const bounds = defaultPlacement(small, { width: 720, height: 460 });
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(640);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(440);
  });
});

describe('custom resize', () => {
  const start = { x: 400, y: 200, width: 720, height: 460 };
  const workArea = LAPTOP.workArea;

  it('grows from the south-east corner', () => {
    expect(computeResize(start, 'se', 100, 50, PANEL_LIMITS, workArea)).toEqual({
      x: 400,
      y: 200,
      width: 820,
      height: 510,
    });
  });

  it('keeps the opposite edge fixed when dragging the north-west corner', () => {
    const result = computeResize(start, 'nw', -100, -50, PANEL_LIMITS, workArea);
    expect(result).toEqual({ x: 300, y: 150, width: 820, height: 510 });
    expect(result.x + result.width).toBe(start.x + start.width);
    expect(result.y + result.height).toBe(start.y + start.height);
  });

  it('stops at the minimum size without moving the fixed edge', () => {
    const result = computeResize(start, 'w', 5000, 0, PANEL_LIMITS, workArea);
    expect(result.width).toBe(PANEL.minWidth);
    expect(result.x + result.width).toBe(start.x + start.width);
    const north = computeResize(start, 'n', 0, 5000, PANEL_LIMITS, workArea);
    expect(north.height).toBe(PANEL.minHeight);
    expect(north.y + north.height).toBe(start.y + start.height);
  });

  it('cannot be dragged outside the work area', () => {
    const result = computeResize(start, 'se', 5000, 5000, PANEL_LIMITS, workArea);
    expect(result.x + result.width).toBeLessThanOrEqual(workArea.x + workArea.width);
    expect(result.y + result.height).toBeLessThanOrEqual(workArea.y + workArea.height);
    const up = computeResize(start, 'nw', -5000, -5000, PANEL_LIMITS, workArea);
    expect(up.x).toBeGreaterThanOrEqual(workArea.x);
    expect(up.y).toBeGreaterThanOrEqual(workArea.y);
  });

  it('ignores non-finite pointer deltas', () => {
    expect(
      computeResize(start, 'e', Number.NaN, Number.POSITIVE_INFINITY, PANEL_LIMITS, workArea),
    ).toEqual(start);
  });

  it('only changes one axis for an edge grip', () => {
    const result = computeResize(start, 'e', 40, 999, PANEL_LIMITS, workArea);
    expect(result).toEqual({ ...start, width: 760 });
  });
});

describe('presets, nudging, collapse', () => {
  const current = { x: 600, y: 100, width: 720, height: 460 };

  it('applies a preset keeping the top-right corner', () => {
    const result = applySize(current, SIZE_PRESETS.compact, PANEL_LIMITS, LAPTOP.workArea);
    expect(result.width).toBe(480);
    expect(result.height).toBe(300);
    expect(result.x + result.width).toBe(current.x + current.width);
    expect(result.y).toBe(current.y);
  });

  it('keeps a large preset on screen', () => {
    const result = applySize(current, SIZE_PRESETS.large, PANEL_LIMITS, LAPTOP.workArea);
    expect(result.x).toBeGreaterThanOrEqual(0);
    expect(result.x + result.width).toBeLessThanOrEqual(1440);
    expect(result.y + result.height).toBeLessThanOrEqual(860);
  });

  it('nudges size and position within limits', () => {
    expect(nudgeSize(current, 24, 0, PANEL_LIMITS, LAPTOP.workArea).width).toBe(744);
    expect(nudgeSize(current, -9999, -9999, PANEL_LIMITS, LAPTOP.workArea)).toMatchObject({
      width: PANEL.minWidth,
      height: PANEL.minHeight,
    });
    expect(nudgePosition(current, 99999, 0, LAPTOP.workArea).x).toBe(1440 - 720);
  });

  it('collapses to the strip and expands back to the remembered height', () => {
    const collapsed = collapsedBounds(current);
    expect(collapsed).toEqual({ ...current, height: PANEL.collapsedHeight });
    expect(expandedBounds(collapsed, 460, PANEL_LIMITS, LAPTOP.workArea)).toEqual(current);
    // Near the bottom edge the expanded panel is moved up to stay visible.
    const low = { x: 100, y: 800, width: 720, height: PANEL.collapsedHeight };
    const expanded = expandedBounds(low, 460, PANEL_LIMITS, LAPTOP.workArea);
    expect(expanded.y + expanded.height).toBeLessThanOrEqual(860);
  });
});

describe('bounds requested over IPC', () => {
  const current = { x: 100, y: 100, width: 720, height: 460 };

  it('accepts a reachable request', () => {
    expect(
      sanitizeRequestedBounds({ x: 200, width: 800 }, current, [LAPTOP], PANEL_LIMITS),
    ).toEqual({
      x: 200,
      y: 100,
      width: 800,
      height: 460,
    });
  });

  it('clamps sizes and pulls an unreachable request back on screen', () => {
    const result = sanitizeRequestedBounds(
      { x: 90000, y: -90000, width: 5, height: 99999 },
      current,
      [LAPTOP],
      PANEL_LIMITS,
    );
    expect(result.width).toBe(PANEL.minWidth);
    expect(result.height).toBeLessThanOrEqual(860);
    expect(isReachable(result, [LAPTOP])).toBe(true);
  });

  it('falls back to current values for non-finite input', () => {
    expect(
      sanitizeRequestedBounds(
        { x: Number.NaN, width: Number.POSITIVE_INFINITY },
        current,
        [LAPTOP],
        PANEL_LIMITS,
      ),
    ).toEqual(current);
  });

  it('with private mode on, keeps a position the panel asks for on the display it is on', () => {
    const onExternal = { x: 1600, y: 100, width: 720, height: 460 };
    const displays = [LAPTOP, EXTERNAL_RIGHT];
    // Without the rule the panel could move itself onto the laptop's display.
    expect(
      pickDisplayForRect(
        sanitizeRequestedBounds({ x: 100, y: 100 }, onExternal, displays, PANEL_LIMITS),
        displays,
      )?.id,
    ).toBe(LAPTOP.id);
    // With it, every request ends on the external display, fully inside its work area.
    for (const request of [
      { x: 100, y: 100 },
      { x: -5000, y: 0 },
      { x: 1300, y: 50 },
      { x: 1600, y: 5000, width: 3000 },
    ]) {
      const result = sanitizeRequestedBounds(
        request,
        onExternal,
        displays,
        PANEL_LIMITS,
        onExternal,
      );
      expect(pickDisplayForRect(result, displays)?.id, JSON.stringify(request)).toBe(
        EXTERNAL_RIGHT.id,
      );
      expect(clampRectToArea(result, EXTERNAL_RIGHT.workArea)).toEqual(result);
    }
    // Moves within that display are kept as asked.
    expect(
      sanitizeRequestedBounds({ x: 2000, y: 300 }, onExternal, displays, PANEL_LIMITS, onExternal),
    ).toEqual({ x: 2000, y: 300, width: 720, height: 460 });
  });
});

describe('measuring a resize drag', () => {
  const reported = { dx: 40, dy: -10 };

  it('uses the page-reported movement until the main process has seen the pointer move', () => {
    expect(
      chooseDragDelta({ startCursor: null, cursor: null, cursorMoved: false, reported }),
    ).toEqual({
      dx: 40,
      dy: -10,
      cursorMoved: false,
    });
    // Synthetic input: the real pointer never moves.
    expect(
      chooseDragDelta({
        startCursor: { x: 500, y: 300 },
        cursor: { x: 500, y: 300 },
        cursorMoved: false,
        reported,
      }),
    ).toEqual({ dx: 40, dy: -10, cursorMoved: false });
  });

  it('prefers the main process’s own pointer reading as soon as it moves', () => {
    expect(
      chooseDragDelta({
        startCursor: { x: 500, y: 300 },
        cursor: { x: 430, y: 320 },
        cursorMoved: false,
        reported,
      }),
    ).toEqual({ dx: -70, dy: 20, cursorMoved: true });
  });

  it('keeps using the pointer reading once it has moved, even back at the start point', () => {
    expect(
      chooseDragDelta({
        startCursor: { x: 500, y: 300 },
        cursor: { x: 500, y: 300 },
        cursorMoved: true,
        reported,
      }),
    ).toEqual({ dx: 0, dy: 0, cursorMoved: true });
  });

  it('is immune to a page that reports absurd or non-finite movement', () => {
    expect(
      chooseDragDelta({
        startCursor: { x: 500, y: 300 },
        cursor: { x: 510, y: 300 },
        cursorMoved: false,
        reported: { dx: 99999, dy: Number.NaN },
      }),
    ).toEqual({ dx: 10, dy: 0, cursorMoved: true });
    expect(
      chooseDragDelta({
        startCursor: null,
        cursor: null,
        cursorMoved: false,
        reported: { dx: Number.NaN, dy: Number.POSITIVE_INFINITY },
      }),
    ).toEqual({ dx: 0, dy: 0, cursorMoved: false });
  });

  it('falls back to the page when the pointer reading is unusable', () => {
    expect(
      chooseDragDelta({
        startCursor: { x: Number.NaN, y: 0 },
        cursor: { x: 10, y: 10 },
        cursorMoved: false,
        reported,
      }),
    ).toEqual({ dx: 40, dy: -10, cursorMoved: false });
  });

  it('a left-edge drag measured in absolute coordinates does not feed back on itself', () => {
    // The pointer moves 80px left in eight steps while the window origin follows it.
    const start = { x: 400, y: 200, width: 720, height: 460 };
    const startCursor = { x: 400, y: 430 };
    let bounds = start;
    let cursorMoved = false;
    for (let step = 1; step <= 8; step += 1) {
      const delta = chooseDragDelta({
        startCursor,
        cursor: { x: startCursor.x - step * 10, y: startCursor.y },
        cursorMoved,
        // What a window-relative source would claim after the origin moved: far too much.
        reported: { dx: -step * 10 - (start.x - bounds.x), dy: 0 },
      });
      cursorMoved = delta.cursorMoved;
      bounds = computeResize(start, 'w', delta.dx, delta.dy, PANEL_LIMITS, LAPTOP.workArea);
    }
    expect(bounds).toEqual({ x: 320, y: 200, width: 800, height: 460 });
  });
});
