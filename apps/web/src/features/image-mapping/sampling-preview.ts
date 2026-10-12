import type { Parameters } from '../pin-design/model';
import { getMappingGrid } from './mapping-grid';
import { layoutPixelsToRGB } from './image-mapping';
import { pixelsToPinRGB } from './sampling';

export interface SamplingPreviewGroup { color: string; path: string }

export function buildSamplingPreview(pixels: Uint8ClampedArray, parameters: Parameters): SamplingPreviewGroup[] {
  const { pins, cellSize: size } = getMappingGrid(parameters);
  if (pixels.length !== pins.length * 4) throw new Error('Preview samples must match the current pin layout.');
  const colors = parameters.layout ? layoutPixelsToRGB(pixels) : pixelsToPinRGB(pixels, parameters.columns, parameters.rows);
  const groups = new Map<string, string[]>();
  pins.forEach((pin, index) => {
    const offset = index * 3;
    const color = `rgb(${colors[offset]}, ${colors[offset + 1]}, ${colors[offset + 2]})`;
    if (!groups.has(color)) groups.set(color, []);
    groups.get(color)!.push(`M${pin.x - size / 2},${-pin.y - size / 2}h${size}v${size}h${-size}Z`);
  });
  return Array.from(groups, ([color, paths]) => ({ color, path: paths.join('') }));
}
