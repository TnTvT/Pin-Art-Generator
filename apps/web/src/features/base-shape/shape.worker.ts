import { generateLayout } from './layout';
import type { ShapeJob } from './shape-worker';

self.onmessage = (event: MessageEvent<ShapeJob>) => {
  try {
    const start = performance.now();
    self.postMessage({ result: generateLayout(event.data.parameters, event.data.shape, event.data.image), elapsedMs: performance.now() - start });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Shape generation failed.' });
  }
};
