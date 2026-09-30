import { useRef, useState } from 'react';
import { Alert, Button, FileButton, Group, NumberInput, Switch } from '@mantine/core';
import { formatDimension } from '../pin-design/model';
import { type SourceImage } from './image-mapping';
import { type HeightMap } from './sampling';

interface ImageMappingPanelProps {
  source: SourceImage | null;
  loading: boolean;
  error: string | null;
  minimum: number;
  maximum: number;
  inverted: boolean;
  heightMap: HeightMap | null;
  onUpload: (file: File | null) => Promise<void>;
  onRemove: () => void;
  onSample: () => Promise<void>;
  onMinimumChange: (value: number) => void;
  onInvertChange: (value: boolean) => void;
}

export default function ImageMappingPanel(props: ImageMappingPanelProps) {
  const resetFile = useRef<(() => void) | null>(null);
  const [draftMinimum, setDraftMinimum] = useState<number | string>(props.minimum);
  const [lastMinimum, setLastMinimum] = useState(props.minimum);
  if (lastMinimum !== props.minimum) {
    setLastMinimum(props.minimum);
    setDraftMinimum(props.minimum);
  }
  const minimumValid = typeof draftMinimum === 'number' && Number.isFinite(draftMinimum)
    && draftMinimum > 0 && draftMinimum <= props.maximum;

  return (
    <section className="image-panel" aria-label="Image mapping">
      <div className="image-heading">
        <div><h2>Image mapping</h2><p>Turn brightness into height. Your image stays on your device.</p></div>
        <Group gap="xs">
          {!props.source && <Button variant="subtle" size="xs" onClick={() => void props.onSample()} disabled={props.loading}>Try sample</Button>}
          <FileButton resetRef={resetFile} accept="image/png,image/jpeg,image/webp" onChange={(file) => {
            void props.onUpload(file);
            resetFile.current?.();
          }}>
            {(fileProps) => <Button {...fileProps} size="xs" variant="light" loading={props.loading}>{props.source ? 'Replace image' : 'Upload image'}</Button>}
          </FileButton>
        </Group>
      </div>
      {props.source ? (
        <div className="image-settings">
          <div className="source-image">
            <img src={props.source.url} alt="Source image for pin height mapping" />
            <span title={props.source.name}>{props.source.name}</span>
            <Button variant="subtle" color="gray" size="compact-xs" onClick={props.onRemove}>Remove image</Button>
          </div>
          <div className="mapping-controls">
            <NumberInput
              label="Min extension"
              value={draftMinimum}
              onChange={(value) => {
                setDraftMinimum(value);
                if (typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= props.maximum) props.onMinimumChange(value);
              }}
              suffix=" mm"
              min={0.01}
              max={props.maximum}
              decimalScale={2}
              allowNegative={false}
              clampBehavior="none"
              size="xs"
              error={minimumValid ? undefined : `Enter a value above 0 and at most ${props.maximum} mm.`}
            />
            <div className="mapping-maximum"><span>Max extension</span><strong>{formatDimension(props.maximum)} mm</strong><small>Adjust in Pin array</small></div>
            <Switch label="Invert mapping" checked={props.inverted} onChange={(event) => props.onInvertChange(event.currentTarget.checked)} size="xs" />
            <p className="mapping-description">{props.inverted ? 'Light pixels → taller pins' : 'Dark pixels → taller pins'} · Aspect ratio preserved</p>
            {props.heightMap && <p className="height-range">Mapped heights: {formatDimension(props.heightMap.minimum)}–{formatDimension(props.heightMap.maximum)} mm</p>}
          </div>
        </div>
      ) : <p className="upload-hint">PNG, JPG, or WebP · Up to 20 MB · No image selected: uniform pin height</p>}
      {props.error && <Alert color="red" title="Image could not be loaded" mt="sm">{props.error}</Alert>}
    </section>
  );
}
