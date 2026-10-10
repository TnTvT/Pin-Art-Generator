import { type ExportRequest } from './export-request';

export interface ExportResult {
  blob: Blob;
  filename: string;
  plateCount: number | null;
}

function downloadFilename(header: string | null, fallback: string) {
  const encoded = header?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  let filename = header?.match(/filename=(?:"([^"]+)"|([^;]+))/i)?.slice(1).find(Boolean) ?? fallback;
  if (encoded) {
    try { filename = decodeURIComponent(encoded.trim()); } catch { filename = fallback; }
  }
  return filename.trim().split(/[\\/]/).pop()?.replace(/[\x00-\x1f\x7f]/g, '') || fallback;
}

export async function fetchExport(request: ExportRequest, signal: AbortSignal): Promise<ExportResult> {
  let response: Response;
  try {
    response = await fetch('/api/exports', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request), signal,
    });
  } catch (error) {
    if (signal.aborted || ((error instanceof Error || error instanceof DOMException) && error.name === 'AbortError')) throw error;
    throw new Error('Could not connect to the export service. Check that the backend is running on localhost:8000, then retry.');
  }
  if (!response.ok || response.headers.get('Content-Type')?.includes('application/json')) {
    let message = `Export failed (HTTP ${response.status}). Please retry.`;
    try {
      const body: unknown = await response.json();
      if (body && typeof body === 'object' && 'error' in body) {
        const error = body.error;
        if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
          const code = 'code' in error && typeof error.code === 'string' ? ` (${error.code})` : '';
          message = `${error.message}${code}`;
        }
      }
    } catch {
      message = `Export failed (HTTP ${response.status}). The service returned an unreadable error. Please retry.`;
    }
    throw new Error(message);
  }
  const blob = await response.blob();
  if (blob.size === 0) throw new Error('The export service returned an empty file. Please retry.');
  const plateHeader = response.headers.get('X-Plate-Count');
  const plateCount = plateHeader === null ? null : Number(plateHeader);
  if (plateCount !== null && plateCount !== 1) throw new Error('The export service returned an invalid plate count. Please retry.');
  return {
    blob, filename: downloadFilename(response.headers.get('Content-Disposition'), `pin-art.${request.format}`), plateCount,
  };
}
