import { describe, expect, it } from 'vitest';
import { guideDimensions } from './dimensions';

describe('lower taper surface clearance', () => {
  it('widens the guide clearance without changing lower surface separation or retaining-head size', () => {
    const original = guideDimensions({ clearance: 0.4, headFlare: 0.6 });
    const widened = guideDimensions({ clearance: 0.6, headFlare: 0.6 });
    expect(widened.lowerHeadHorizontalGap).toBe(original.lowerHeadHorizontalGap);
    expect(widened.lowerMouthOffset).toBe(original.lowerMouthOffset);
    expect(widened.lowerHeadHeight).toBe(original.lowerHeadHeight);
    expect(widened.upperHeadHeight).toBe(original.upperHeadHeight);
    expect(widened.lowerMouthHeight).toBeCloseTo(original.lowerMouthHeight - 0.1, 12);
    expect(widened.upperMouthOffset).toBeCloseTo(0.9, 12);
    expect(widened.upperMouthHeight).toBe(original.upperMouthHeight);
  });
  it('defaults to 45 degrees and 0.3 mm lower slope separation without changing the upper mouth', () => {
    const dimensions = guideDimensions({ clearance: 0.4, headFlare: 0.6 });
    const facetFactor = Math.cos(Math.PI / 63);
    const normalGap = dimensions.lowerHeadHorizontalGap * facetFactor / Math.sqrt(1 + facetFactor ** 2);
    expect(normalGap).toBeCloseTo(0.3, 12);
    expect(dimensions.lowerHeadHeight).toBeCloseTo(0.6, 12);
    expect(dimensions.upperMouthOffset).toBeCloseTo(0.8, 12);
    expect(dimensions.upperMouthHeight).toBe(0.6);
  });
  it.each([45, 60])('targets 0.2 mm normal distance at %s degrees without widening the shaft', angle => {
    const dimensions = guideDimensions({ clearance: 0.4, headFlare: 0.6, lowerHeadAngle: angle, lowerHeadGap: 0.2 });
    const slope = Math.tan(angle * Math.PI / 180);
    const horizontalGap = dimensions.lowerMouthOffset - 0.6;
    const facetFactor = Math.cos(Math.PI / 63);
    const normalGap = horizontalGap * facetFactor / Math.sqrt(1 + (facetFactor / slope) ** 2);
    expect(normalGap).toBeCloseTo(0.2, 12);
    expect(dimensions.lowerHeadHeight).toBeCloseTo(0.6 * slope, 12);
    expect(dimensions.lowerMouthHeight).toBeCloseTo((0.6 + horizontalGap - 0.2) * slope, 12);
    expect(dimensions.upperMouthOffset).toBeCloseTo(0.8, 12);
    expect(dimensions.upperMouthHeight).toBe(0.6);
  });
  it.each([0, -0.1, NaN, Infinity])('rejects invalid normal gap %s', lowerHeadGap => {
    expect(() => guideDimensions({ clearance: 0.4, headFlare: 0.6, lowerHeadGap })).toThrow('Lower head surface gap');
  });
});
