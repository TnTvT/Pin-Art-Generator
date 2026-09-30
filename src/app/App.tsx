import { useMemo, useState } from 'react';
import { Alert, Badge, Button } from '@mantine/core';
import ParameterField from '../features/pin-design/ParameterField';
import ModelPreview from '../features/preview/ModelPreview';
import ImageMappingPanel from '../features/image-mapping/ImageMappingPanel';
import useSourceImage from '../features/image-mapping/useSourceImage';
import { mapImageToPins } from '../features/image-mapping/image-mapping';
import { DEFAULTS, formatDimension, getMetrics, getWarnings, type Parameters } from '../features/pin-design/model';

type Draft = Record<keyof Parameters, number | string>;

export default function App() {
  const [parameters, setParameters] = useState<Parameters>({ ...DEFAULTS });
  const [draft, setDraft] = useState<Draft>({ ...DEFAULTS });
  const image = useSourceImage();
  const [minimum, setMinimum] = useState(2);
  const [inverted, setInverted] = useState(false);
  const mapping = useMemo(() => {
    if (!image.source) return { heightMap: null, error: null };
    try {
      return { heightMap: mapImageToPins(image.source, parameters, minimum, inverted), error: null };
    } catch {
      return { heightMap: null, error: 'Image mapping is unavailable. The preview is showing uniform pins.' };
    }
  }, [image.source, parameters, minimum, inverted]);
  const metrics = getMetrics(parameters);
  const warnings = getWarnings(parameters);

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
          <span>Pin Art<span className="brand-secondary"> Studio</span></span>
          <Badge variant="light" color="gray" size="sm">MVP</Badge>
        </div>
        <span className="header-caption">A little precision. A lot of possibility.</span>
      </header>
      <main>
        <div className="page-heading">
          <h1>Workspace</h1>
          <span className="unit-label">All dimensions in <strong>mm</strong></span>
        </div>
        <div className="workspace">
          <aside className="controls-panel" aria-label="Design parameters">
            <div className="controls-heading"><h2>Parameters</h2><span>01 / DESIGN</span></div>
            <section className="control-section">
              <div className="section-heading"><h3>Base plate</h3><span>Foundation</span></div>
              <div className="field-pair">{field('width', 'Base width')}{field('depth', 'Base depth')}</div>
              {field('thickness', 'Base thickness')}
            </section>
            <section className="control-section">
              <div className="section-heading"><h3>Pin array</h3><Badge color="teal" variant="light" size="sm">{metrics.count.toLocaleString('en-US')} pins</Badge></div>
              <div className="field-pair">{field('columns', 'Columns', true)}{field('rows', 'Rows', true)}</div>
              <p className="field-help">A centered grid of columns × rows.</p>
              {field('spacing', 'Pin spacing', false, 20)}
              <p className="field-help">Measured from center to center.</p>
              {field('diameter', 'Pin diameter', false, 10)}
              {field('extension', image.source ? 'Max extension' : 'Pin extension', false, 80)}
              <p className="field-help">Height above the base plate.</p>
            </section>
            <div className="controls-bottom"><Button variant="default" fullWidth onClick={resetParameters}>Reset parameters</Button></div>
          </aside>
          <div className="preview-column">
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
            <ModelPreview parameters={parameters} heights={mapping.heightMap?.heights} />
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
