import { describe, expect, it } from 'vitest';
import { FILAMENT_CATALOG, CATALOG_CAPTURED_ON, getFilament } from './catalog';
import sourceText from '../../../../../fixtures/filaments/bambu-pla-source.json?raw';
import provenanceText from './data/bambu-pla.provenance.json?raw';
import licenseText from '../../../public/licenses/bambu-filaments-MIT.txt?raw';

describe('bundled Bambu PLA catalog', () => {
  it('reproduces all selected values from the independently licensed source fixture', () => {
    const source = JSON.parse(sourceText) as { sku: string; material: string; product: string; color_name: string; color_hex: string; color_hexes: string[] }[];
    const expected = new Map<string, { type: string; code: string; color: string; hex: string }>();
    for (const entry of source) {
      if (entry.color_hexes.length !== 1 || !/^[0-9A-F]{6}FF$/i.test(entry.color_hex)) continue;
      expect(entry.material).toBe('PLA');
      const type = entry.product.replace('PLA ', '');
      expect(['Basic', 'Matte']).toContain(type);
      const id = `${type.toLowerCase()}-${entry.sku}`;
      const value = { type, code: entry.sku, color: entry.color_name, hex: `#${entry.color_hex.slice(0, 6).toUpperCase()}` };
      if (expected.has(id)) expect(value).toEqual(expected.get(id));
      expected.set(id, value);
    }
    expect(FILAMENT_CATALOG).toHaveLength(expected.size);
    for (const [id, value] of expected) expect(getFilament(id)).toMatchObject(value);
    for (const type of ['Basic', 'Matte']) {
      const names = FILAMENT_CATALOG.filter(filament => filament.type === type).map(filament => filament.color);
      expect(names).toEqual([...names].sort((first, second) => first.localeCompare(second, 'en')));
    }
  });

  it('pins the provenance and ships the upstream MIT permission and copyright notice', () => {
    const provenance = JSON.parse(provenanceText);
    expect(provenance.license).toBe('MIT');
    expect(provenance.revision).toBe('73cf0567028942e2ea9962371fc033511aac2ed7');
    expect(provenance.capturedOn).toBe(CATALOG_CAPTURED_ON);
    expect(licenseText).toContain('Copyright (c) 2026 Paul Bottein');
    expect(licenseText).toContain('Permission is hereby granted');
    expect(FILAMENT_CATALOG.every(filament => filament.sourceUrl === provenance.sourceUrl)).toBe(true);
  });

  it('contains one opaque single-color entry per product from the licensed snapshot', () => {
    expect(CATALOG_CAPTURED_ON).toBe('2026-10-19');
    expect(FILAMENT_CATALOG.filter((filament) => filament.type === 'Basic')).toHaveLength(31);
    expect(FILAMENT_CATALOG.filter((filament) => filament.type === 'Matte')).toHaveLength(25);
    expect(new Set(FILAMENT_CATALOG.map((filament) => filament.id)).size).toBe(56);
    const blues = FILAMENT_CATALOG.filter((filament) => filament.type === 'Basic' && filament.color === 'Blue');
    expect(blues.map((filament) => filament.code)).toEqual(['10601']);
    expect(getFilament('basic-10500')).toMatchObject({ color: 'Green', hex: '#005F61' });
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
      expect(filament.id).toBe(`${filament.type.toLowerCase()}-${filament.code}`);
      expect(filament.sourceUrl).toBe('https://github.com/piitaya/bambu-filaments/blob/73cf0567028942e2ea9962371fc033511aac2ed7/filaments.json');
      expect(getFilament(filament.id)).toBe(filament);
    }
    expect(getFilament('missing')).toBeUndefined();
    expect(getFilament('basic-10501')).toMatchObject({ color: 'Bambu Green', hex: '#00AE42', rgb: [0, 174, 66] });
    expect(getFilament('matte-11201')).toMatchObject({ color: 'Sakura Pink', hex: '#E8AFCF', rgb: [232, 175, 207] });
    expect(getFilament('basic-131')).toBeUndefined();
  });
});
