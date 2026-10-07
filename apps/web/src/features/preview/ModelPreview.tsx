import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, Button, Group, Switch, useComputedColorScheme } from '@mantine/core';
import type { MechanicalMesh } from '../mechanics/preview-geometry';
import { createPreview, type Preview, type PreviewEditing, type ViewAction } from './preview';
import { DEFAULT_MODEL_COLORS, type ModelColors, type Parameters } from '../pin-design/model';
import InfoPopover from '../../components/InfoPopover/InfoPopover';
import DesignColorSummary from '../filaments/DesignColorSummary';
import type { MaterialSelection } from '../filaments/materials';

interface ModelPreviewProps {
  parameters: Parameters;
  mechanical?: MechanicalMesh;
  heights?: Float32Array;
  colors?: ModelColors;
  pinColors?: readonly string[];
  materialSelections?: readonly MaterialSelection[];
  editing?: PreviewEditing;
  heightLabel?: string;
  toolbar?: ReactNode;
}

export default function ModelPreview({ parameters, mechanical, heights, colors = DEFAULT_MODEL_COLORS, pinColors, materialSelections, editing, heightLabel, toolbar }: ModelPreviewProps) {
  const container = useRef<HTMLDivElement>(null);
  const preview = useRef<Preview | null>(null);
  const [transparent, setTransparent] = useState(false);
  const [error, setError] = useState(false);
  const colorScheme = useComputedColorScheme('light', { getInitialValueInEffect: false });

  useEffect(() => {
    if (!container.current) return;
    try {
      preview.current = createPreview(container.current);
    } catch {
      setError(true);
    }
    return () => {
      preview.current?.dispose();
      preview.current = null;
    };
  }, []);

  useEffect(() => {
    preview.current?.update(parameters, heights, mechanical);
  }, [parameters, heights, mechanical]);
  useEffect(() => { preview.current?.setTransparentBase?.(transparent && parameters.construction?.mode === 'print-in-place'); }, [transparent, parameters.construction?.mode]);

  useEffect(() => {
    preview.current?.setColorScheme(colorScheme);
  }, [colorScheme]);

  useEffect(() => {
    preview.current?.setModelColors(colors);
  }, [colors]);

  useEffect(() => { if (pinColors) preview.current?.setPinColors(pinColors); }, [pinColors]);
  useEffect(() => { if (editing) preview.current?.setEditing(editing); }, [editing]);

  const setView = (action: ViewAction) => preview.current?.setView(action);
  const designSelections = useMemo(() => materialSelections ?? [
    { color: colors.base, filamentId: null },
    ...(pinColors ?? Array<string>(parameters.layout?.pins.length ?? parameters.columns * parameters.rows).fill(colors.pins)).map(color => ({ color, filamentId: null })),
  ], [materialSelections, colors, pinColors, parameters]);

  return (
    <section className="preview-panel" aria-label="Model preview">
      <div className="preview-heading">
        <div className="preview-title">
          <h2>3D preview</h2>
          <InfoPopover label="Preview help">
            <p>Click a pin to select. Drag to rotate. Shift-click toggles pins; Shift-drag adds pins in a box. Scroll to zoom; right-drag to pan.</p>
            <p>Print-in-place shows the actual guide holes, tapered retaining heads and clearance in the initial printing position. Extension includes the top head. Use Transparent base to inspect the structure; no motion simulation is applied.</p>
          </InfoPopover>
        </div>
        <Group gap="xs" className="view-actions">
          {parameters.construction?.mode === 'print-in-place' && <Switch label="Transparent base" size="xs" checked={transparent} onChange={event => setTransparent(event.currentTarget.checked)} disabled={error} />}
          <Button variant="default" size="xs" onClick={() => setView('top')} disabled={error}>Top view</Button>
          <Button variant="default" size="xs" onClick={() => setView('fit')} disabled={error}>Fit model</Button>
          <Button variant="subtle" color="gray" size="xs" onClick={() => setView('reset')} disabled={error}>Reset view</Button>
        </Group>
      </div>
      <div className="viewport">
        {!error && toolbar && <div className="preview-tools">{toolbar}</div>}
        <div className="canvas-container" ref={container} />
        {error && (
          <Alert color="red" title="3D preview unavailable" className="preview-error">
            Your browser could not start WebGL. Enable hardware acceleration or try another browser.
          </Alert>
        )}
        <div className="viewport-tag"><span className="status-dot" />Live preview</div>
        <div className="viewport-dimensions">{parameters.width} × {parameters.depth} mm<span>Base dimensions</span></div>
      </div>
      <div className="preview-footer">
        <DesignColorSummary selections={designSelections} />
        <span className="material-key"><i style={{ background: colors.pins }} /> {heightLabel ?? (heights ? 'Image-mapped heights' : 'Uniform pin height')}</span>
      </div>
    </section>
  );
}
