import { useMemo, useState } from 'react';
import { Alert, Button, Checkbox, Group, Modal, NumberInput, Slider } from '@mantine/core';
import InfoPopover from '../../components/InfoPopover/InfoPopover';
import type { Parameters } from '../pin-design/model';
import { sampleImagePixels, type SourceImage } from './image-mapping';
import { DEFAULT_IMAGE_PLACEMENT, fitImageToPins, MAX_IMAGE_ZOOM, MIN_IMAGE_ZOOM, zoomImage, type ImagePlacement } from './image-placement';
import ImagePlacementCanvas from './ImagePlacementCanvas';
import './image-placement.css';
import { DEFAULT_IMAGE_SAMPLING, type ImageSampling } from './image-sampling';
import useSamplingPreview from './useSamplingPreview';
import { buildSamplingPreview } from './sampling-preview';
import { getMappingGrid } from './mapping-grid';

interface Props {
  opened: boolean; source: SourceImage; parameters: Parameters; placement: ImagePlacement;
  blocked: boolean; processing: boolean; error: string | null;
  sampling?: ImageSampling;
  onChange: (placement: ImagePlacement) => void; onClose: () => void;
}

function PlacementField({ label, value, onChange, blocked, zoom = false }: { label: string; value: number; onChange: (value: number) => void; blocked: boolean; zoom?: boolean }) {
  const displayValue = Number(value.toFixed(2));
  const [draft, setDraft] = useState<number | string>(displayValue);
  const [previous, setPrevious] = useState(value);
  if (value !== previous) { setPrevious(value); setDraft(displayValue); }
  const valid = typeof draft === 'number' && Number.isFinite(draft) && (!zoom || draft >= MIN_IMAGE_ZOOM * 100 && draft <= MAX_IMAGE_ZOOM * 100);
  return <NumberInput label={label} size="xs" value={draft} suffix={zoom ? ' %' : ' mm'} decimalScale={2} clampBehavior="none" disabled={blocked}
    error={valid ? undefined : zoom ? 'Enter 10–400%.' : 'Enter a finite offset.'} onChange={next => {
      setDraft(next);
      if (typeof next === 'number' && Number.isFinite(next) && (!zoom || next >= MIN_IMAGE_ZOOM * 100 && next <= MAX_IMAGE_ZOOM * 100)) onChange(next);
    }} />;
}

export default function ImagePlacementDialog(props: Props) {
  const { parameters, source, placement, onChange, blocked } = props;
  const sampling = props.sampling ?? DEFAULT_IMAGE_SAMPLING;
  const preview = useSamplingPreview(source, sampling);
  const [showPinShapes, setShowPinShapes] = useState(false);
  const [imageOpacity, setImageOpacity] = useState(100);
  const [sampleVersion, setSampleVersion] = useState(0);
  const grid = useMemo(() => getMappingGrid(parameters), [parameters]);
  const samples = useMemo(() => {
    if (!preview.source) return { groups: [], error: null };
    try {
      return { groups: buildSamplingPreview(sampleImagePixels(preview.source, parameters, placement, sampling), parameters), error: null };
    } catch (error) {
      return { groups: [], error: error instanceof Error ? error.message : 'Image samples could not be prepared.' };
    }
  }, [preview.source, parameters, placement, sampling, sampleVersion]);
  return <Modal opened={props.opened} onClose={props.onClose} title="Adjust image" closeButtonProps={{ 'aria-label': 'Close image adjustment' }} centered size={1000} className="image-placement-dialog">
    <div className="image-placement-heading">
      <div><p id="image-placement-instructions">Drag to move · Scroll to zoom</p><p>Sampling: {sampling === 'pixel' ? 'Pixel' : 'Smooth'} · Compact pin tops</p></div>
      <InfoPopover label="Image placement help"><p>Move and zoom the original image on the left; the read-only panel on the right shows each pin's sampled RGB before filament matching and manual edits. Both share the same placement and viewport. Lower Image opacity to see the grid more clearly; this only changes the left preview, not sampled colors, heights or downloads. Grid cells use the pin-top envelope, not physical spacing; print-in-place includes the head flare. The original keeps its aspect ratio; Pixel samples can jump between cells during zoom. Missing lattice positions stay blank. Show pin shapes overlays the top outlines at compact positions. The base outline is a compressed reference, not the print layout.</p><p>Offsets and arrow keys use compact-grid mm (Shift: 5 mm); + / − zoom. The checkerboard is display-only: transparent pixels and uncovered cells map to white. Escape cancels a drag. Fit image and Reset restore centered contain within the compact grid; From image uses the foreground bounds. Changes apply live. Physical pin positions, base geometry, spacing and manual edits stay unchanged.</p></InfoPopover>
    </div>
    <Group justify="space-between" mb="xs"><span className="image-placement-status">Cell size: {Number(grid.cellSize.toFixed(2))} mm</span><Checkbox size="xs" label="Show pin shapes" checked={showPinShapes} onChange={event => setShowPinShapes(event.currentTarget.checked)} /></Group>
    <div className="image-placement-comparison">
      <section aria-label="Original image" className="image-placement-panel">
        <h3>Original image</h3>
        <ImagePlacementCanvas source={source} preview={preview.source} sampling={sampling} showPinShapes={showPinShapes} imageOpacity={imageOpacity / 100}
          parameters={parameters} placement={placement} onChange={onChange} blocked={blocked} />
        <div className="image-placement-opacity">
          <Group justify="space-between" gap="xs"><span>Image opacity</span><span>{imageOpacity}%</span></Group>
          <Slider thumbLabel="Image opacity" min={0} max={100} step={5} value={imageOpacity} onChange={setImageOpacity} label={value => `${value}%`} size="xs" />
        </div>
      </section>
      <section aria-label="Mapped samples" className="image-placement-panel">
        <h3>Mapped samples</h3>
        <ImagePlacementCanvas source={source} preview={preview.source} sampling={sampling} samples={samples.groups} showSamples showPinShapes={showPinShapes} interactive={false}
          parameters={parameters} placement={placement} onChange={onChange} blocked={blocked} />
      </section>
    </div>
    <div className="image-placement-fields">
      <PlacementField label="Offset X" value={placement.offsetX} blocked={blocked} onChange={offsetX => onChange({ ...placement, offsetX })} />
      <PlacementField label="Offset Y" value={placement.offsetY} blocked={blocked} onChange={offsetY => onChange({ ...placement, offsetY })} />
      <PlacementField label="Zoom" value={placement.zoom * 100} blocked={blocked} zoom onChange={value => onChange(zoomImage(placement, value / 100))} />
    </div>
    <Slider thumbLabel="Image zoom" min={MIN_IMAGE_ZOOM * 100} max={MAX_IMAGE_ZOOM * 100} step={1} value={placement.zoom * 100}
      onChange={value => onChange(zoomImage(placement, value / 100))} label={value => `${value}%`} disabled={blocked} />
    <Group gap="xs" mt="md" justify="space-between" className="image-placement-actions">
      <Group gap="xs" className="image-placement-shortcuts"><Button size="xs" variant="default" disabled={blocked} onClick={() => onChange({ ...placement, offsetX: 0, offsetY: 0 })}>Center image</Button>
        <Button size="xs" variant="default" disabled={blocked} onClick={() => onChange(fitImageToPins(source.bitmap, parameters))}>Fit image</Button>
        <Button size="xs" variant="subtle" disabled={blocked} onClick={() => onChange({ ...DEFAULT_IMAGE_PLACEMENT })}>Reset</Button></Group>
      <Button size="xs" onClick={props.onClose}>Done</Button>
    </Group>
    <p className="image-placement-status" role="status">{props.processing || preview.loading ? 'Updating mapping…' : 'Image mapping only · Base and pin layout unchanged'}</p>
    {preview.error && <Alert color="red" title="Image preview unavailable">{preview.error}<Button variant="subtle" size="xs" onClick={preview.retry}>Retry preview</Button></Alert>}
    {samples.error && <Alert color="red" title="Image samples unavailable">{samples.error}<Button variant="subtle" size="xs" onClick={() => setSampleVersion(version => version + 1)}>Retry samples</Button></Alert>}
    {props.error && <Alert color="red" title="Placement not applied">{props.error}</Alert>}
  </Modal>;
}
