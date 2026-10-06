import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SourceImage } from './image-mapping';
import { prepareSamplingSource, releaseSamplingSource } from './sampling-source';

const decode = vi.fn();
const bitmap = () => ({ width: 1024, height: 512, close: vi.fn() }) as unknown as ImageBitmap;
const sourceImage = (): SourceImage => ({ name: 'large.png', url: 'blob:large', bitmap: bitmap(), blob: new Blob(['image']), originalSize: { width: 2400, height: 1200 } });

beforeEach(() => {
  decode.mockReset();
  vi.stubGlobal('createImageBitmap', decode);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,raster');
});

describe('sampling source ownership', () => {
  it('uses the original Blob for Pixel downsizing, caches it and leaves contour identity unchanged', async () => {
    const source = sourceImage(), pixel = bitmap();
    decode.mockResolvedValue(pixel);
    const first = await prepareSamplingSource(source, 'pixel');
    const second = await prepareSamplingSource(source, 'pixel');
    expect(decode).toHaveBeenCalledExactlyOnceWith(source.blob, { resizeWidth: 1024, resizeHeight: 512, resizeQuality: 'pixelated' });
    expect(first).toBe(second);
    expect(first.bitmap).toBe(pixel);
    expect(first.url).toBe('data:image/png;base64,raster');
    expect(source.bitmap).not.toBe(pixel);
    expect(source.url).toBe('blob:large');
    releaseSamplingSource(source);
    releaseSamplingSource(source);
    expect(pixel.close).toHaveBeenCalledOnce();
    expect(source.bitmap.close).not.toHaveBeenCalled();
  });

  it('reuses unresized images and previews the canonical Smooth raster without another decode', async () => {
    const large = sourceImage();
    const small = { ...large, originalSize: { width: 1024, height: 512 } };
    expect(await prepareSamplingSource(small, 'pixel')).toBe(small);
    const smooth = await prepareSamplingSource(large, 'smooth');
    expect(smooth.bitmap).toBe(large.bitmap);
    expect(smooth.url).toContain('data:image/png');
    expect(decode).not.toHaveBeenCalled();
    releaseSamplingSource(large);
    releaseSamplingSource(small);
    expect(large.bitmap.close).not.toHaveBeenCalled();
  });

  it('closes stale decoded resources after release and never returns a disposed source', async () => {
    const source = sourceImage(), pixel = bitmap();
    let finish!: (image: ImageBitmap) => void;
    decode.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const pending = prepareSamplingSource(source, 'pixel');
    const rejected = expect(pending).rejects.toThrow(/no longer available/);
    releaseSamplingSource(source);
    finish(pixel);
    await rejected;
    expect(pixel.close).toHaveBeenCalledOnce();
    await expect(prepareSamplingSource(source, 'smooth')).rejects.toThrow(/no longer available/);
  });

  it('allows retry after a decode failure and releases a bitmap when preview preparation fails', async () => {
    const source = sourceImage(), pixel = bitmap();
    decode.mockRejectedValueOnce(new Error('Decode failed')).mockResolvedValue(pixel);
    await expect(prepareSamplingSource(source, 'pixel')).rejects.toThrow('Decode failed');
    vi.mocked(HTMLCanvasElement.prototype.toDataURL).mockImplementationOnce(() => { throw new Error('Preview failed'); });
    await expect(prepareSamplingSource(source, 'pixel')).rejects.toThrow('Preview failed');
    expect(pixel.close).toHaveBeenCalledOnce();
    const retryPixel = bitmap();
    decode.mockResolvedValue(retryPixel);
    expect((await prepareSamplingSource(source, 'pixel')).bitmap).toBe(retryPixel);
    releaseSamplingSource(source);
    expect(retryPixel.close).toHaveBeenCalledOnce();
  });
});
