import { EPSILON, type Layout, type PinPosition } from '../base-shape/layout';
import { geometryParameters, minimumPinClearance, pinBounds, resolvePinGeometries, type PinGeometry, type PinShape } from '../pin-shape/geometry';

export interface Parameters {
  width: number;
  depth: number;
  thickness: number;
  columns: number;
  rows: number;
  spacing: number;
  diameter: number;
  extension: number;
  pinShape?: PinShape;
  pinRotation?: number;
  pinGeometries?: readonly PinGeometry[];
  layout?: Layout;
}
export type ParameterName = keyof Omit<Parameters, 'layout' | 'pinShape' | 'pinRotation' | 'pinGeometries'>;

export function pinCount(parameters: Parameters) { return parameters.layout?.pins.length ?? parameters.columns * parameters.rows; }
export function pinPosition(parameters: Parameters, index: number): PinPosition {
  if (parameters.layout) {
    const pin = parameters.layout.pins[index];
    if (!pin) throw new Error('Pin index is outside the committed layout.');
    return pin;
  }
  return { id: `R${Math.floor(index / parameters.columns) + 1}:C${index % parameters.columns + 1}`,
    x: (index % parameters.columns - (parameters.columns - 1) / 2) * parameters.spacing,
    y: (Math.floor(index / parameters.columns) - (parameters.rows - 1) / 2) * parameters.spacing };
}

export function getPinPositions(parameters: Parameters): readonly PinPosition[] {
  return parameters.layout?.pins ?? Array.from({ length: pinCount(parameters) }, (_, index) => pinPosition(parameters, index));
}

export interface ModelColors {
  base: string;
  pins: string;
}

export const DEFAULT_MODEL_COLORS: ModelColors = {
  base: '#8e9089',
  pins: '#00b1b7',
};

export const DEFAULTS: Parameters = {
  width: 120,
  depth: 100,
  thickness: 3,
  columns: 20,
  rows: 16,
  spacing: 5,
  diameter: 2,
  extension: 20,
};

export function getMetrics(parameters: Parameters) {
  const pins = getPinPositions(parameters), geometries = resolvePinGeometries(parameters);
  if (!pins.length) return { count: 0, width: 0, depth: 0, clearance: null };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const boundsCache = new Map<string, ReturnType<typeof pinBounds>>();
  for (let index = 0; index < pins.length; index++) {
    const pin = pins[index], geometry = geometries[index], key = `${geometry.shape}:${geometry.rotation}`;
    if (!boundsCache.has(key)) boundsCache.set(key, pinBounds(geometryParameters(parameters, geometry)));
    const bounds = boundsCache.get(key)!;
    minX = Math.min(minX, pin.x + bounds.minX); minY = Math.min(minY, pin.y + bounds.minY);
    maxX = Math.max(maxX, pin.x + bounds.maxX); maxY = Math.max(maxY, pin.y + bounds.maxY);
  }
  return {
    count: pins.length,
    width: maxX - minX,
    depth: maxY - minY,
    clearance: minimumPinClearance(parameters, pins),
  };
}

export function getWarnings(parameters: Parameters, metrics = getMetrics(parameters)) {
  const warnings: string[] = [];
  if (metrics.width > parameters.width + EPSILON || metrics.depth > parameters.depth + EPSILON) {
    warnings.push('The pin grid extends beyond the base. Increase the base size or reduce the grid count or spacing.');
  }
  if (metrics.clearance !== null && metrics.clearance < 0 && metrics.count > 1) {
    warnings.push('Pins overlap. Increase spacing or reduce pin size, or change pin shape or rotation.');
  }
  return warnings;
}

export const formatDimension = (value: number) => Number(value.toFixed(2)).toLocaleString('en-US');
