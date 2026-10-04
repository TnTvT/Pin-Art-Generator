import { useEffect, useMemo, useRef, useState } from 'react';
import type { Parameters } from '../pin-design/model';
import type { PinEditor } from '../pin-editing/usePinEditor';
import { validateMaterials } from '../pin-editing/model';
import type { ColorMappingOptions, ColorMappingResult, MappingMode, MaterialOverride } from '../image-mapping/color-mapping';
import { layoutPixelsToHeights, layoutPixelsToRGB, mapImageToPins, readShapeImage, sampleImagePixels, type SourceImage } from '../image-mapping/image-mapping';
import type { HeightMap } from '../image-mapping/sampling';
import { startColorMapping } from '../image-mapping/color-worker';
import { samePins, type generateLayout, type ShapeOptions } from './layout';
import { startShapeJob } from './shape-worker';

export interface GenerationSettings { parameters: Parameters; shape: ShapeOptions; source: SourceImage | null; enabled: boolean; minimum: number; inverted: boolean; mode: MappingMode; options: ColorMappingOptions }
export interface GeneratedDesign { parameters: Parameters; heightMap: HeightMap | null; colors: ColorMappingResult | null; elapsedMs: number; changed: boolean }

export default function useDesignGeneration(settings: GenerationSettings, committed: Parameters, editor: PinEditor) {
  const [retry, setRetry] = useState(0);
  const [status, setStatus] = useState<{ job: object; design?: GeneratedDesign; error?: string } | null>(null);
  const overridesSignature = JSON.stringify([...editor.state.overrides].flatMap(([index, value]) => value.material ? [{ index, material: value.material }] : []));
  const overrides = useMemo(() => JSON.parse(overridesSignature) as MaterialOverride[], [overridesSignature]);
  const base = editor.state.base;
  const job = useMemo(() => ({ settings, base, overrides, retry }), [settings, base, overrides, retry]);
  const current = useRef(committed);
  const shapeCache = useRef<{ key: string; source: SourceImage | null; result: ReturnType<typeof generateLayout> } | null>(null);
  current.current = committed;

  useEffect(() => {
    let active = true;
    let cancel = () => {};
    async function run() {
      try {
        const start = performance.now();
        const source = settings.shape.source === 'image' ? settings.source : null;
        const { width, depth, spacing, diameter } = settings.parameters;
        const key = JSON.stringify({ width, depth, spacing, diameter, shape: settings.shape });
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
        const retained = changed ? [] : overrides;
        let heightMap: HeightMap | null = null, colors: ColorMappingResult | null = null;
        if (settings.enabled && settings.source) {
          if (settings.mode === 'height') heightMap = mapImageToPins(settings.source, parameters, settings.minimum, settings.inverted);
          else {
            const pixels = sampleImagePixels(settings.source, parameters);
            if (settings.mode === 'height-color') heightMap = layoutPixelsToHeights(pixels, settings.minimum, parameters.extension, settings.inverted);
            const task = startColorMapping({ ...settings.options, rgb: layoutPixelsToRGB(pixels), base, overrides: retained });
            cancel = task.cancel;
            colors = (await task.promise).result;
          }
        }
        if (!active) return;
        validateMaterials(parameters.layout.pins.length, new Map(retained.map(value => [value.index, { material: value.material }])), base, colors?.materials);
        if (heightMap && (heightMap.heights.length !== parameters.layout.pins.length || heightMap.heights.some(value => !Number.isFinite(value) || value <= 0))) throw new Error('Generated heights must match the layout and be finite and greater than zero.');
        setStatus({ job, design: { parameters, heightMap, colors, elapsedMs: performance.now() - start, changed } });
      } catch (error) {
        if (active) setStatus({ job, error: `${error instanceof Error ? error.message : 'Design generation failed.'} Current settings have not been applied.` });
      }
    }
    void run();
    return () => { active = false; cancel(); };
  }, [job]);

  return { job, design: status?.job === job ? status.design : undefined, loading: status?.job !== job,
    error: status?.job === job ? status.error ?? null : null, retry: () => setRetry(value => value + 1) };
}
