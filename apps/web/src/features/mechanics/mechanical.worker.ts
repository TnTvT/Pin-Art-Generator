import type { Parameters } from '../pin-design/model';
import { buildMechanicalBase } from './preview-geometry';

self.onmessage = (event: MessageEvent<Parameters>) => {
  try {
    const mesh = buildMechanicalBase(event.data);
    self.postMessage(mesh, { transfer: [mesh.positions.buffer] });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Mechanical geometry failed.' });
  }
};
