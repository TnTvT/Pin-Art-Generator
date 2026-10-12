import type { Parameters } from '../pin-design/model';
import { getMappingGrid } from './mapping-grid';

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
  const dimensions = getMappingGrid(parameters);
  const contentWidth = bounds ? bounds[2] - bounds[0] : image.width;
  const contentHeight = bounds ? bounds[3] - bounds[1] : image.height;
  const scale = Math.min(dimensions.width / contentWidth, dimensions.depth / contentHeight) * placement.zoom;
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
  imageTransform(image, parameters);
  return { ...DEFAULT_IMAGE_PLACEMENT };
}
