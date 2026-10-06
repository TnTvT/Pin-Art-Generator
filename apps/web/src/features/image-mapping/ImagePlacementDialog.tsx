import { useState } from 'react';
import { Alert, Button, Group, Modal, NumberInput, Slider } from '@mantine/core';
import InfoPopover from '../../components/InfoPopover/InfoPopover';
import type { Parameters } from '../pin-design/model';
import type { SourceImage } from './image-mapping';
import { DEFAULT_IMAGE_PLACEMENT, fitImageToPins, MAX_IMAGE_ZOOM, MIN_IMAGE_ZOOM, zoomImage, type ImagePlacement } from './image-placement';
import ImagePlacementCanvas from './ImagePlacementCanvas';
import './image-placement.css';
import { DEFAULT_IMAGE_SAMPLING, type ImageSampling } from './image-sampling';
import useSamplingPreview from './useSamplingPreview';

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
  return <Modal opened={props.opened} onClose={props.onClose} title="Adjust image" closeButtonProps={{ 'aria-label': 'Close image adjustment' }} centered size="lg" className="image-placement-dialog">
    <div className="image-placement-heading">
      <div><p id="image-placement-instructions">Drag to move · Scroll to zoom</p><p>Sampling: {sampling === 'pixel' ? 'Pixel' : 'Smooth'}</p></div>
      <InfoPopover label="Image placement help"><p>Only image height and color mapping changes. The base outline, pin positions and manual edits stay unchanged, including From image bases. Outside the image is white. Arrow keys move 1 mm (Shift: 5 mm); + / − zoom. Escape cancels a drag. Fit image fits the source content to the pin footprint; Reset restores the original centered mapping. Changes apply live and are kept when you close.</p></InfoPopover>
    </div>
    <ImagePlacementCanvas source={source} preview={preview.source} sampling={sampling} parameters={parameters} placement={placement} onChange={onChange} blocked={blocked} />
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
    {props.error && <Alert color="red" title="Placement not applied">{props.error}</Alert>}
  </Modal>;
}
