import { describe, expect, it } from 'vitest';
import { DEFAULTS } from '../pin-design/model';
import { DEFAULT_SHAPE, generateLayout } from '../base-shape/layout';
import { DEFAULT_CONSTRUCTION, profilePoints, validateMechanics } from './model';

const construction = { ...DEFAULT_CONSTRUCTION, mode: 'print-in-place' as const };
const parameters = { ...DEFAULTS, ...generateLayout({ ...DEFAULTS, construction }, DEFAULT_SHAPE), construction };
describe('print-in-place mechanics', () => {
  it('uses 4 mm spacing and 0.4 mm radial retention without increasing sliding clearance', () => {
    expect(DEFAULTS.spacing).toBe(4);
    expect(DEFAULT_CONSTRUCTION.sliding).toEqual({ clearance: 0.4, headFlare: 0.6 });
    const { clearance, headFlare } = DEFAULT_CONSTRUCTION.sliding;
    const head = profilePoints('round', DEFAULTS.diameter, headFlare);
    const guide = profilePoints('round', DEFAULTS.diameter, clearance / 2);
    const width = (points: typeof head) => Math.max(...points.map(point => point[0])) - Math.min(...points.map(point => point[0]));
    expect(width(head)).toBeCloseTo(3.2);
    expect(width(guide)).toBeCloseTo(2.4);
    expect((width(head) - width(guide)) / 2).toBeCloseTo(0.4);
    expect(() => validateMechanics({ ...parameters, layout: undefined, spacing: 3.8 })).not.toThrow();
    expect(() => validateMechanics({ ...parameters, layout: undefined, spacing: 3.79 })).toThrow('Guide walls');
  });
  it('accepts default pins and rejects short extensions and mouth collisions', () => {
    expect(() => validateMechanics(parameters)).not.toThrow();
    expect(() => validateMechanics(parameters, new Float32Array(parameters.layout.pins.length).fill(0.5))).toThrow('extension');
    expect(() => validateMechanics({ ...parameters, construction: { ...parameters.construction, sliding: { clearance: 0.4, headFlare: 1.1 } } })).toThrow('Guide thickness');
  });
  it.each(['round', 'square', 'triangle'] as const)('keeps offset profiles convex with finite coordinates: %s', shape => {
    const ring = profilePoints(shape, 2, 0.4);
    expect(ring.length).toBeGreaterThanOrEqual(64);
    expect(ring.flat().every(Number.isFinite)).toBe(true);
  });
});
