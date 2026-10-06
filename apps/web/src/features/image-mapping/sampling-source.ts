import type { SourceImage } from './image-mapping';
import type { ImageSampling } from './image-sampling';

interface CachedSource {
  promise: Promise<SourceImage>;
  bitmap?: ImageBitmap;
}

const cache = new WeakMap<SourceImage, Map<ImageSampling, CachedSource>>();
const disposed = new WeakSet<SourceImage>();

export async function prepareSamplingSource(source: SourceImage, sampling: ImageSampling): Promise<SourceImage> {
  if (disposed.has(source)) throw new Error('This image is no longer available.');
  if (!source.originalSize || source.originalSize.width === source.bitmap.width && source.originalSize.height === source.bitmap.height) return source;
  let entries = cache.get(source);
  if (!entries) { entries = new Map(); cache.set(source, entries); }
  const previous = entries.get(sampling);
  if (previous) return previous.promise;
  const entry: CachedSource = { promise: Promise.resolve(source) };
  entries.set(sampling, entry);
  entry.promise = (async () => {
    let owned: ImageBitmap | undefined;
    try {
      if (sampling === 'pixel') {
        if (!source.blob) throw new Error('The original image is missing. Upload it again to use Pixel sampling.');
        owned = await createImageBitmap(source.blob, { resizeWidth: source.bitmap.width, resizeHeight: source.bitmap.height, resizeQuality: 'pixelated' });
      }
      if (disposed.has(source)) throw new Error('This image is no longer available.');
      const bitmap = owned ?? source.bitmap;
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Image processing is unavailable in this browser.');
      context.drawImage(bitmap, 0, 0);
      const url = canvas.toDataURL('image/png');
      entry.bitmap = owned;
      return { name: source.name, bitmap, url };
    } catch (error) {
      owned?.close();
      entries.delete(sampling);
      throw error;
    }
  })();
  return entry.promise;
}

export function releaseSamplingSource(source: SourceImage) {
  if (disposed.has(source)) return;
  disposed.add(source);
  for (const entry of cache.get(source)?.values() ?? []) entry.bitmap?.close();
  cache.delete(source);
}
