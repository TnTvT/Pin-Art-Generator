import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SourceImage } from './image-mapping';
import { DEFAULT_IMAGE_PLACEMENT } from './image-placement';
import useImagePlacement from './useImagePlacement';

describe('image placement lifecycle', () => {
  it('keeps placement for the same source, resets for replacement/removal, and restores cancelled layout changes', () => {
    const source = { name: 'first', url: 'blob:first', bitmap: {} } as SourceImage;
    const replacement = { name: 'second', url: 'blob:second', bitmap: {} } as SourceImage;
    const { result, rerender } = renderHook(({ image }: { image: SourceImage | null }) => useImagePlacement(image), { initialProps: { image: source as SourceImage | null } });
    const placement = { offsetX: 12, offsetY: -4, zoom: 2 };
    act(() => result.current.change(placement));
    rerender({ image: source });
    expect(result.current.placement).toEqual(placement);
    rerender({ image: replacement });
    expect(result.current.placement).toEqual(DEFAULT_IMAGE_PLACEMENT);
    act(() => { result.current.restore(source, placement); rerender({ image: source }); });
    expect(result.current.placement).toEqual(placement);
    rerender({ image: null });
    expect(result.current.placement).toEqual(DEFAULT_IMAGE_PLACEMENT);
  });
});
