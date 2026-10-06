import { getMetrics, getPinPositions, getWarnings, pinCount, type Parameters } from '../pin-design/model';
import { resolveFilamentProfile, type FilamentProfile, type MaterialSelection, type ModelMaterials } from '../filaments/materials';
import { type Layout, type Region } from '../base-shape/layout';
import { effectivePinRotation, geometryParameters, pinBounds, resolvePinGeometries, resolvedContainment, validatePinGeometry, type PinGeometry } from '../pin-shape/geometry';

export type ExportFormat = 'stl' | '3mf';
export type ExportMode = 'fixed' | 'detachable';

export interface ExportOptions {
  mode: ExportMode;
  socket: { insertionDepth: number; clearance: number };
  plate: { width: number; depth: number };
}

export interface ExportRequest extends ExportOptions {
  format: ExportFormat;
  parameters: Omit<Parameters, 'layout' | 'rows' | 'columns' | 'pinGeometries'> & { rows?: number; columns?: number };
  pinGeometries?: PinGeometry[];
  layout?: Omit<Layout, 'imageBounds'>;
  heights: number[];
  materials: string[];
  filamentProfiles: FilamentProfile[];
  baseMaterial: number;
  pinMaterials: number[];
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  mode: 'fixed',
  socket: { insertionDepth: 2, clearance: 0.2 },
  plate: { width: 256, depth: 256 },
};

export const BAMBU_PROFILE = { name: 'Bambu Lab X1 Carbon 0.4 nozzle', width: 256, depth: 256, height: 250 } as const;

export function validateExport(parameters: Parameters, heights: Float32Array | undefined, options: ExportOptions, format?: ExportFormat, measurements?: ReturnType<typeof getMetrics>): string | null {
  const { layout } = parameters;
  const dimensions = [parameters.width, parameters.depth, parameters.thickness, parameters.spacing, parameters.diameter, parameters.extension, parameters.columns, parameters.rows];
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
    if (!layout.pins.length || layout.pins.length > 10000 || !Number.isFinite(layout.edgePadding) || layout.edgePadding < 0) return 'Use 1–10,000 pins and nonnegative edge padding.';
  }
  const positions = getPinPositions(parameters);
  if (positions.some((pin, index) => !Number.isFinite(pin.x) || !Number.isFinite(pin.y) || !fits[index](pin.x, pin.y, layout?.edgePadding ?? 0))) return 'Pin positions must respect every outer and hole boundary and Edge padding.';
  if (format === 'stl' && options.mode === 'fixed' && metrics.clearance !== null && metrics.clearance <= 0.000001) return 'Fixed STL requires a positive gap between pin footprints. Increase spacing or reduce pin size.';
  if (heights && (heights.length !== metrics.count || heights.some((height) => !Number.isFinite(height) || height <= 0))) {
    return 'Resolved pin heights are invalid or incomplete. Every pin must have a finite height greater than 0 mm.';
  }
  if (options.mode === 'detachable') {
    if (!Number.isFinite(options.plate.width) || !Number.isFinite(options.plate.depth) || options.plate.width <= 0 || options.plate.depth <= 0) {
      return 'Enter a positive bed width and depth.';
    }
    if (parameters.width + 10 > options.plate.width || parameters.depth + 10 > options.plate.depth) {
      return 'The base must fit on the bed with a 5 mm margin on every side. Increase the bed size or reduce the base.';
    }
    const { insertionDepth, clearance } = options.socket;
    if (!Number.isFinite(insertionDepth) || insertionDepth <= 0 || !Number.isFinite(clearance) || clearance < 0) {
      return 'Enter a positive insertion depth and a nonnegative socket clearance.';
    }
    if (parameters.thickness - insertionDepth < 1 - 0.000001) return 'Socket floor must be at least 1 mm thick. Increase base thickness or reduce insertion depth.';
    if (metrics.clearance !== null && metrics.clearance - clearance < 0.8 - 0.000001) return 'Socket walls between pins must be at least 0.8 mm. Increase spacing or reduce pin size or clearance.';
    if (!layout && ((parameters.width - metrics.width - clearance) / 2 < 0.8 - 0.000001 || (parameters.depth - metrics.depth - clearance) / 2 < 0.8 - 0.000001)) {
      return 'Socket edges must be at least 0.8 mm from the base edge. Increase the base size or reduce the grid.';
    }
    if (geometries.some(geometry => {
      const bounds = pinBounds(geometryParameters(parameters, geometry));
      return bounds.maxX - bounds.minX > options.plate.width - 10 || bounds.maxY - bounds.minY > options.plate.depth - 10;
    })) {
      return 'Detached pins do not fit on the bed with 5 mm margins.';
    }
    if (positions.some((pin, index) => !fits[index](pin.x, pin.y, clearance / 2 + 0.8))) {
      return 'Socket edges must be at least 0.8 mm from every outer or hole boundary. Increase padding or reduce socket clearance.';
    }
  }
  if (format === '3mf') {
    if (parameters.width > BAMBU_PROFILE.width || parameters.depth > BAMBU_PROFILE.depth) {
      return 'Bambu X1C 3MF requires a base within the 256 × 256 mm bed. Reduce the base or download STL.';
    }
    if (options.mode === 'detachable' && (options.plate.width > BAMBU_PROFILE.width || options.plate.depth > BAMBU_PROFILE.depth)) {
      return 'Bambu X1C usable bed dimensions must not exceed 256 × 256 mm. Reduce the bed area or download STL.';
    }
    const maximum = heights ? Math.max(...heights) : parameters.extension;
    const printHeight = options.mode === 'detachable' ? Math.max(parameters.thickness, maximum + options.socket.insertionDepth) : parameters.thickness + maximum;
    if (printHeight > BAMBU_PROFILE.height) return 'Bambu X1C 3MF parts must fit the profile’s 250 mm printable height. Reduce height or download STL.';
  }
  return null;
}

export function buildExportRequest(parameters: Parameters, heights: Float32Array | undefined, selections: ModelMaterials, options: ExportOptions, format: ExportFormat, pinSelections?: readonly MaterialSelection[]): ExportRequest {
  const error = validateExport(parameters, heights, options, format);
  if (error) throw new Error(error);
  const count = pinCount(parameters);
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
  const { pinGeometries: unusedGeometry, ...legacyParameters } = parameters;
  return {
    format, mode: options.mode,
    parameters: parameters.layout
      ? { width: parameters.width, depth: parameters.depth, thickness: parameters.thickness, spacing: parameters.spacing, diameter: parameters.diameter, extension: parameters.extension,
        ...(parameters.pinShape ? { pinShape: parameters.pinShape } : {}), ...(parameters.pinRotation !== undefined ? { pinRotation: effectivePinRotation(parameters) } : {}) }
      : { ...legacyParameters, ...(parameters.pinRotation !== undefined ? { pinRotation: effectivePinRotation(parameters) } : {}) },
    pinGeometries: resolvePinGeometries(parameters),
    ...(parameters.layout ? { layout: { regions: parameters.layout.regions, pins: parameters.layout.pins, edgePadding: parameters.layout.edgePadding } } : {}),
    heights: heights ? Array.from(heights) : Array<number>(count).fill(parameters.extension),
    materials, filamentProfiles, baseMaterial: indices[0],
    pinMaterials: indices.slice(1),
    socket: { ...options.socket }, plate: { ...options.plate },
  };
}
