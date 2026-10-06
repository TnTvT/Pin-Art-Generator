import { useState } from 'react';
import type { SourceImage } from './image-mapping';
import { DEFAULT_IMAGE_PLACEMENT, type ImagePlacement } from './image-placement';

export default function useImagePlacement(source: SourceImage | null) {
  const [state, setState] = useState({ source, placement: DEFAULT_IMAGE_PLACEMENT });
  if (state.source !== source) setState({ source, placement: DEFAULT_IMAGE_PLACEMENT });
  return {
    placement: state.source === source ? state.placement : DEFAULT_IMAGE_PLACEMENT,
    change: (placement: ImagePlacement) => setState({ source, placement }),
    restore: (previous: SourceImage | null, placement = DEFAULT_IMAGE_PLACEMENT) => setState({ source: previous, placement }),
  };
}
