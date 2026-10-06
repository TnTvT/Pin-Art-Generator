import { useEffect, useState } from 'react';
import type { SourceImage } from './image-mapping';
import type { ImageSampling } from './image-sampling';
import { prepareSamplingSource } from './sampling-source';

export default function useSamplingPreview(source: SourceImage, sampling: ImageSampling) {
  const [retryVersion, setRetryVersion] = useState(0);
  const [status, setStatus] = useState<{ original: SourceImage; sampling: ImageSampling; version: number; preview: SourceImage | null; error: string | null } | null>(null);
  const resized = !!source.originalSize && (source.originalSize.width !== source.bitmap.width || source.originalSize.height !== source.bitmap.height);
  useEffect(() => {
    if (!resized) return;
    let active = true;
    void prepareSamplingSource(source, sampling).then(preview => {
      if (active) setStatus({ original: source, sampling, version: retryVersion, preview, error: null });
    }).catch(error => {
      if (active) setStatus({ original: source, sampling, version: retryVersion, preview: null, error: error instanceof Error ? error.message : 'Image preview could not be prepared.' });
    });
    return () => { active = false; };
  }, [source, sampling, resized, retryVersion]);
  const current = status?.original === source && status.sampling === sampling && status.version === retryVersion ? status : null;
  return { source: resized ? current?.preview ?? null : source, loading: resized && !current, error: resized ? current?.error ?? null : null,
    retry: () => setRetryVersion(version => version + 1) };
}
