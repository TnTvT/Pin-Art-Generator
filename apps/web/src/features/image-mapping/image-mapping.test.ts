import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULTS } from '../pin-design/model';
import { layoutPixelsToHeights, layoutPixelsToRGB, mapImageToPins, sampleImagePixels, type SourceImage } from './image-mapping';

const rgba = new Uint8ClampedArray([0,0,0,255, 255,0,0,255, 255,255,255,255, 0,0,255,128]);
const source = { name: 'blocks.png', url: 'blob:blocks', bitmap: { width: 2, height: 2 } as ImageBitmap };
const parameters = { ...DEFAULTS, spacing: 5, diameter: 2, layout: { regions: [], edgePadding: 5,
  pins: [{ id: 'top-left', x: -2.5, y: 2.5 }, { id: 'top-right', x: 2.5, y: 2.5 },
    { id: 'bottom-left', x: -2.5, y: -2.5 }, { id: 'bottom-right', x: 2.5, y: -2.5 }] } };

function mockPixels() {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn(), getImageData: () => ({ data: rgba }) } as unknown as CanvasRenderingContext2D);
}
afterEach(() => vi.restoreAllMocks());

describe('compact-grid image sampling', () => {
  it('lets multiple pin tops share one pixel without blending neighboring pixels', () => {
    mockPixels();
    const dense = { ...parameters, layout: { ...parameters.layout,
      pins: [7.5, 2.5, -2.5, -7.5].flatMap((vertical, row) => [-7.5, -2.5, 2.5, 7.5].map((horizontal, column) => ({ id: `${row}:${column}`, x: horizontal, y: vertical }))) } };
    const pixels = sampleImagePixels(source, dense, undefined, 'pixel');
    expect([...layoutPixelsToRGB(pixels)].slice(0, 12)).toEqual([0,0,0, 0,0,0, 255,0,0, 255,0,0]);
    const heights = mapImageToPins(source, dense, 2, false, undefined, 'pixel').heights;
    expect(heights[0]).toBe(heights[1]);
    expect(heights[2]).toBe(heights[3]);
    expect([...layoutPixelsToRGB(pixels)].slice(-3)).toEqual([127,127,255]);
  });

  it.each(['pixel', 'smooth'] as const)('ignores physical gaps and base padding in %s mapping for an unchanged lattice', sampling => {
    mockPixels();
    const expected = sampleImagePixels(source, parameters, undefined, sampling);
    const wider = { ...parameters, width: 240, depth: 200, spacing: 10, layout: { ...parameters.layout, edgePadding: 20,
      pins: parameters.layout.pins.map(pin => ({ ...pin, x: pin.x * 2, y: pin.y * 2 })) } };
    expect([...sampleImagePixels(source, wider, undefined, sampling)]).toEqual([...expected]);
    expect([...sampleImagePixels(source, { ...parameters, diameter: 3 }, undefined, sampling)]).toEqual([...expected]);
    expect(parameters.layout.pins[0]).toEqual({ id: 'top-left', x: -2.5, y: 2.5 });
  });

  it('keeps Pixel height/color orientation, alpha and white outside consistent', () => {
    mockPixels();
    const pixels = sampleImagePixels(source, parameters, undefined, 'pixel');
    expect([...layoutPixelsToRGB(pixels)]).toEqual([0,0,0, 255,0,0, 255,255,255, 127,127,255]);
    expect([...mapImageToPins(source, parameters, 2, false, undefined, 'pixel').heights]).toEqual([...layoutPixelsToHeights(pixels, 2, 20, false).heights]);
    expect([...mapImageToPins(source, parameters, 2, true, undefined, 'pixel').heights]).toEqual([...layoutPixelsToHeights(pixels, 2, 20, true).heights]);
    expect([...sampleImagePixels(source, parameters, { offsetX: 100, offsetY: 100, zoom: 1 }, 'pixel')]).toEqual(Array(16).fill(255));
  });

  it('preserves legacy canvas ordering with the compact pin-top aspect ratio', () => {
    const context = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn(), imageSmoothingEnabled: false, imageSmoothingQuality: 'low',
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([0,0,0,255, 255,255,255,255]) })) };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const photo: SourceImage = { name: 'photo.png', url: 'blob:photo', bitmap: { width: 200, height: 100 } as ImageBitmap };
    const result = mapImageToPins(photo, { ...DEFAULTS, columns: 2, rows: 1, spacing: 5, diameter: 2 }, 2, false);
    expect(context.drawImage).toHaveBeenCalledWith(photo.bitmap, 0, 0, 2, 1);
    expect(context.getImageData).toHaveBeenCalledWith(0, 0, 2, 1);
    expect(context.fillStyle).toBe('#ffffff');
    expect(Array.from(result.heights)).toEqual([20, 2]);
  });

  it('reports unavailable canvas processing instead of producing invalid heights', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    expect(() => mapImageToPins(source, DEFAULTS, 2, false)).toThrow('Image processing is unavailable');
  });

  it('uses cropped foreground coordinates without altering the physical layout', () => {
    mockPixels();
    const pixels = sampleImagePixels(source, parameters);
    expect([...layoutPixelsToRGB(pixels)]).toEqual([0,0,0, 255,0,0, 255,255,255, 127,127,255]);
    expect([...sampleImagePixels(source, { ...parameters, layout: { ...parameters.layout, imageBounds: [0,0,2,2] } })]).toEqual([...pixels]);
  });

  it('moves and zooms the same compact samples for heights and colors', () => {
    mockPixels();
    const placement = { offsetX: 1, offsetY: -1, zoom: 2 };
    const sampled = sampleImagePixels(source, parameters, placement);
    expect([...layoutPixelsToRGB(sampled)].slice(0, 3)).toEqual([0,0,0]);
    expect([...layoutPixelsToRGB(sampled)].slice(-3)).toEqual([159,96,128]);
    expect([...mapImageToPins(source, parameters, 2, false, placement).heights]).toEqual([...layoutPixelsToHeights(sampled, 2, 20, false).heights]);
  });
});
