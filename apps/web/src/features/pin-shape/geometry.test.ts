import { describe, expect, it } from 'vitest';
import { DEFAULTS } from '../pin-design/model';
import { ringArea, type Point, type Region } from '../base-shape/layout';
import { createPinContainment, effectivePinRotation, minimumPinClearance, pinBounds, pinVertices, validatePinGeometry } from './geometry';

const rectangle = (minX: number, minY: number, maxX: number, maxY: number): Point[] => [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]];
const base: Region = { outer: rectangle(-10, -10, 10, 10), holes: [] };

describe('circumscribed pin cross-sections', () => {
  it.each([0, 30, 45, 90, 360])('matches analytic square and triangle fixtures at %s degrees', rotation => {
    const angle = (rotation === 360 ? 0 : rotation) * Math.PI / 180;
    const square = pinVertices('square', 2, rotation);
    const triangle = pinVertices('triangle', 2, rotation);
    const halfSide = Math.SQRT1_2;
    const fixtures: [Point[], Point[]] = [
      [[-halfSide, -halfSide], [halfSide, -halfSide], [halfSide, halfSide], [-halfSide, halfSide]],
      [[0, 1], [-Math.sqrt(3) / 2, -0.5], [Math.sqrt(3) / 2, -0.5]],
    ];
    for (const [vertices, reference] of [[square, fixtures[0]], [triangle, fixtures[1]]]) {
      expect(ringArea(vertices)).toBeGreaterThan(0);
      vertices.forEach(([horizontal, vertical], index) => {
        const [referenceX, referenceY] = reference[index];
        expect(horizontal).toBeCloseTo(referenceX * Math.cos(angle) - referenceY * Math.sin(angle), 12);
        expect(vertical).toBeCloseTo(referenceX * Math.sin(angle) + referenceY * Math.cos(angle), 12);
        expect(Math.hypot(horizontal, vertical)).toBeCloseTo(1, 12);
      });
      expect(vertices.reduce((sum, vertex) => sum + vertex[0], 0)).toBeCloseTo(0, 12);
      expect(vertices.reduce((sum, vertex) => sum + vertex[1], 0)).toBeCloseTo(0, 12);
    }
    expect(Math.hypot(square[0][0] - square[1][0], square[0][1] - square[1][1])).toBeCloseTo(Math.SQRT2);
    expect(Math.hypot(triangle[0][0] - triangle[1][0], triangle[0][1] - triangle[1][1])).toBeCloseTo(Math.sqrt(3));
  });

  it('ignores round rotation and canonicalizes 360 without changing polygon symmetry', () => {
    expect(pinVertices('round', 2, 90)).toEqual(pinVertices('round', 2));
    expect(pinVertices('round', 2)).toHaveLength(64);
    expect(effectivePinRotation({ ...DEFAULTS, pinRotation: 90 })).toBe(0);
    expect(effectivePinRotation({ ...DEFAULTS, pinShape: 'triangle', pinRotation: 360 })).toBe(0);
    for (const [shape, rotation] of [['square', 90], ['triangle', 120]] as const) {
      const rotated = pinVertices(shape, 2, rotation);
      expect(pinVertices(shape, 2).every(point => rotated.some(other => Math.hypot(point[0] - other[0], point[1] - other[1]) < 1e-12))).toBe(true);
    }
  });

  it('returns asymmetric triangle bounds and exact round bounds', () => {
    expect(pinBounds(DEFAULTS)).toEqual({ minX: -1, minY: -1, maxX: 1, maxY: 1 });
    const bounds = pinBounds({ ...DEFAULTS, pinShape: 'triangle' });
    expect(bounds.minX).toBeCloseTo(-Math.sqrt(3) / 2);
    expect(bounds.maxX).toBeCloseTo(Math.sqrt(3) / 2);
    expect(bounds.minY).toBeCloseTo(-0.5);
    expect(bounds.maxY).toBeCloseTo(1);
  });

  it.each([
    [{ diameter: 0 }, /size/i], [{ diameter: NaN }, /size/i], [{ diameter: Infinity }, /size/i],
    [{ pinShape: 'hexagon' }, /shape/i], [{ pinShape: null }, /shape/i], [{ pinRotation: null }, /rotation/i], [{ pinRotation: -1 }, /rotation/i],
    [{ pinRotation: 361 }, /rotation/i], [{ pinRotation: NaN }, /rotation/i], [{ pinRotation: Infinity }, /rotation/i],
  ])('rejects invalid geometry %o', (change, message) => {
    expect(() => validatePinGeometry({ ...DEFAULTS, ...change } as typeof DEFAULTS)).toThrow(message);
  });
});

describe('true footprint containment', () => {
  it('uses the polygon rather than its circumcircle, including rotated footprints', () => {
    const regions = [{ outer: rectangle(-0.75, -0.75, 0.75, 0.75), holes: [] }];
    expect(createPinContainment(regions, DEFAULTS)(0, 0, 0)).toBe(false);
    expect(createPinContainment(regions, { ...DEFAULTS, pinShape: 'square' })(0, 0, 0)).toBe(true);
    expect(createPinContainment(regions, { ...DEFAULTS, pinShape: 'square', pinRotation: 45 })(0, 0, 0)).toBe(false);
  });

  it('accepts tangent boundaries and exact wall padding, including socket offsets', () => {
    const parameters = { ...DEFAULTS, pinShape: 'square' as const };
    const fits = createPinContainment([base], parameters);
    expect(fits(10 - Math.SQRT1_2, 0, 0)).toBe(true);
    expect(fits(10 - Math.SQRT1_2 - 0.9, 0, 0.2 / 2 + 0.8)).toBe(true);
    expect(fits(10 - Math.SQRT1_2 - 0.89, 0, 0.9)).toBe(false);
    expect(createPinContainment([base], DEFAULTS)(9, 0, 0)).toBe(true);
    expect(createPinContainment([base], DEFAULTS)(8, 0, 1)).toBe(true);
  });

  it('detects fully enclosed holes even when the center and every vertex are outside the hole', () => {
    const regions = [{ ...base, holes: [rectangle(0.2, 0.2, 0.4, 0.4)] }];
    expect(createPinContainment(regions, { ...DEFAULTS, pinShape: 'square' })(0, 0, 0)).toBe(false);
    expect(createPinContainment(regions, DEFAULTS)(0, 0, 0)).toBe(false);
    expect(createPinContainment(regions, { ...DEFAULTS, pinShape: 'square' })(-1, -1, 0)).toBe(true);
  });

  it('rejects concave boundary crossings missed by vertex-only tests', () => {
    const region = { outer: [[-5,-5], [5,-5], [5,5], [0.3,5], [0.3,0.4], [0.2,0.4], [0.2,5], [-5,5]] as Point[], holes: [] };
    expect(createPinContainment([region], { ...DEFAULTS, pinShape: 'square' })(0, 0, 0)).toBe(false);
  });

  it('checks hole padding and disconnected regions', () => {
    const regions = [{ ...base, holes: [rectangle(2, -2, 4, 2)] }, { outer: rectangle(20, -2, 24, 2), holes: [] }];
    const fits = createPinContainment(regions, { ...DEFAULTS, pinShape: 'square' });
    expect(fits(2 - Math.SQRT1_2 - 0.5, 0, 0.5)).toBe(true);
    expect(fits(2 - Math.SQRT1_2 - 0.49, 0, 0.5)).toBe(false);
    expect(fits(22, 0, 0.5)).toBe(true);
    expect(fits(15, 0, 0)).toBe(false);
  });
});

describe('signed neighbour clearance', () => {
  const pins = (horizontal: number, vertical = 0) => [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: horizontal, y: vertical }];

  it('handles empty and single-pin layouts and analytic round distances', () => {
    expect(minimumPinClearance(DEFAULTS, [])).toBeNull();
    expect(minimumPinClearance(DEFAULTS, pins(0).slice(0, 1))).toBeNull();
    expect(minimumPinClearance(DEFAULTS, pins(3, 4))).toBe(3);
    expect(minimumPinClearance(DEFAULTS, pins(1))).toBe(-1);
  });

  it('returns Euclidean polygon gaps, tangency and signed penetration', () => {
    const parameters = { ...DEFAULTS, pinShape: 'square' as const };
    expect(minimumPinClearance(parameters, pins(3))).toBeCloseTo(3 - Math.SQRT2);
    expect(minimumPinClearance(parameters, pins(3, 3))).toBeCloseTo(Math.SQRT2 * (3 - Math.SQRT2));
    expect(minimumPinClearance(parameters, pins(Math.SQRT2))).toBeCloseTo(0);
    expect(minimumPinClearance(parameters, pins(1))).toBeCloseTo(1 - Math.SQRT2);
    expect(minimumPinClearance(parameters, pins(0))).toBeCloseTo(-Math.SQRT2);
  });

  it.each([0, 30, 45, 90, 120, 360])('preserves signed triangle gaps at %s degrees', pinRotation => {
    const angle = (pinRotation === 360 ? 0 : pinRotation) * Math.PI / 180;
    const parameters = { ...DEFAULTS, pinShape: 'triangle' as const, pinRotation };
    const alongNormal = (distance: number) => pins(-Math.sin(angle) * distance, Math.cos(angle) * distance);
    expect(minimumPinClearance(parameters, alongNormal(0))).toBeCloseTo(-1.5, 12);
    expect(minimumPinClearance(parameters, alongNormal(1))).toBeCloseTo(-0.5, 12);
    expect(minimumPinClearance(parameters, alongNormal(1.5))).toBe(0);
    expect(minimumPinClearance(parameters, alongNormal(2))).toBeCloseTo(0.5, 12);
  });

  it('scales polygon clearance for small positive sizes', () => {
    expect(minimumPinClearance({ ...DEFAULTS, pinShape: 'square', diameter: 2e-8 }, pins(3e-8))).toBeCloseTo((3 - Math.SQRT2) * 1e-8, 18);
  });

  it('finds overlapping diagonal neighbours missed by axial checks', () => {
    const parameters = { ...DEFAULTS, pinShape: 'square' as const };
    const allPins = [...pins(1.8), { id: 'diagonal', x: 1, y: 1 }];
    expect(minimumPinClearance(parameters, allPins)).toBeCloseTo(1 - Math.SQRT2, 12);
  });

  it('checks diagonal neighbours rather than just adjacent rows and columns', () => {
    const parameters = { ...DEFAULTS, pinShape: 'triangle' as const, pinRotation: 45 };
    const allPins = [...pins(2), { id: 'c', x: 0, y: 2 }, { id: 'd', x: 2, y: 2 }];
    const diagonalGap = minimumPinClearance(parameters, pins(2, -2));
    expect(minimumPinClearance(parameters, allPins)).toBeCloseTo(Math.min(
      minimumPinClearance(parameters, pins(2))!, minimumPinClearance(parameters, pins(0, 2))!,
      minimumPinClearance(parameters, pins(2, 2))!, diagonalGap!,
    ));
  });

  it.each(['round', 'square', 'triangle'] as const)('indexes a 10,000-pin %s grid efficiently', pinShape => {
    const allPins = Array.from({ length: 10000 }, (_, index) => ({ id: String(index), x: index % 100 * 5, y: Math.floor(index / 100) * 5 }));
    const started = performance.now();
    const expected = pinShape === 'round' ? 3 : pinShape === 'square' ? 5 - Math.SQRT2 : 5 - Math.sqrt(3);
    expect(minimumPinClearance({ ...DEFAULTS, pinShape }, allPins)).toBeCloseTo(expected);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it('also indexes densely overlapping 10,000-pin layouts without scanning every pair', () => {
    const allPins = Array.from({ length: 10000 }, (_, index) => ({ id: String(index), x: index % 100 * 0.001, y: Math.floor(index / 100) * 0.001 }));
    const started = performance.now();
    expect(minimumPinClearance({ ...DEFAULTS, pinShape: 'square' }, allPins)).toBeCloseTo(0.001 - Math.SQRT2, 10);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it.each(['round', 'square', 'triangle'] as const)('matches exhaustive pair gaps for irregular %s positions', pinShape => {
    const allPins = Array.from({ length: 30 }, (_, index) => ({ id: String(index), x: Math.sin(index * 13) * 20, y: Math.cos(index * 7) * 20 }));
    const parameters = { ...DEFAULTS, pinShape, pinRotation: 30 };
    let expected = Infinity;
    allPins.forEach((pin, index) => allPins.slice(index + 1).forEach(other => {
      expected = Math.min(expected, minimumPinClearance(parameters, [pin, other])!);
    }));
    expect(minimumPinClearance(parameters, [...allPins].reverse())).toBeCloseTo(expected, 10);
  });
});
