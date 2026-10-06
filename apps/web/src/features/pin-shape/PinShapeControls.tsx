import { useEffect, useState } from 'react';
import { NumberInput, SegmentedControl, Slider } from '@mantine/core';
import { formatDimension, type Parameters } from '../pin-design/model';
import type { PinShape } from './geometry';
import InfoPopover from '../../components/InfoPopover/InfoPopover';

export default function PinShapeControls({ parameters, onChange, disabled = false }: {
  parameters: Parameters;
  onChange: (value: Pick<Parameters, 'pinShape' | 'pinRotation'>) => void;
  disabled?: boolean;
}) {
  const rotation = parameters.pinRotation ?? 0;
  const [draft, setDraft] = useState<number | string>(rotation);
  useEffect(() => { setDraft(rotation); }, [rotation, parameters.pinShape]);
  const valid = typeof draft === 'number' && Number.isFinite(draft) && draft >= 0 && draft <= 360;
  function changeRotation(value: number | string) {
    setDraft(value);
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 360) onChange({ pinRotation: value });
  }
  return <div className="shape-controls">
    <fieldset className="mapping-mode"><legend>Pin shape <InfoPopover label="Pin shape help">
      <p>Pin size is the diameter of the enclosing circle. A square's diagonal and a triangle's circumcircle have this size. These controls set the defaults; use Shape in the preview toolbar to override selected pins. All pins share one size.</p>
      {parameters.pinShape === 'square' && <p>Square side: {formatDimension(parameters.diameter / Math.sqrt(2))} mm.</p>}
      {parameters.pinShape === 'triangle' && <p>Triangle side: {formatDimension(parameters.diameter * Math.sqrt(3) / 2)} mm.</p>}
      <p>Rotation is counterclockwise in Top view. At 0°, square sides align with X/Y and the triangle points toward +Y. Spacing is measured between pin centers; padding and clearance use the actual shape.</p>
    </InfoPopover></legend>
      <SegmentedControl fullWidth size="xs" disabled={disabled} value={parameters.pinShape ?? 'round'}
        data={[{ value: 'round', label: 'Round' }, { value: 'square', label: 'Square' }, { value: 'triangle', label: 'Triangle' }]}
        onChange={pinShape => onChange({ pinShape: pinShape as PinShape })} />
    </fieldset>
    {(parameters.pinShape ?? 'round') !== 'round' && <>
      <NumberInput label="Pin rotation" size="xs" suffix="°" min={0} max={360} step={1} decimalScale={2}
        value={draft} clampBehavior="none" disabled={disabled} onChange={changeRotation}
        error={valid ? undefined : `Using last valid rotation: ${rotation}°.`} />
      <Slider aria-label="Pin rotation" min={0} max={360} step={1} value={rotation} disabled={disabled} onChange={changeRotation} label={value => `${value}°`} />
    </>}
  </div>;
}
