import type { Layout, PinPosition } from '../base-shape/layout';

export interface Parameters {
  width: number;
  depth: number;
  thickness: number;
  columns: number;
  rows: number;
  spacing: number;
  diameter: number;
  extension: number;
  layout?: Layout;
}
export type ParameterName = keyof Omit<Parameters, 'layout'>;

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
  return {
    count: pinCount(parameters),
    width: parameters.layout ? Math.max(...parameters.layout.pins.map(pin => pin.x)) - Math.min(...parameters.layout.pins.map(pin => pin.x)) + parameters.diameter : (parameters.columns - 1) * parameters.spacing + parameters.diameter,
    depth: parameters.layout ? Math.max(...parameters.layout.pins.map(pin => pin.y)) - Math.min(...parameters.layout.pins.map(pin => pin.y)) + parameters.diameter : (parameters.rows - 1) * parameters.spacing + parameters.diameter,
    clearance: parameters.spacing - parameters.diameter,
  };
}

export function getWarnings(parameters: Parameters) {
  const metrics = getMetrics(parameters);
  const warnings: string[] = [];
  if (metrics.width > parameters.width || metrics.depth > parameters.depth) {
    warnings.push('The pin grid extends beyond the base. Increase the base size or reduce the grid count or spacing.');
  }
  if (metrics.clearance < 0 && metrics.count > 1) {
    warnings.push('Pins overlap. Set the center spacing to at least the pin diameter.');
  }
  return warnings;
}

export const formatDimension = (value: number) => Number(value.toFixed(2)).toLocaleString('en-US');
