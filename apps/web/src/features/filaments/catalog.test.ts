import { describe, expect, it } from 'vitest';
import { FILAMENT_CATALOG, CATALOG_CAPTURED_ON, getFilament } from './catalog';

describe('bundled Bambu PLA catalog', () => {
  it('retains every entry from the two source pages and stable identities', () => {
    expect(CATALOG_CAPTURED_ON).toBe('2026-09-30');
    expect(FILAMENT_CATALOG.filter((filament) => filament.type === 'Basic')).toHaveLength(32);
    expect(FILAMENT_CATALOG.filter((filament) => filament.type === 'Matte')).toHaveLength(25);
    expect(new Set(FILAMENT_CATALOG.map((filament) => filament.id)).size).toBe(57);
    const blues = FILAMENT_CATALOG.filter((filament) => filament.type === 'Basic' && filament.color === 'Blue');
    expect(blues.map((filament) => filament.code)).toEqual(['10600', '10601']);
    expect(blues[0].hex).toBe(blues[1].hex);
    expect(blues[0].id).not.toBe(blues[1].id);
  });

  it('stores material, type, color, hex and matching RGB with source links', () => {
    for (const filament of FILAMENT_CATALOG) {
      expect(filament.brand).toBe('Bambu Lab');
      expect(filament.material).toBe('PLA');
      expect(['Basic', 'Matte']).toContain(filament.type);
      expect(filament.color).not.toBe('');
      expect(filament.code).toMatch(/^\d{5}$/);
      expect(filament.hex).toMatch(/^#[0-9A-F]{6}$/);
      expect(filament.rgb).toEqual([1, 3, 5].map((offset) => parseInt(filament.hex.slice(offset, offset + 2), 16)));
      expect(filament.sourceUrl).toMatch(/^https:\/\/3dfilamentprofiles.com\/filament\/details\/\d+$/);
      expect(getFilament(filament.id)).toBe(filament);
    }
    expect(getFilament('missing')).toBeUndefined();
    expect(getFilament('basic-131')).toMatchObject({ color: 'Bambu Green', hex: '#00AE42', rgb: [0, 174, 66] });
    expect(getFilament('matte-155')).toMatchObject({ color: 'Sakura Pink', hex: '#E8AFCF', rgb: [232, 175, 207] });
  });
});
