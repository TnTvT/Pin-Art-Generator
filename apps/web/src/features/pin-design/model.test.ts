import { describe, expect, it } from 'vitest';
import { DEFAULTS, getMetrics, getPinPositions, getWarnings } from './model';

describe('pin grid measurements', () => {
  it('includes the outer pin diameter in the default footprint', () => {
    expect(getMetrics(DEFAULTS)).toEqual({ count: 320, width: 68.5, depth: 54.5, clearance: 1.5 });
  });

  it('gives a single pin a footprint equal to its diameter', () => {
    expect(getMetrics({ ...DEFAULTS, columns: 1, rows: 1 })).toEqual({ count: 1, width: 2, depth: 2, clearance: null });
  });

  it('supports the maximum 5,000-pin grid', () => {
    expect(getMetrics({ ...DEFAULTS, columns: 100, rows: 50 }).count).toBe(5000);
  });

  it('measures actual rotated polygon bounds for legacy positions', () => {
    const metrics = getMetrics({ ...DEFAULTS, columns: 1, rows: 1, pinShape: 'triangle' });
    expect(metrics.width).toBeCloseTo(Math.sqrt(3));
    expect(metrics.depth).toBeCloseTo(1.5);
    expect(metrics.clearance).toBeNull();
    const rotated = getMetrics({ ...DEFAULTS, columns: 1, rows: 1, pinShape: 'triangle', pinRotation: 90 });
    expect(rotated.width).toBeCloseTo(1.5);
    expect(rotated.depth).toBeCloseTo(Math.sqrt(3));
  });

  it('uses committed positions for bounds and clearance, not configured spacing or duplicate IDs', () => {
    const pins = [{ id: 'a', x: -10, y: -1 }, { id: 'a', x: -7, y: 3 }, { id: 'c', x: 0, y: 2 }];
    const parameters = { ...DEFAULTS, spacing: 0.1, layout: { regions: [], pins, edgePadding: 0 } };
    expect(getPinPositions(parameters)).toBe(pins);
    expect(getMetrics(parameters)).toEqual({ count: 3, width: 12, depth: 6, clearance: 3 });
  });

  it('resolves legacy positions in existing row-major order and IDs', () => {
    expect(getPinPositions({ ...DEFAULTS, rows: 1, columns: 2 })).toEqual([
      { id: 'R1:C1', x: -1.75, y: 0 }, { id: 'R1:C2', x: 1.75, y: 0 },
    ]);
  });

  it('returns zero footprint and no clearance for an empty committed layout', () => {
    expect(getMetrics({ ...DEFAULTS, layout: { regions: [], pins: [], edgePadding: 0 } })).toEqual({ count: 0, width: 0, depth: 0, clearance: null });
  });

  it('reports the actual polygon clearance even when its circumscribed circles overlap', () => {
    const metrics = getMetrics({ ...DEFAULTS, columns: 2, rows: 1, spacing: 1.5, pinShape: 'square' });
    expect(metrics.clearance).toBeCloseTo(1.5 - Math.SQRT2);
    expect(getWarnings({ ...DEFAULTS, columns: 2, rows: 1, spacing: 1.5, pinShape: 'square' })).toEqual([]);
    expect(getWarnings({ ...DEFAULTS, columns: 2, rows: 1, spacing: 1.5, pinShape: 'square', pinRotation: 45 })).toEqual([expect.stringContaining('overlap')]);
  });

  it('stays pure when callers mutate parameter and position objects between measurements', () => {
    const pins = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 3, y: 0 }];
    const parameters = { ...DEFAULTS, pinShape: 'square' as const, pinRotation: 0, layout: { regions: [], pins, edgePadding: 0 } };
    expect(getMetrics(parameters).clearance).toBeCloseTo(3 - Math.SQRT2);
    pins[1].x = 1;
    expect(getMetrics(parameters).clearance).toBeCloseTo(1 - Math.SQRT2);
    parameters.pinRotation = 45;
    expect(getMetrics(parameters).clearance).toBeCloseTo(-Math.SQRT1_2);
  });
});

describe('layout warnings', () => {
  it('accepts coherent precomputed metrics for immutable UI consumers', () => {
    const parameters = { ...DEFAULTS, spacing: 1 };
    const metrics = getMetrics(parameters);
    expect(getWarnings(parameters, metrics)).toEqual(getWarnings(parameters));
  });
  it('accepts a grid that exactly fits the base with touching pins', () => {
    expect(getWarnings({ ...DEFAULTS, width: 4, depth: 4, columns: 2, rows: 2, spacing: 2 })).toEqual([]);
  });

  it.each([{ width: 68 }, { depth: 54 }])('warns when either footprint dimension exceeds the base: %o', (dimensions) => {
    expect(getWarnings({ ...DEFAULTS, ...dimensions })).toEqual([expect.stringContaining('beyond the base')]);
  });

  it('warns about overlapping pins while allowing a single pin', () => {
    expect(getWarnings({ ...DEFAULTS, spacing: 1 })).toEqual([expect.stringContaining('overlap')]);
    expect(getWarnings({ ...DEFAULTS, spacing: 1, columns: 1, rows: 1 })).toEqual([]);
  });

  it('reports overflow and overlap together', () => {
    expect(getWarnings({ ...DEFAULTS, width: 1, spacing: 1 })).toHaveLength(2);
  });
});
