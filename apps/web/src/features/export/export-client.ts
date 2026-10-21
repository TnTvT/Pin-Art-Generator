import { type ExportRequest } from './export-request';

export interface ExportResult {
  blob: Blob;
  filename: string;
  plateCount: number | null;
}

export interface ExportAvailability {
  busy: boolean;
  estimatedWaitSeconds: number | null;
  estimateKind: 'upper-bound';
}

export class ExportBusyError extends Error {
  constructor(message: string, readonly availability: ExportAvailability) {
    super(message);
    this.name = 'ExportBusyError';
  }
}

function validWait(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 600;
}

export async function fetchExportAvailability(signal: AbortSignal): Promise<ExportAvailability> {
  const response = await fetch('/api/exports/status', { cache: 'no-store', signal });
  const body: unknown = await response.json();
  if (!response.ok || !body || typeof body !== 'object' || !('busy' in body) || typeof body.busy !== 'boolean'
    || !('estimatedWaitSeconds' in body) || !validWait(body.estimatedWaitSeconds)
    || !('estimateKind' in body) || body.estimateKind !== 'upper-bound') {
    throw new Error('Could not check exporter availability. Please retry manually.');
  }
  return { busy: body.busy, estimatedWaitSeconds: body.estimatedWaitSeconds, estimateKind: body.estimateKind };
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
    throw new Error('Could not connect to the export service. Check your connection, then retry.');
  }
  if (!response.ok || response.headers.get('Content-Type')?.includes('application/json')) {
    let message = `Export failed (HTTP ${response.status}). Please retry.`;
    let availability: ExportAvailability | null = null;
    try {
      const body: unknown = await response.json();
      if (body && typeof body === 'object' && 'error' in body) {
        const error = body.error;
        if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
          const code = 'code' in error && typeof error.code === 'string' ? ` (${error.code})` : '';
          message = `${error.message}${code}`;
          if (response.status === 503 && 'code' in error && error.code === 'EXPORT_BUSY') {
            message = error.message;
            availability = { busy: true, estimateKind: 'upper-bound',
              estimatedWaitSeconds: 'estimateKind' in error && error.estimateKind === 'upper-bound'
                && 'estimatedWaitSeconds' in error && validWait(error.estimatedWaitSeconds) ? error.estimatedWaitSeconds : null };
          }
        }
      }
    } catch {
      message = `Export failed (HTTP ${response.status}). The service returned an unreadable error. Please retry.`;
    }
    if (availability) throw new ExportBusyError(message, availability);
    const retryAfter = response.headers.get('Retry-After');
    if ([429, 503].includes(response.status) && retryAfter && /^\d+$/.test(retryAfter)) {
      const seconds = Number(retryAfter);
      if (Number.isSafeInteger(seconds) && seconds > 0) message += ` Retry in ${seconds} seconds.`;
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
