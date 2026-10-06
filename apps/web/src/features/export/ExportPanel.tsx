import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Group, NumberInput, SegmentedControl } from '@mantine/core';
import { getMetrics, type Parameters } from '../pin-design/model';
import { type MaterialSelection, type ModelMaterials } from '../filaments/materials';
import { BAMBU_PROFILE, buildExportRequest, DEFAULT_EXPORT_OPTIONS, validateExport, type ExportFormat, type ExportMode, type ExportOptions } from './export-request';
import { fetchExport } from './export-client';
import InfoPopover from '../../components/InfoPopover/InfoPopover';

interface ExportPanelProps {
  parameters: Parameters;
  heights?: Float32Array;
  materials: ModelMaterials;
  pinSelections?: readonly MaterialSelection[];
  blockedReason?: string | null;
}

type NumericSetting = 'insertionDepth' | 'clearance' | 'bedWidth' | 'bedDepth';

export default function ExportPanel({ parameters, heights, materials, pinSelections, blockedReason }: ExportPanelProps) {
  const [options, setOptions] = useState<ExportOptions>(() => ({ ...DEFAULT_EXPORT_OPTIONS, socket: { ...DEFAULT_EXPORT_OPTIONS.socket }, plate: { ...DEFAULT_EXPORT_OPTIONS.plate } }));
  const [draft, setDraft] = useState<Record<NumericSetting, number | string>>({ insertionDepth: 2, clearance: 0.2, bedWidth: 256, bedDepth: 256 });
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failedFormat, setFailedFormat] = useState<ExportFormat>('3mf');
  const [feedback, setFeedback] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const downloadUrls = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const measurements = useMemo(() => getMetrics(parameters), [parameters]);
  const validation = useMemo(() => blockedReason || validateExport(parameters, heights, options, undefined, measurements), [blockedReason, parameters, heights, options, measurements]);
  const bambuValidation = useMemo(() => validation || validateExport(parameters, heights, options, '3mf', measurements), [validation, parameters, heights, options, measurements]);
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

  function changeNumeric(name: NumericSetting, value: number | string) {
    setDraft((current) => ({ ...current, [name]: value }));
    if (typeof value !== 'number' || !Number.isFinite(value) || (name === 'clearance' ? value < 0 : value <= 0)) return;
    setOptions((current) => name === 'bedWidth' || name === 'bedDepth'
      ? { ...current, plate: { ...current.plate, [name === 'bedWidth' ? 'width' : 'depth']: value } }
      : { ...current, socket: { ...current.socket, [name]: value } });
  }

  function numericField(name: NumericSetting, label: string) {
    const value = draft[name];
    const valid = typeof value === 'number' && Number.isFinite(value) && (name === 'clearance' ? value >= 0 : value > 0);
    const lastValid = name === 'bedWidth' ? options.plate.width : name === 'bedDepth' ? options.plate.depth : options.socket[name];
    return <NumberInput label={label} value={value} onChange={(next) => changeNumeric(name, next)}
      min={name === 'clearance' ? 0 : 0.01} suffix=" mm" step={0.1} decimalScale={2}
      allowNegative={false} clampBehavior="none" size="sm" disabled={busy !== null}
      error={valid ? undefined : `Using last valid value: ${lastValid} mm.`} />;
  }

  async function exportModel(format: ExportFormat) {
    if (controller.current || (format === 'stl' ? stlValidation : bambuValidation)) return;
    const requestController = new AbortController();
    controller.current = requestController;
    setBusy(format);
    setError(null);
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
      setFeedback(`Download ready: ${result.filename}${result.plateCount === null ? '' : ` · ${result.plateCount} ${result.plateCount === 1 ? 'plate' : 'plates'}`}.`);
    } catch (failure) {
      if (mounted.current && !requestController.signal.aborted) {
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
        <p>Fixed: pins joined to the base in one printable sculpture. Detachable: plate 1 contains only the centered socket base. Upright pins start on plate 2, with additional pin-only plates as needed. The preview stays assembled.</p>
        <p>Sockets follow the pin shape and rotation. Socket clearance of 0.2 mm offsets each wall outward by 0.1 mm, with rounded outer corners. Minimum floor: 1 mm; walls and edges: 0.8 mm. Use a physical fit sample to calibrate clearance.</p>
        <p>5 mm bed margins and 4 mm separation between actual pin footprints. The server determines the actual plate count.</p>
        <p>3MF printer: {BAMBU_PROFILE.name} · 256 × 256 mm bed · 250 mm profile height. Uses the 0.20mm Standard X1C preset; verify material profiles and filament assignments in Bambu Studio. STL remains printer-independent.</p>
      </InfoPopover></div><span>03 / EXPORT</span></div>
      <div className="export-settings">
        <fieldset className="export-mode">
          <legend>Export mode</legend>
          <SegmentedControl fullWidth value={options.mode} onChange={(value) => setOptions((current) => ({ ...current, mode: value as ExportMode }))}
            data={[{ label: 'Fixed', value: 'fixed' }, { label: 'Detachable', value: 'detachable' }]} disabled={busy !== null} size="sm" />
        </fieldset>
        <p className="field-help">{options.mode === 'fixed' ? 'Pins attached to the base.' : 'Separate base and pin plates.'}</p>
        {options.mode === 'detachable' && <>
          <div className="field-pair">{numericField('insertionDepth', 'Insertion depth')}{numericField('clearance', 'Socket clearance')}</div>
          <div className="field-pair">{numericField('bedWidth', 'Bed width')}{numericField('bedDepth', 'Bed depth')}</div>
        </>}
        {(parameters.layout?.pins.length ?? parameters.columns * parameters.rows) >= 2500 && <p className="field-help">Dense exports can take a minute. STL may require several GB of memory; use fewer pins on memory-constrained computers.</p>}
        {validation && <p id="export-block-reason" className="export-blocked" role="status">Export blocked: {validation}</p>}
        {!validation && bambuValidation && <p id="bambu-block-reason" className="export-blocked" role="status">3MF blocked: {bambuValidation}</p>}
        {!validation && stlValidation && <p id="stl-block-reason" className="export-blocked" role="status">STL blocked: {stlValidation}</p>}
        <div className="export-actions">
          <Button variant="default" fullWidth onClick={() => void exportModel('stl')} loading={busy === 'stl'} disabled={busy !== null || !!stlValidation} aria-describedby={validation ? 'export-block-reason' : stlValidation ? 'stl-block-reason' : undefined}>Download STL</Button>
          <Button fullWidth onClick={() => void exportModel('3mf')} loading={busy === '3mf'} disabled={busy !== null || !!bambuValidation} aria-describedby={validation ? 'export-block-reason' : bambuValidation ? 'bambu-block-reason' : undefined}>Download Bambu 3MF</Button>
        </div>
        <div aria-live="polite" role="status">
          {busy && <p className="field-help">Preparing {busy === '3mf' ? 'Bambu 3MF' : 'STL'}…</p>}
          {feedback && <p className="export-feedback">{feedback}</p>}
        </div>
        {error && <Alert color="red" title="Export failed">
          {error}
          <Group gap="xs" mt="sm">
            <Button variant="light" size="xs" onClick={() => void exportModel(failedFormat)} disabled={busy !== null || !!(failedFormat === 'stl' ? stlValidation : bambuValidation)}>Retry export</Button>
            <Button variant="subtle" size="xs" onClick={() => setError(null)}>Clear error</Button>
          </Group>
        </Alert>}
      </div>
    </section>
  );
}
