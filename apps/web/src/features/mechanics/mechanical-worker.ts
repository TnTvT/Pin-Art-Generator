import type { Parameters } from '../pin-design/model';
import type { MechanicalMesh } from './preview-geometry';

export function startMechanicalJob(parameters: Parameters) {
  const worker = new Worker(new URL('./mechanical.worker.ts', import.meta.url), { type: 'module' });
  let rejectTask: (error: Error) => void;
  let finished = false;
  const promise = new Promise<MechanicalMesh>((resolve, reject) => {
    rejectTask = reject;
    function fail(message: string) { finished = true; worker.terminate(); reject(new Error(message)); }
    worker.onmessage = event => {
      if ('error' in event.data) fail(event.data.error);
      else { finished = true; worker.terminate(); resolve(event.data); }
    };
    worker.onerror = event => { event.preventDefault(); fail('Mechanical geometry processing failed. Retry the settings.'); };
    worker.onmessageerror = () => fail('Mechanical geometry returned an unreadable result.');
    try { worker.postMessage(parameters); } catch { fail('Mechanical geometry could not start. Retry the settings.'); }
  });
  return { promise, cancel: () => { worker.terminate(); if (!finished) { finished = true; rejectTask(new Error('Mechanical geometry cancelled.')); } } };
}
