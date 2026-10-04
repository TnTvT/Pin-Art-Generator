import { deltaE2000, Lab, sRGB, to } from 'colorjs.io/fn';
import { FILAMENT_CATALOG, getFilament, type FilamentColor } from '../filaments/catalog';
import { materialKey, type MaterialSelection } from '../filaments/materials';

export type MappingMode = 'height' | 'color' | 'height-color';
export type PaletteSource = 'auto' | 'manual';
export type PaletteFamily = 'both' | 'basic' | 'matte';
export interface ColorMappingOptions {
  source: PaletteSource;
  family: PaletteFamily;
  maximum: number;
  filamentIds: string[];
}
export interface MaterialOverride { index: number; material: MaterialSelection }
export interface ColorMappingRequest extends ColorMappingOptions {
  rgb: Uint8Array;
  base: MaterialSelection;
  overrides: MaterialOverride[];
}
export interface PaletteUsage { material: MaterialSelection; count: number }
export interface ColorMappingResult {
  materials: MaterialSelection[];
  palette: PaletteUsage[];
  notice: string | null;
}

export const DEFAULT_COLOR_MAPPING: ColorMappingOptions = {
  source: 'auto', family: 'both', maximum: 4, filamentIds: ['basic-128', 'basic-903'],
};

function selection(filament: FilamentColor): MaterialSelection {
  return { color: filament.hex.toLowerCase(), filamentId: filament.id };
}

export function paletteCandidates(family: PaletteFamily, ids?: readonly string[]) {
  const filaments = ids ? ids.map(id => {
    const filament = getFilament(id);
    if (!filament) throw new Error(`Unknown filament: ${id}. Reselect your filaments.`);
    return filament;
  }) : [...FILAMENT_CATALOG];
  const unique = new Map<string, FilamentColor>();
  filaments.sort((first, second) => (first.type === second.type ? 0 : first.type === 'Basic' ? -1 : 1)
    || first.code.localeCompare(second.code) || first.id.localeCompare(second.id));
  for (const filament of filaments) {
    if (family !== 'both' && filament.type.toLowerCase() !== family) continue;
    const key = materialKey(selection(filament));
    if (!unique.has(key)) unique.set(key, filament);
  }
  return [...unique.values()];
}

function labColor(rgb: readonly number[]) {
  return to({ space: sRGB, coords: [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255], alpha: 1 }, Lab);
}

function refinePalette(chosen: number[], distances: Float64Array[], weights: number[], keys: string[], reserved: Set<string>, hasGeneratedPins: boolean) {
  for (let pass = 0; pass < 2; pass++) {
    let changed = false;
    for (let slot = 0; slot < chosen.length; slot++) {
      const others = chosen.filter((_, index) => index !== slot);
      const remaining = Float64Array.from(weights, (_, position) => others.reduce((nearest, candidate) => Math.min(nearest, distances[candidate][position]), Infinity));
      const used = new Set([...reserved, ...others.map(candidate => keys[candidate])]);
      let best = chosen[slot];
      let bestCost = weights.reduce((total, weight, position) => total + Math.min(remaining[position], distances[best][position]) * weight, 0);
      for (let candidate = 0; candidate < distances.length; candidate++) {
        if (others.includes(candidate) || hasGeneratedPins && !used.has(keys[candidate]) && used.size >= 16) continue;
        let cost = 0;
        for (let position = 0; position < weights.length; position++) cost += Math.min(remaining[position], distances[candidate][position]) * weights[position];
        if (cost < bestCost - 1e-9) { best = candidate; bestCost = cost; }
      }
      if (best !== chosen[slot]) { chosen[slot] = best; changed = true; }
    }
    if (!changed) break;
  }
}

export function mapPinColors(request: ColorMappingRequest): ColorMappingResult {
  const count = request.rgb.length / 3;
  if (!Number.isInteger(count) || count < 1 || count > 10000) throw new Error('Image colors must match 1–10,000 pins.');
  if (!Number.isInteger(request.maximum) || request.maximum < 1 || request.maximum > 16) throw new Error('Choose 1–16 maximum pin materials.');
  const candidates = paletteCandidates(request.source === 'manual' ? 'both' : request.family,
    request.source === 'manual' ? request.filamentIds : undefined);
  if (!candidates.length) throw new Error('Choose at least one preset filament for color mapping.');
  const overrides = new Map<number, MaterialSelection>();
  const reserved = new Set([materialKey(request.base)]);
  for (const override of request.overrides) {
    if (!Number.isInteger(override.index) || override.index < 0 || override.index >= count) throw new Error('Manual colors do not match the current grid.');
    overrides.set(override.index, override.material);
    reserved.add(materialKey(override.material));
  }
  if (reserved.size > 16) throw new Error('Use at most 16 materials including the base and manual colors.');
  const histogram = new Map<number, { rgb: number[]; weight: number; position: number }>();
  const pinPositions = new Uint16Array(count);
  for (let index = 0; index < count; index++) {
    const color = [...request.rgb.subarray(index * 3, index * 3 + 3)];
    const key = (color[0] << 16) | (color[1] << 8) | color[2];
    let entry = histogram.get(key);
    if (!entry) {
      entry = { rgb: color, weight: 0, position: histogram.size };
      histogram.set(key, entry);
    }
    if (!overrides.has(index)) entry.weight++;
    pinPositions[index] = entry.position;
  }
  const entries = [...histogram.values()];
  const colors = entries.map(entry => labColor(entry.rgb));
  const candidateColors = candidates.map(filament => labColor(filament.rgb));
  const distances = candidates.map((_, candidate) => Float64Array.from(colors, color => deltaE2000(color, candidateColors[candidate])));
  const keys = candidates.map(filament => materialKey(selection(filament)));
  const chosen: number[] = [];
  let limited = false;
  if (request.source === 'manual') {
    chosen.push(...candidates.map((_, index) => index));
  } else {
    const hasGeneratedPins = overrides.size < count;
    const nearest = new Float64Array(entries.length).fill(Infinity);
    const used = new Set(reserved);
    while (chosen.length < request.maximum) {
      let best = -1;
      let bestCost = Infinity;
      for (let candidate = 0; candidate < candidates.length; candidate++) {
        if (chosen.includes(candidate)) continue;
        if (hasGeneratedPins && !used.has(keys[candidate]) && used.size >= 16) { limited = true; continue; }
        let cost = 0;
        for (let index = 0; index < entries.length; index++) {
          cost += Math.min(nearest[index], distances[candidate][index]) * (hasGeneratedPins ? entries[index].weight : 1);
        }
        if (cost < bestCost - 1e-9) { bestCost = cost; best = candidate; }
      }
      if (best < 0) break;
      const currentCost = entries.reduce((total, entry, index) => total + nearest[index] * (hasGeneratedPins ? entry.weight : 1), 0);
      if (chosen.length && bestCost >= currentCost - 1e-9) break;
      chosen.push(best);
      used.add(keys[best]);
      for (let index = 0; index < entries.length; index++) nearest[index] = Math.min(nearest[index], distances[best][index]);
    }
    if (!chosen.length) throw new Error('All 16 material slots are occupied. Reset some manual colors or select matching filaments.');
    refinePalette(chosen, distances, entries.map(entry => hasGeneratedPins ? entry.weight : 1), keys, reserved, hasGeneratedPins);
  }
  chosen.sort((first, second) => first - second);
  const matches = entries.map((_, position) => chosen.reduce((best, candidate) =>
    distances[candidate][position] < distances[best][position] - 1e-9 ? candidate : best, chosen[0]));
  const materials = [...pinPositions].map(position => selection(candidates[matches[position]]));
  const used = new Set([materialKey(request.base)]);
  const palette = new Map<string, PaletteUsage>();
  materials.forEach((material, index) => {
    used.add(materialKey(overrides.get(index) ?? material));
    const key = materialKey(material);
    const usage = palette.get(key);
    if (usage) usage.count++;
    else palette.set(key, { material, count: 1 });
  });
  if (used.size > 16) throw new Error('Mapping would use more than 16 materials including the base and manual colors. Choose fewer filaments or reset manual colors.');
  return { materials, palette: [...palette.values()], notice: limited && chosen.length < request.maximum
    ? 'The palette is limited by the 16-material budget, including the base and manual colors.' : null };
}
