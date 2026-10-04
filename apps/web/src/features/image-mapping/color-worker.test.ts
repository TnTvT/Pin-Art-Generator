import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MODEL_MATERIALS } from '../filaments/materials';
import { DEFAULT_COLOR_MAPPING } from './color-mapping';
import { startColorMapping } from './color-worker';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { FakeWorker.instances.push(this); }
}
const request = () => ({ ...DEFAULT_COLOR_MAPPING, rgb: new Uint8Array([255, 255, 255]), base: DEFAULT_MODEL_MATERIALS.base, overrides: [] });

beforeEach(() => {
  FakeWorker.instances.length = 0;
  vi.stubGlobal('Worker', FakeWorker);
});

describe('color worker ownership', () => {
  it('transfers sampled RGB and terminates after a successful reply', async () => {
    const input = request();
    const task = startColorMapping(input);
    const worker = FakeWorker.instances[0];
    expect(worker.postMessage).toHaveBeenCalledWith(input, [input.rgb.buffer]);
    const reply = { result: { materials: [DEFAULT_MODEL_MATERIALS.pins], palette: [], notice: null }, elapsedMs: 5 };
    worker.onmessage!(new MessageEvent('message', { data: reply }));
    await expect(task.promise).resolves.toEqual(reply);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('returns readable errors and terminates on calculation and transport failures', async () => {
    for (const failure of ['calculation', 'load', 'message']) {
      const task = startColorMapping(request());
      const worker = FakeWorker.instances.at(-1)!;
      if (failure === 'calculation') worker.onmessage!(new MessageEvent('message', { data: { error: 'Choose fewer filaments.' } }));
      else if (failure === 'load') worker.onerror!(new ErrorEvent('error', { cancelable: true }));
      else worker.onmessageerror!();
      await expect(task.promise).rejects.toThrow(/filaments|processing/i);
      expect(worker.terminate).toHaveBeenCalledOnce();
    }
  });

  it('terminates a cancelled job and a failed postMessage', async () => {
    const task = startColorMapping(request());
    task.cancel();
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
    class BrokenWorker extends FakeWorker {
      postMessage = vi.fn(() => { throw new Error('Transfer failed'); });
    }
    vi.stubGlobal('Worker', BrokenWorker);
    const broken = startColorMapping(request());
    await expect(broken.promise).rejects.toThrow(/Transfer failed/);
    expect(FakeWorker.instances.at(-1)!.terminate).toHaveBeenCalledOnce();
  });
});
