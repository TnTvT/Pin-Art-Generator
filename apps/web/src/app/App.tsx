import { useMemo, useState } from 'react';
import { Accordion, Alert, Badge, Button, Group, Modal } from '@mantine/core';
import ThemeToggle from './ThemeToggle';
import ParameterField from '../features/pin-design/ParameterField';
import ModelPreview from '../features/preview/ModelPreview';
import ImageMappingPanel from '../features/image-mapping/ImageMappingPanel';
import useSourceImage from '../features/image-mapping/useSourceImage';
import useImageMapping from '../features/image-mapping/useImageMapping';
import { DEFAULT_COLOR_MAPPING, type MappingMode } from '../features/image-mapping/color-mapping';
import ExportPanel from '../features/export/ExportPanel';
import { DEFAULTS, formatDimension, getMetrics, getWarnings, type Parameters } from '../features/pin-design/model';
import { DEFAULT_MODEL_MATERIALS, materialKey } from '../features/filaments/materials';
import usePinEditor from '../features/pin-editing/usePinEditor';
import PinEditorToolbar from '../features/pin-editing/PinEditorToolbar';
import FilamentColorField from '../features/filaments/FilamentColorField';
import InfoPopover from '../components/InfoPopover/InfoPopover';

type Draft = Record<keyof Parameters, number | string>;
const mappingLabels: Record<MappingMode, string> = {
  height: 'Image-mapped heights', color: 'Image-mapped colors', 'height-color': 'Image-mapped height + color',
};

export default function App() {
  const [parameters, setParameters] = useState<Parameters>({ ...DEFAULTS });
  const [draft, setDraft] = useState<Draft>({ ...DEFAULTS });
  const [pendingParameters, setPendingParameters] = useState<{ parameters: Parameters; resetGenerator: boolean } | null>(null);
  const image = useSourceImage();
  const [minimum, setMinimum] = useState(2);
  const [inverted, setInverted] = useState(false);
  const [mode, setMode] = useState<MappingMode>('height');
  const [colorOptions, setColorOptions] = useState(DEFAULT_COLOR_MAPPING);
  const editor = usePinEditor(parameters, undefined, image.loading);
  const mapping = useImageMapping({ source: image.source, parameters, minimum, inverted, mode, options: colorOptions, editor });
  const modelMaterials = useMemo(() => ({ base: editor.state.base, pins: DEFAULT_MODEL_MATERIALS.pins }), [editor.state.base]);
  const modelColors = useMemo(() => ({ base: modelMaterials.base.color, pins: modelMaterials.pins.color }), [modelMaterials]);
  const pinColors = useMemo(() => editor.committed.pinSelections.map(material => material.color), [editor.committed.pinSelections]);
  const materialSelections = useMemo(() => [editor.state.base, ...editor.committed.pinSelections], [editor.state.base, editor.committed.pinSelections]);
  const materialsCount = useMemo(() => new Set(materialSelections.map(materialKey)).size, [materialSelections]);
  const metrics = getMetrics(parameters);
  const warnings = getWarnings(parameters);
  const exportBlockedReason = editor.isDragging ? 'Finish or cancel the height drag before exporting.' : image.loading || mapping.loading
    ? 'Image processing is still running. Wait before exporting.'
    : image.error
      ? `Image processing failed: ${image.error} Replace the image or use uniform pins to export.`
      : mapping.error;

  function changeParameter(name: keyof Parameters, value: number | string) {
    if (editor.isDragging) return;
    setDraft((current) => ({ ...current, [name]: value }));
    const isCount = name === 'columns' || name === 'rows';
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return;
    if (isCount && (!Number.isInteger(value) || value > 100)) return;
    if (isCount && value !== parameters[name]) {
      const next = { ...parameters, [name]: value };
      if (editor.state.overrides.size) return;
      editor.dispatch({ type: 'topology', count: next.rows * next.columns });
    }
    if (name === 'extension') setMinimum((current) => Math.min(current, value));
    setParameters((current) => ({ ...current, [name]: value }));
  }

  function commitGridDraft(name: keyof Parameters) {
    if ((name !== 'rows' && name !== 'columns') || !editor.state.overrides.size || editor.isDragging) return;
    const value = draft[name];
    if (typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 100 && value !== parameters[name]) setPendingParameters({ parameters: { ...parameters, [name]: value }, resetGenerator: false });
  }

  function changeHeightRange([lower, upper]: [number, number]) {
    if (editor.isDragging || !Number.isFinite(lower) || !Number.isFinite(upper) || lower <= 0 || upper < lower) return;
    setMinimum(lower);
    setParameters(current => ({ ...current, extension: upper }));
    setDraft(current => ({ ...current, extension: upper }));
  }

  function resetParameters() {
    if (editor.isDragging) return;
    if (parameters.rows !== DEFAULTS.rows || parameters.columns !== DEFAULTS.columns) {
      if (editor.state.overrides.size) { setPendingParameters({ parameters: { ...DEFAULTS }, resetGenerator: true }); return; }
      editor.dispatch({ type: 'topology', count: DEFAULTS.rows * DEFAULTS.columns });
    }
    setParameters({ ...DEFAULTS });
    setDraft({ ...DEFAULTS });
    setMinimum(2);
    setInverted(false);
  }

  function cancelGridChange() {
    setPendingParameters(null);
    setDraft(current => ({ ...current, rows: parameters.rows, columns: parameters.columns }));
  }

  function acceptGridChange() {
    if (!pendingParameters) return;
    const next = pendingParameters.parameters;
    editor.dispatch({ type: 'topology', count: next.rows * next.columns });
    setParameters(next);
    setDraft({ ...next });
    if (pendingParameters.resetGenerator) {
      setMinimum(2);
      setInverted(false);
    } else setMinimum(current => Math.min(current, next.extension));
    setPendingParameters(null);
  }

  function field(name: keyof Parameters, label: string, integer = false, sliderMax?: number) {
    return <ParameterField name={name} label={label} value={draft[name]} validValue={parameters[name]} onChange={changeParameter} onCommit={integer ? commitGridDraft : undefined} integer={integer} sliderMax={sliderMax} />;
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">{Array.from({ length: 9 }, (_, index) => <i key={index} />)}</div>
          <h1>Pin Art<span className="brand-secondary"> Studio</span></h1>
        </div>
        <div className="header-actions">
          <span className="unit-label"><span className="unit-description">All dimensions in </span><strong>mm</strong></span>
          <ThemeToggle />
        </div>
      </header>
      <main>
        <div className="workspace">
          <aside className="design-sidebar" aria-label="Design controls" tabIndex={0}>
            <ImageMappingPanel
              source={image.source}
              loading={image.loading}
              error={image.error || mapping.error}
              minimum={minimum}
              maximum={parameters.extension}
              inverted={inverted}
              heightMap={mapping.heightMap}
              mode={mode}
              options={colorOptions}
              colors={mapping.colors}
              processing={mapping.loading || image.loading}
              elapsedMs={mapping.elapsedMs}
              resolvedMaterialsCount={materialsCount}
              onModeChange={setMode}
              onOptionsChange={setColorOptions}
              onRetry={mapping.retry}
              onUpload={image.upload}
              onRemove={image.remove}
              onSample={image.useSample}
              onHeightRangeChange={changeHeightRange}
              onInvertChange={setInverted}
            />
            {image.error && !image.source && <Button variant="subtle" size="xs" onClick={image.remove}>Clear image error and use uniform pins</Button>}
            <section className="controls-panel" aria-label="Parameters">
              <div className="controls-heading"><h2>Parameters</h2><span>01 / DESIGN</span></div>
              <Accordion multiple defaultValue={['base', 'pins']} order={3} className="parameter-accordion">
                <Accordion.Item value="base">
                  <Accordion.Control><span className="section-heading"><span>Base plate</span><span>Foundation</span></span></Accordion.Control>
                  <Accordion.Panel>
                    <div className="field-pair">{field('width', 'Base width')}{field('depth', 'Base depth')}</div>
                    {field('thickness', 'Base thickness')}
                    <div className="base-material"><FilamentColorField label="Base color" value={editor.state.base} disabled={editor.isDragging || editor.blocked}
                      onChange={material => editor.dispatch({ type: 'material', target: 'base', material })} /></div>
                  </Accordion.Panel>
                </Accordion.Item>
                <Accordion.Item value="pins">
                  <Accordion.Control><span className="section-heading"><span>Pin array</span><Badge color="teal" variant="light" size="sm">{metrics.count.toLocaleString('en-US')} pins</Badge></span></Accordion.Control>
                  <Accordion.Panel>
                    <div className="field-pair">{field('columns', 'Columns', true)}{field('rows', 'Rows', true)}</div>
                    <div className="parameter-info"><InfoPopover label="Grid and height help"><p>A centered grid of columns × rows. Spacing is measured from center to center. Generated height is above the base; manual pin heights are preserved.</p></InfoPopover></div>
                    {editor.state.overrides.size > 0 && <p className="field-help">New counts require confirmation on Enter or when leaving the field.</p>}
                    {field('spacing', 'Pin spacing', false, 20)}
                    {field('diameter', 'Pin diameter', false, 10)}
                    {(!image.source || mode === 'color') && field('extension', 'Generated pin height', false, 80)}
                  </Accordion.Panel>
                </Accordion.Item>
              </Accordion>
              <div className="controls-bottom"><Button variant="default" fullWidth onClick={resetParameters}>Reset parameters</Button></div>
            </section>
            <ExportPanel parameters={parameters} heights={editor.committed.heights} materials={modelMaterials} pinSelections={editor.committed.pinSelections} blockedReason={exportBlockedReason} />
          </aside>
          <div className="preview-column">
            <ModelPreview parameters={parameters} heights={editor.heights} colors={modelColors} pinColors={pinColors} materialSelections={materialSelections}
              heightLabel={editor.state.overrides.size ? 'Edited pin design' : image.source ? mappingLabels[mode] : 'Uniform pin height'}
              toolbar={<PinEditorToolbar editor={editor} columns={parameters.columns} />}
              editing={{ heightMode: editor.heightMode, selection: editor.state.selection, active: editor.state.active,
                dragging: editor.isDragging, onSelect: editor.select, onDragStart: editor.startDrag, onDragDelta: editor.updateDrag,
                onDragEnd: editor.finishDrag, onDragCancel: editor.cancelDrag }} />
            <div className="metrics" aria-label="Design measurements">
              <div className="metric"><span>Total pins</span><strong>{metrics.count.toLocaleString('en-US')}</strong></div>
              <div className="metric"><span>Grid footprint</span><strong>{formatDimension(metrics.width)} × {formatDimension(metrics.depth)} <em>mm</em></strong></div>
              <div className="metric"><span>Pin clearance</span><strong>{formatDimension(metrics.clearance)} <em>mm</em></strong></div>
            </div>
            <div className="design-feedback" role="status" aria-live="polite">
              {warnings.length > 0 ? warnings.map((warning) => <Alert key={warning} color="orange" title="Check your dimensions">{warning}</Alert>) : <span className="fit-message"><span aria-hidden="true">✓</span> Your pin array fits within the base.</span>}
            </div>
          </div>
        </div>
      </main>
      <Modal opened={pendingParameters !== null} onClose={cancelGridChange} title="Change pin grid?" centered>
        <p>Changing rows or columns clears all pin edits, the selection, and undo history. The base material is kept.</p>
        <Group justify="flex-end"><Button variant="default" onClick={cancelGridChange}>Keep grid</Button>
          <Button onClick={acceptGridChange}>Change grid</Button></Group>
      </Modal>
    </div>
  );
}
