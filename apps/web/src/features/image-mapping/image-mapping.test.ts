import { describe, expect, it, vi } from 'vitest';
import { DEFAULTS } from '../pin-design/model';
import { layoutPixelsToHeights, layoutPixelsToRGB, mapImageToPins, sampleImagePixels, type SourceImage } from './image-mapping';

describe('canvas image sampling', () => {
  it('lets multiple pins share a pixel without blending neighboring cells or counting physical gaps', () => {
    const rgba = new Uint8ClampedArray([0,0,0,255, 255,0,0,255, 255,255,255,255, 0,0,255,128]);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn(), getImageData: () => ({ data: rgba }) } as unknown as CanvasRenderingContext2D);
    const source = { name: 'blocks.png', url: 'blob:blocks', bitmap: { width: 2, height: 2 } as ImageBitmap };
    const parameters = { ...DEFAULTS, width: 2, depth: 2, layout: { regions: [], edgePadding: 0,
      pins: [-.9, -.25, 0, .999, 1].map((x, index) => ({ id: String(index), x, y: .5 })) } };
    const pixels = sampleImagePixels(source, parameters, undefined, 'pixel');
    expect([...layoutPixelsToRGB(pixels)]).toEqual([0,0,0, 0,0,0, 255,0,0, 255,0,0, 255,255,255]);
    const heights = mapImageToPins(source, parameters, 2, false, undefined, 'pixel').heights;
    expect(heights[0]).toBe(heights[1]);
    expect(heights[2]).toBe(heights[3]);
    expect([...sampleImagePixels(source, { ...parameters, diameter: .1, spacing: .25 }, undefined, 'pixel')]).toEqual([...pixels]);
    expect([...sampleImagePixels(source, parameters)].slice(4, 7)).toEqual([64,0,0]);
  });

  it('keeps Pixel height/color orientation, white outside, alpha and placement consistent', () => {
    const rgba = new Uint8ClampedArray([0,0,0,255, 255,0,0,255, 255,255,255,255, 0,0,255,128]);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn(), getImageData: () => ({ data: rgba }) } as unknown as CanvasRenderingContext2D);
    const source = { name: 'blocks.png', url: 'blob:blocks', bitmap: { width: 2, height: 2 } as ImageBitmap };
    const placement = { offsetX: 3, offsetY: -2, zoom: 2 };
    const parameters = { ...DEFAULTS, width: 2, depth: 2, layout: { regions: [], edgePadding: 0,
      pins: [{ id: 'top', x: 2, y: -1 }, { id: 'bottom', x: 4, y: -3 }, { id: 'outside', x: .99, y: -1 }] } };
    const pixels = sampleImagePixels(source, parameters, placement, 'pixel');
    expect([...layoutPixelsToRGB(pixels)]).toEqual([0,0,0, 127,127,255, 255,255,255]);
    expect([...mapImageToPins(source, parameters, 2, false, placement, 'pixel').heights]).toEqual([...layoutPixelsToHeights(pixels, 2, 20, false).heights]);
    expect([...mapImageToPins(source, parameters, 2, true, placement, 'pixel').heights]).toEqual([...layoutPixelsToHeights(pixels, 2, 20, true).heights]);
  });

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
  it('moves and zooms the same original RGBA samples for heights and colors, with white outside the image', () => {
    const rgba = new Uint8ClampedArray([0,0,0,255, 255,0,0,255, 255,255,255,255, 0,0,255,128]);
    const context = { drawImage: vi.fn(), getImageData: vi.fn(() => ({ data: rgba })) };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const source = { name: 'asymmetric.png', url: 'blob:test', bitmap: { width: 2, height: 2 } as ImageBitmap };
    const parameters = { ...DEFAULTS, width: 2, depth: 2, layout: { regions: [], edgePadding: 0, imageBounds: [0,0,2,2] as [number, number, number, number], pins: [{ id: 'a', x: -.5, y: .5 }, { id: 'b', x: 1.5, y: -1.5 }] } };
    const placement = { offsetX: .5, offsetY: -.5, zoom: 2 };
    const sampled = sampleImagePixels(source, parameters, placement);
    expect([...layoutPixelsToRGB(sampled)]).toEqual([0,0,0, 127,127,255]);
    expect([...mapImageToPins(source, parameters, 2, false, placement).heights]).toEqual([...layoutPixelsToHeights(sampled, 2, 20, false).heights]);
    expect([...sampleImagePixels(source, parameters, { offsetX: 100, offsetY: 100, zoom: 1 })]).toEqual([255,255,255,255,255,255,255,255]);
    expect(parameters.layout.pins[0]).toEqual({ id: 'a', x: -.5, y: .5 });
  });
});
