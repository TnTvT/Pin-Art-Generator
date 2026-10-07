import { describe, expect, it } from 'vitest';
import { DEFAULTS } from '../pin-design/model';
import { DEFAULT_MODEL_MATERIALS } from '../filaments/materials';
import { buildExportRequest, DEFAULT_EXPORT_OPTIONS, validateExport } from '../export/export-request';
import { DEFAULT_SHAPE, generateLayout } from './layout';
import { createEditorState, editorReducer, hasPinEdits } from '../pin-editing/model';

describe('shape export snapshots', () => {
  it('keeps explicit layout cross-sections in the export contract', () => {
    const input = { ...DEFAULTS, pinShape: 'triangle' as const, pinRotation: 30 };
    const parameters = { ...input, ...generateLayout(input, DEFAULT_SHAPE) };
    const request = buildExportRequest(parameters, undefined, DEFAULT_MODEL_MATERIALS, DEFAULT_EXPORT_OPTIONS, '3mf');
    expect(request.parameters.pinShape).toBe('triangle');
    expect(request.parameters.pinRotation).toBe(30);
    expect(request.layout?.pins).toEqual(parameters.layout.pins);
  });
  it.each(['rectangle', 'rounded', 'circle', 'ellipse'] as const)('sends explicit %s geometry without legacy counts or image metadata', preset => {
    const parameters = { ...DEFAULTS, ...generateLayout(DEFAULTS, { ...DEFAULT_SHAPE, preset }) };
    parameters.layout.imageBounds = [0, 0, 100, 100];
    const request = buildExportRequest(parameters, undefined, DEFAULT_MODEL_MATERIALS, DEFAULT_EXPORT_OPTIONS, '3mf');
    expect(request.parameters).not.toHaveProperty('columns');
    expect(request.parameters).not.toHaveProperty('rows');
    expect(request.parameters).not.toHaveProperty('layout');
    expect(request.layout).not.toHaveProperty('imageBounds');
    expect(request.heights).toHaveLength(parameters.layout.pins.length);
    expect(request.pinMaterials).toHaveLength(parameters.layout.pins.length);
    expect(request.layout?.pins).toEqual(parameters.layout.pins);
  });
  it('validates guide walls against actual curved boundaries', () => {
    const parameters = { ...DEFAULTS, ...generateLayout(DEFAULTS, { ...DEFAULT_SHAPE, preset: 'circle', padding: 0 }) };
    expect(validateExport(parameters, undefined, { ...DEFAULT_EXPORT_OPTIONS, mode: 'print-in-place' })).toMatch(/edge wall/);
  });
  it('checks actual guide neighbours rather than the spacing of absent grid positions', () => {
    const parameters = { ...DEFAULTS, spacing: 2, ...generateLayout({ ...DEFAULTS, spacing: 2 }, DEFAULT_SHAPE) };
    parameters.layout.pins = [{ id: 'g:0:-10', x: -20, y: 0 }, { id: 'g:0:10', x: 20, y: 0 }];
    const options = { ...DEFAULT_EXPORT_OPTIONS, mode: 'print-in-place' as const };
    expect(validateExport(parameters, undefined, options, '3mf')).toBeNull();
    parameters.layout.pins[1] = { id: 'g:0:-9', x: -18, y: 0 };
    expect(validateExport(parameters, undefined, options, '3mf')).toMatch(/Guide walls/);
  });
  it('requires confirmation for historical pin edits even after undo, but not base-only changes', () => {
    let state = createEditorState(2);
    state = editorReducer(state, { type: 'material', target: 'base', material: { color: '#ffffff', filamentId: null } });
    expect(hasPinEdits(state)).toBe(false);
    state = editorReducer(state, { type: 'select', ids: [0], operation: 'replace' });
    state = editorReducer(state, { type: 'height', heights: new Float32Array([20,20]), value: 30, mode: 'set' });
    state = editorReducer(state, { type: 'undo' });
    expect(state.overrides.size).toBe(0);
    expect(hasPinEdits(state)).toBe(true);
  });
});
