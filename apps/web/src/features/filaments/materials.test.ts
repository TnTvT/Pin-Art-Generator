import { describe, expect, it } from 'vitest';
import { getFilament } from './catalog';
import { DEFAULT_MODEL_MATERIALS, resolveFilamentProfile } from './materials';

describe('default printable materials', () => {
  it('uses catalog PLA Basic Gray and Turquoise rather than custom colors', () => {
    expect(DEFAULT_MODEL_MATERIALS.base.filamentId).toBe('basic-128');
    expect(DEFAULT_MODEL_MATERIALS.pins.filamentId).toBe('basic-903');
    for (const selection of Object.values(DEFAULT_MODEL_MATERIALS)) {
      expect(selection.color.toLowerCase()).toBe(getFilament(selection.filamentId!)!.hex.toLowerCase());
      expect(resolveFilamentProfile(selection)).toBe('bambu-pla-basic');
    }
  });
});
