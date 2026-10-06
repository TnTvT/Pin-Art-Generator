import { useEffect, useMemo, useRef, useState } from 'react';
import type { Parameters } from '../pin-design/model';
import type { PinEditor } from '../pin-editing/usePinEditor';
import { validateGeometryOverrides, validateMaterials } from '../pin-editing/model';
import type { ColorMappingOptions, ColorMappingResult, MappingMode, MaterialOverride } from '../image-mapping/color-mapping';
import { layoutPixelsToHeights, layoutPixelsToRGB, mapImageToPins, readShapeImage, sampleImagePixels, type SourceImage } from '../image-mapping/image-mapping';
import type { HeightMap } from '../image-mapping/sampling';
import { startColorMapping } from '../image-mapping/color-worker';
import type { ImagePlacement } from '../image-mapping/image-placement';
import { DEFAULT_IMAGE_SAMPLING, type ImageSampling, type MappingTimings } from '../image-mapping/image-sampling';
import { prepareSamplingSource } from '../image-mapping/sampling-source';
import { samePins, type generateLayout, type ShapeOptions } from './layout';
import { startShapeJob } from './shape-worker';

export interface GenerationSettings { parameters: Parameters; shape: ShapeOptions; source: SourceImage | null; enabled: boolean; minimum: number; inverted: boolean; mode: MappingMode; options: ColorMappingOptions; placement?: ImagePlacement; sampling?: ImageSampling }
export interface GeneratedDesign { parameters: Parameters; heightMap: HeightMap | null; colors: ColorMappingResult | null; elapsedMs: number; changed: boolean; timings: MappingTimings }

export default function useDesignGeneration(settings: GenerationSettings, committed: Parameters, editor: PinEditor) {
  const [retry, setRetry] = useState(0);
  const [status, setStatus] = useState<{ job: object; design?: GeneratedDesign; error?: string; geometryConflict?: boolean } | null>(null);
  const overridesSignature = JSON.stringify([...editor.state.overrides].flatMap(([index, value]) => value.material ? [{ index, material: value.material }] : []));
  const overrides = useMemo(() => JSON.parse(overridesSignature) as MaterialOverride[], [overridesSignature]);
  const base = editor.state.base;
  const job = useMemo(() => ({ settings, base, overrides, retry }), [settings, base, overrides, retry]);
  const current = useRef(committed);
  const geometryOverrides = useRef(editor.state.overrides);
  geometryOverrides.current = editor.state.overrides;
  const shapeCache = useRef<{ key: string; source: SourceImage | null; result: ReturnType<typeof generateLayout> } | null>(null);
  const designCache = useRef<{ settings: GenerationSettings; retry: number; design: GeneratedDesign } | null>(null);
  current.current = committed;

  useEffect(() => {
    let active = true;
    let cancel = () => {};
    let geometryConflict = false;
    function validateRetained(parameters: Parameters) {
      try { validateGeometryOverrides(parameters, geometryOverrides.current); }
      catch (error) { geometryConflict = true; throw error; }
    }
    async function run() {
      try {
        const cached = designCache.current;
        if (cached?.settings === settings && cached.retry === retry && current.current.layout && samePins(current.current.layout, cached.design.parameters.layout!)) {
          validateRetained(cached.design.parameters);
          validateMaterials(cached.design.parameters.layout!.pins.length, new Map(overrides.map(value => [value.index, { material: value.material }])), base, cached.design.colors?.materials);
          setStatus({ job, design: { ...cached.design, changed: false } });
          return;
        }
        const start = performance.now();
        const source = settings.shape.source === 'image' ? settings.source : null;
        const { width, depth, spacing, diameter, pinShape, pinRotation } = settings.parameters;
        const key = JSON.stringify({ width, depth, spacing, diameter, pinShape: pinShape ?? 'round', pinRotation: pinShape === 'round' || !pinShape ? 0 : (pinRotation ?? 0) % 360, shape: settings.shape });
        let shapeResult = shapeCache.current?.key === key && shapeCache.current.source === source ? shapeCache.current.result : null;
        if (!shapeResult) {
          const shapeTask = startShapeJob({ parameters: settings.parameters, shape: settings.shape, image: source ? readShapeImage(source) : undefined });
          cancel = shapeTask.cancel;
          shapeResult = (await shapeTask.promise).result;
        }
        if (!active) return;
        shapeCache.current = { key, source, result: shapeResult };
        const parameters = { ...settings.parameters, ...shapeResult };
        if (![parameters.thickness, parameters.extension].every(value => Number.isFinite(value) && value > 0)) throw new Error('Use positive finite base thickness and generated height.');
        const changed = !current.current.layout || !samePins(current.current.layout, parameters.layout);
        if (!changed) validateRetained(parameters);
        const retained = changed ? [] : overrides;
        let heightMap: HeightMap | null = null, colors: ColorMappingResult | null = null;
        const timings: MappingTimings = { preparationMs: 0, samplingMs: 0, paletteMs: 0 };
        if (settings.enabled && settings.source) {
          const sampling = settings.sampling ?? DEFAULT_IMAGE_SAMPLING;
          const preparationStart = performance.now();
          const samplingSource = await prepareSamplingSource(settings.source, sampling);
          if (!active) return;
          timings.preparationMs = performance.now() - preparationStart;
          const samplingStart = performance.now();
          if (settings.mode === 'height') {
            heightMap = mapImageToPins(samplingSource, parameters, settings.minimum, settings.inverted, settings.placement, sampling);
            timings.samplingMs = performance.now() - samplingStart;
          }
          else {
            const pixels = sampleImagePixels(samplingSource, parameters, settings.placement, sampling);
            if (settings.mode === 'height-color') heightMap = layoutPixelsToHeights(pixels, settings.minimum, parameters.extension, settings.inverted);
            const rgb = layoutPixelsToRGB(pixels);
            timings.samplingMs = performance.now() - samplingStart;
            const paletteStart = performance.now();
            const task = startColorMapping({ ...settings.options, rgb, base, overrides: retained });
            cancel = task.cancel;
            colors = (await task.promise).result;
            timings.paletteMs = performance.now() - paletteStart;
          }
        }
        if (!active) return;
        validateMaterials(parameters.layout.pins.length, new Map(retained.map(value => [value.index, { material: value.material }])), base, colors?.materials);
        if (heightMap && (heightMap.heights.length !== parameters.layout.pins.length || heightMap.heights.some(value => !Number.isFinite(value) || value <= 0))) throw new Error('Generated heights must match the layout and be finite and greater than zero.');
        const design = { parameters, heightMap, colors, elapsedMs: performance.now() - start, changed, timings };
        designCache.current = { settings, retry, design };
        setStatus({ job, design });
      } catch (error) {
        if (active) setStatus({ job, geometryConflict, error: `${error instanceof Error ? error.message : 'Design generation failed.'} Current settings have not been applied.` });
      }
    }
    void run();
    return () => { active = false; cancel(); };
  }, [job]);

  return { job, design: status?.job === job ? status.design : undefined, loading: status?.job !== job,
    geometryConflict: status?.job === job && status.geometryConflict === true,
    error: status?.job === job ? status.error ?? null : null, retry: () => setRetry(value => value + 1) };
}
