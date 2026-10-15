import { describe, expect, it } from 'vitest';
import { DEFAULTS } from '../pin-design/model';
import { DEFAULT_SHAPE, generateLayout } from '../base-shape/layout';
import { DEFAULT_CONSTRUCTION, profilePoints, validateMechanics } from './model';

const construction = { ...DEFAULT_CONSTRUCTION, mode: 'print-in-place' as const };
const parameters = { ...DEFAULTS, spacing: 4.5, ...generateLayout({ ...DEFAULTS, spacing: 4.5, construction }, DEFAULT_SHAPE), construction };
describe('print-in-place mechanics', () => {
  it('validates surface gap independently of shaft clearance and retaining head size', () => {
    expect(() => validateMechanics(parameters)).not.toThrow();
    expect(() => validateMechanics({ ...parameters, construction: { ...construction, sliding: { ...construction.sliding, lowerHeadGap: -0.1 } } })).toThrow('Lower head surface gap');
    expect(() => validateMechanics({ ...parameters, thickness: 2.52 })).toThrow('Guide thickness');
    expect(() => validateMechanics({ ...parameters, thickness: 2.53 })).not.toThrow();
    expect(() => validateMechanics({ ...parameters, construction: { ...construction, sliding: { ...construction.sliding, lowerHeadGap: 0.4 } } })).toThrow('Guide walls');
  });
  it('keeps 4 mm spacing and 0.4 mm radial retention with wider clearance and heads', () => {
    expect(DEFAULTS.spacing).toBe(4);
    expect(DEFAULT_CONSTRUCTION.sliding).toEqual({ clearance: 0.6, headFlare: 0.7, lowerHeadGap: 0.3, lowerHeadAngle: 45 });
    const { clearance, headFlare } = DEFAULT_CONSTRUCTION.sliding;
    const head = profilePoints('round', DEFAULTS.diameter, headFlare);
    const guide = profilePoints('round', DEFAULTS.diameter, clearance / 2);
    const width = (points: typeof head) => Math.max(...points.map(point => point[0])) - Math.min(...points.map(point => point[0]));
    expect(width(head)).toBeCloseTo(3.4);
    expect(width(guide)).toBeCloseTo(2.6);
    expect((width(head) - width(guide)) / 2).toBeCloseTo(0.4);
    expect(() => validateMechanics({ ...parameters, layout: undefined, spacing: 4 })).toThrow('Guide walls');
    expect(() => validateMechanics({ ...parameters, layout: undefined, spacing: 4.45 })).not.toThrow();
    expect(() => validateMechanics({ ...parameters, layout: undefined, spacing: 4.44 })).toThrow('Guide walls');
    expect(() => validateMechanics({ ...parameters, layout: undefined, diameter: 3, spacing: 5 })).toThrow('Guide walls');
    expect(() => validateMechanics({ ...parameters, layout: undefined, diameter: 3, spacing: 5.5 })).not.toThrow();
  });
  it('accepts default pins and rejects short extensions and mouth collisions', () => {
    expect(() => validateMechanics(parameters)).not.toThrow();
    expect(() => validateMechanics(parameters, new Float32Array(parameters.layout.pins.length).fill(0.5))).toThrow('extension');
    expect(() => validateMechanics({ ...parameters, construction: { ...parameters.construction, sliding: { clearance: 0.4, headFlare: 1.1 } } })).toThrow('Guide thickness');
  });
  it('rejects lower and upper head tapers that consume the entire pin length', () => {
    const settings = { ...DEFAULTS, columns: 1, rows: 1, spacing: 10, thickness: 5, extension: 2.4,
      construction: { mode: 'print-in-place' as const, sliding: { clearance: 2, headFlare: 1.2, lowerHeadGap: 0.01, lowerHeadAngle: 85 } } };
    expect(() => validateMechanics(settings)).toThrow('positive shaft length');
  });
  it.each(['round', 'square', 'triangle'] as const)('keeps offset profiles convex with finite coordinates: %s', shape => {
    const ring = profilePoints(shape, 2, 0.4);
    expect(ring.length).toBeGreaterThanOrEqual(64);
    expect(ring.flat().every(Number.isFinite)).toBe(true);
  });
});
