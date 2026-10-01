import { describe, expect, it } from 'vitest';
import { DEFAULTS, DEFAULT_MODEL_COLORS } from '../pin-design/model';
import { buildExportRequest, DEFAULT_EXPORT_OPTIONS, validateExport } from './export-request';

describe('export request mapping', () => {
  it('resolves uniform heights and material indices without sending images', () => {
    const request = buildExportRequest(DEFAULTS, undefined, DEFAULT_MODEL_COLORS, DEFAULT_EXPORT_OPTIONS, 'stl');
    expect(request).toEqual({
      format: 'stl', mode: 'fixed', parameters: DEFAULTS,
      heights: Array(320).fill(20), materials: ['#5b6b78', '#2dada3'],
      baseMaterial: 0, pinMaterials: Array(320).fill(1),
      socket: { insertionDepth: 2, clearance: 0.2 }, plate: { width: 256, depth: 256 },
    });
  });

  it('copies row-major heights and parameters and deduplicates hex colors case-insensitively', () => {
    const parameters = { ...DEFAULTS, columns: 2, rows: 2 };
    const heights = new Float32Array([2, 8, 4, 20]);
    const request = buildExportRequest(parameters, heights, { base: '#ABCDEF', pins: '#abcdef' }, DEFAULT_EXPORT_OPTIONS, '3mf');
    parameters.width = 5;
    heights[0] = 9;
    expect(request.parameters.width).toBe(120);
    expect(request.heights).toEqual([2, 8, 4, 20]);
    expect(request.materials).toEqual(['#abcdef']);
    expect(request.pinMaterials).toEqual([0, 0, 0, 0]);
  });
});

describe('print validation', () => {
  it('blocks overlap and a grid outside the base', () => {
    expect(validateExport({ ...DEFAULTS, spacing: 1 }, undefined, DEFAULT_EXPORT_OPTIONS)).toMatch(/overlap/i);
    expect(validateExport({ ...DEFAULTS, width: 50 }, undefined, DEFAULT_EXPORT_OPTIONS)).toMatch(/beyond the base/i);
  });

  it('rejects missing, non-finite, nonpositive or out-of-range resolved heights', () => {
    for (const heights of [new Float32Array(1), new Float32Array(320), new Float32Array(320).fill(NaN), new Float32Array(320).fill(21)]) {
      expect(validateExport(DEFAULTS, heights, DEFAULT_EXPORT_OPTIONS)).toMatch(/heights/i);
    }
  });

  it('validates detachable floor, socket walls and outer edges only in detachable mode', () => {
    const options = { ...DEFAULT_EXPORT_OPTIONS, mode: 'detachable' as const };
    expect(validateExport(DEFAULTS, undefined, options)).toBeNull();
    expect(validateExport({ ...DEFAULTS, thickness: 2.9 }, undefined, options)).toMatch(/floor/i);
    expect(validateExport({ ...DEFAULTS, spacing: 2.9 }, undefined, options)).toMatch(/wall/i);
    expect(validateExport({ ...DEFAULTS, spacing: 3 }, undefined, options)).toBeNull();
    expect(validateExport({ ...DEFAULTS, width: 98 }, undefined, options)).toMatch(/edge/i);
    expect(validateExport({ ...DEFAULTS, thickness: 0.5 }, undefined, DEFAULT_EXPORT_OPTIONS)).toBeNull();
  });

  it('requires a 5 mm bed margin only for detachable models', () => {
    const options = { ...DEFAULT_EXPORT_OPTIONS, plate: { width: 129, depth: 256 } };
    expect(validateExport(DEFAULTS, undefined, options)).toBeNull();
    expect(validateExport(DEFAULTS, undefined, { ...options, mode: 'detachable' })).toMatch(/5 mm/i);
    expect(validateExport(DEFAULTS, undefined, { ...options, mode: 'detachable', plate: { width: 130, depth: 110 } })).toBeNull();
    const large = { ...DEFAULTS, columns: 100, rows: 100, width: 500, depth: 500 };
    expect(validateExport(large, undefined, DEFAULT_EXPORT_OPTIONS)).toBeNull();
  });

  it('leaves automatic plate packing and the 36-plate limit to the server', () => {
    const parameters = { ...DEFAULTS, columns: 6, rows: 6, width: 5.61, depth: 5.61, diameter: 0.001, spacing: 0.801 };
    const options = { ...DEFAULT_EXPORT_OPTIONS, mode: 'detachable' as const, socket: { insertionDepth: 2, clearance: 0 }, plate: { width: 15.61, depth: 15.61 } };
    expect(validateExport(parameters, undefined, options)).toBeNull();
  });
});
