import { describe, expect, it, vi } from 'vitest';
import { DEFAULTS } from '../pin-design/model';
import { layoutPixelsToHeights, layoutPixelsToRGB, mapImageToPins, sampleImagePixels, type SourceImage } from './image-mapping';

describe('canvas image sampling', () => {
  it('samples a centered image at grid resolution and passes the pixels to height mapping', () => {
    const context = {
      fillStyle: '',
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      imageSmoothingEnabled: false,
      imageSmoothingQuality: 'low',
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]) })),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const source: SourceImage = { name: 'photo.png', url: 'blob:photo', bitmap: { width: 200, height: 100 } as ImageBitmap };
    const result = mapImageToPins(source, { ...DEFAULTS, columns: 2, rows: 1, spacing: 2, diameter: 2 }, 2, false);
    expect(context.drawImage).toHaveBeenCalledWith(source.bitmap, 0, 0, 2, 1);
    expect(context.getImageData).toHaveBeenCalledWith(0, 0, 2, 1);
    expect(context.fillStyle).toBe('#ffffff');
    expect(Array.from(result.heights)).toEqual([20, 2]);
  });

  it('reports unavailable canvas processing instead of producing invalid heights', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const source: SourceImage = { name: 'photo.png', url: 'blob:photo', bitmap: {} as ImageBitmap };
    expect(() => mapImageToPins(source, DEFAULTS, 2, false)).toThrow('Image processing is unavailable');
  });
  it('samples actual XY positions with image top at positive Y for both presets and cropped contours', () => {
    const rgba = new Uint8ClampedArray([0,0,0,255, 255,0,0,255, 255,255,255,255, 0,0,255,255]);
    const context = { drawImage: vi.fn(), getImageData: vi.fn(() => ({ data: rgba })) };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const source = { name: 'asymmetric.png', url: 'blob:asymmetric', bitmap: { width: 2, height: 2 } as ImageBitmap };
    const parameters = { ...DEFAULTS, width: 2, depth: 2, layout: { regions: [], edgePadding: 0, pins: [{ id: 'bottom', x: -.5, y: -.5 }, { id: 'top', x: -.5, y: .5 }, { id: 'blue', x: .5, y: -.5 }] } };
    const pixels = sampleImagePixels(source, parameters);
    expect([...layoutPixelsToRGB(pixels)]).toEqual([255,255,255, 0,0,0, 0,0,255]);
    expect([...layoutPixelsToHeights(pixels, 2, 20, false).heights].slice(0, 2)).toEqual([2,20]);
    expect([...sampleImagePixels(source, { ...parameters, layout: { ...parameters.layout, imageBounds: [0,0,2,2] } })]).toEqual([...pixels]);
  });
});
