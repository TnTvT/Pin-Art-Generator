import { describe, expect, it } from 'vitest';
import { DEFAULTS } from '../pin-design/model';
import { createEditorState, editorReducer, resolveDesign } from './model';
import { DEFAULT_CONSTRUCTION } from '../mechanics/model';

const parameters = { ...DEFAULTS, columns: 2, rows: 1 };
function selected() {
  return editorReducer(createEditorState(2, parameters), { type: 'select', ids: [0], operation: 'replace' });
}
describe('transactional per-pin geometry', () => {
  it('rejects Triangle edits and history restoration in print-in-place atomically', () => {
    const movable = { ...parameters, spacing: 6, construction: { ...DEFAULT_CONSTRUCTION, mode: 'print-in-place' as const } };
    const initial = editorReducer(createEditorState(2, movable), { type: 'select', ids: [0], operation: 'replace' });
    const rejected = editorReducer(initial, { type: 'geometry', geometry: { shape: 'triangle', rotation: 0 } });
    expect(rejected.error).toMatch(/Triangle.*Fixed sculpture/);
    expect(rejected.overrides).toBe(initial.overrides);
    expect(rejected.past).toBe(initial.past);
    let edited = editorReducer(selected(), { type: 'geometry', geometry: { shape: 'triangle', rotation: 0 } });
    edited = editorReducer(edited, { type: 'geometry', geometry: { shape: 'round', rotation: 0 } });
    edited = editorReducer(edited, { type: 'generation', parameters: movable });
    const undone = editorReducer(edited, { type: 'undo' });
    expect(undone.error).toMatch(/Triangle.*Fixed sculpture/);
    expect(undone.overrides).toBe(edited.overrides);
    expect(undone.past).toBe(edited.past);
  });
  it('changes only selected geometry, preserving height/material and explicit default-equal overrides', () => {
    let state = editorReducer(selected(), { type: 'height', heights: new Float32Array([20, 20]), value: 30, mode: 'set' });
    state = editorReducer(state, { type: 'geometry', geometry: { shape: 'square', rotation: 45 } });
    expect(resolveDesign(state, parameters).pinGeometries).toEqual([{ shape: 'square', rotation: 45 }, { shape: 'round', rotation: 0 }]);
    expect(resolveDesign(state, parameters).heights[0]).toBe(30);
    state = editorReducer(state, { type: 'geometry', geometry: { shape: 'round', rotation: 0 } });
    expect(state.overrides.get(0)?.geometry).toEqual({ shape: 'round', rotation: 0 });
    expect(resolveDesign(state, { ...parameters, pinShape: 'triangle' }).pinGeometries.map(value => value.shape)).toEqual(['round', 'triangle']);
  });
  it('restores only geometry and undoes/redoes/reset all in one transaction', () => {
    let state = editorReducer(selected(), { type: 'geometry', geometry: { shape: 'triangle', rotation: 360 } });
    expect(state.overrides.get(0)?.geometry?.rotation).toBe(0);
    const applied = state;
    state = editorReducer(state, { type: 'reset', target: 'geometry' });
    expect(state.overrides.size).toBe(0);
    state = editorReducer(state, { type: 'undo' });
    expect(resolveDesign(state, parameters).pinGeometries[0].shape).toBe('triangle');
    expect(editorReducer(state, { type: 'redo' }).overrides.size).toBe(0);
    expect(editorReducer(applied, { type: 'reset', target: 'all' }).overrides.size).toBe(0);
  });
  it('rejects invalid angles and boundary batches without touching history or selection', () => {
    const input = { ...parameters, width: 3, columns: 1, diameter: 4, pinShape: 'square' as const };
    const state = editorReducer(createEditorState(1, input), { type: 'select', ids: [0], operation: 'replace' });
    const invalid = editorReducer(state, { type: 'geometry', geometry: { shape: 'round', rotation: 0 } });
    expect(invalid.error).toMatch(/padding/);
    expect(invalid.overrides).toBe(state.overrides);
    expect(invalid.past).toBe(state.past);
    expect(editorReducer(state, { type: 'geometry', geometry: { shape: 'square', rotation: NaN } }).error).toMatch(/rotation/);
  });
  it('revalidates history against updated size and defaults without advancing the cursor', () => {
    let state = editorReducer(createEditorState(1, { ...parameters, width: 3, columns: 1, diameter: 2, pinShape: 'square' }), { type: 'select', ids: [0], operation: 'replace' });
    state = editorReducer(state, { type: 'geometry', geometry: { shape: 'round', rotation: 0 } });
    state = editorReducer(state, { type: 'undo' });
    state = editorReducer(state, { type: 'generation', parameters: { ...parameters, width: 3, columns: 1, diameter: 4, pinShape: 'square' } });
    const rejected = editorReducer(state, { type: 'redo' });
    expect(rejected.error).toMatch(/padding/);
    expect(rejected.future).toBe(state.future);
    expect(rejected.overrides).toBe(state.overrides);
  });
  it('rejects reset-all when it would restore overlapping defaults', () => {
    const input = { ...parameters, spacing: 1.5 };
    let state = editorReducer(createEditorState(2, input), { type: 'select', ids: [0, 1], operation: 'replace' });
    state = editorReducer(state, { type: 'geometry', geometry: { shape: 'square', rotation: 0 } });
    expect(state.error).toBeNull();
    const rejected = editorReducer(state, { type: 'reset', target: 'all' });
    expect(rejected.error).toMatch(/overlap/);
    expect(rejected.overrides).toBe(state.overrides);
    expect(rejected.past).toBe(state.past);
  });
});
