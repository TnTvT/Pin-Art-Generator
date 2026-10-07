import InfoPopover from '../../components/InfoPopover/InfoPopover';
import { useState } from 'react';
import { NumberInput, RangeSlider } from '@mantine/core';
import { formatDimension } from '../pin-design/model';

interface HeightRangeControlProps {
  minimum: number;
  maximum: number;
  onChange: (range: [number, number]) => void;
}

type RangeDraft = [number | string, number | string];

export default function HeightRangeControl({ minimum, maximum, onChange }: HeightRangeControlProps) {
  const [draft, setDraft] = useState<RangeDraft>([minimum, maximum]);
  const [lastRange, setLastRange] = useState([minimum, maximum]);
  const [sliderMaximum, setSliderMaximum] = useState(Math.max(80, maximum));
  if (maximum > sliderMaximum) setSliderMaximum(maximum);
  if (lastRange[0] !== minimum || lastRange[1] !== maximum) {
    setLastRange([minimum, maximum]);
    setDraft([minimum, maximum]);
  }
  const valid = typeof draft[0] === 'number' && Number.isFinite(draft[0]) && draft[0] > 0
    && typeof draft[1] === 'number' && Number.isFinite(draft[1]) && draft[1] >= draft[0];

  function changeBound(index: 0 | 1, value: number | string) {
    const next: RangeDraft = [...draft];
    next[index] = value;
    setDraft(next);
    if (typeof next[0] === 'number' && Number.isFinite(next[0]) && next[0] > 0
      && typeof next[1] === 'number' && Number.isFinite(next[1]) && next[1] >= next[0]) onChange([next[0], next[1]]);
  }

  return (
    <fieldset className="mapping-height-range">
      <legend>Height range <InfoPopover label="Mapped extension help"><p>These values are pin extensions measured from the base top to the pin top in the initial printing position. Print-in-place includes the top retaining head; total pin length also includes base thickness. Invert only changes height mapping.</p></InfoPopover> <span>{formatDimension(minimum)}–{formatDimension(maximum)} mm</span></legend>
      <RangeSlider
        value={[minimum, maximum]}
        onChange={range => { setDraft(range); onChange(range); }}
        min={0.01}
        max={sliderMaximum}
        step={0.1}
        precision={2}
        minRange={0}
        pushOnOverlap={false}
        thumbFromLabel="Minimum mapped height"
        thumbToLabel="Maximum mapped height"
        thumbValueText={value => `${formatDimension(value)} mm`}
        label={value => `${formatDimension(value)} mm`}
        size="xs"
        thumbSize={16}
        className="mapping-height-slider"
      />
      <div className="field-pair">
        <NumberInput label="Min height" value={draft[0]} onChange={value => changeBound(0, value)}
          suffix=" mm" min={0.01} step={0.1} decimalScale={2} allowNegative={false} clampBehavior="none" size="xs" />
        <NumberInput label="Max height" value={draft[1]} onChange={value => changeBound(1, value)}
          suffix=" mm" min={0.01} step={0.1} decimalScale={2} allowNegative={false} clampBehavior="none" size="xs" />
      </div>
      {!valid && <p className="mapping-height-error" role="alert">Enter positive heights with Min height ≤ Max height.</p>}
    </fieldset>
  );
}
