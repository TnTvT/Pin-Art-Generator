import { describe, expect, it } from 'vitest';
import { DEFAULTS, getMetrics } from '../pin-design/model';
import { minimumPinClearance, resolvePinGeometries, validateResolvedGeometry, type PinGeometry } from './geometry';
import { DEFAULT_SHAPE, generateLayout } from '../base-shape/layout';

describe('resolved per-pin footprints', () => {
  it('resolves legacy defaults and validates full arrays before canonicalizing angles', () => {
    const parameters = { ...DEFAULTS, columns: 2, rows: 1, pinShape: 'triangle' as const, pinRotation: 360 };
    expect(resolvePinGeometries(parameters)).toEqual([{ shape: 'triangle', rotation: 0 }, { shape: 'triangle', rotation: 0 }]);
    expect(() => resolvePinGeometries({ ...parameters, pinGeometries: [] })).toThrow(/match/);
    expect(() => resolvePinGeometries({ ...parameters, pinGeometries: [{ shape: 'round', rotation: NaN }, { shape: 'square', rotation: 0 }] })).toThrow(/rotation/);
  });

  it('measures circle-polygon and polygon-polygon gaps, not circumscribed circles', () => {
    const parameters = { ...DEFAULTS, columns: 2, rows: 1, diameter: 2, spacing: 3,
      pinGeometries: [{ shape: 'round' as const, rotation: 0 }, { shape: 'square' as const, rotation: 0 }] };
    expect(getMetrics(parameters).clearance).toBeCloseTo(2 - Math.SQRT1_2);
    expect(getMetrics(parameters).width).toBeCloseTo(4 + Math.SQRT1_2);
    expect(getMetrics({ ...parameters, pinGeometries: [{ shape: 'square', rotation: 0 }, { shape: 'square', rotation: 45 }] }).clearance).toBeCloseTo(2 - Math.SQRT1_2);
  });

  it('rejects full-batch overlap and actual padding violations without altering positions', () => {
    const parameters = { ...DEFAULTS, width: 4, depth: 4, columns: 1, rows: 1, diameter: 4, pinShape: 'square' as const };
    expect(() => validateResolvedGeometry(parameters)).not.toThrow();
    expect(() => validateResolvedGeometry({ ...parameters, width: 3 })).not.toThrow();
    expect(() => validateResolvedGeometry({ ...parameters, width: 3, pinGeometries: [{ shape: 'round', rotation: 0 }] })).toThrow(/padding/);
    expect(() => validateResolvedGeometry({ ...DEFAULTS, spacing: 0.5, columns: 2, rows: 1 })).toThrow(/overlap/);
  });
  it('matches indexed nearest gaps to all-pair checks for asymmetric mixed angles', () => {
    const pins = Array.from({ length: 60 }, (_, index) => ({ id: `p:${index}`, x: (index * 37 % 113) / 5, y: (index * 41 % 97) / 5 }));
    const pinGeometries: PinGeometry[] = pins.map((_, index) => ({ shape: (['round', 'square', 'triangle'] as const)[index % 3], rotation: index * 47 % 360 }));
    const parameters = { ...DEFAULTS, layout: { regions: [], edgePadding: 0, pins }, pinGeometries };
    let expected = Infinity;
    for (let first = 0; first < pins.length; first++) for (let second = first + 1; second < pins.length; second++) {
      const pair = { ...parameters, layout: { ...parameters.layout, pins: [pins[first], pins[second]] }, pinGeometries: [pinGeometries[first], pinGeometries[second]] };
      expected = Math.min(expected, minimumPinClearance(pair, pair.layout.pins)!);
    }
    expect(minimumPinClearance(parameters, pins)).toBeCloseTo(expected, 10);
  });
  it('validates and resolves a full 10,000-pin mixed layout without changing topology', () => {
    const input = { ...DEFAULTS, width: 100.8, depth: 100.8, diameter: 1, spacing: 1, pinShape: 'triangle' as const, pinRotation: 45 };
    const parameters = { ...input, ...generateLayout(input, { ...DEFAULT_SHAPE, padding: 0 }) };
    expect(parameters.layout.pins).toHaveLength(10000);
    const pinGeometries: PinGeometry[] = parameters.layout.pins.map((pin, index) => Math.abs(pin.x) < 49 && Math.abs(pin.y) < 49
      ? { shape: (['round', 'square', 'triangle'] as const)[index % 3], rotation: index % 3 === 2 ? 45 : 0 }
      : { shape: 'square', rotation: 0 });
    const resolved = { ...parameters, pinGeometries };
    const start = performance.now();
    validateResolvedGeometry(resolved);
    const metrics = getMetrics(resolved);
    expect(metrics.count).toBe(10000);
    expect(metrics.clearance).toBeGreaterThanOrEqual(0);
    expect(resolved.layout.pins).toBe(parameters.layout.pins);
    console.info(`10,000 mixed-pin validation + metrics: ${(performance.now() - start).toFixed(1)} ms`);
  });
  it('keeps dense overlapping uniform and mixed clearance queries indexed', () => {
    const pins = Array.from({ length: 10000 }, (_, index) => ({ id: `p:${index}`, x: index % 100 * 0.01, y: Math.floor(index / 100) * 0.01 }));
    const pinGeometries: PinGeometry[] = pins.map(() => ({ shape: 'square', rotation: 0 }));
    const parameters = { ...DEFAULTS, diameter: 1, layout: { regions: [], edgePadding: 0, pins }, pinGeometries };
    const start = performance.now();
    expect(minimumPinClearance(parameters, pins)).toBeCloseTo(0.01 - Math.SQRT1_2);
    pinGeometries[5000] = { shape: 'round', rotation: 0 };
    expect(minimumPinClearance(parameters, pins)).toBeCloseTo(0.01 - Math.SQRT1_2 / 2 - 0.5);
    console.info(`10,000 dense uniform + mixed clearance: ${(performance.now() - start).toFixed(1)} ms`);
  });
});
