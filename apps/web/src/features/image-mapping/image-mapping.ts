import { getMetrics, type Parameters } from '../pin-design/model';
import { fitImage, pixelsToHeights, type HeightMap } from './sampling';
import type { ShapeImage } from '../base-shape/layout';
import { DEFAULT_IMAGE_PLACEMENT, imageTransform, sourcePoint, type ImagePlacement } from './image-placement';

export interface SourceImage {
  name: string;
  url: string;
  bitmap: ImageBitmap;
}

export function readShapeImage(source: SourceImage): ShapeImage {
  const canvas = document.createElement('canvas');
  canvas.width = source.bitmap.width; canvas.height = source.bitmap.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Image processing is unavailable in this browser.');
  context.drawImage(source.bitmap, 0, 0);
  return { width: canvas.width, height: canvas.height, pixels: context.getImageData(0, 0, canvas.width, canvas.height).data };
}

export function sampleLayoutPixels(source: SourceImage, parameters: Parameters, placement = DEFAULT_IMAGE_PLACEMENT): Uint8ClampedArray {
  const image = readShapeImage(source), layout = parameters.layout!;
  const pixels = new Uint8ClampedArray(layout.pins.length * 4);
  const transform = imageTransform(image, parameters, placement);
  function channel(horizontal: number, vertical: number, axis: number) {
    if (horizontal < 0 || vertical < 0 || horizontal >= image.width || vertical >= image.height) return 255;
    const offset = (vertical * image.width + horizontal) * 4, alpha = image.pixels[offset + 3] / 255;
    return image.pixels[offset + axis] * alpha + 255 * (1 - alpha);
  }
  layout.pins.forEach((pin, index) => {
    const { x: sourceX, y: sourceY } = sourcePoint(pin, transform);
    const left = Math.floor(sourceX), top = Math.floor(sourceY), amountX = sourceX - left, amountY = sourceY - top;
    for (let axis = 0; axis < 3; axis++) pixels[index * 4 + axis] =
      (channel(left, top, axis) * (1 - amountX) + channel(left + 1, top, axis) * amountX) * (1 - amountY)
      + (channel(left, top + 1, axis) * (1 - amountX) + channel(left + 1, top + 1, axis) * amountX) * amountY;
    pixels[index * 4 + 3] = 255;
  });
  return pixels;
}

export function sampleImagePixels(source: SourceImage, parameters: Parameters, adjustment: ImagePlacement = DEFAULT_IMAGE_PLACEMENT): Uint8ClampedArray {
  if (parameters.layout) return sampleLayoutPixels(source, parameters, adjustment);
  imageTransform(source.bitmap, parameters, adjustment);
  const canvas = document.createElement('canvas');
  canvas.width = parameters.columns;
  canvas.height = parameters.rows;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Image processing is unavailable in this browser.');
  const footprint = getMetrics(parameters);
  const placement = fitImage(source.bitmap.width, source.bitmap.height, footprint.width, footprint.depth, canvas.width, canvas.height);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source.bitmap,
    (canvas.width - placement.width * adjustment.zoom) / 2 + adjustment.offsetX / footprint.width * canvas.width,
    (canvas.height - placement.height * adjustment.zoom) / 2 - adjustment.offsetY / footprint.depth * canvas.height,
    placement.width * adjustment.zoom, placement.height * adjustment.zoom);
  return context.getImageData(0, 0, canvas.width, canvas.height).data;
}

export function mapImageToPins(source: SourceImage, parameters: Parameters, minimum: number, invert: boolean, placement?: ImagePlacement): HeightMap {
  if (parameters.layout) return layoutPixelsToHeights(sampleImagePixels(source, parameters, placement), minimum, parameters.extension, invert);
  return pixelsToHeights(sampleImagePixels(source, parameters, placement), parameters.columns, parameters.rows, minimum, parameters.extension, invert);
}

export function layoutPixelsToRGB(pixels: Uint8ClampedArray) {
  const rgb = new Uint8Array(pixels.length / 4 * 3);
  for (let index = 0; index < pixels.length / 4; index++) rgb.set(pixels.subarray(index * 4, index * 4 + 3), index * 3);
  return rgb;
}

export function layoutPixelsToHeights(pixels: Uint8ClampedArray, minimum: number, maximum: number, invert: boolean): HeightMap {
  const heights = Float32Array.from({ length: pixels.length / 4 }, (_, index) => {
    const offset = index * 4, brightness = (pixels[offset] * 0.2126 + pixels[offset + 1] * 0.7152 + pixels[offset + 2] * 0.0722) / 255;
    return minimum + (invert ? brightness : 1 - brightness) * (maximum - minimum);
  });
  return { heights, minimum: Math.min(...heights), maximum: Math.max(...heights) };
}
