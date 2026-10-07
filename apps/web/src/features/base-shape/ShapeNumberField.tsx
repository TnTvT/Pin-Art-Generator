import { useEffect, useState } from 'react';
import { NumberInput } from '@mantine/core';

export default function ShapeNumberField({ label, value, maximum, millimeters = true, disabled = false, onChange }: { label: string; value: number; maximum?: number; millimeters?: boolean; disabled?: boolean; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState<number | string>(value);
  useEffect(() => { setDraft(value); }, [value]);
  const valid = typeof draft === 'number' && Number.isFinite(draft) && draft >= 0 && (maximum === undefined || draft <= maximum);
  return <NumberInput disabled={disabled} label={label} size="xs" value={draft} min={0} max={maximum} suffix={millimeters ? ' mm' : undefined} clampBehavior="none"
    error={valid ? undefined : maximum === undefined ? 'Enter a finite nonnegative number.' : `Enter a number from 0 to ${maximum}.`}
    onChange={next => {
      setDraft(next);
      if (typeof next === 'number' && Number.isFinite(next) && next >= 0 && (maximum === undefined || next <= maximum)) onChange(next);
    }} />;
}
