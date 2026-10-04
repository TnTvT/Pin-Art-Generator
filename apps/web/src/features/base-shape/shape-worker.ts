import type { Parameters } from '../pin-design/model';
import type { generateLayout, ShapeImage, ShapeOptions } from './layout';

export interface ShapeJob { parameters: Parameters; shape: ShapeOptions; image?: ShapeImage }
export function startShapeJob(request: ShapeJob) {
  const worker = new Worker(new URL('./shape.worker.ts', import.meta.url), { type: 'module' });
  const promise = new Promise<{ result: ReturnType<typeof generateLayout>; elapsedMs: number }>((resolve, reject) => {
    worker.onmessage = event => {
      worker.terminate();
      if ('error' in event.data) reject(new Error(event.data.error));
      else resolve(event.data);
    };
    worker.onerror = event => {
      event.preventDefault();
      worker.terminate();
      reject(new Error('Shape processing is unavailable. Retry the settings.'));
    };
    worker.onmessageerror = () => { worker.terminate(); reject(new Error('Shape processing returned an unreadable result.')); };
    try { worker.postMessage(request, request.image ? [request.image.pixels.buffer] : []); }
    catch (error) { worker.terminate(); reject(error); }
  });
  return { promise, cancel: () => worker.terminate() };
}
