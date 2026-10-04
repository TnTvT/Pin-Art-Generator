import { DEFAULT_MODEL_COLORS } from '../pin-design/model';
import { getFilament } from './catalog';

export type FilamentProfile = 'bambu-pla-basic' | 'bambu-pla-matte' | 'generic-pla';

export interface MaterialSelection {
  color: string;
  filamentId: string | null;
}

export interface ModelMaterials {
  base: MaterialSelection;
  pins: MaterialSelection;
}

export const DEFAULT_MODEL_MATERIALS: ModelMaterials = {
  base: { color: DEFAULT_MODEL_COLORS.base, filamentId: 'basic-128' },
  pins: { color: DEFAULT_MODEL_COLORS.pins, filamentId: 'basic-903' },
};

export function resolveFilamentProfile(selection: MaterialSelection): FilamentProfile {
  if (selection.filamentId === null) return 'generic-pla';
  const filament = getFilament(selection.filamentId);
  if (!filament || filament.hex.toLowerCase() !== selection.color.toLowerCase()) {
    throw new Error('The selected filament and color do not match. Reselect the filament or choose Custom color.');
  }
  return filament.type === 'Basic' ? 'bambu-pla-basic' : 'bambu-pla-matte';
}

export function materialKey(material: MaterialSelection) {
  if (!/^#[0-9a-f]{6}$/i.test(material.color)) throw new Error('Choose a valid #RRGGBB color.');
  return `${material.color.toLowerCase()}:${resolveFilamentProfile(material)}`;
}
