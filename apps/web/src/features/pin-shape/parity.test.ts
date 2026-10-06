import { describe, expect, it } from 'vitest';
import fixtureData from '../../../../../fixtures/pin-cross-sections.json?raw';
import { DEFAULTS } from '../pin-design/model';
import { pinBounds, pinVertices, type PinShape } from './geometry';

const fixtures = JSON.parse(fixtureData) as { shape: PinShape; size: number; rotation: number; vertices: number[][]; bounds: Record<string, number> }[];
describe('shared TypeScript/Python cross-section golden fixtures', () => {
  it.each(fixtures)('$shape at $rotation° matches authoritative vertices and bounds', fixture => {
    const vertices = pinVertices(fixture.shape, fixture.size, fixture.rotation);
    vertices.forEach((point, index) => point.forEach((value, axis) => expect(value).toBeCloseTo(fixture.vertices[index][axis], 12)));
    const bounds = pinBounds({ ...DEFAULTS, diameter: fixture.size, pinShape: fixture.shape, pinRotation: fixture.rotation });
    for (const key of ['minX', 'minY', 'maxX', 'maxY'] as const) expect(bounds[key]).toBeCloseTo(fixture.bounds[key], 12);
  });
});
