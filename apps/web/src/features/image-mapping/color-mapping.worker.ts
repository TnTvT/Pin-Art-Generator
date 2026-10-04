import { mapPinColors, type ColorMappingRequest, type ColorMappingResult } from './color-mapping';

export type ColorWorkerReply = { result: ColorMappingResult; elapsedMs: number } | { error: string };

self.onmessage = (event: MessageEvent<ColorMappingRequest>) => {
  const start = performance.now();
  let reply: ColorWorkerReply;
  try {
    reply = { result: mapPinColors(event.data), elapsedMs: performance.now() - start };
  } catch (error) {
    reply = { error: error instanceof Error ? error.message : 'Color mapping failed.' };
  }
  self.postMessage(reply);
};
