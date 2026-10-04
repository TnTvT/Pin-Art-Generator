import { getMetrics, type Parameters } from '../pin-design/model';
import { fitImage, pixelsToHeights, type HeightMap } from './sampling';

export interface SourceImage {
  name: string;
  url: string;
  bitmap: ImageBitmap;
}

export function sampleImagePixels(source: SourceImage, parameters: Parameters): Uint8ClampedArray {
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
  context.drawImage(source.bitmap, placement.x, placement.y, placement.width, placement.height);
  return context.getImageData(0, 0, canvas.width, canvas.height).data;
}

export function mapImageToPins(source: SourceImage, parameters: Parameters, minimum: number, invert: boolean): HeightMap {
  return pixelsToHeights(sampleImagePixels(source, parameters), parameters.columns, parameters.rows, minimum, parameters.extension, invert);
}
