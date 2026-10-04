import { NumberInput, Slider } from '@mantine/core';
import { type ParameterName } from './model';

interface ParameterFieldProps {
  name: ParameterName;
  label: string;
  value: number | string;
  validValue: number;
  onChange: (name: ParameterName, value: number | string) => void;
  onCommit?: (name: ParameterName) => void;
  integer?: boolean;
  sliderMax?: number;
}

export default function ParameterField({ name, label, value, validValue, onChange, onCommit, integer, sliderMax }: ParameterFieldProps) {
  const valid = typeof value === 'number' && Number.isFinite(value) && value > 0
    && (!integer || (Number.isInteger(value) && value <= 100));

  return (
    <div className="parameter-field">
      <NumberInput
        label={label}
        value={value}
        onChange={(nextValue) => onChange(name, nextValue)}
        onBlur={() => onCommit?.(name)}
        onKeyDown={event => { if (event.key === 'Enter') onCommit?.(name); }}
        min={integer ? 1 : 0.01}
        max={integer ? 100 : undefined}
        allowDecimal={!integer}
        allowNegative={false}
        decimalScale={integer ? 0 : 2}
        clampBehavior="none"
        suffix={integer ? undefined : ' mm'}
        error={valid ? undefined : integer ? 'Use a whole number from 1 to 100.' : 'Enter a positive number.'}
        size="sm"
        step={integer ? 1 : 0.1}
        styles={{ input: { fontVariantNumeric: 'tabular-nums' } }}
      />
      {sliderMax && (
        <Slider
          aria-label={`${label} slider`}
          value={validValue}
          onChange={(nextValue) => onChange(name, nextValue)}
          min={0.1}
          max={Math.max(sliderMax, validValue)}
          step={0.1}
          size="xs"
          label={(sliderValue) => `${sliderValue.toFixed(1)} mm`}
          className="parameter-slider"
        />
      )}
    </div>
  );
}
