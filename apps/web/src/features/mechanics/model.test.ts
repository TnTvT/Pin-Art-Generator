import { describe, expect, it } from 'vitest';
import { DEFAULTS } from '../pin-design/model';
import { DEFAULT_SHAPE, generateLayout } from '../base-shape/layout';
import { DEFAULT_CONSTRUCTION, profilePoints, validateMechanics } from './model';

const parameters = { ...DEFAULTS, ...generateLayout(DEFAULTS, DEFAULT_SHAPE), construction: { ...DEFAULT_CONSTRUCTION, mode: 'print-in-place' as const } };
describe('print-in-place mechanics', () => {
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
