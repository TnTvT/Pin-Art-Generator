import { describe, expect, it } from 'vitest';
import { DEFAULTS } from '../pin-design/model';
import { createEditorState, editorReducer, resolveDesign } from './model';

const parameters = { ...DEFAULTS, columns: 2, rows: 2 };
const generated = new Float32Array([5, 10, 15, 20]);
const selected = () => editorReducer(createEditorState(4), { type: 'select', ids: [0, 1], operation: 'replace' });

describe('pin editing transactions', () => {
  it('enforces the encoded delta memory budget for dense editing histories', () => {
    let state = createEditorState(10000);
    state = editorReducer(state, { type: 'select', ids: Array.from({ length: 10000 }, (_, index) => index), operation: 'replace' });
    const heights = new Float32Array(10000).fill(20);
    for (let value = 1; value <= 35; value++) state = editorReducer(state, { type: 'height', heights, value, mode: 'set' });
    expect(state.historyBytes).toBeLessThanOrEqual(16 * 1024 * 1024);
    expect(state.past.length).toBeLessThan(35);
    expect(state.overrides.size).toBe(10000);
  });

  it('rejects overflow, underflow and invalid colors without replacing valid edits', () => {
    for (const value of [Number.MAX_VALUE, Number.MIN_VALUE, 0]) {
      expect(editorReducer(selected(), { type: 'height', heights: generated, value, mode: 'set' }).error).toBeTruthy();
    }
    expect(editorReducer(selected(), { type: 'material', target: 'selection', material: { color: '#12', filamentId: null } }).overrides.size).toBe(0);
  });

  it('does not create history for identical edits or empty selections', () => {
    let state = editorReducer(selected(), { type: 'height', heights: generated, value: 20, mode: 'set' });
    state = editorReducer(state, { type: 'height', heights: generated, value: 20, mode: 'set' });
    expect(state.past).toHaveLength(1);
    state = editorReducer(state, { type: 'select', ids: [], operation: 'replace' });
    expect(editorReducer(state, { type: 'reset', target: 'height' }).past).toHaveLength(1);
  });

  it('rejects a color restore that would introduce a seventeenth material', () => {
    let state = createEditorState(17);
    state = editorReducer(state, { type: 'select', ids: Array.from({ length: 17 }, (_, index) => index), operation: 'replace' });
    state = editorReducer(state, { type: 'material', target: 'selection', material: { color: '#ffffff', filamentId: null } });
    for (let index = 0; index < 14; index++) {
      state = editorReducer(state, { type: 'select', ids: [index], operation: 'replace' });
      state = editorReducer(state, { type: 'material', target: 'selection', material: { color: `#${index.toString(16).padStart(6, '0')}`, filamentId: null } });
    }
    state = editorReducer(state, { type: 'select', ids: [16], operation: 'replace' });
    const restored = editorReducer(state, { type: 'reset', target: 'material' });
    expect(restored.error).toMatch(/16/);
    expect(restored.overrides).toBe(state.overrides);
  });
  it('sets and offsets only selected heights, using resolved rather than generated values', () => {
    let state = editorReducer(selected(), { type: 'height', heights: generated, value: 2, mode: 'offset' });
    expect(Array.from(resolveDesign(state, parameters, generated).heights)).toEqual([7, 12, 15, 20]);
    state = editorReducer(state, { type: 'height', heights: resolveDesign(state, parameters, generated).heights, value: 30, mode: 'set' });
    expect(Array.from(resolveDesign(state, parameters, generated).heights)).toEqual([30, 30, 15, 20]);
    expect(state.past).toHaveLength(2);
    state = editorReducer(state, { type: 'undo' });
    expect(Array.from(resolveDesign(state, parameters, generated).heights)).toEqual([7, 12, 15, 20]);
    expect(editorReducer(state, { type: 'redo' }).past).toHaveLength(2);
  });

  it('rejects invalid batches without clamping, mutation, or history', () => {
    for (const value of [-5, NaN, Infinity, -Infinity]) {
      const state = editorReducer(selected(), { type: 'height', heights: generated, value, mode: 'offset' });
      expect(state.error).toBeTruthy();
      expect(state.overrides.size).toBe(0);
      expect(state.past).toHaveLength(0);
    }
  });

  it('keeps manual overrides through regeneration and resets to the latest generator', () => {
    let state = editorReducer(selected(), { type: 'height', heights: generated, value: 25, mode: 'set' });
    const next = new Float32Array([1, 2, 3, 4]);
    expect(Array.from(resolveDesign(state, parameters, next).heights)).toEqual([25, 25, 3, 4]);
    state = editorReducer(state, { type: 'reset', target: 'height' });
    expect(Array.from(resolveDesign(state, parameters, next).heights)).toEqual([1, 2, 3, 4]);
    state = editorReducer(state, { type: 'undo' });
    expect(Array.from(resolveDesign(state, parameters, next).heights)).toEqual([25, 25, 3, 4]);
  });

  it('toggles selection, retains active identity, and excludes it from history', () => {
    let state = editorReducer(selected(), { type: 'select', ids: [1, 3], operation: 'toggle' });
    expect([...state.selection]).toEqual([0, 3]);
    expect(state.active).toBe(3);
    expect(state.past).toHaveLength(0);
    state = editorReducer(state, { type: 'topology', count: 1 });
    expect(state.selection.size).toBe(0);
    expect(state.count).toBe(1);
  });

  it('paints only the selected pins and restores colors independently from heights', () => {
    let state = editorReducer(selected(), { type: 'height', heights: generated, value: 30, mode: 'set' });
    state = editorReducer(state, { type: 'material', material: { color: '#ff0000', filamentId: null }, target: 'selection' });
    expect(resolveDesign(state, parameters, generated).pinSelections.map(material => material.color)).toEqual(['#ff0000', '#ff0000', '#00b1b7', '#00b1b7']);
    state = editorReducer(state, { type: 'reset', target: 'material' });
    expect(Array.from(resolveDesign(state, parameters, generated).heights)).toEqual([30, 30, 15, 20]);
    expect(resolveDesign(state, parameters, generated).pinSelections[0]).toEqual({ color: '#00b1b7', filamentId: 'basic-903' });
  });

  it('rejects a seventeenth used material including the base and drops replaced materials', () => {
    let state = createEditorState(16);
    for (let index = 0; index < 14; index++) {
      state = editorReducer(state, { type: 'select', ids: [index], operation: 'replace' });
      state = editorReducer(state, { type: 'material', material: { color: `#${index.toString(16).padStart(6, '0')}`, filamentId: null }, target: 'selection' });
    }
    state = editorReducer(state, { type: 'select', ids: [15], operation: 'replace' });
    const rejected = editorReducer(state, { type: 'material', material: { color: '#ffffff', filamentId: null }, target: 'selection' });
    expect(rejected.error).toMatch(/16/);
    expect(rejected.overrides).toBe(state.overrides);
    state = editorReducer(state, { type: 'select', ids: [0], operation: 'replace' });
    expect(editorReducer(state, { type: 'material', material: { color: '#ffffff', filamentId: null }, target: 'selection' }).error).toBeNull();
  });

  it('bounds history, clears redo on edits, and resets topology without changing the base', () => {
    let state = editorReducer(selected(), { type: 'material', target: 'base', material: { color: '#ffffff', filamentId: null } });
    for (let index = 1; index < 60; index++) state = editorReducer(state, { type: 'height', heights: generated, value: index, mode: 'set' });
    expect(state.past).toHaveLength(50);
    expect(state.historyBytes).toBeLessThanOrEqual(16 * 1024 * 1024);
    state = editorReducer(state, { type: 'undo' });
    expect(state.future).toHaveLength(1);
    state = editorReducer(state, { type: 'height', heights: generated, value: 99, mode: 'set' });
    expect(state.future).toHaveLength(0);
    state = editorReducer(state, { type: 'topology', count: 8 });
    expect(state.base.color).toBe('#ffffff');
    expect(state.past).toHaveLength(0);
    expect(state.overrides.size).toBe(0);
  });
});
