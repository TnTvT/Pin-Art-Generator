import { BAMBU_PLA_DATA } from './data/bambu-pla';

export interface FilamentColor {
  readonly id: string;
  readonly brand: string;
  readonly material: string;
  readonly type: 'Basic' | 'Matte';
  readonly color: string;
  readonly code: string;
  readonly hex: string;
  readonly rgb: readonly [number, number, number];
  readonly sourceUrl: string;
}

export const CATALOG_CAPTURED_ON = BAMBU_PLA_DATA.capturedOn;
export const CATALOG_SOURCES = BAMBU_PLA_DATA.series.map((series) => ({ type: series.type, url: series.sourceUrl }));

export const FILAMENT_CATALOG: readonly FilamentColor[] = BAMBU_PLA_DATA.series.flatMap((series) => series.colors.map((color) => ({
  id: `${series.type.toLowerCase()}-${color.sourceId}`,
  brand: BAMBU_PLA_DATA.brand,
  material: BAMBU_PLA_DATA.material,
  type: series.type,
  color: color.color,
  code: color.code,
  hex: color.hex,
  rgb: color.rgb,
  sourceUrl: `https://3dfilamentprofiles.com/filament/details/${color.sourceId}`,
})));

const filamentById = new Map(FILAMENT_CATALOG.map((filament) => [filament.id, filament]));

export function getFilament(id: string): FilamentColor | undefined {
  return filamentById.get(id);
}

export const CUSTOM_COLOR_SWATCHES = [
  '#ffffff', '#000000', '#868e96', '#dee2e6',
  '#fa5252', '#e64980', '#be4bdb', '#7950f2',
  '#4c6ef5', '#228be6', '#15aabf', '#12b886',
  '#40c057', '#82c91e', '#fab005', '#fd7e14',
];
