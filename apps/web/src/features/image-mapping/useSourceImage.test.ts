import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import useSourceImage from './useSourceImage';

const decode = vi.fn<(source: unknown, options?: ImageBitmapOptions) => Promise<ImageBitmap>>();
const createObjectURL = vi.fn(() => 'blob:image');
const revokeObjectURL = vi.fn();
const bitmap = (width = 200, height = 100) => ({ width, height, close: vi.fn() }) as unknown as ImageBitmap;
const file = (type = 'image/png') => new File(['image'], 'picture.png', { type });

function deferredBitmap() {
  let resolve!: (image: ImageBitmap) => void;
  const promise = new Promise<ImageBitmap>((finish) => { resolve = finish; });
  return { promise, resolve };
}

beforeEach(() => {
  decode.mockReset();
  createObjectURL.mockReset().mockReturnValue('blob:image');
  revokeObjectURL.mockReset();
  vi.stubGlobal('createImageBitmap', decode);
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = createObjectURL;
    static revokeObjectURL = revokeObjectURL;
  });
});

describe('source image lifecycle', () => {
  it.each(['image/png', 'image/jpeg', 'image/webp'])('loads supported images: %s', async (type) => {
    const decoded = bitmap();
    decode.mockResolvedValue(decoded);
    const { result } = renderHook(useSourceImage);
    await act(async () => { await result.current.upload(file(type)); });
    expect(result.current.source?.bitmap).toBe(decoded);
    expect(result.current.source?.url).toBe('blob:image');
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('rejects unsupported files and oversized images before decoding', async () => {
    const { result } = renderHook(useSourceImage);
    await act(async () => { await result.current.upload(file('image/svg+xml')); });
    expect(result.current.error).toContain('PNG, JPG, or WebP');
    const oversized = file();
    Object.defineProperty(oversized, 'size', { value: 20 * 1024 * 1024 + 1 });
    await act(async () => { await result.current.upload(oversized); });
    expect(result.current.error).toContain('20 MB');
    expect(decode).not.toHaveBeenCalled();
  });

  it('preserves the previous image when the replacement cannot be decoded', async () => {
    const previous = bitmap();
    decode.mockResolvedValueOnce(previous).mockRejectedValueOnce(new Error('Invalid image'));
    const { result } = renderHook(useSourceImage);
    await act(async () => { await result.current.upload(file()); });
    await act(async () => { await result.current.upload(file()); });
    expect(result.current.source?.bitmap).toBe(previous);
    expect(previous.close).not.toHaveBeenCalled();
    expect(result.current.error).toContain('could not be read');
    expect(result.current.loading).toBe(false);
  });

  it('resizes large images without changing their aspect ratio and releases the original bitmap', async () => {
    const original = bitmap(2400, 1200);
    const resized = bitmap(1024, 512);
    decode.mockResolvedValueOnce(original).mockResolvedValueOnce(resized);
    const { result } = renderHook(useSourceImage);
    await act(async () => { await result.current.upload(file()); });
    expect(decode).toHaveBeenLastCalledWith(original, { resizeWidth: 1024, resizeHeight: 512, resizeQuality: 'high' });
    expect(original.close).toHaveBeenCalledOnce();
    expect(result.current.source?.bitmap).toBe(resized);
  });

  it('releases the decoded bitmap even when resizing fails', async () => {
    const original = bitmap(2000, 1000);
    decode.mockResolvedValueOnce(original).mockRejectedValueOnce(new Error('Resize failed'));
    const { result } = renderHook(useSourceImage);
    await act(async () => { await result.current.upload(file()); });
    expect(original.close).toHaveBeenCalledOnce();
    expect(result.current.source).toBeNull();
    expect(result.current.error).toContain('could not be read');
  });

  it('keeps the newest upload when an earlier decode finishes later', async () => {
    const pending = deferredBitmap();
    const older = bitmap();
    const newer = bitmap();
    decode.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(newer);
    const { result } = renderHook(useSourceImage);
    let firstUpload!: Promise<void>;
    act(() => { firstUpload = result.current.upload(file()); });
    await act(async () => { await result.current.upload(file()); });
    await act(async () => { pending.resolve(older); await firstUpload; });
    expect(result.current.source?.bitmap).toBe(newer);
    expect(older.close).toHaveBeenCalledOnce();
    expect(newer.close).not.toHaveBeenCalled();
  });

  it('does not restore a removed image when a pending decode finishes', async () => {
    const pending = deferredBitmap();
    const decoded = bitmap();
    decode.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(useSourceImage);
    let upload!: Promise<void>;
    act(() => { upload = result.current.upload(file()); });
    act(() => result.current.remove());
    await act(async () => { pending.resolve(decoded); await upload; });
    expect(result.current.source).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(decoded.close).toHaveBeenCalledOnce();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('releases URLs and bitmaps on replacement and unmount', async () => {
    const first = bitmap();
    const second = bitmap();
    decode.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    createObjectURL.mockReturnValueOnce('blob:first').mockReturnValueOnce('blob:second');
    const { result, unmount } = renderHook(useSourceImage);
    await act(async () => { await result.current.upload(file()); });
    await act(async () => { await result.current.upload(file()); });
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:first');
    expect(first.close).toHaveBeenCalledOnce();
    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:second');
    expect(second.close).toHaveBeenCalledOnce();
  });
  it('retains the applied bitmap until a changed image is accepted or a layout confirmation is cancelled', async () => {
    const first = bitmap(), second = bitmap(), third = bitmap();
    decode.mockResolvedValueOnce(first).mockResolvedValueOnce(second).mockResolvedValueOnce(third);
    const { result, unmount } = renderHook(() => useSourceImage(true));
    await act(async () => { await result.current.upload(file()); });
    act(() => result.current.accept());
    await act(async () => { await result.current.upload(file()); });
    expect(first.close).not.toHaveBeenCalled();
    act(() => result.current.restore());
    expect(result.current.source?.bitmap).toBe(first);
    expect(second.close).toHaveBeenCalledOnce();
    await act(async () => { await result.current.upload(file()); });
    act(() => result.current.accept());
    expect(first.close).toHaveBeenCalledOnce();
    unmount();
    expect(third.close).toHaveBeenCalledOnce();
  });
});
