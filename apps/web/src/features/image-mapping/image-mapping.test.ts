import { describe, expect, it, vi } from 'vitest';
import { DEFAULTS } from '../pin-design/model';
import { mapImageToPins, type SourceImage } from './image-mapping';

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
});
