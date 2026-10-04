import { useCallback, useEffect, useRef, useState } from 'react';
import { type SourceImage } from './image-mapping';
import { createSampleImage } from './sample-image';

function releaseImage(image: SourceImage | null) {
  if (!image) return;
  URL.revokeObjectURL(image.url);
  image.bitmap.close();
}

export default function useSourceImage(deferredRelease = false) {
  const [source, setSource] = useState<SourceImage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<SourceImage | null>(null);
  const accepted = useRef<SourceImage | null>(null);
  const requestId = useRef(0);

  useEffect(() => () => {
    requestId.current += 1;
    releaseImage(current.current);
    if (accepted.current !== current.current) releaseImage(accepted.current);
    current.current = null;
  }, []);

  async function upload(file: File | null) {
    if (!file) return;
    const activeRequest = ++requestId.current;
    setError(null);
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError('Choose a PNG, JPG, or WebP image.');
      setLoading(false);
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setError('Choose an image smaller than 20 MB.');
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const decoded = await createImageBitmap(file);
      let bitmap = decoded;
      const longestSide = Math.max(decoded.width, decoded.height);
      if (longestSide > 1024) {
        try {
          bitmap = await createImageBitmap(decoded, {
            resizeWidth: Math.max(1, Math.round(decoded.width * 1024 / longestSide)),
            resizeHeight: Math.max(1, Math.round(decoded.height * 1024 / longestSide)),
            resizeQuality: 'high',
          });
        } finally {
          decoded.close();
        }
      }
      if (activeRequest !== requestId.current) {
        bitmap.close();
        return;
      }
      const nextImage = { name: file.name, url: URL.createObjectURL(file), bitmap };
      if (!deferredRelease || current.current !== accepted.current) releaseImage(current.current);
      current.current = nextImage;
      setSource(nextImage);
    } catch {
      if (activeRequest === requestId.current) setError('This image could not be read. Try another PNG, JPG, or WebP file.');
    } finally {
      if (activeRequest === requestId.current) setLoading(false);
    }
  }

  function remove() {
    requestId.current += 1;
    if (!deferredRelease || current.current !== accepted.current) releaseImage(current.current);
    current.current = null;
    setSource(null);
    setError(null);
    setLoading(false);
  }

  async function useSample() {
    try {
      await upload(await createSampleImage());
    } catch {
      setError('Could not create the sample image. Please upload an image instead.');
    }
  }

  const accept = useCallback(() => {
    if (accepted.current !== current.current) releaseImage(accepted.current);
    accepted.current = current.current;
  }, []);
  const restore = useCallback(() => {
    requestId.current += 1;
    if (accepted.current !== current.current) releaseImage(current.current);
    current.current = accepted.current;
    setSource(accepted.current);
    setLoading(false);
    setError(null);
  }, []);
  return { source, loading, error, upload, remove, useSample, accept, restore };
}
