import { useMemo } from 'react';
import { Tooltip } from '@mantine/core';
import { getFilament } from './catalog';
import type { MaterialSelection } from './materials';

interface ColorUsage {
  color: string;
  base: boolean;
  pins: number;
  materials: Map<string | null, MaterialSelection>;
}

export default function DesignColorSummary({ selections }: { selections: readonly MaterialSelection[] }) {
  const colors = useMemo(() => {
    const grouped = new Map<string, ColorUsage>();
    selections.forEach((selection, index) => {
      const color = selection.color.toLowerCase();
      let usage = grouped.get(color);
      if (!usage) {
        usage = { color, base: false, pins: 0, materials: new Map() };
        grouped.set(color, usage);
      }
      if (index === 0) usage.base = true;
      else usage.pins++;
      usage.materials.set(selection.filamentId, selection);
    });
    return [...grouped.values()];
  }, [selections]);

  return <div className="design-color-summary" aria-label="Design colors">
    <span>Design:</span><strong>{colors.length} {colors.length === 1 ? 'color' : 'colors'}</strong>
    <div className="color-swatches">{colors.map(usage => {
      const hex = usage.color.toUpperCase();
      const rgb = [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16)).join(', ');
      const label = <div className="design-color-tooltip">
        <strong>{hex}</strong><span>RGB {rgb}</span>
        {[...usage.materials.values()].map(selection => {
          const filament = selection.filamentId ? getFilament(selection.filamentId) : undefined;
          return <div key={selection.filamentId ?? 'custom'} className="design-color-material">
            <strong>{filament ? `${filament.color} (${filament.code})` : 'Custom color'}</strong>
            <span>{filament ? `${filament.brand} · ${filament.material} ${filament.type}` : 'Generic PLA'}</span>
          </div>;
        })}
        <span>{[usage.base ? 'Base' : null, usage.pins ? `${usage.pins.toLocaleString('en-US')} ${usage.pins === 1 ? 'pin' : 'pins'}` : null].filter(Boolean).join(' · ')}</span>
      </div>;
      return <Tooltip key={usage.color} label={label} multiline withArrow position="top" events={{ hover: true, focus: true, touch: true }}>
        <button type="button" className="design-color-swatch" aria-label={`${hex} color details`}><i style={{ backgroundColor: usage.color }} aria-hidden="true" /></button>
      </Tooltip>;
    })}</div>
  </div>;
}
