import { describe, expect, it } from 'vitest';
import { DEFAULTS } from '../pin-design/model';
import { DEFAULT_MODEL_MATERIALS } from '../filaments/materials';
import { FILAMENT_CATALOG } from '../filaments/catalog';
import { buildExportRequest, DEFAULT_EXPORT_OPTIONS, validateExport } from './export-request';

describe('export request mapping', () => {
  it('rejects legacy and explicit layouts exceeding 5,000 pins', () => {
    const parameters = { ...DEFAULTS, columns: 100, rows: 51, width: 500, depth: 500 };
    expect(validateExport(parameters, undefined, DEFAULT_EXPORT_OPTIONS)).toMatch(/5,000/);
    const layout = { regions: [], edgePadding: 0, pins: Array.from({ length: 5001 }, (_, index) => ({ id: `pin:${index}`, x: index, y: 0 })) };
    expect(validateExport({ ...DEFAULTS, layout }, undefined, DEFAULT_EXPORT_OPTIONS)).toMatch(/5,000/);
  });
  it.each(['square', 'triangle'] as const)('sends %s size, rotation, real heights and materials without numeric validation rejecting the enum', pinShape => {
    const parameters = { ...DEFAULTS, columns: 2, rows: 1, pinShape, pinRotation: 360 };
    const request = buildExportRequest(parameters, new Float32Array([4, 30]), DEFAULT_MODEL_MATERIALS, DEFAULT_EXPORT_OPTIONS, '3mf');
    expect(request.parameters.pinShape).toBe(pinShape);
    expect(request.parameters.pinRotation).toBe(0);
    expect(request.parameters.diameter).toBe(2);
    expect(request.heights).toEqual([4, 30]);
    expect(request.pinMaterials).toEqual([1, 1]);
  });
  it('resolves uniform heights and material indices without sending images', () => {
    const request = buildExportRequest(DEFAULTS, undefined, DEFAULT_MODEL_MATERIALS, DEFAULT_EXPORT_OPTIONS, 'stl');
    expect(request).toEqual({
      format: 'stl', mode: 'fixed', parameters: DEFAULTS,
      pinGeometries: Array(320).fill({ shape: 'round', rotation: 0 }),
      heights: Array(320).fill(20), materials: ['#8e9089', '#00b1b7'],
      filamentProfiles: ['bambu-pla-basic', 'bambu-pla-basic'],
      baseMaterial: 0, pinMaterials: Array(320).fill(1),
      sliding: { clearance: 0.4, headFlare: 0.6 },
    });
  });

  it('copies row-major heights and parameters and deduplicates hex colors case-insensitively', () => {
    const parameters = { ...DEFAULTS, columns: 2, rows: 2 };
    const heights = new Float32Array([2, 8, 4, 20]);
    const request = buildExportRequest(parameters, heights, { base: { color: '#ABCDEF', filamentId: null }, pins: { color: '#abcdef', filamentId: null } }, DEFAULT_EXPORT_OPTIONS, '3mf');
    parameters.width = 5;
    heights[0] = 9;
    expect(request.parameters.width).toBe(120);
    expect(request.heights).toEqual([2, 8, 4, 20]);
    expect(request.materials).toEqual(['#abcdef']);
    expect(request.filamentProfiles).toEqual(['generic-pla']);
    expect(request.pinMaterials).toEqual([0, 0, 0, 0]);
  });

  it('deduplicates the same profile and RGB even when catalog product IDs differ', () => {
    const blueColors = FILAMENT_CATALOG.filter((filament) => filament.color === 'Blue' && filament.type === 'Basic');
    expect(blueColors).toHaveLength(2);
    const selections = blueColors.map((filament) => ({ color: filament.hex, filamentId: filament.id }));
    const request = buildExportRequest(DEFAULTS, undefined, { base: selections[0], pins: selections[1] }, DEFAULT_EXPORT_OPTIONS, '3mf');
    expect(request.materials).toEqual(['#0a2989']);
    expect(request.filamentProfiles).toEqual(['bambu-pla-basic']);
    expect(request.pinMaterials).toEqual(Array(320).fill(0));
  });

  it('rejects unknown catalog IDs and mismatched preset colors instead of substituting', () => {
    for (const filamentId of ['missing', FILAMENT_CATALOG[0].id]) {
      expect(() => buildExportRequest(DEFAULTS, undefined, { ...DEFAULT_MODEL_MATERIALS, base: { color: '#123456', filamentId } }, DEFAULT_EXPORT_OPTIONS, '3mf')).toThrow(/do not match/);
    }
  });
});

describe('print validation', () => {
  it('checks asymmetric polygon containment in the legacy path, not just total footprint size', () => {
    const parameters = { ...DEFAULTS, columns: 1, rows: 1, depth: 1.5, pinShape: 'triangle' as const };
    expect(validateExport(parameters, undefined, DEFAULT_EXPORT_OPTIONS, '3mf')).toMatch(/boundary/);
    expect(validateExport({ ...parameters, depth: 2 }, undefined, DEFAULT_EXPORT_OPTIONS, '3mf')).toBeNull();
  });
  it('uses actual square wall gaps rather than enclosing circles for guide mouths', () => {
    const parameters = { ...DEFAULTS, pinShape: 'square' as const, spacing: 3.4 };
    const options = { ...DEFAULT_EXPORT_OPTIONS, mode: 'print-in-place' as const };
    expect(validateExport(parameters, undefined, options, '3mf')).toBeNull();
    expect(validateExport({ ...parameters, pinRotation: 45 }, undefined, options, '3mf')).toMatch(/Guide walls/);
    expect(validateExport({ ...parameters, pinRotation: 361 }, undefined, options)).toMatch(/rotation/i);
  });
  it('blocks tangent fixed STL while retaining compatible tangent round 3MF', () => {
    const parameters = { ...DEFAULTS, spacing: 2 };
    expect(validateExport(parameters, undefined, DEFAULT_EXPORT_OPTIONS, 'stl')).toMatch(/positive gap/);
    expect(validateExport(parameters, undefined, DEFAULT_EXPORT_OPTIONS, '3mf')).toBeNull();
  });
  it('checks the X1C envelope only for 3MF and uses resolved rather than configured maximum heights', () => {
    const large = { ...DEFAULTS, width: 300 };
    expect(validateExport(large, undefined, DEFAULT_EXPORT_OPTIONS, '3mf')).toMatch(/X1C/);
    expect(validateExport(large, undefined, DEFAULT_EXPORT_OPTIONS, 'stl')).toBeNull();
    const tall = { ...DEFAULTS, extension: 250 };
    expect(validateExport(tall, undefined, DEFAULT_EXPORT_OPTIONS, '3mf')).toMatch(/250 mm/);
    expect(validateExport(tall, new Float32Array(320).fill(20), DEFAULT_EXPORT_OPTIONS, '3mf')).toBeNull();
    expect(() => buildExportRequest(large, undefined, DEFAULT_MODEL_MATERIALS, DEFAULT_EXPORT_OPTIONS, '3mf')).toThrow(/X1C/);
  });
  it('blocks overlap and a grid outside the base', () => {
    expect(validateExport({ ...DEFAULTS, spacing: 1 }, undefined, DEFAULT_EXPORT_OPTIONS)).toMatch(/overlap/i);
    expect(validateExport({ ...DEFAULTS, width: 50 }, undefined, DEFAULT_EXPORT_OPTIONS)).toMatch(/beyond the base/i);
  });

  it('allows manual heights above generation and exports per-pin materials', () => {
    const parameters = { ...DEFAULTS, columns: 2, rows: 1 };
    const pins = [{ color: '#ff0000', filamentId: null }, { color: '#ffffff', filamentId: 'matte-321' }];
    const request = buildExportRequest(parameters, new Float32Array([30, 40]), DEFAULT_MODEL_MATERIALS, DEFAULT_EXPORT_OPTIONS, '3mf', pins);
    expect(request.heights).toEqual([30, 40]);
    expect(request.materials).toEqual(['#8e9089', '#ff0000', '#ffffff']);
    expect(request.pinMaterials).toEqual([1, 2]);
    expect(request.filamentProfiles).toEqual(['bambu-pla-basic', 'generic-pla', 'bambu-pla-matte']);
  });

  it('rejects missing, non-finite or nonpositive resolved heights', () => {
    for (const heights of [new Float32Array(1), new Float32Array(320), new Float32Array(320).fill(NaN)]) {
      expect(validateExport(DEFAULTS, heights, DEFAULT_EXPORT_OPTIONS)).toMatch(/heights/i);
    }
  });

  it('validates guides, heads and mouth walls for print-in-place', () => {
    const options = { ...DEFAULT_EXPORT_OPTIONS, mode: 'print-in-place' as const };
    expect(validateExport(DEFAULTS, undefined, options)).toBeNull();
    expect(validateExport({ ...DEFAULTS, thickness: 1.5 }, undefined, options)).toMatch(/Guide thickness/);
    expect(validateExport({ ...DEFAULTS, spacing: 3.3 }, undefined, options)).toMatch(/wall/i);
    expect(validateExport({ ...DEFAULTS, thickness: 0.5 }, undefined, DEFAULT_EXPORT_OPTIONS)).toBeNull();
  });
  it('requires print-in-place 3MF margins but keeps STL printer-independent', () => {
    const options = { ...DEFAULT_EXPORT_OPTIONS, mode: 'print-in-place' as const };
    const large = { ...DEFAULTS, width: 247 };
    expect(validateExport(large, undefined, options, '3mf')).toMatch(/5 mm/);
    expect(validateExport(large, undefined, options, 'stl')).toBeNull();
    const request = buildExportRequest(DEFAULTS, undefined, DEFAULT_MODEL_MATERIALS, options, '3mf');
    expect(request.sliding).toEqual({ clearance: 0.4, headFlare: 0.6 });
    expect(request.parameters).not.toHaveProperty('construction');
    expect(request).not.toHaveProperty('socket');
    expect(request).not.toHaveProperty('plate');
  });
});
