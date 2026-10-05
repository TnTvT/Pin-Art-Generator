import { describe, expect, it } from 'vitest';
import { DEFAULTS } from '../pin-design/model';
import { DEFAULT_MODEL_MATERIALS, type MaterialSelection } from '../filaments/materials';
import { createEditorState, editorReducer, resolveDesign } from './model';

const parameters = { ...DEFAULTS, rows: 1, columns: 2 };
const white: MaterialSelection = { color: '#ffffff', filamentId: 'basic-77' };
const custom: MaterialSelection = { color: '#123456', filamentId: null };

describe('generated material baselines', () => {
  it('recolors the original generated group atomically without changing selection, heights or other groups', () => {
    const grid = { ...parameters, columns: 4 };
    let state = editorReducer(createEditorState(4), { type: 'generation', materials: [white, DEFAULT_MODEL_MATERIALS.pins, white, white], heights: new Float32Array([4, 8, 12, 16]) });
    state = editorReducer(state, { type: 'select', ids: [2], operation: 'replace' });
    state = editorReducer(state, { type: 'height', heights: resolveDesign(state, grid).heights, value: 40, mode: 'set' });
    state = editorReducer(state, { type: 'material', target: 'selection', material: DEFAULT_MODEL_MATERIALS.base });
    const before = state;
    state = editorReducer(state, { type: 'material-group', source: white, material: custom });
    expect(state.error).toBeNull();
    expect(state.selection).toBe(before.selection);
    expect(state.active).toBe(2);
    expect(state.base).toBe(before.base);
    expect(state.generatedMaterials).toBe(before.generatedMaterials);
    expect(state.past).toHaveLength(before.past.length + 1);
    expect(resolveDesign(state, grid).pinSelections).toEqual([custom, DEFAULT_MODEL_MATERIALS.pins, custom, custom]);
    expect([...resolveDesign(state, grid).heights]).toEqual([4, 8, 40, 16]);
    state = editorReducer(state, { type: 'undo' });
    expect(state.overrides).toEqual(before.overrides);
    state = editorReducer(state, { type: 'redo' });
    expect(resolveDesign(state, grid).pinSelections[2]).toEqual(custom);
    state = editorReducer(state, { type: 'material-group', source: white, material: DEFAULT_MODEL_MATERIALS.pins });
    expect(resolveDesign(state, grid).pinSelections).toEqual(Array(4).fill(DEFAULT_MODEL_MATERIALS.pins));
    expect([...resolveDesign(state, grid).heights]).toEqual([4, 8, 40, 16]);
  });
  it('distinguishes same-RGB generated groups with different profiles', () => {
    const basic: MaterialSelection = { color: '#ffffff', filamentId: 'basic-77' };
    const matte = { color: '#ffffff', filamentId: 'matte-321' };
    let state = editorReducer(createEditorState(2), { type: 'generation', materials: [basic, matte] });
    state = editorReducer(state, { type: 'material-group', source: basic, material: custom });
    expect(resolveDesign(state, parameters).pinSelections).toEqual([custom, matte]);
  });
  it('rejects a seventeenth material for an entire group without changing history', () => {
    const generated = [white, ...Array.from({ length: 15 }, (_, index) => ({ color: `#${(index + 1).toString(16).padStart(6, '0')}`, filamentId: null }))];
    let state = editorReducer(createEditorState(16), { type: 'material', target: 'base', material: white });
    state = editorReducer(state, { type: 'generation', materials: generated });
    const rejected = editorReducer(state, { type: 'material-group', source: white, material: custom });
    expect(rejected.error).toMatch(/16/);
    expect(rejected.overrides).toBe(state.overrides);
    expect(rejected.past).toBe(state.past);
  });
  it('rejects a stale or absent generated group', () => {
    const before = createEditorState(2);
    const rejected = editorReducer(before, { type: 'material-group', source: white, material: custom });
    expect(rejected.error).toMatch(/group/i);
    expect(rejected.overrides).toBe(before.overrides);
    expect(rejected.past).toHaveLength(0);
  });
  it('updates a 10,000-pin group in one reversible transaction', () => {
    let state = editorReducer(createEditorState(10000), { type: 'generation', materials: Array(10000).fill(white) });
    state = editorReducer(state, { type: 'material-group', source: white, material: custom });
    expect(state.overrides.size).toBe(10000);
    expect(state.past).toHaveLength(1);
    expect(state.past[0].deltas).toHaveLength(10000);
    state = editorReducer(state, { type: 'undo' });
    expect(state.overrides.size).toBe(0);
    expect(state.generatedMaterials?.[9999]).toEqual(white);
  });
  it('regenerates without history and restores to the latest generator, not the original colors', () => {
    let state = editorReducer(createEditorState(2), { type: 'generation', materials: [white, white] });
    state = editorReducer(state, { type: 'select', ids: [0], operation: 'replace' });
    state = editorReducer(state, { type: 'material', target: 'selection', material: custom });
    state = editorReducer(state, { type: 'generation', materials: [DEFAULT_MODEL_MATERIALS.pins, white] });
    expect(state.past).toHaveLength(1);
    expect(resolveDesign(state, parameters).pinSelections).toEqual([custom, white]);
    state = editorReducer(state, { type: 'reset', target: 'material' });
    expect(resolveDesign(state, parameters).pinSelections).toEqual([DEFAULT_MODEL_MATERIALS.pins, white]);
    state = editorReducer(state, { type: 'undo' });
    expect(resolveDesign(state, parameters).pinSelections[0]).toEqual(custom);
    state = editorReducer(state, { type: 'reset', target: 'all' });
    expect(state.base).toEqual(DEFAULT_MODEL_MATERIALS.base);
    expect(resolveDesign(state, parameters).pinSelections).toEqual([DEFAULT_MODEL_MATERIALS.pins, white]);
  });

  it('removing mapping leaves edits intact and removing edits restores defaults', () => {
    let state = editorReducer(createEditorState(2), { type: 'generation', materials: [white, white] });
    state = editorReducer(state, { type: 'select', ids: [0], operation: 'replace' });
    state = editorReducer(state, { type: 'material', target: 'selection', material: custom });
    state = editorReducer(state, { type: 'generation' });
    expect(resolveDesign(state, parameters).pinSelections).toEqual([custom, DEFAULT_MODEL_MATERIALS.pins]);
  });

  it('rejects invalid regeneration and undo/redo that exceed the current generator budget', () => {
    const materials = Array.from({ length: 15 }, (_, index) => ({ color: `#${(index + 1).toString(16).padStart(6, '0')}`, filamentId: null }));
    let state = createEditorState(16);
    state = editorReducer(state, { type: 'select', ids: [0], operation: 'replace' });
    state = editorReducer(state, { type: 'material', target: 'selection', material: custom });
    const baseline = [white, ...materials];
    state = editorReducer(state, { type: 'generation', materials: baseline });
    expect(state.error).toMatch(/16/);
    expect(state.generatedMaterials).toBeUndefined();
    state = editorReducer(state, { type: 'generation', materials: [DEFAULT_MODEL_MATERIALS.base, ...materials.slice(0, 14), DEFAULT_MODEL_MATERIALS.base] });
    expect(state.error).toBeNull();
    state = editorReducer(state, { type: 'undo' });
    expect(state.error).toBeNull();
    state = editorReducer(state, { type: 'generation', materials: [white, ...materials.slice(0, 14), white] });
    expect(state.error).toBeNull();
    const rejected = editorReducer(state, { type: 'redo' });
    expect(rejected.error).toMatch(/16/);
    expect(rejected.overrides).toBe(state.overrides);
    expect(rejected.future).toBe(state.future);
  });

  it('validates generator length and resets the generator on topology changes', () => {
    let state = editorReducer(createEditorState(2), { type: 'generation', materials: [white] });
    expect(state.error).toMatch(/grid/);
    state = editorReducer(state, { type: 'generation', materials: [white, white] });
    state = editorReducer(state, { type: 'topology', count: 4 });
    expect(state.generatedMaterials).toBeUndefined();
    expect(state.past).toHaveLength(0);
  });

  it('rejects undo of a base change when the latest generator already fills all 16 slots', () => {
    let state = createEditorState(16);
    state = editorReducer(state, { type: 'material', target: 'base', material: white });
    const materials = [white, ...Array.from({ length: 15 }, (_, index) => ({ color: `#${(index + 1).toString(16).padStart(6, '0')}`, filamentId: null }))];
    state = editorReducer(state, { type: 'generation', materials });
    expect(state.error).toBeNull();
    const rejected = editorReducer(state, { type: 'undo' });
    expect(rejected.error).toMatch(/16/);
    expect(rejected.base).toBe(state.base);
    expect(rejected.past).toBe(state.past);
  });
});
