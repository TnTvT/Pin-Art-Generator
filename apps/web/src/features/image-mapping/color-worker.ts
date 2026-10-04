import type { ColorMappingRequest } from './color-mapping';
import type { ColorWorkerReply } from './color-mapping.worker';

export function startColorMapping(request: ColorMappingRequest) {
  const worker = new Worker(new URL('./color-mapping.worker.ts', import.meta.url), { type: 'module' });
  const promise = new Promise<Exclude<ColorWorkerReply, { error: string }>>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<ColorWorkerReply>) => {
      worker.terminate();
      if ('error' in event.data) reject(new Error(event.data.error));
      else resolve(event.data);
    };
    worker.onerror = event => {
      event.preventDefault();
      worker.terminate();
      reject(new Error('Color processing is unavailable. Retry or switch to Height mapping.'));
    };
    worker.onmessageerror = () => {
      worker.terminate();
      reject(new Error('Color processing returned an unreadable result. Retry the mapping.'));
    };
    try { worker.postMessage(request, [request.rgb.buffer]); }
    catch (error) { worker.terminate(); reject(error); }
  });
  return { promise, cancel: () => worker.terminate() };
}
