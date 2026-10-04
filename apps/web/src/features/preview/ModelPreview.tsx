import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, Button, Group, useComputedColorScheme } from '@mantine/core';
import { createPreview, type Preview, type PreviewEditing, type ViewAction } from './preview';
import { DEFAULT_MODEL_COLORS, type ModelColors, type Parameters } from '../pin-design/model';
import InfoPopover from '../../components/InfoPopover/InfoPopover';
import DesignColorSummary from '../filaments/DesignColorSummary';
import type { MaterialSelection } from '../filaments/materials';

interface ModelPreviewProps {
  parameters: Parameters;
  heights?: Float32Array;
  colors?: ModelColors;
  pinColors?: readonly string[];
  materialSelections?: readonly MaterialSelection[];
  editing?: PreviewEditing;
  heightLabel?: string;
  toolbar?: ReactNode;
}

export default function ModelPreview({ parameters, heights, colors = DEFAULT_MODEL_COLORS, pinColors, materialSelections, editing, heightLabel, toolbar }: ModelPreviewProps) {
  const container = useRef<HTMLDivElement>(null);
  const preview = useRef<Preview | null>(null);
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
    preview.current?.update(parameters, heights);
  }, [parameters, heights]);

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
    ...(pinColors ?? Array<string>(parameters.columns * parameters.rows).fill(colors.pins)).map(color => ({ color, filamentId: null })),
  ], [materialSelections, colors, pinColors, parameters.columns, parameters.rows]);

  return (
    <section className="preview-panel" aria-label="Model preview">
      <div className="preview-heading">
        <div className="preview-title">
          <h2>3D preview</h2>
          <InfoPopover label="Preview help">
            <p>Click a pin to select. Drag to rotate. Shift-click toggles pins; Shift-drag adds pins in a box. Scroll to zoom; right-drag to pan.</p>
            <p>Assembled conceptual preview. Detachable sockets and print-plate layout are not rendered.</p>
          </InfoPopover>
        </div>
        <Group gap="xs" className="view-actions">
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
