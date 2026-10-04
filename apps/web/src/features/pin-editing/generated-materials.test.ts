import { describe, expect, it } from 'vitest';
import { DEFAULTS } from '../pin-design/model';
import { DEFAULT_MODEL_MATERIALS, type MaterialSelection } from '../filaments/materials';
import { createEditorState, editorReducer, resolveDesign } from './model';

const parameters = { ...DEFAULTS, rows: 1, columns: 2 };
const white: MaterialSelection = { color: '#ffffff', filamentId: 'basic-77' };
const custom: MaterialSelection = { color: '#123456', filamentId: null };

describe('generated material baselines', () => {
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
