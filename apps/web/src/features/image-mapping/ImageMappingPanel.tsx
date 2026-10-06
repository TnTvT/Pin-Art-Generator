import { useRef, useState } from 'react';
import { Alert, Button, FileButton, Group, MultiSelect, NumberInput, SegmentedControl, Select, Switch } from '@mantine/core';
import { FILAMENT_CATALOG, getFilament } from '../filaments/catalog';
import type { ColorMappingOptions, ColorMappingResult, MappingMode, PaletteFamily, PaletteSource } from './color-mapping';
import { formatDimension, type Parameters } from '../pin-design/model';
import { type SourceImage } from './image-mapping';
import { type HeightMap } from './sampling';
import InfoPopover from '../../components/InfoPopover/InfoPopover';
import HeightRangeControl from './HeightRangeControl';
import GeneratedPalette from './GeneratedPalette';
import type { MaterialSelection } from '../filaments/materials';
import type { ImagePlacement } from './image-placement';
import ImagePlacementDialog from './ImagePlacementDialog';
import { DEFAULT_IMAGE_SAMPLING, type ImageSampling, type MappingTimings } from './image-sampling';

interface ImageMappingPanelProps {
  enabled?: boolean;
  onEnabledChange?: (value: boolean) => void;
  source: SourceImage | null;
  parameters?: Parameters;
  placement?: ImagePlacement;
  placementBlocked?: boolean;
  onPlacementChange?: (placement: ImagePlacement) => void;
  loading: boolean;
  error: string | null;
  minimum: number;
  maximum: number;
  inverted: boolean;
  heightMap: HeightMap | null;
  mode: MappingMode;
  sampling?: ImageSampling;
  onSamplingChange?: (sampling: ImageSampling) => void;
  options: ColorMappingOptions;
  colors: ColorMappingResult | null;
  processing: boolean;
  editingBlocked?: boolean;
  editError?: string | null;
  resolvedPinMaterials?: readonly MaterialSelection[];
  onReplaceGroup?: (source: MaterialSelection, replacement: MaterialSelection) => void;
  resolvedMaterialsCount: number;
  elapsedMs: number | null;
  timings?: MappingTimings;
  onModeChange: (mode: MappingMode) => void;
  onOptionsChange: (options: ColorMappingOptions) => void;
  onRetry: () => void;
  onUpload: (file: File | null) => Promise<void>;
  onRemove: () => void;
  onSample: () => Promise<void>;
  onHeightRangeChange: (range: [number, number]) => void;
  onInvertChange: (value: boolean) => void;
}

const filamentOptions = (['Basic', 'Matte'] as const).map(type => ({
  group: `Bambu Lab · PLA ${type}`,
  items: FILAMENT_CATALOG.filter(filament => filament.type === type).map(filament => ({ value: filament.id, label: `${filament.color} (${filament.code})` })),
}));

export default function ImageMappingPanel(props: ImageMappingPanelProps) {
  const resetFile = useRef<(() => void) | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const [draftMaximum, setDraftMaximum] = useState<number | string>(props.options.maximum);
  const [lastMaximum, setLastMaximum] = useState(props.options.maximum);
  if (lastMaximum !== props.options.maximum) {
    setLastMaximum(props.options.maximum);
    setDraftMaximum(props.options.maximum);
  }
  const maximumValid = typeof draftMaximum === 'number' && Number.isInteger(draftMaximum) && draftMaximum >= 1 && draftMaximum <= 16;
  const hasHeights = props.mode !== 'color';
  const hasColors = props.mode !== 'height';

  return (
    <section className="image-panel" aria-label="Image mapping">
      <div className="image-heading">
        <div className="section-title"><h2>Image mapping</h2><InfoPopover label="Image mapping help"><p>Turn brightness into height, image colors into preset filaments, or both. Your image stays on your device. Upload PNG, JPG, or WebP up to 20 MB. Mapping samples composite transparency and margins over white; contour detection uses original alpha. Manual edits take priority.</p></InfoPopover></div>
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
            <img src={props.source.url} alt="Source image for pin mapping" />
            <span title={props.source.name}>{props.source.name}</span>
            <Button variant="subtle" color="gray" size="compact-xs" onClick={props.onRemove}>Remove image</Button>
          </div>
          {props.onEnabledChange && <Switch label="Map image to pins" checked={props.enabled !== false} onChange={event => props.onEnabledChange?.(event.currentTarget.checked)} size="xs" />}
          {props.parameters && props.placement && props.onPlacementChange && <Button size="xs" variant="default" fullWidth onClick={() => setAdjusting(true)}
            disabled={props.loading || props.placementBlocked || props.enabled === false}>Adjust image</Button>}
          {props.enabled !== false && <div className="mapping-controls">
            <fieldset className="mapping-mode"><legend>Sampling <InfoPopover label="Sampling help"><p>Smooth blends neighboring pixels. Pixel reads the nearest pixel without blending. Multiple pins can sample the same pixel or enlarged color block; gaps are not extra image pixels. Pixel does not add pins or restore details missed by a sparse array, JPEG compression or image downsizing.</p><p>Processing raster: {props.source.bitmap.width} × {props.source.bitmap.height} px · Maximum side: 1,024 px. This is not an automatically detected logical pixel-art grid.</p></InfoPopover></legend>
              <SegmentedControl fullWidth size="xs" value={props.sampling ?? DEFAULT_IMAGE_SAMPLING} disabled={props.placementBlocked}
                onChange={sampling => props.onSamplingChange?.(sampling as ImageSampling)} data={[{ label: 'Smooth', value: 'smooth' }, { label: 'Pixel', value: 'pixel' }]} />
            </fieldset>
            <fieldset className="mapping-mode"><legend>Mapping mode</legend>
              <SegmentedControl fullWidth size="xs" value={props.mode} onChange={mode => props.onModeChange(mode as MappingMode)}
                data={[{ label: 'Height', value: 'height' }, { label: 'Color', value: 'color' }, { label: 'Height + Color', value: 'height-color' }]} />
            </fieldset>
            {hasHeights && <>
            <HeightRangeControl minimum={props.minimum} maximum={props.maximum} onChange={props.onHeightRangeChange} />
            <Switch label="Invert mapping" checked={props.inverted} onChange={(event) => props.onInvertChange(event.currentTarget.checked)} size="xs" />
            <p className="mapping-description">{props.inverted ? 'Light pixels → taller pins' : 'Dark pixels → taller pins'} · Aspect ratio preserved</p>
            {props.heightMap && <p className="height-range">Mapped heights: {formatDimension(props.heightMap.minimum)}–{formatDimension(props.heightMap.maximum)} mm</p>}
            </>}
            {hasColors && <>
              <fieldset className="mapping-mode"><legend>Palette source <InfoPopover label="Palette matching help"><p>Auto palette greedily chooses preset colors using perceptual ΔE2000 differences. My filaments only uses your selected presets. Max pin materials excludes the base; the final design can use at most 16 materials including the base and manual colors. This does not assign AMS slots. Catalog RGB approximates printed color.</p></InfoPopover></legend>
                <SegmentedControl fullWidth size="xs" value={props.options.source} onChange={source => props.onOptionsChange({ ...props.options, source: source as PaletteSource })}
                  data={[{ label: 'Auto palette', value: 'auto' }, { label: 'My filaments', value: 'manual' }]} />
              </fieldset>
              {props.options.source === 'auto' ? <>
                <Select label="Filament family" size="xs" allowDeselect={false} value={props.options.family}
                  onChange={family => { if (family) props.onOptionsChange({ ...props.options, family: family as PaletteFamily }); }}
                  data={[{ label: 'Both', value: 'both' }, { label: 'PLA Basic', value: 'basic' }, { label: 'PLA Matte', value: 'matte' }]} />
                <NumberInput label="Max pin materials" size="xs" value={draftMaximum} min={1} max={16} allowNegative={false} allowDecimal={false} clampBehavior="none"
                  onChange={value => {
                    setDraftMaximum(value);
                    if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 16) props.onOptionsChange({ ...props.options, maximum: value });
                  }} error={maximumValid ? undefined : 'Enter an integer from 1 to 16.'} />
              </> : <MultiSelect className="mapping-filaments" label="Available filaments" searchable size="xs" data={filamentOptions} value={props.options.filamentIds}
                onChange={filamentIds => props.onOptionsChange({ ...props.options, filamentIds })} placeholder="Choose preset filaments" maxDropdownHeight={240}
                renderOption={({ option }) => <div className="filament-option"><span className="filament-swatch" style={{ backgroundColor: getFilament(option.value)?.hex }} aria-hidden="true" /><span>{option.label}</span></div>} />}
              {props.colors && <GeneratedPalette colors={props.colors} resolvedMaterials={props.resolvedPinMaterials} disabled={props.processing || props.editingBlocked}
                error={props.editError} onReplace={props.onReplaceGroup} />}
              <p className="mapping-description">Final design: {props.resolvedMaterialsCount} {props.resolvedMaterialsCount === 1 ? 'material' : 'materials'} (including base)</p>
            </>}
            <p className="mapping-description" role="status" data-preparation-ms={props.timings?.preparationMs} data-sampling-ms={props.timings?.samplingMs} data-palette-ms={props.timings?.paletteMs}>
              {props.processing ? 'Updating mapping…' : props.elapsedMs !== null ? `Mapping updated · ${Math.round(props.elapsedMs)} ms` : ''}</p>
          </div>}
        </div>
      ) : null}
      {props.error && <Alert color="red" title="Image mapping needs attention" mt="sm">{props.error}<Button variant="subtle" size="xs" onClick={props.onRetry} disabled={props.processing}>Retry mapping</Button></Alert>}
      {adjusting && props.source && props.parameters && props.placement && props.onPlacementChange && <ImagePlacementDialog key={props.source.url}
        opened source={props.source} parameters={props.parameters} placement={props.placement} onChange={props.onPlacementChange} onClose={() => setAdjusting(false)}
        sampling={props.sampling} processing={props.processing} blocked={!!props.placementBlocked || props.loading} error={props.error} />}
    </section>
  );
}
