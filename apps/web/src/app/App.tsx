import { useEffect, useMemo, useRef, useState } from 'react';
import { Accordion, Alert, Badge, Button, Group, Modal, NumberInput } from '@mantine/core';
import ConstructionControls from '../features/mechanics/ConstructionControls';
import { DEFAULT_CONSTRUCTION, mechanicalWarnings } from '../features/mechanics/model';
import ThemeToggle from './ThemeToggle';
import ParameterField from '../features/pin-design/ParameterField';
import ModelPreview from '../features/preview/ModelPreview';
import ImageMappingPanel from '../features/image-mapping/ImageMappingPanel';
import useSourceImage from '../features/image-mapping/useSourceImage';
import useImagePlacement from '../features/image-mapping/useImagePlacement';
import { DEFAULT_IMAGE_SAMPLING, type ImageSampling } from '../features/image-mapping/image-sampling';
import { DEFAULT_COLOR_MAPPING, type MappingMode } from '../features/image-mapping/color-mapping';
import ExportPanel from '../features/export/ExportPanel';
import { DEFAULTS, formatDimension, getMetrics, getWarnings, pinCount, type ParameterName, type Parameters } from '../features/pin-design/model';
import { DEFAULT_SHAPE, generateLayout, type ShapeOptions } from '../features/base-shape/layout';
import ShapeControls from '../features/base-shape/ShapeControls';
import ShapeNumberField from '../features/base-shape/ShapeNumberField';
import PinShapeControls from '../features/pin-shape/PinShapeControls';
import useDesignGeneration, { type GeneratedDesign, type GenerationSettings } from '../features/base-shape/useDesignGeneration';
import { DEFAULT_MODEL_MATERIALS, materialKey } from '../features/filaments/materials';
import usePinEditor from '../features/pin-editing/usePinEditor';
import { hasPinEdits } from '../features/pin-editing/model';
import PinEditorToolbar from '../features/pin-editing/PinEditorToolbar';
import FilamentColorField from '../features/filaments/FilamentColorField';
import InfoPopover from '../components/InfoPopover/InfoPopover';

type Draft = Record<ParameterName, number | string>;
const INITIAL_PARAMETERS = { ...DEFAULTS, ...generateLayout(DEFAULTS, DEFAULT_SHAPE) };
const mappingLabels: Record<MappingMode, string> = {
  height: 'Image-mapped heights', color: 'Image-mapped colors', 'height-color': 'Image-mapped height + color',
};

export default function App() {
  const [parameters, setParameters] = useState<Parameters>(INITIAL_PARAMETERS);
  const [requested, setRequested] = useState<Parameters>({ ...DEFAULTS });
  const [shape, setShape] = useState<ShapeOptions>(DEFAULT_SHAPE);
  const [enabled, setEnabled] = useState(true);
  const [resetVersion, setResetVersion] = useState(0);
  const [draft, setDraft] = useState<Draft>({ ...DEFAULTS });
  const [pendingDesign, setPendingDesign] = useState<{ job: object; design: GeneratedDesign; settings: GenerationSettings } | null>(null);
  const image = useSourceImage(true);
  const imagePlacement = useImagePlacement(image.source);
  const [minimum, setMinimum] = useState(10);
  const [inverted, setInverted] = useState(false);
  const [mode, setMode] = useState<MappingMode>('height');
  const [sampling, setSampling] = useState<ImageSampling>(DEFAULT_IMAGE_SAMPLING);
  const [colorOptions, setColorOptions] = useState(DEFAULT_COLOR_MAPPING);
  const editor = usePinEditor(parameters, undefined, image.loading);
  const settings = useMemo(() => ({ parameters: requested, shape, source: image.source, enabled, minimum, inverted, mode, sampling, options: colorOptions, placement: imagePlacement.placement }), [requested, shape, image.source, enabled, minimum, inverted, mode, sampling, colorOptions, imagePlacement.placement]);
  const mapping = useDesignGeneration(settings, parameters, editor);
  const applied = useRef<{ job?: object; settings: GenerationSettings; design?: GeneratedDesign }>({ settings });
  const updating = image.loading || mapping.loading || (!mapping.error && mapping.job !== applied.current.job) || pendingDesign !== null;
  const editsBlocked = updating || !!mapping.error && !mapping.geometryConflict;
  if (editor.state.mappingPending !== editsBlocked) editor.setMappingPending(editsBlocked);
  const recoveryOverrides = useRef(editor.state.overrides);
  useEffect(() => {
    const changed = recoveryOverrides.current !== editor.state.overrides;
    recoveryOverrides.current = editor.state.overrides;
    if (mapping.geometryConflict && changed) mapping.retry();
  }, [mapping.geometryConflict, editor.state.overrides]);

  function publish(design: GeneratedDesign, job: object, acceptedSettings: GenerationSettings) {
    if (design.changed) editor.dispatch({ type: 'topology', count: pinCount(design.parameters) });
    editor.regenerate(design.heightMap?.heights, design.colors?.materials, design.parameters);
    applied.current = { job, settings: acceptedSettings, design };
    setParameters(design.parameters);
    image.accept();
    setPendingDesign(null);
  }
  useEffect(() => {
    if (!mapping.design || applied.current.job === mapping.job || pendingDesign?.job === mapping.job) return;
    if (mapping.design.changed && hasPinEdits(editor.state)) setPendingDesign({ job: mapping.job, design: mapping.design, settings });
    else publish(mapping.design, mapping.job, settings);
  }, [mapping.design, mapping.job, pendingDesign?.job]);
  const modelMaterials = useMemo(() => ({ base: editor.state.base, pins: DEFAULT_MODEL_MATERIALS.pins }), [editor.state.base]);
  const modelColors = useMemo(() => ({ base: modelMaterials.base.color, pins: modelMaterials.pins.color }), [modelMaterials]);
  const pinColors = useMemo(() => editor.committed.pinSelections.map(material => material.color), [editor.committed.pinSelections]);
  const materialSelections = useMemo(() => [editor.state.base, ...editor.committed.pinSelections], [editor.state.base, editor.committed.pinSelections]);
  const materialsCount = useMemo(() => new Set(materialSelections.map(materialKey)).size, [materialSelections]);
  const resolvedParameters = useMemo(() => ({ ...parameters, pinGeometries: editor.committed.pinGeometries }), [parameters, editor.committed.pinGeometries]);
  const mechanical = applied.current.design?.mechanical;
  const displayedGeometries = applied.current.design?.pinGeometries;
  const previewParameters = useMemo(() => parameters.construction?.mode === 'print-in-place' && displayedGeometries ? { ...parameters, pinGeometries: displayedGeometries } : resolvedParameters, [parameters, displayedGeometries, resolvedParameters]);
  const metrics = useMemo(() => getMetrics(resolvedParameters), [resolvedParameters]);
  const warnings = useMemo(() => [...getWarnings(resolvedParameters, metrics), ...mechanicalWarnings(resolvedParameters)], [resolvedParameters, metrics]);
  const exportBlockedReason = editor.isDragging ? 'Finish or cancel the height drag before exporting.' : mapping.error || (updating
    ? 'Design processing is still running. Wait before exporting.'
    : image.error
      ? `Image processing failed: ${image.error} Replace the image or use uniform pins to export.`
      : null);

  function changeParameter(name: ParameterName, value: number | string) {
    if (editor.isDragging) return;
    setDraft((current) => ({ ...current, [name]: value }));
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return;
    if (name === 'extension') setMinimum((current) => Math.min(current, value));
    setRequested((current) => ({ ...current, [name]: value }));
  }

  function changeHeightRange([lower, upper]: [number, number]) {
    if (editor.isDragging || !Number.isFinite(lower) || !Number.isFinite(upper) || lower <= 0 || upper < lower) return;
    setMinimum(lower);
    setRequested(current => ({ ...current, extension: upper }));
    setDraft(current => ({ ...current, extension: upper }));
  }

  function resetParameters() {
    if (editor.isDragging) return;
    setRequested({ ...DEFAULTS });
    setShape(DEFAULT_SHAPE);
    setResetVersion(version => version + 1);
    setDraft({ ...DEFAULTS });
    setMinimum(10);
    setInverted(false);
  }

  function cancelGridChange() {
    const previous = applied.current.settings;
    setPendingDesign(null);
    setRequested(previous.parameters);
    setDraft({ ...previous.parameters });
    setShape(previous.shape);
    setEnabled(previous.enabled);
    setMinimum(previous.minimum);
    setInverted(previous.inverted);
    setMode(previous.mode);
    setSampling(previous.sampling ?? DEFAULT_IMAGE_SAMPLING);
    setColorOptions(previous.options);
    imagePlacement.restore(previous.source, previous.placement);
    image.restore();
  }

  function acceptGridChange() {
    if (pendingDesign && pendingDesign.job === mapping.job) publish(pendingDesign.design, pendingDesign.job, pendingDesign.settings);
  }

  function field(name: ParameterName, label: string, integer = false, sliderMax?: number) {
    return <ParameterField name={name} label={label} value={draft[name]} validValue={requested[name]} onChange={changeParameter} integer={integer} sliderMax={sliderMax} />;
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
              enabled={enabled} onEnabledChange={setEnabled}
              source={image.source}
              parameters={resolvedParameters}
              placement={imagePlacement.placement}
              placementBlocked={editor.isDragging || pendingDesign !== null}
              onPlacementChange={placement => { if (!editor.isDragging && !pendingDesign) imagePlacement.change(placement); }}
              loading={image.loading}
              error={image.error || mapping.error}
              minimum={minimum}
              maximum={requested.extension}
              inverted={inverted}
              heightMap={applied.current.design?.heightMap ?? null}
              mode={mode}
              sampling={sampling}
              onSamplingChange={value => { if (!editor.isDragging && !pendingDesign) setSampling(value); }}
              options={colorOptions}
              colors={applied.current.design?.colors ?? null}
              processing={mapping.loading || image.loading}
              editingBlocked={editor.blocked || editor.isDragging}
              editError={editor.state.error}
              resolvedPinMaterials={editor.committed.pinSelections}
              onReplaceGroup={(source, material) => editor.dispatch({ type: 'material-group', source, material })}
              elapsedMs={applied.current.design?.elapsedMs ?? null}
              timings={applied.current.design?.timings}
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
              <ConstructionControls value={requested.construction ?? DEFAULT_CONSTRUCTION} disabled={editor.isDragging || pendingDesign !== null} onChange={construction => setRequested(current => ({ ...current, construction }))} />
              <Accordion multiple defaultValue={['base', 'pins']} order={3} className="parameter-accordion">
                <Accordion.Item value="base">
                  <Accordion.Control><span className="section-heading"><span>Base plate</span><span>Foundation</span></span></Accordion.Control>
                  <Accordion.Panel>
                    <ShapeControls key={resetVersion} value={shape} onChange={setShape} layout={parameters.layout!} diameter={parameters.diameter} pinShape={parameters.pinShape} pinRotation={parameters.pinRotation} pinGeometries={editor.committed.pinGeometries} />
                    <div className="field-pair">{field('width', shape.source === 'preset' && shape.preset === 'circle' ? 'Base diameter' : 'Base width')}
                      {shape.source === 'image' ? <NumberInput label="Base depth" size="xs" suffix=" mm" value={parameters.depth} min={0.01} clampBehavior="none" disabled={!parameters.layout?.imageBounds}
                        onChange={depth => { if (typeof depth === 'number' && depth > 0 && !editor.isDragging) changeParameter('width', depth * parameters.width / parameters.depth); }} />
                        : shape.preset !== 'circle' ? field('depth', 'Base depth') : <div className="field-help">Base depth: {formatDimension(parameters.depth)} mm · Linked ratio</div>}</div>
                    {field('thickness', 'Base thickness')}
                    <div className="base-material"><FilamentColorField label="Base color" value={editor.state.base} disabled={editor.isDragging || editor.blocked}
                      onChange={material => editor.dispatch({ type: 'material', target: 'base', material })} /></div>
                  </Accordion.Panel>
                </Accordion.Item>
                <Accordion.Item value="pins">
                  <Accordion.Control><span className="section-heading"><span>Pin array</span><Badge color="teal" variant="light" size="sm">{metrics.count.toLocaleString('en-US')} pins</Badge></span></Accordion.Control>
                  <Accordion.Panel>
                    <PinShapeControls key={`pin-shape-${resetVersion}`} parameters={requested} disabled={editor.isDragging} onChange={value => setRequested(current => ({ ...current, ...value }))} />
                    <div className="parameter-info"><InfoPopover label="Grid and height help"><p>Pins use a centered square grid inside the contour. Spacing is center to center. Extension measures from the base top to the pin top, including the retaining head in Print-in-place. Edge padding measures from the pin's outer wall (retaining head in Print-in-place) to every boundary. Layout changes require confirmation when pins have manual edits.</p></InfoPopover></div>
                    <ShapeNumberField key={resetVersion} label="Edge padding" value={shape.padding} onChange={padding => setShape(current => ({ ...current, padding }))} />
                    {field('spacing', 'Pin spacing', false, 20)}
                    {field('diameter', 'Pin size', false, 10)}
                    {(!image.source || !enabled || mode === 'color') && field('extension', 'Generated pin extension', false, 80)}
                  </Accordion.Panel>
                </Accordion.Item>
              </Accordion>
              <div className="controls-bottom"><Button variant="default" fullWidth onClick={resetParameters}>Reset parameters</Button></div>
            </section>
            <ExportPanel parameters={resolvedParameters} heights={editor.committed.heights} materials={modelMaterials} pinSelections={editor.committed.pinSelections} blockedReason={exportBlockedReason} />
          </aside>
          <div className="preview-column">
            <ModelPreview parameters={previewParameters} mechanical={mechanical} heights={editor.heights} colors={modelColors} pinColors={pinColors} materialSelections={materialSelections}
              heightLabel={editor.state.overrides.size ? 'Edited pin design' : applied.current.settings.source && applied.current.settings.enabled ? mappingLabels[applied.current.settings.mode] : 'Uniform pin height'}
              toolbar={<PinEditorToolbar editor={editor} parameters={parameters} />}
              editing={{ heightMode: editor.heightMode, selection: editor.state.selection, active: editor.state.active,
                dragging: editor.isDragging, onSelect: editor.select, onDragStart: editor.startDrag, onDragDelta: editor.updateDrag,
                onDragEnd: editor.finishDrag, onDragCancel: editor.cancelDrag }} />
            <div className="metrics" aria-label="Design measurements">
              <div className="metric"><span>Total pins</span><strong>{metrics.count.toLocaleString('en-US')}</strong></div>
              <div className="metric"><span>Pin footprint</span><strong>{formatDimension(metrics.width)} × {formatDimension(metrics.depth)} <em>mm</em></strong></div>
              <div className="metric"><span>Pin clearance</span><strong>{metrics.clearance === null ? '—' : <>{formatDimension(metrics.clearance)} <em>mm</em></>}</strong></div>
            </div>
            <div className="design-feedback" role="status" aria-live="polite">
              {mapping.error ? <Alert color="red" title="Settings not applied">{mapping.error}<Button size="xs" variant="subtle" onClick={mapping.retry}>Retry settings</Button></Alert> : updating ? <span>Updating design…</span> : warnings.length > 0 ? warnings.map((warning) => <Alert key={warning} color="orange" title="Check your dimensions">{warning}</Alert>) : <span className="fit-message"><span aria-hidden="true">✓</span> Your pin array fits within the base. · {Math.round(applied.current.design?.elapsedMs ?? 0)} ms</span>}
            </div>
          </div>
        </div>
      </main>
      <Modal opened={pendingDesign !== null} onClose={cancelGridChange} title="Change pin layout?" centered>
        <p>Changing pin positions clears all pin edits, the selection, and undo history. Your base material, image, and mapping settings are kept.</p>
        <Group justify="flex-end"><Button variant="default" onClick={cancelGridChange}>Keep layout</Button>
          <Button disabled={pendingDesign?.job !== mapping.job} onClick={acceptGridChange}>Change layout</Button></Group>
      </Modal>
    </div>
  );
}
