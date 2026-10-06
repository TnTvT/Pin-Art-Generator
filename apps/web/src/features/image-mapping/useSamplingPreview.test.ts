import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SourceImage } from './image-mapping';
import type { ImageSampling } from './image-sampling';
import { prepareSamplingSource } from './sampling-source';
import useSamplingPreview from './useSamplingPreview';

vi.mock('./sampling-source', () => ({ prepareSamplingSource: vi.fn() }));
const source = { name: 'large', url: 'blob:large', bitmap: { width: 1024, height: 512 }, originalSize: { width: 2000, height: 1000 } } as SourceImage;
beforeEach(() => vi.mocked(prepareSamplingSource).mockReset());

describe('sampling adjustment preview', () => {
  it('uses small source images immediately without decoding or loading placeholders', () => {
    const small = { ...source, originalSize: { width: 1024, height: 512 } };
    const { result } = renderHook(() => useSamplingPreview(small, 'pixel'));
    expect(result.current.source).toBe(small);
    expect(result.current.loading).toBe(false);
    expect(prepareSamplingSource).not.toHaveBeenCalled();
  });

  it('ignores a late Pixel preview after switching to Smooth and never displays a mixed version', async () => {
    let finish!: (source: SourceImage) => void;
    const smooth = { ...source, url: 'data:smooth' }, pixel = { ...source, url: 'data:pixel' };
    vi.mocked(prepareSamplingSource).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(smooth);
    const { result, rerender } = renderHook(({ sampling }) => useSamplingPreview(source, sampling), { initialProps: { sampling: 'pixel' as ImageSampling } });
    expect(result.current.source).toBeNull();
    expect(result.current.loading).toBe(true);
    rerender({ sampling: 'smooth' });
    await waitFor(() => expect(result.current.source).toBe(smooth));
    await act(async () => finish(pixel));
    expect(result.current.source).toBe(smooth);
  });

  it('exposes retryable errors without using the original smoothed raster for Pixel', async () => {
    const pixel = { ...source, url: 'data:pixel' };
    vi.mocked(prepareSamplingSource).mockRejectedValueOnce(new Error('Decode failed')).mockResolvedValue(pixel);
    const { result } = renderHook(() => useSamplingPreview(source, 'pixel'));
    await waitFor(() => expect(result.current.error).toBe('Decode failed'));
    expect(result.current.source).toBeNull();
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.source).toBe(pixel));
  });
});
