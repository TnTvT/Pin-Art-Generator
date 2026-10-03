import { useEffect, useState } from 'react';
import { ColorInput, Select } from '@mantine/core';
import { CUSTOM_COLOR_SWATCHES, FILAMENT_CATALOG, getFilament } from './catalog';
import { type MaterialSelection } from './materials';
import './filaments.css';

interface FilamentColorFieldProps {
  label: string;
  value: MaterialSelection;
  onChange: (value: MaterialSelection) => void;
  disabled?: boolean;
}

const options = [
  ...(['Basic', 'Matte'] as const).map((type) => ({
    group: `Bambu Lab · PLA ${type}`,
    items: FILAMENT_CATALOG.filter((filament) => filament.type === type).map((filament) => ({
      value: filament.id, label: `${filament.color} (${filament.code})`,
    })),
  })),
  { group: 'Other colors', items: [{ value: 'custom', label: 'Custom color' }] },
];

export default function FilamentColorField({ label, value, onChange, disabled = false }: FilamentColorFieldProps) {
  const [draft, setDraft] = useState(value.color);
  const filament = value.filamentId ? getFilament(value.filamentId) : undefined;

  useEffect(() => {
    setDraft(value.color);
  }, [value.color]);

  function choose(id: string | null) {
    if (!id) return;
    setDraft(value.color);
    const next = getFilament(id);
    if (next) onChange({ color: next.hex.toLowerCase(), filamentId: next.id });
    else if (id === 'custom') onChange({ color: value.color, filamentId: null });
  }

  function changeCustom(next: string) {
    setDraft(next);
    if (/^#[0-9a-f]{6}$/i.test(next)) onChange({ color: next.toLowerCase(), filamentId: null });
  }

  return (
    <div className="filament-color-field">
      <Select label={label.replace('color', 'filament')} value={value.filamentId || 'custom'} onChange={choose} data={options}
        searchable allowDeselect={false} disabled={disabled} size="sm" maxDropdownHeight={240}
        filter={({ search }) => options.map((group) => ({
          ...group,
          items: group.items.filter((option) => option.value === 'custom'
            || `${group.group} ${option.label} ${getFilament(option.value)?.hex}`.toLowerCase().includes(search.trim().toLowerCase())),
        })).filter((group) => group.items.length > 0)}
        renderOption={({ option, checked }) => {
          const preset = getFilament(option.value);
          return <div className="filament-option">
            <span className="filament-swatch" style={{ background: preset?.hex || 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' }} aria-hidden="true" />
            <span>{option.label}</span>
            {checked && <span className="filament-check" aria-hidden="true">✓</span>}
          </div>;
        }} />
      {filament ? <div className="filament-details">
        <span className="filament-swatch" style={{ background: filament.hex }} aria-hidden="true" />
        <div>
          <span>{filament.brand} · {filament.material} {filament.type}</span>
          <strong>{filament.hex}</strong>
          <span>RGB {filament.rgb.join(', ')}</span>
        </div>
        <a href={filament.sourceUrl} target="_blank" rel="noopener noreferrer" aria-label={`Source for ${filament.color}`}>Source ↗</a>
      </div> : <ColorInput label={label} format="hex" value={draft} onChange={changeCustom}
        swatches={CUSTOM_COLOR_SWATCHES} swatchesPerRow={8} size="sm" disabled={disabled}
        eyeDropperButtonProps={{ 'aria-label': `Pick ${label.toLowerCase()} from screen` }}
        error={/^#[0-9a-f]{6}$/i.test(draft) ? undefined : `Using last valid color: ${value.color}.`} />}
    </div>
  );
}
