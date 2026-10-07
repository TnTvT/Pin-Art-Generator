import { describe, expect, it } from 'vitest';
import { FILAMENT_CATALOG, getFilament } from '../filaments/catalog';
import { DEFAULT_MODEL_MATERIALS, materialKey } from '../filaments/materials';
import { mapPinColors, paletteCandidates, type ColorMappingRequest } from './color-mapping';

const white = getFilament('basic-77')!;
const turquoise = getFilament('basic-903')!;
const matteWhite = FILAMENT_CATALOG.find(filament => filament.type === 'Matte' && filament.hex === '#FFFFFF')!;
const rgb = (...ids: string[]) => new Uint8Array(ids.flatMap(id => [...getFilament(id)!.rgb]));
const request = (changes: Partial<ColorMappingRequest> = {}): ColorMappingRequest => ({
  rgb: rgb(white.id, turquoise.id), source: 'auto', family: 'both', maximum: 4,
  filamentIds: [white.id, turquoise.id], base: DEFAULT_MODEL_MATERIALS.base, overrides: [], ...changes,
});

describe('preset image color mapping', () => {
  it('does not waste a four-material palette on an intermediate color when four exact presets fit', () => {
    const red = FILAMENT_CATALOG.find(filament => filament.type === 'Basic' && filament.hex === '#C12E1F')!;
    const blue = FILAMENT_CATALOG.find(filament => filament.code === '10600')!;
    const ids = [white.id, turquoise.id, red.id, blue.id];
    const result = mapPinColors(request({ rgb: rgb(...ids) }));
    expect(result.materials.map(material => material.color)).toEqual(ids.map(id => getFilament(id)!.hex.toLowerCase()));
  });
  it('maps 5,000 distinct pin samples within the material budget', () => {
    const samples = new Uint8Array(15000);
    for (let index = 0; index < 5000; index++) samples.set([(index * 17) % 256, Math.floor(index / 256), (index * 31) % 256], index * 3);
    const start = performance.now();
    const result = mapPinColors(request({ rgb: samples }));
    console.info(`5,000-pin preset matching: ${Math.round(performance.now() - start)} ms`);
    expect(result.materials).toHaveLength(5000);
    expect(result.palette.length).toBeLessThanOrEqual(4);
    expect(result.palette.reduce((total, entry) => total + entry.count, 0)).toBe(5000);
  });
  it('matches exact and nearby colors to actual catalog materials', () => {
    const result = mapPinColors(request({ source: 'manual', rgb: new Uint8Array([...white.rgb, 1, 176, 184]) }));
    expect(result.materials.map(material => material.filamentId)).toEqual([white.id, turquoise.id]);
    expect(result.palette.map(entry => entry.count)).toEqual([1, 1]);
  });

  it('deduplicates same RGB/profile but keeps Basic and Matte distinct with a stable tie', () => {
    const candidates = paletteCandidates('both');
    expect(new Set(candidates.map(filament => materialKey({ color: filament.hex, filamentId: filament.id }))).size).toBe(candidates.length);
    const whites = candidates.filter(filament => filament.hex.toLowerCase() === '#ffffff');
    expect(whites.map(filament => filament.type)).toEqual(['Basic', 'Matte']);
    expect(mapPinColors(request({ source: 'manual', filamentIds: [matteWhite.id, white.id], rgb: rgb(white.id) })).materials[0].filamentId).toBe(white.id);
    expect(mapPinColors(request({ source: 'manual', filamentIds: [matteWhite.id], rgb: rgb(white.id) })).materials[0].filamentId).toBe(matteWhite.id);
  });

  it('greedily picks a bounded deterministic palette and honors the family', () => {
    const input = request({ maximum: 2 });
    expect(mapPinColors(input)).toEqual(mapPinColors(input));
    expect(mapPinColors(input).materials.map(material => material.filamentId)).toEqual([white.id, turquoise.id]);
    expect(mapPinColors(request({ maximum: 1 })).palette).toHaveLength(1);
    expect(mapPinColors(request({ family: 'matte' })).materials.every(material => getFilament(material.filamentId!)!.type === 'Matte')).toBe(true);
  });

  it('reserves base/manual slots and excludes overridden pins from optimization', () => {
    const overrides = Array.from({ length: 14 }, (_, index) => ({ index, material: { color: `#${index.toString(16).padStart(6, '0')}`, filamentId: null } }));
    const input = request({ rgb: new Uint8Array([...rgb(...Array(14).fill(white.id)), ...rgb(turquoise.id, turquoise.id)]), overrides });
    const result = mapPinColors(input);
    expect(result.palette).toHaveLength(1);
    expect(result.materials[14].filamentId).toBe(turquoise.id);
    expect(result.notice).toMatch(/16/);
  });

  it('does not silently trim a self-selected palette and validates actual used materials', () => {
    const overrides = Array.from({ length: 15 }, (_, index) => ({ index, material: { color: `#${index.toString(16).padStart(6, '0')}`, filamentId: null } }));
    expect(() => mapPinColors(request({ source: 'manual', rgb: rgb(...Array(15).fill(white.id), turquoise.id), overrides }))).toThrow(/16/);
    expect(() => mapPinColors(request({ source: 'manual', filamentIds: [] }))).toThrow(/Choose at least/);
    expect(() => mapPinColors(request({ source: 'manual', filamentIds: ['missing'] }))).toThrow(/Unknown/);
    expect(() => mapPinColors(request({ maximum: 17 }))).toThrow(/1.*16/);
  });

  it('still maps all pins when every generated color is hidden by manual overrides', () => {
    const result = mapPinColors(request({ overrides: [0, 1].map(index => ({ index, material: DEFAULT_MODEL_MATERIALS.base })) }));
    expect(result.materials).toHaveLength(2);
    expect(result.materials.every(material => material.filamentId !== null)).toBe(true);
  });
});
