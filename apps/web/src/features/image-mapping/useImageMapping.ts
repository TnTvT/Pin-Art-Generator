import { useEffect, useMemo, useState } from 'react';
import type { Parameters } from '../pin-design/model';
import { validateMaterials } from '../pin-editing/model';
import type { PinEditor } from '../pin-editing/usePinEditor';
import { mapImageToPins, sampleImagePixels, type SourceImage } from './image-mapping';
import { pixelsToHeights, pixelsToPinRGB, type HeightMap } from './sampling';
import { startColorMapping } from './color-worker';
import type { ColorMappingOptions, ColorMappingResult, MappingMode } from './color-mapping';

interface MappingInput {
  source: SourceImage | null;
  parameters: Parameters;
  minimum: number;
  inverted: boolean;
  mode: MappingMode;
  options: ColorMappingOptions;
  editor: PinEditor;
}
interface MappingStatus {
  input: object;
  topology: string;
  heightMap: HeightMap | null;
  colors: ColorMappingResult | null;
  elapsedMs: number | null;
  error: string | null;
}

export default function useImageMapping({ source, parameters, minimum, inverted, mode, options, editor }: MappingInput) {
  const materialOverrides = [...editor.state.overrides].flatMap(([index, override]) => override.material ? [{ index, material: override.material }] : []);
  const signature = JSON.stringify(materialOverrides);
  const stableOverrides = useMemo(() => materialOverrides, [signature]);
  const base = editor.state.base;
  const input = useMemo(() => ({ source, parameters, minimum, inverted, mode, options, base, overrides: stableOverrides }),
    [source, parameters, minimum, inverted, mode, options, base, stableOverrides]);
  const topology = `${parameters.rows}:${parameters.columns}`;
  const [status, setStatus] = useState<MappingStatus | null>(null);
  const [retry, setRetry] = useState(0);
  const job = useMemo(() => ({ input, retry }), [input, retry]);
  const pending = status?.input !== job;
  if (editor.state.mappingPending !== pending) editor.setMappingPending(pending);
  const { regenerate } = editor;

  useEffect(() => {
    let active = true;
    let cancel = () => {};
    const start = performance.now();
    const complete = (heightMap: HeightMap | null, colors: ColorMappingResult | null, elapsedMs: number | null) => {
      if (!active) return;
      const overrides = new Map(input.overrides.map(override => [override.index, { material: override.material }]));
      const count = input.parameters.rows * input.parameters.columns;
      if (input.source && input.mode !== 'color' && !heightMap) throw new Error('Resolved image heights are missing. Retry or replace the image.');
      if (heightMap && (heightMap.heights.length !== count || heightMap.heights.some(height => !Number.isFinite(height) || height <= 0))) throw new Error('Resolved image heights must match the grid and be finite and positive.');
      validateMaterials(count, overrides, input.base, colors?.materials);
      regenerate(heightMap?.heights, colors?.materials);
      setStatus({ input: job, topology, heightMap, colors, elapsedMs, error: null });
    };
    const fail = (error: unknown) => {
      if (!active) return;
      const reason = error instanceof Error ? error.message : 'Image processing failed.';
      setStatus(previous => ({ input: job, topology,
        heightMap: previous?.topology === topology ? previous.heightMap : null,
        colors: previous?.topology === topology ? previous.colors : null,
        elapsedMs: null, error: `Image mapping failed: ${reason}` }));
    };
    try {
      if (!input.source) complete(null, null, null);
      else if (input.mode === 'height') complete(mapImageToPins(input.source, input.parameters, input.minimum, input.inverted), null, performance.now() - start);
      else {
        const pixels = sampleImagePixels(input.source, input.parameters);
        const heightMap = input.mode === 'height-color'
          ? pixelsToHeights(pixels, input.parameters.columns, input.parameters.rows, input.minimum, input.parameters.extension, input.inverted) : null;
        const task = startColorMapping({ ...input.options, base: input.base, overrides: input.overrides,
          rgb: pixelsToPinRGB(pixels, input.parameters.columns, input.parameters.rows) });
        cancel = task.cancel;
        void task.promise.then(reply => complete(heightMap, reply.result, reply.elapsedMs)).catch(fail);
      }
    } catch (error) { fail(error); }
    return () => { active = false; cancel(); };
  }, [job, topology, regenerate]);

  const current = status?.topology === topology ? status : null;
  return { heightMap: current?.heightMap ?? null, colors: current?.colors ?? null, elapsedMs: current?.elapsedMs ?? null,
    loading: pending, error: pending ? null : current?.error ?? null, retry: () => setRetry(value => value + 1) };
}
