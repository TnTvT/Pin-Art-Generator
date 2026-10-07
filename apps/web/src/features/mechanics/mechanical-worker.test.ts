import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULTS } from '../pin-design/model';
import { startMechanicalJob } from './mechanical-worker';

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
describe('mechanical worker lifecycle', () => {
  it('returns buffers and terminates on completion, failures and cancellation', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const task = startMechanicalJob(DEFAULTS);
    const mesh = { positions: new Float32Array([0, 0, 0]), elapsedMs: 1 };
    FakeWorker.instances[0].onmessage?.({ data: mesh });
    await expect(task.promise).resolves.toEqual(mesh);
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
    const failed = startMechanicalJob(DEFAULTS);
    FakeWorker.instances[1].onmessage?.({ data: { error: 'Invalid guide' } });
    await expect(failed.promise).rejects.toThrow('Invalid guide');
    const cancelled = startMechanicalJob(DEFAULTS);
    const rejection = expect(cancelled.promise).rejects.toThrow('cancelled');
    cancelled.cancel(); await rejection;
    expect(FakeWorker.instances[2].terminate).toHaveBeenCalledOnce();
  });
});
