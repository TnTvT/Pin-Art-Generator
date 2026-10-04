import { memo } from 'react';
import { ColorInput, SegmentedControl, Select, Slider } from '@mantine/core';
import type { ShapeOptions, Layout } from './layout';
import InfoPopover from '../../components/InfoPopover/InfoPopover';
import ShapeNumberField from './ShapeNumberField';

export default function ShapeControls({ value, onChange, layout, diameter }: { value: ShapeOptions; onChange: (value: ShapeOptions) => void; layout: Layout; diameter: number }) {
  return <div className="shape-controls">
    <fieldset className="mapping-mode"><legend>Base source <InfoPopover label="Base shape help"><p>Preset shapes use a centered square grid. From image uses outer silhouettes only: interior gaps are filled with solid base and may contain pins. Image height and color mapping still use the original pixels. Padding measures from pin walls to the outer boundary. Separate silhouettes print as separate pieces.</p></InfoPopover></legend>
      <SegmentedControl fullWidth size="xs" value={value.source} data={[{ value: 'preset', label: 'Preset shape' }, { value: 'image', label: 'From image' }]} onChange={source => onChange({ ...value, source: source as ShapeOptions['source'] })} />
    </fieldset>
    {value.source === 'preset' ? <>
      <Select label="Base shape" size="xs" value={value.preset} allowDeselect={false}
        data={[{ value: 'rectangle', label: 'Rectangle' }, { value: 'rounded', label: 'Rounded rectangle' }, { value: 'circle', label: 'Circle' }, { value: 'ellipse', label: 'Ellipse' }]}
        onChange={preset => { if (preset) onChange({ ...value, preset: preset as ShapeOptions['preset'] }); }} />
      {value.preset === 'rounded' && <ShapeNumberField label="Corner radius" value={value.radius} onChange={radius => onChange({ ...value, radius })} />}
    </> : <>
      <Select label="Contour detection" size="xs" allowDeselect={false} value={value.detection} data={[{ value: 'auto', label: 'Auto' }, { value: 'transparency', label: 'Transparency' }, { value: 'background', label: 'Background color' }]}
        onChange={detection => { if (detection) onChange({ ...value, detection: detection as ShapeOptions['detection'] }); }} />
      {value.detection !== 'transparency' && <>
        <ColorInput label="Background color" size="xs" format="hex" value={value.background} onChange={background => { if (/^#[a-f0-9]{6}$/i.test(background)) onChange({ ...value, background }); }} />
        <ShapeNumberField label="Background tolerance (ΔE2000)" value={value.tolerance} maximum={50} millimeters={false} onChange={tolerance => onChange({ ...value, tolerance })} />
        <Slider aria-label="Background tolerance" min={0} max={50} value={value.tolerance} onChange={tolerance => onChange({ ...value, tolerance })} />
      </>}
    </>}
    <ContourPreview layout={layout} diameter={diameter} />
  </div>;
}

export const ContourPreview = memo(function ContourPreview({ layout, diameter }: { layout: Layout; diameter: number }) {
  const points = layout.regions.flatMap(region => region.outer);
  const width = Math.max(...points.map(point => point[0])) - Math.min(...points.map(point => point[0]));
  const depth = Math.max(...points.map(point => point[1])) - Math.min(...points.map(point => point[1]));
  const radius = diameter / 2;
  return <figure className="contour-preview">
    <svg role="img" aria-label="Applied base contour and pin positions" viewBox={`${-width / 2 - 2} ${-depth / 2 - 2} ${width + 4} ${depth + 4}`}>
      <g transform="scale(1,-1)">
        {layout.regions.map((region, index) => <path key={index} fillRule="evenodd" d={[region.outer, ...region.holes].map(ring => `M${ring.map(point => point.join(',')).join('L')}Z`).join('')} />)}
        <path className="contour-pins" d={layout.pins.map(pin => `M${pin.x - radius},${pin.y}a${radius},${radius} 0 1,0 ${diameter},0a${radius},${radius} 0 1,0 ${-diameter},0`).join('')} />
      </g>
    </svg>
    <figcaption>Applied contour · {layout.regions.length} {layout.regions.length === 1 ? 'region' : 'regions'}{layout.regions.length > 1 && ' · Separate print pieces'}</figcaption>
  </figure>;
});
