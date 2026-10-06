import { getMetrics, getPinPositions, type Parameters } from '../pin-design/model';
import { pinBounds } from '../pin-shape/geometry';

export interface ImagePlacement { offsetX: number; offsetY: number; zoom: number }
export const DEFAULT_IMAGE_PLACEMENT: ImagePlacement = { offsetX: 0, offsetY: 0, zoom: 1 };
export const MIN_IMAGE_ZOOM = 0.1;
export const MAX_IMAGE_ZOOM = 4;
type ImageSize = { width: number; height: number };
type Position = { x: number; y: number };

export function imageTransform(image: ImageSize, parameters: Parameters, placement = DEFAULT_IMAGE_PLACEMENT) {
  if (![placement.offsetX, placement.offsetY].every(Number.isFinite)) throw new Error('Image offsets must be finite.');
  if (!Number.isFinite(placement.zoom) || placement.zoom < MIN_IMAGE_ZOOM || placement.zoom > MAX_IMAGE_ZOOM) throw new Error('Image zoom must be between 10% and 400%.');
  const bounds = parameters.layout?.imageBounds;
  const dimensions = parameters.layout ? parameters : getMetrics(parameters);
  const scale = (bounds ? parameters.width / (bounds[2] - bounds[0]) : Math.min(dimensions.width / image.width, dimensions.depth / image.height)) * placement.zoom;
  const centerX = bounds ? (bounds[0] + bounds[2]) / 2 : image.width / 2;
  const centerY = bounds ? (bounds[1] + bounds[3]) / 2 : image.height / 2;
  return { scale, centerX, centerY, offsetX: placement.offsetX, offsetY: placement.offsetY,
    left: placement.offsetX - centerX * scale, top: placement.offsetY + centerY * scale,
    width: image.width * scale, height: image.height * scale };
}

export function sourcePoint(point: Position, transform: ReturnType<typeof imageTransform>) {
  return { x: transform.centerX + (point.x - transform.offsetX) / transform.scale - 0.5,
    y: transform.centerY - (point.y - transform.offsetY) / transform.scale - 0.5 };
}

export function zoomImage(placement: ImagePlacement, requested: number, anchor: Position = { x: placement.offsetX, y: placement.offsetY }): ImagePlacement {
  const zoom = Math.min(MAX_IMAGE_ZOOM, Math.max(MIN_IMAGE_ZOOM, requested));
  return { zoom, offsetX: anchor.x + (placement.offsetX - anchor.x) * zoom / placement.zoom,
    offsetY: anchor.y + (placement.offsetY - anchor.y) * zoom / placement.zoom };
}

export function fitImageToPins(image: ImageSize, parameters: Parameters): ImagePlacement {
  const pins = getPinPositions(parameters);
  if (!pins.length) return { ...DEFAULT_IMAGE_PLACEMENT };
  const footprint = pinBounds(parameters);
  let left = Infinity, right = -Infinity, bottom = Infinity, top = -Infinity;
  for (const pin of pins) {
    left = Math.min(left, pin.x + footprint.minX); right = Math.max(right, pin.x + footprint.maxX);
    bottom = Math.min(bottom, pin.y + footprint.minY); top = Math.max(top, pin.y + footprint.maxY);
  }
  const bounds = parameters.layout?.imageBounds;
  const contentWidth = bounds ? bounds[2] - bounds[0] : image.width;
  const contentHeight = bounds ? bounds[3] - bounds[1] : image.height;
  const scale = Math.min((right - left) / contentWidth, (top - bottom) / contentHeight);
  return { offsetX: (left + right) / 2, offsetY: (bottom + top) / 2,
    zoom: Math.max(MIN_IMAGE_ZOOM, Math.min(MAX_IMAGE_ZOOM, scale / imageTransform(image, parameters).scale)) };
}
