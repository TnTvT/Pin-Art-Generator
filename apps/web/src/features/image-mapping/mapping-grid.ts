import { getPinPositions, type Parameters } from '../pin-design/model';

export function getMappingGrid(parameters: Parameters) {
  const physical = getPinPositions(parameters);
  const cellSize = parameters.diameter + (parameters.construction?.mode === 'print-in-place' ? 2 * parameters.construction.sliding.headFlare : 0);
  if (!physical.length || !Number.isFinite(cellSize) || cellSize <= 0 || !Number.isFinite(parameters.spacing) || parameters.spacing <= 0) {
    throw new Error('Image mapping requires pins with a positive size and spacing.');
  }
  let left = Infinity, right = -Infinity, bottom = Infinity, top = -Infinity;
  for (const pin of physical) {
    left = Math.min(left, pin.x); right = Math.max(right, pin.x);
    bottom = Math.min(bottom, pin.y); top = Math.max(top, pin.y);
  }
  const centerX = (left + right) / 2, centerY = (bottom + top) / 2, scale = cellSize / parameters.spacing;
  return { cellSize, scale, centerX, centerY, width: (right - left) * scale + cellSize, depth: (top - bottom) * scale + cellSize,
    pins: physical.map(pin => ({ id: pin.id, x: (pin.x - centerX) * scale, y: (pin.y - centerY) * scale })) };
}
