import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Group, useComputedColorScheme } from '@mantine/core';
import { createPreview, type Preview, type ViewAction } from './preview';
import { type Parameters } from '../pin-design/model';

export default function ModelPreview({ parameters, heights }: { parameters: Parameters; heights?: Float32Array }) {
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

  const setView = (action: ViewAction) => preview.current?.setView(action);

  return (
    <section className="preview-panel" aria-label="Model preview">
      <div className="preview-heading">
        <div>
          <h2>3D preview</h2>
          <span className="preview-subtitle">Your design, from every angle.</span>
        </div>
        <Group gap="xs" className="view-actions">
          <Button variant="default" size="xs" onClick={() => setView('top')} disabled={error}>Top view</Button>
          <Button variant="default" size="xs" onClick={() => setView('fit')} disabled={error}>Fit model</Button>
          <Button variant="subtle" color="gray" size="xs" onClick={() => setView('reset')} disabled={error}>Reset view</Button>
        </Group>
      </div>
      <div className="viewport">
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
        <span><strong>Drag</strong> to rotate <span className="instruction-separator">·</span> <strong>Scroll</strong> to zoom <span className="instruction-separator">·</span> <strong>Right-drag</strong> to pan</span>
        <span className="material-key"><i /> {heights ? 'Image-mapped heights' : 'Uniform pin height'}</span>
      </div>
    </section>
  );
}
