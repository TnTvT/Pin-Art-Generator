import { EPSILON, type Layout, type PinPosition } from '../base-shape/layout';
import { minimumPinClearance, pinBounds, type PinShape } from '../pin-shape/geometry';

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
  layout?: Layout;
}
export type ParameterName = keyof Omit<Parameters, 'layout' | 'pinShape' | 'pinRotation'>;

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
  const bounds = pinBounds(parameters), pins = getPinPositions(parameters);
  if (!pins.length) return { count: 0, width: 0, depth: 0, clearance: null };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pin of pins) {
    minX = Math.min(minX, pin.x); minY = Math.min(minY, pin.y);
    maxX = Math.max(maxX, pin.x); maxY = Math.max(maxY, pin.y);
  }
  return {
    count: pins.length,
    width: maxX - minX + bounds.maxX - bounds.minX,
    depth: maxY - minY + bounds.maxY - bounds.minY,
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
