import { describe, expect, it, vi } from 'vitest';
import { DEFAULTS } from '../pin-design/model';
import { DEFAULT_MODEL_MATERIALS } from '../filaments/materials';
import { buildExportRequest, DEFAULT_EXPORT_OPTIONS } from './export-request';
import { ExportBusyError, fetchExport, fetchExportAvailability } from './export-client';

const request = () => buildExportRequest(DEFAULTS, undefined, DEFAULT_MODEL_MATERIALS, DEFAULT_EXPORT_OPTIONS, '3mf');

describe('export fetch', () => {
  it('preserves an approximate busy estimate without claiming a queued export', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: {
      code: 'EXPORT_BUSY', message: 'Your request has not been queued.', estimatedWaitSeconds: 95, estimateKind: 'upper-bound',
    } }), { status: 503, headers: { 'Retry-After': '5' } })));
    const failure = await fetchExport(request(), new AbortController().signal).catch(error => error);
    expect(failure).toBeInstanceOf(ExportBusyError);
    expect(failure.availability).toEqual({ busy: true, estimatedWaitSeconds: 95, estimateKind: 'upper-bound' });
    expect(failure.message).not.toMatch(/Retry in 5/);
  });

  it('checks availability without posting another export and rejects malformed estimates', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ busy: false, estimatedWaitSeconds: 0, estimateKind: 'upper-bound' }))
      .mockResolvedValueOnce(Response.json({ busy: true, estimatedWaitSeconds: -10, estimateKind: 'upper-bound' }));
    vi.stubGlobal('fetch', fetchMock);
    const signal = new AbortController().signal;
    expect(await fetchExportAvailability(signal)).toEqual({ busy: false, estimatedWaitSeconds: 0, estimateKind: 'upper-bound' });
    expect(fetchMock).toHaveBeenCalledWith('/api/exports/status', { cache: 'no-store', signal });
    await expect(fetchExportAvailability(signal)).rejects.toThrow(/availability/i);
  });

  it('posts JSON with an abort signal and reads binary, filename and plate count', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('binary', {
      headers: { 'Content-Disposition': 'attachment; filename="pin-art.3mf"', 'X-Plate-Count': '1' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    const payload = request();
    const result = await fetchExport(payload, controller.signal);
    expect(fetchMock).toHaveBeenCalledWith('/api/exports', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal,
    });
    expect(result.blob.size).toBe(6);
    expect(result.filename).toBe('pin-art.3mf');
    expect(result.plateCount).toBe(1);
  });

  it('uses encoded Content-Disposition filenames and strips path components', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('binary', {
      headers: { 'Content-Disposition': "attachment; filename*=UTF-8''..%2Fpin%20art.3mf", 'X-Plate-Count': '1' },
    })));
    expect((await fetchExport(request(), new AbortController().signal)).filename).toBe('pin art.3mf');
  });

  it('surfaces the structured server error instead of downloading JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'BED_TOO_SMALL', message: 'Increase bed width.' } }), { status: 422 })));
    await expect(fetchExport(request(), new AbortController().signal)).rejects.toThrow('Increase bed width. (BED_TOO_SMALL)');
  });

  it('gives readable errors for offline and non-JSON failures', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response('<html>Unavailable</html>', { status: 502 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchExport(request(), new AbortController().signal)).rejects.toThrow(/connect.*export service/i);
    await expect(fetchExport(request(), new AbortController().signal)).rejects.toThrow(/502/);
  });

  it.each([429, 503])('shows the retry delay without automatically resubmitting HTTP %s', async status => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'Please wait.' } }), {
      status, headers: { 'Retry-After': '45' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchExport(request(), new AbortController().signal)).rejects.toThrow('Retry in 45 seconds.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not suggest localhost to users when the deployed service is offline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(fetchExport(request(), new AbortController().signal)).rejects.not.toThrow('localhost');
  });

  it('rejects empty binaries and invalid plate counts and preserves aborts', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(''))
      .mockResolvedValueOnce(new Response('binary', { headers: { 'X-Plate-Count': '37' } }))
      .mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchExport(request(), new AbortController().signal)).rejects.toThrow(/empty/i);
    await expect(fetchExport(request(), new AbortController().signal)).rejects.toThrow(/plate count/i);
    await expect(fetchExport(request(), new AbortController().signal)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it.each(['0', '2', '36', '1.5', 'invalid'])('rejects unsupported plate count %s', async plateCount => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('binary', { headers: { 'X-Plate-Count': plateCount } })));
    await expect(fetchExport(request(), new AbortController().signal)).rejects.toThrow(/plate count/i);
  });
});
