import { DEFAULT_CONSTRUCTION, validateMechanics, type Construction } from '../mechanics/model';
import { MAX_PINS } from '../pin-design/limits';
import { getMetrics, getPinPositions, getWarnings, pinCount, type Parameters } from '../pin-design/model';
import { resolveFilamentProfile, type FilamentProfile, type MaterialSelection, type ModelMaterials } from '../filaments/materials';
import { type Layout, type Region } from '../base-shape/layout';
import { effectivePinRotation, resolvePinGeometries, resolvedContainment, validatePinGeometry, type PinGeometry } from '../pin-shape/geometry';
import { DEFAULT_PRINTER, PRINTER_PROFILES, validatePrinterMaterials, type PrinterId } from './printer-profiles';
import { validatePinShapeAvailability } from '../pin-shape/availability';

export type ExportFormat = 'stl' | '3mf';
export type ExportMode = Construction['mode'];
export type ExportOptions = Construction & { printer?: PrinterId };

export interface ExportRequest extends ExportOptions {
  format: ExportFormat;
  parameters: Omit<Parameters, 'layout' | 'rows' | 'columns' | 'pinGeometries' | 'construction'> & { rows?: number; columns?: number };
  pinGeometries?: PinGeometry[];
  layout?: Omit<Layout, 'imageBounds'>;
  heights: number[];
  materials: string[];
  filamentProfiles: FilamentProfile[];
  baseMaterial: number;
  pinMaterials: number[];
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = DEFAULT_CONSTRUCTION;

export function validateExport(parameters: Parameters, heights: Float32Array | undefined, options: ExportOptions, format?: ExportFormat, measurements?: ReturnType<typeof getMetrics>): string | null {
  const { layout } = parameters;
  const dimensions = [parameters.width, parameters.depth, parameters.thickness, parameters.spacing, parameters.diameter, parameters.extension, parameters.columns, parameters.rows];
  if (pinCount(parameters) < 1 || pinCount(parameters) > MAX_PINS) return 'Use 1–5,000 pins. Increase spacing or padding, or reduce the base.';
  if (dimensions.some((value) => !Number.isFinite(value) || value <= 0)
    || !Number.isInteger(parameters.columns) || !Number.isInteger(parameters.rows)
    || parameters.columns > 100 || parameters.rows > 100) return 'Use valid positive parameters and grid counts from 1 to 100.';
  try { validatePinGeometry(parameters); resolvePinGeometries(parameters); } catch (error) { return error instanceof Error ? error.message : 'Use a valid pin shape and rotation.'; }
  const metrics = measurements ?? getMetrics(parameters);
  const warning = getWarnings(parameters, metrics)[0];
  if (warning) return warning;
  const regions: Region[] = layout?.regions ?? [{ outer: [[-parameters.width / 2, -parameters.depth / 2], [parameters.width / 2, -parameters.depth / 2], [parameters.width / 2, parameters.depth / 2], [-parameters.width / 2, parameters.depth / 2]], holes: [] }];
  let fits: ReturnType<typeof resolvedContainment>;
  let geometries: PinGeometry[];
  try { fits = resolvedContainment(parameters, regions); geometries = resolvePinGeometries(parameters); }
  catch (error) { return error instanceof Error ? error.message : 'Use valid per-pin geometries.'; }
  if (layout) {
    if (!Number.isFinite(layout.edgePadding) || layout.edgePadding < 0) return 'Use nonnegative edge padding.';
  }
  const positions = getPinPositions(parameters);
  if (positions.some((pin, index) => !Number.isFinite(pin.x) || !Number.isFinite(pin.y) || !fits[index](pin.x, pin.y, layout?.edgePadding ?? 0))) return 'Pin positions must respect every outer and hole boundary and Edge padding.';
  if (format === 'stl' && options.mode === 'fixed' && metrics.clearance !== null && metrics.clearance <= 0.000001) return 'Fixed STL requires a positive gap between pin footprints. Increase spacing or reduce pin size.';
  if (heights && (heights.length !== metrics.count || heights.some((height) => !Number.isFinite(height) || height <= 0))) {
    return 'Resolved pin heights are invalid or incomplete. Every pin must have a finite height greater than 0 mm.';
  }
  try {
    validatePinShapeAvailability({ ...parameters, construction: options });
    validateMechanics({ ...parameters, construction: options }, heights);
  }
  catch (error) { return error instanceof Error ? error.message : 'Invalid print-in-place structure.'; }
  if (format === '3mf') {
    const profile = PRINTER_PROFILES[options.printer ?? DEFAULT_PRINTER];
    if (parameters.width > profile.width || parameters.depth > profile.depth) {
      return `${profile.shortName} 3MF requires a base within the ${profile.width} × ${profile.depth} mm bed. Reduce the base or download STL.`;
    }
    if (options.mode === 'print-in-place' && (parameters.width > profile.width - 10 || parameters.depth > profile.depth - 10)) return 'Print-in-place 3MF must fit the bed with 5 mm margins. Reduce the base or download STL.';
    const maximum = heights ? Math.max(...heights) : parameters.extension;
    const printHeight = parameters.thickness + maximum;
    if (printHeight > profile.height) return `${profile.shortName} 3MF parts must fit the profile’s ${profile.height} mm printable height. Reduce height or download STL.`;
  }
  return null;
}

export function resolveExportMaterials(count: number, selections: ModelMaterials, pinSelections?: readonly MaterialSelection[]) {
  if (pinSelections && pinSelections.length !== count) throw new Error('Pin materials must match the grid count.');
  const selected = [selections.base, ...(pinSelections ?? Array<MaterialSelection>(count).fill(selections.pins))];
  const colorValues = selected.map((selection) => selection.color.toLowerCase());
  if (colorValues.some((color) => !/^#[0-9a-f]{6}$/.test(color))) throw new Error('Choose base and pin colors in #RRGGBB format.');
  const profiles = selected.map(resolveFilamentProfile);
  const materials: string[] = [];
  const filamentProfiles: FilamentProfile[] = [];
  const palette = new Map<string, number>();
  const indices = selected.map((selection, index) => {
    const key = `${colorValues[index]}:${profiles[index]}`;
    let materialIndex = palette.get(key);
    if (materialIndex === undefined) {
      materialIndex = materials.length;
      palette.set(key, materialIndex);
      materials.push(selection.color.toLowerCase());
      filamentProfiles.push(profiles[index]);
    }
    return materialIndex;
  });
  if (materials.length > 16) throw new Error('Use at most 16 materials including the base.');
  return { materials, filamentProfiles, baseMaterial: indices[0], pinMaterials: indices.slice(1) };
}

export function buildExportRequest(parameters: Parameters, heights: Float32Array | undefined, selections: ModelMaterials, options: ExportOptions, format: ExportFormat, pinSelections?: readonly MaterialSelection[]): ExportRequest {
  const error = validateExport(parameters, heights, options, format);
  if (error) throw new Error(error);
  const count = pinCount(parameters);
  const palette = resolveExportMaterials(count, selections, pinSelections);
  if (format === '3mf') {
    const materialError = validatePrinterMaterials(options.printer ?? DEFAULT_PRINTER, palette.materials.length);
    if (materialError) throw new Error(materialError);
  }
  const { pinGeometries: unusedGeometry, construction: unusedConstruction, ...legacyParameters } = parameters;
  return {
    format, mode: options.mode,
    ...(options.printer && options.printer !== DEFAULT_PRINTER ? { printer: options.printer } : {}),
    parameters: parameters.layout
      ? { width: parameters.width, depth: parameters.depth, thickness: parameters.thickness, spacing: parameters.spacing, diameter: parameters.diameter, extension: parameters.extension,
        ...(parameters.pinShape ? { pinShape: parameters.pinShape } : {}), ...(parameters.pinRotation !== undefined ? { pinRotation: effectivePinRotation(parameters) } : {}) }
      : { ...legacyParameters, ...(parameters.pinRotation !== undefined ? { pinRotation: effectivePinRotation(parameters) } : {}) },
    pinGeometries: resolvePinGeometries(parameters),
    ...(parameters.layout ? { layout: { regions: parameters.layout.regions, pins: parameters.layout.pins, edgePadding: parameters.layout.edgePadding } } : {}),
    heights: heights ? Array.from(heights) : Array<number>(count).fill(parameters.extension),
    ...palette,
    sliding: { ...options.sliding },
  };
}
