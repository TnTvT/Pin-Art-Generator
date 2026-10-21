import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Group, Select } from '@mantine/core';
import { getMetrics, type Parameters } from '../pin-design/model';
import { type MaterialSelection, type ModelMaterials } from '../filaments/materials';
import { buildExportRequest, DEFAULT_EXPORT_OPTIONS, resolveExportMaterials, validateExport, type ExportFormat } from './export-request';
import { DEFAULT_PRINTER, PRINTER_PROFILES, validatePrinterMaterials, type PrinterId } from './printer-profiles';
import { ExportBusyError, fetchExport, fetchExportAvailability, type ExportAvailability } from './export-client';
import InfoPopover from '../../components/InfoPopover/InfoPopover';

interface ExportPanelProps {
  parameters: Parameters;
  heights?: Float32Array;
  materials: ModelMaterials;
  pinSelections?: readonly MaterialSelection[];
  blockedReason?: string | null;
}

export default function ExportPanel({ parameters, heights, materials, pinSelections, blockedReason }: ExportPanelProps) {
  const [printer, setPrinter] = useState<PrinterId>(DEFAULT_PRINTER);
  const profile = PRINTER_PROFILES[printer];
  const options = useMemo(() => ({ ...(parameters.construction ?? DEFAULT_EXPORT_OPTIONS), printer }), [parameters.construction, printer]);
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failedFormat, setFailedFormat] = useState<ExportFormat>('3mf');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [availability, setAvailability] = useState<ExportAvailability | null>(null);
  const waitingForExporter = availability?.busy === true;
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const downloadUrls = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const measurements = useMemo(() => getMetrics(parameters), [parameters]);
  const materialValidation = useMemo(() => {
    try {
      const palette = resolveExportMaterials(measurements.count, materials, pinSelections);
      return { error: null, printerError: validatePrinterMaterials(printer, palette.materials.length), count: palette.materials.length };
    } catch (failure) {
      return { error: failure instanceof Error ? failure.message : 'Invalid material selections.', printerError: null, count: null };
    }
  }, [measurements.count, materials, pinSelections, printer]);
  const validation = useMemo(() => blockedReason || materialValidation.error || validateExport(parameters, heights, options, undefined, measurements), [blockedReason, materialValidation.error, parameters, heights, options, measurements]);
  const printerValidation = useMemo(() => validation || validateExport(parameters, heights, options, '3mf', measurements) || materialValidation.printerError, [validation, parameters, heights, options, measurements, materialValidation.printerError]);
  const stlValidation = useMemo(() => validation || validateExport(parameters, heights, options, 'stl', measurements), [validation, parameters, heights, options, measurements]);

  useEffect(() => {
    mounted.current = true;
    const urls = downloadUrls.current;
    return () => {
      mounted.current = false;
      controller.current?.abort();
      controller.current = null;
      urls.forEach((timer, url) => {
        clearTimeout(timer);
        URL.revokeObjectURL(url);
      });
      urls.clear();
    };
  }, []);

  useEffect(() => {
    if (!waitingForExporter) return;
    const checkController = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let requestTimeout: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    async function check() {
      requestTimeout = setTimeout(() => checkController.abort(), 8_000);
      try {
        const status = await fetchExportAvailability(checkController.signal);
        if (cancelled) return;
        if (checkController.signal.aborted) throw new Error('Availability check timed out.');
        setAvailability(status);
        if (status.busy) timer = setTimeout(() => void check(), 5_000);
      } catch {
        if (cancelled) return;
        setAvailability(null);
        setError('Could not check exporter availability. Please retry manually.');
      } finally {
        clearTimeout(requestTimeout);
      }
    }
    timer = setTimeout(() => void check(), 5_000);
    const countdown = setInterval(() => setAvailability(current => current?.busy && current.estimatedWaitSeconds !== null
      ? { ...current, estimatedWaitSeconds: Math.max(0, current.estimatedWaitSeconds - 1) } : current), 1_000);
    return () => {
      cancelled = true;
      checkController.abort();
      clearTimeout(timer);
      clearTimeout(requestTimeout);
      clearInterval(countdown);
    };
  }, [waitingForExporter]);

  async function exportModel(format: ExportFormat) {
    if (controller.current || waitingForExporter || (format === 'stl' ? stlValidation : printerValidation)) return;
    const requestController = new AbortController();
    controller.current = requestController;
    setBusy(format);
    setError(null);
    setAvailability(null);
    setFeedback(null);
    setFailedFormat(format);
    try {
      const request = buildExportRequest(parameters, heights, materials, options, format, pinSelections);
      const result = await fetchExport(request, requestController.signal);
      if (!mounted.current || requestController.signal.aborted) return;
      const url = URL.createObjectURL(result.blob);
      const timer = setTimeout(() => {
        URL.revokeObjectURL(url);
        downloadUrls.current.delete(url);
      }, 60_000);
      downloadUrls.current.set(url, timer);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = result.filename;
      document.body.appendChild(anchor);
      try { anchor.click(); } finally { anchor.remove(); }
      setFeedback(`Download ready: ${result.filename}${result.plateCount === null ? '' : ' · 1 plate'}.`);
    } catch (failure) {
      if (mounted.current && !requestController.signal.aborted) {
        if (failure instanceof ExportBusyError) setAvailability(failure.availability);
        setError(failure instanceof Error ? failure.message : 'Export could not be completed. Please retry.');
      }
    } finally {
      if (controller.current === requestController) controller.current = null;
      if (mounted.current) setBusy(null);
    }
  }

  return (
    <section className="export-panel controls-panel" aria-label="Print export" aria-busy={busy !== null}>
      <div className="controls-heading"><div className="section-title"><h2>Print export</h2><InfoPopover label="Export help">
        <p>Fixed sculpture joins pins to the base. Print-in-place downloads the perforated guide base and independent headed pins in their initial printing positions.</p>
        <p>Extension is measured from the base top to the pin top, including the head. Clearances need a physical fit sample. Disable supports in the sliding gaps; check brims and slicer settings do not fuse parts.</p>
        <p>3MF printer: {profile.name} · {profile.width} × {profile.depth} mm bed · {profile.height} mm height. Open as a project in {profile.slicer}, with its official printer presets installed. Uses the 0.20mm Standard preset. STL remains printer-independent.</p>
        <p>{printer === 'snapmaker-u1' ? 'U1 supports up to 4 used materials including the base. Bambu Basic/Matte selections retain their colors and family labels as project materials based on Generic PLA; these are not official U1-tuned Bambu filament profiles. Verify material settings and toolhead assignments in Snapmaker Orca.' : 'Up to 16 used materials including the base. Basic and Matte reference official X1C filament presets. Verify filament assignments in Bambu Studio.'}</p>
      </InfoPopover></div><span>03 / EXPORT</span></div>
      <div className="export-settings">
        <Select label="Printer" value={printer} allowDeselect={false} disabled={busy !== null}
          data={Object.entries(PRINTER_PROFILES).map(([value, item]) => ({ value, label: item.label }))}
          onChange={(value) => {
            if (value && value in PRINTER_PROFILES) {
              setPrinter(value as PrinterId);
              setError(null);
              setAvailability(null);
              setFeedback(null);
            }
          }} />
        {materialValidation.count !== null && <p className="field-help">{materialValidation.count} / {profile.maxMaterials} materials for 3MF · Includes base</p>}
        {(parameters.layout?.pins.length ?? parameters.columns * parameters.rows) >= 2500 && <p className="field-help">Dense exports can take a minute. STL may require several GB of memory; use fewer pins on memory-constrained computers.</p>}
        {validation && <p id="export-block-reason" className="export-blocked" role="status">Export blocked: {validation}</p>}
        {!validation && printerValidation && <p id="printer-block-reason" className="export-blocked" role="status">3MF blocked: {printerValidation}</p>}
        {!validation && stlValidation && <p id="stl-block-reason" className="export-blocked" role="status">STL blocked: {stlValidation}</p>}
        <div className="export-actions">
          <Button variant="default" fullWidth onClick={() => void exportModel('stl')} loading={busy === 'stl'} disabled={busy !== null || waitingForExporter || !!stlValidation} aria-describedby={validation ? 'export-block-reason' : stlValidation ? 'stl-block-reason' : undefined}>Download STL</Button>
          <Button fullWidth onClick={() => void exportModel('3mf')} loading={busy === '3mf'} disabled={busy !== null || waitingForExporter || !!printerValidation} aria-describedby={validation ? 'export-block-reason' : printerValidation ? 'printer-block-reason' : undefined}>Download 3MF</Button>
        </div>
        <div aria-live="polite" role="status">
          {busy && <p className="field-help">Preparing {busy === '3mf' ? '3MF' : 'STL'}…</p>}
          {feedback && <p className="export-feedback">{feedback}</p>}
        </div>
        {error && <Alert color={availability ? 'blue' : 'red'} title={waitingForExporter ? 'Exporter busy' : availability ? 'Ready to retry' : 'Export failed'}>
          {availability && !waitingForExporter ? 'The exporter is available. Retry when ready; nothing has been submitted automatically.' : error}
          {waitingForExporter && <>
            <p>{availability.estimatedWaitSeconds === null ? 'Checking availability…' : availability.estimatedWaitSeconds === 0
              ? 'Taking longer than estimated. Checking availability…'
              : <>Estimated wait: up to about <span style={{ whiteSpace: 'nowrap' }}>{Math.floor(availability.estimatedWaitSeconds / 60) ? `${Math.floor(availability.estimatedWaitSeconds / 60)} min ` : ''}{availability.estimatedWaitSeconds % 60} s</span>.</>}</p>
            <p>This estimate is based on time limits, not a guaranteed finish time. Checking every 5 seconds.</p>
          </>}
          <Group gap="xs" mt="sm">
            <Button variant="light" size="xs" onClick={() => void exportModel(failedFormat)} disabled={busy !== null || waitingForExporter || !!(failedFormat === 'stl' ? stlValidation : printerValidation)}>Retry export</Button>
            <Button variant="subtle" size="xs" onClick={() => { setError(null); setAvailability(null); }}>Clear error</Button>
          </Group>
        </Alert>}
      </div>
    </section>
  );
}
