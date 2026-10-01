import { getMetrics, getWarnings, type ModelColors, type Parameters } from '../pin-design/model';

export type ExportFormat = 'stl' | '3mf';
export type ExportMode = 'fixed' | 'detachable';

export interface ExportOptions {
  mode: ExportMode;
  socket: { insertionDepth: number; clearance: number };
  plate: { width: number; depth: number };
}

export interface ExportRequest extends ExportOptions {
  format: ExportFormat;
  parameters: Parameters;
  heights: number[];
  materials: string[];
  baseMaterial: number;
  pinMaterials: number[];
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  mode: 'fixed',
  socket: { insertionDepth: 2, clearance: 0.2 },
  plate: { width: 256, depth: 256 },
};

export function validateExport(parameters: Parameters, heights: Float32Array | undefined, options: ExportOptions): string | null {
  if (Object.values(parameters).some((value) => !Number.isFinite(value) || value <= 0)
    || !Number.isInteger(parameters.columns) || !Number.isInteger(parameters.rows)
    || parameters.columns > 100 || parameters.rows > 100) return 'Use valid positive parameters and grid counts from 1 to 100.';
  const warning = getWarnings(parameters)[0];
  if (warning) return warning;
  const metrics = getMetrics(parameters);
  if (heights && (heights.length !== metrics.count || heights.some((height) => !Number.isFinite(height) || height <= 0 || height > parameters.extension + 0.00001))) {
    return 'Resolved image heights are invalid or incomplete. Reprocess or remove the image before exporting.';
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
    const socketDiameter = parameters.diameter + clearance;
    if (metrics.count > 1 && parameters.spacing - socketDiameter < 0.8 - 0.000001) return 'Socket walls between pins must be at least 0.8 mm. Increase spacing or reduce diameter or clearance.';
    const socketWidth = (parameters.columns - 1) * parameters.spacing + socketDiameter;
    const socketDepth = (parameters.rows - 1) * parameters.spacing + socketDiameter;
    if ((parameters.width - socketWidth) / 2 < 0.8 - 0.000001 || (parameters.depth - socketDepth) / 2 < 0.8 - 0.000001) {
      return 'Socket edges must be at least 0.8 mm from the base edge. Increase the base size or reduce the grid.';
    }
    if (parameters.diameter > options.plate.width - 10 || parameters.diameter > options.plate.depth - 10) {
      return 'Detached pins do not fit on the bed with 5 mm margins.';
    }
  }
  return null;
}

export function buildExportRequest(parameters: Parameters, heights: Float32Array | undefined, colors: ModelColors, options: ExportOptions, format: ExportFormat): ExportRequest {
  const error = validateExport(parameters, heights, options);
  if (error) throw new Error(error);
  const colorValues = [colors.base, colors.pins].map((color) => color.toLowerCase());
  if (colorValues.some((color) => !/^#[0-9a-f]{6}$/.test(color))) throw new Error('Choose base and pin colors in #RRGGBB format.');
  const materials = [...new Set(colorValues)];
  const count = getMetrics(parameters).count;
  return {
    format, mode: options.mode, parameters: { ...parameters },
    heights: heights ? Array.from(heights) : Array<number>(count).fill(parameters.extension),
    materials, baseMaterial: materials.indexOf(colorValues[0]),
    pinMaterials: Array<number>(count).fill(materials.indexOf(colorValues[1])),
    socket: { ...options.socket }, plate: { ...options.plate },
  };
}
