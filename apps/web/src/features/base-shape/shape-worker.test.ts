import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULTS } from '../pin-design/model';
import { DEFAULT_SHAPE } from './layout';
import { startShapeJob } from './shape-worker';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage?: (event: { data: unknown }) => void;
  onerror?: (event: { preventDefault: () => void }) => void;
  onmessageerror?: () => void;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() { FakeWorker.instances.push(this); }
}
afterEach(() => { vi.unstubAllGlobals(); FakeWorker.instances = []; });
describe('shape workers', () => {
  it('transfers raw contour pixels and terminates completed, failed, and cancelled workers', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const pixels = new Uint8ClampedArray(4);
    const task = startShapeJob({ parameters: DEFAULTS, shape: DEFAULT_SHAPE, image: { width: 1, height: 1, pixels } });
    const worker = FakeWorker.instances[0];
    expect(worker.postMessage.mock.calls[0][1]).toEqual([pixels.buffer]);
    worker.onmessage?.({ data: { error: 'No foreground' } });
    await expect(task.promise).rejects.toThrow('No foreground');
    expect(worker.terminate).toHaveBeenCalled();
    const next = startShapeJob({ parameters: DEFAULTS, shape: DEFAULT_SHAPE });
    next.cancel();
    expect(FakeWorker.instances[1].terminate).toHaveBeenCalled();
  });
});
