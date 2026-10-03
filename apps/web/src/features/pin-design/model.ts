export interface Parameters {
  width: number;
  depth: number;
  thickness: number;
  columns: number;
  rows: number;
  spacing: number;
  diameter: number;
  extension: number;
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
    count: parameters.columns * parameters.rows,
    width: (parameters.columns - 1) * parameters.spacing + parameters.diameter,
    depth: (parameters.rows - 1) * parameters.spacing + parameters.diameter,
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
