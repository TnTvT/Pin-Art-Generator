import { describe, expect, it } from 'vitest';
import { DEFAULTS } from '../pin-design/model';
import { DEFAULT_MODEL_MATERIALS } from '../filaments/materials';
import { buildExportRequest, DEFAULT_EXPORT_OPTIONS, validateExport } from './export-request';
import { PRINTER_PROFILES, type PrinterId } from './printer-profiles';
import fixtureData from '../../../../../fixtures/printer-profiles.json?raw';

const u1 = { ...DEFAULT_EXPORT_OPTIONS, printer: 'snapmaker-u1' as const };

describe('printer export selection', () => {
  it('agrees with the backend printer envelope and material budget fixtures', () => {
    const fixtures = JSON.parse(fixtureData) as { id: PrinterId; width: number; depth: number; height: number; maxMaterials: number }[];
    for (const { id, width, depth, height, maxMaterials } of fixtures) {
      expect(PRINTER_PROFILES[id]).toMatchObject({ width, depth, height, maxMaterials });
    }
  });
  it('accepts the U1 envelope without changing design or STL limits', () => {
    const parameters = { ...DEFAULTS, width: 270, depth: 270, extension: 267 };
    expect(validateExport(parameters, undefined, u1, '3mf')).toBeNull();
    expect(validateExport(parameters, undefined, DEFAULT_EXPORT_OPTIONS, '3mf')).toMatch(/X1C/);
    expect(validateExport({ ...parameters, width: 271 }, undefined, u1, '3mf')).toMatch(/270 × 270/);
    expect(validateExport({ ...parameters, extension: 268 }, undefined, u1, '3mf')).toMatch(/270 mm/);
    expect(validateExport({ ...parameters, width: 500, extension: 400 }, undefined, u1, 'stl')).toBeNull();
    const request = buildExportRequest(parameters, undefined, DEFAULT_MODEL_MATERIALS, u1, '3mf');
    expect(request.printer).toBe('snapmaker-u1');
    expect(request.parameters).toEqual(parameters);
    expect(request.materials).toEqual(['#8e9089', '#00b1b7']);
    expect(request.filamentProfiles).toEqual(['bambu-pla-basic', 'bambu-pla-basic']);
  });

  it('includes the base in the U1 four-material budget and deduplicates actual pairs', () => {
    const parameters = { ...DEFAULTS, columns: 4, rows: 1 };
    const pins = ['#111111', '#222222', '#333333', '#444444'].map(color => ({ color, filamentId: null }));
    expect(() => buildExportRequest(parameters, undefined, DEFAULT_MODEL_MATERIALS, u1, '3mf', pins)).toThrow(/4.*including the base/);
    expect(buildExportRequest(parameters, undefined, DEFAULT_MODEL_MATERIALS, u1, 'stl', pins).materials).toHaveLength(5);
    pins[3] = { ...pins[2] };
    expect(buildExportRequest(parameters, undefined, DEFAULT_MODEL_MATERIALS, u1, '3mf', pins).materials).toHaveLength(4);
  });

  it('uses 5 mm margins only in print-in-place 3MF', () => {
    const options = { ...u1, mode: 'print-in-place' as const };
    expect(validateExport({ ...DEFAULTS, width: 260, depth: 260 }, undefined, options, '3mf')).toBeNull();
    expect(validateExport({ ...DEFAULTS, width: 261 }, undefined, options, '3mf')).toMatch(/5 mm margins/);
  });
});
