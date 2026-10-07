import { describe, expect, it } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import fixtureData from '../../../../../fixtures/sliding-profiles.json?raw';
import solidData from '../../../../../fixtures/sliding-solids.json?raw';
import { DEFAULTS } from '../pin-design/model';
import { createEditorState, editorReducer } from '../pin-editing/model';
import { DEFAULT_CONSTRUCTION, profilePoints } from './model';
import { buildMechanicalBase, createMechanicalPinGeometry, geometryFromMesh } from './preview-geometry';
import type { PinShape } from '../pin-shape/geometry';

const fixtures = JSON.parse(fixtureData) as { shape: PinShape; diameter: number; offset: number; points: number[][] }[];
const construction = { ...DEFAULT_CONSTRUCTION, mode: 'print-in-place' as const };
const solids = JSON.parse(solidData) as { shape: PinShape; baseVolume: number; pinVolume: number }[];
function signedVolume(geometry: ReturnType<typeof geometryFromMesh>) {
  const positions = geometry.getAttribute('position'), first = new Vector3(), second = new Vector3(), third = new Vector3();
  let volume = 0;
  for (let index = 0; index < positions.count; index += 3) {
    first.fromBufferAttribute(positions, index); second.fromBufferAttribute(positions, index + 1); third.fromBufferAttribute(positions, index + 2);
    volume += first.dot(second.cross(third)) / 6;
  }
  return volume;
}
describe('mechanical geometry parity', () => {
  it.each(fixtures)('$shape $diameter/$offset profiles match Python', fixture => {
    const points = profilePoints(fixture.shape, fixture.diameter, fixture.offset);
    expect(points).toHaveLength(fixture.points.length);
    points.forEach((point, index) => point.forEach((value, axis) => expect(value).toBeCloseTo(fixture.points[index][axis], 12)));
  });
  it.each(['round', 'square', 'triangle'] as const)('builds real hole surfaces and head dimensions: %s', shape => {
    const parameters = { ...DEFAULTS, width: 20, depth: 20, columns: 1, rows: 1, pinShape: shape, construction };
    const base = geometryFromMesh(buildMechanicalBase(parameters));
    base.computeBoundingBox();
    expect(base.boundingBox!.min.toArray()).toEqual([-10, -10, 0]);
    expect(base.boundingBox!.max.toArray()).toEqual([10, 10, 3]);
    const solid = solids.find(value => value.shape === shape)!;
    expect(signedVolume(base)).toBeCloseTo(solid.baseVolume, 4);
    const lower = createMechanicalPinGeometry(shape, 2, 0.4, 'bottom-head');
    const shaft = createMechanicalPinGeometry(shape, 2, 0.4, 'shaft');
    const upper = createMechanicalPinGeometry(shape, 2, 0.4, 'top-head');
    expect(signedVolume(lower) + signedVolume(upper) + signedVolume(shaft) * 12.2).toBeCloseTo(solid.pinVolume, 4);
    lower.dispose(); shaft.dispose(); upper.dispose();
    const head = createMechanicalPinGeometry(shape, 2, 0.4, 'top-head');
    head.computeBoundingBox();
    expect(head.boundingBox!.min.z).toBe(0); expect(head.boundingBox!.max.z).toBeCloseTo(0.4);
    const moved = head.clone().applyMatrix4(new Matrix4().makeTranslation(0, 0, 12.6)); moved.computeBoundingBox();
    expect(moved.boundingBox!.max.z).toBeCloseTo(13);
    base.dispose(); head.dispose(); moved.dispose();
  });
  it('keeps mixed rotated guides, concave outlines, original holes and disconnected regions closed', () => {
    const parameters = { ...DEFAULTS, width: 40, depth: 20, construction,
      layout: { edgePadding: 1, regions: [
        { outer: [[-20, -10], [-2, -10], [-2, 0], [-4, 0], [-4, 10], [-20, 10]] as [number, number][], holes: [[[-8, 3], [-8, 5], [-6, 5], [-6, 3]] as [number, number][]] },
        { outer: [[2, -10], [20, -10], [20, 10], [2, 10]] as [number, number][], holes: [] },
      ], pins: [{ id: 'left', x: -12, y: 0 }, { id: 'right', x: 12, y: 0 }] },
      pinGeometries: [{ shape: 'square' as const, rotation: 30 }, { shape: 'triangle' as const, rotation: 90 }] };
    const geometry = geometryFromMesh(buildMechanicalBase(parameters)), positions = geometry.getAttribute('position');
    const edges = new Map<string, { count: number; winding: number }>();
    for (let index = 0; index < positions.count; index += 3) {
      const corners = [0, 1, 2].map(offset => new Vector3().fromBufferAttribute(positions, index + offset).toArray().join(','));
      corners.forEach((point, offset) => {
        const next = corners[(offset + 1) % 3], key = [point, next].sort().join('|'), edge = edges.get(key) ?? { count: 0, winding: 0 };
        edge.count++; edge.winding += point < next ? 1 : -1; edges.set(key, edge);
      });
    }
    expect([...edges.values()].every(edge => edge.count === 2 && edge.winding === 0)).toBe(true);
    expect(signedVolume(geometry)).toBeGreaterThan(2000); geometry.dispose();
  });
  it('rejects invalid height edits and rechecks history against current mechanics', () => {
    const parameters = { ...DEFAULTS, columns: 1, rows: 1, construction };
    let state = createEditorState(1, parameters);
    state = editorReducer(state, { type: 'select', ids: [0], operation: 'replace' });
    state = editorReducer(state, { type: 'height', heights: new Float32Array([20]), value: 0.5, mode: 'set' });
    expect(state.overrides.size).toBe(0); expect(state.past).toHaveLength(0); expect(state.error).toMatch(/extension/);
    state = editorReducer(state, { type: 'height', heights: new Float32Array([20]), value: 1, mode: 'set' });
    state = editorReducer(state, { type: 'undo' });
    state = editorReducer(state, { type: 'generation', parameters: { ...parameters, thickness: 4, construction: { ...construction, sliding: { clearance: 0.4, headFlare: 0.6 } } } });
    state = editorReducer(state, { type: 'redo' });
    expect(state.overrides.size).toBe(0); expect(state.future).toHaveLength(1); expect(state.error).toMatch(/extension/);
  });
});
