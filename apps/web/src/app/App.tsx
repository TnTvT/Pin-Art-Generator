import { useMemo, useState } from 'react';
import { Accordion, Alert, Badge, Button } from '@mantine/core';
import ThemeToggle from './ThemeToggle';
import ParameterField from '../features/pin-design/ParameterField';
import ModelPreview from '../features/preview/ModelPreview';
import ImageMappingPanel from '../features/image-mapping/ImageMappingPanel';
import useSourceImage from '../features/image-mapping/useSourceImage';
import { mapImageToPins } from '../features/image-mapping/image-mapping';
import ExportPanel from '../features/export/ExportPanel';
import { DEFAULTS, formatDimension, getMetrics, getWarnings, type Parameters } from '../features/pin-design/model';
import { DEFAULT_MODEL_MATERIALS, type ModelMaterials } from '../features/filaments/materials';

type Draft = Record<keyof Parameters, number | string>;

export default function App() {
  const [parameters, setParameters] = useState<Parameters>({ ...DEFAULTS });
  const [draft, setDraft] = useState<Draft>({ ...DEFAULTS });
  const [modelMaterials, setModelMaterials] = useState<ModelMaterials>(() => ({ base: { ...DEFAULT_MODEL_MATERIALS.base }, pins: { ...DEFAULT_MODEL_MATERIALS.pins } }));
  const modelColors = useMemo(() => ({ base: modelMaterials.base.color, pins: modelMaterials.pins.color }), [modelMaterials.base.color, modelMaterials.pins.color]);
  const image = useSourceImage();
  const [minimum, setMinimum] = useState(2);
  const [inverted, setInverted] = useState(false);
  const mapping = useMemo(() => {
    if (!image.source) return { heightMap: null, error: null };
    try {
      return { heightMap: mapImageToPins(image.source, parameters, minimum, inverted), error: null };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Image processing is unavailable in this browser.';
      return { heightMap: null, error: `Image mapping failed: ${reason} The preview is showing uniform pins. Remove or replace the image to export.` };
    }
  }, [image.source, parameters, minimum, inverted]);
  const metrics = getMetrics(parameters);
  const warnings = getWarnings(parameters);
  const exportBlockedReason = image.loading
    ? 'Image processing is still running. Wait before exporting.'
    : image.error
      ? `Image processing failed: ${image.error} Replace the image or use uniform pins to export.`
      : mapping.error || (image.source && !mapping.heightMap ? 'Resolved image heights are missing. Remove or replace the image before exporting.' : null);

  function changeParameter(name: keyof Parameters, value: number | string) {
    setDraft((current) => ({ ...current, [name]: value }));
    const isCount = name === 'columns' || name === 'rows';
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return;
    if (isCount && (!Number.isInteger(value) || value > 100)) return;
    if (name === 'extension') setMinimum((current) => Math.min(current, value));
    setParameters((current) => ({ ...current, [name]: value }));
  }

  function resetParameters() {
    setParameters({ ...DEFAULTS });
    setDraft({ ...DEFAULTS });
    setMinimum(2);
    setInverted(false);
  }

  function field(name: keyof Parameters, label: string, integer = false, sliderMax?: number) {
    return <ParameterField name={name} label={label} value={draft[name]} validValue={parameters[name]} onChange={changeParameter} integer={integer} sliderMax={sliderMax} />;
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">{Array.from({ length: 9 }, (_, index) => <i key={index} />)}</div>
          <h1>Pin Art<span className="brand-secondary"> Studio</span></h1>
          <Badge variant="light" color="gray" size="sm">MVP</Badge>
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
              onUpload={image.upload}
              onRemove={image.remove}
              onSample={image.useSample}
              onMinimumChange={setMinimum}
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
                  </Accordion.Panel>
                </Accordion.Item>
                <Accordion.Item value="pins">
                  <Accordion.Control><span className="section-heading"><span>Pin array</span><Badge color="teal" variant="light" size="sm">{metrics.count.toLocaleString('en-US')} pins</Badge></span></Accordion.Control>
                  <Accordion.Panel>
                    <div className="field-pair">{field('columns', 'Columns', true)}{field('rows', 'Rows', true)}</div>
                    <p className="field-help">A centered grid of columns × rows.</p>
                    {field('spacing', 'Pin spacing', false, 20)}
                    <p className="field-help">Measured from center to center.</p>
                    {field('diameter', 'Pin diameter', false, 10)}
                    {field('extension', image.source ? 'Max extension' : 'Pin extension', false, 80)}
                    <p className="field-help">Height above the base plate.</p>
                  </Accordion.Panel>
                </Accordion.Item>
              </Accordion>
              <div className="controls-bottom"><Button variant="default" fullWidth onClick={resetParameters}>Reset parameters</Button></div>
            </section>
            <ExportPanel parameters={parameters} heights={mapping.heightMap?.heights} materials={modelMaterials} onMaterialsChange={setModelMaterials} blockedReason={exportBlockedReason} />
          </aside>
          <div className="preview-column">
            <ModelPreview parameters={parameters} heights={mapping.heightMap?.heights} colors={modelColors} />
            <div className="metrics" aria-label="Design measurements">
              <div className="metric"><span>Total pins</span><strong>{metrics.count.toLocaleString('en-US')}<small>{parameters.columns} columns × {parameters.rows} rows</small></strong></div>
              <div className="metric"><span>Grid footprint</span><strong>{formatDimension(metrics.width)} × {formatDimension(metrics.depth)} <em>mm</em><small>Centered on the base</small></strong></div>
              <div className="metric"><span>Pin clearance</span><strong>{formatDimension(metrics.clearance)} <em>mm</em><small>Edge-to-edge distance</small></strong></div>
            </div>
            <div className="design-feedback" role="status" aria-live="polite">
              {warnings.length > 0 ? warnings.map((warning) => <Alert key={warning} color="orange" title="Check your dimensions">{warning}</Alert>) : <span className="fit-message"><span aria-hidden="true">✓</span> Your pin array fits within the base.</span>}
            </div>
          </div>
        </div>
      </main>
      <footer className="app-footer"><span>PIN ART STUDIO</span><span>Explore the geometry. Build the idea.</span></footer>
    </div>
  );
}
