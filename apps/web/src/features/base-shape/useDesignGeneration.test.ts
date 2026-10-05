import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULTS } from '../pin-design/model';
import { DEFAULT_MODEL_MATERIALS } from '../filaments/materials';
import type { PinEditor } from '../pin-editing/usePinEditor';
import { mapImageToPins, sampleImagePixels, type SourceImage } from '../image-mapping/image-mapping';
import { DEFAULT_COLOR_MAPPING } from '../image-mapping/color-mapping';
import { startColorMapping } from '../image-mapping/color-worker';
import { DEFAULT_SHAPE, generateLayout } from './layout';
import { startShapeJob } from './shape-worker';
import useDesignGeneration, { type GenerationSettings } from './useDesignGeneration';

vi.mock('./shape-worker', () => ({ startShapeJob: vi.fn() }));
vi.mock('../image-mapping/image-mapping', async importOriginal => ({ ...await importOriginal<typeof import('../image-mapping/image-mapping')>(), mapImageToPins: vi.fn(), sampleImagePixels: vi.fn() }));
vi.mock('../image-mapping/color-worker', () => ({ startColorMapping: vi.fn() }));
const committed = { ...DEFAULTS, ...generateLayout(DEFAULTS, DEFAULT_SHAPE) };
const settings: GenerationSettings = { parameters: DEFAULTS, shape: DEFAULT_SHAPE, source: null, enabled: true, minimum: 2, inverted: false, mode: 'height', options: DEFAULT_COLOR_MAPPING };
const editor = { state: { base: DEFAULT_MODEL_MATERIALS.base, overrides: new Map([[0, { height: 30 }]]) } } as unknown as PinEditor;
beforeEach(() => {
  vi.mocked(startColorMapping).mockReset();
  vi.mocked(startShapeJob).mockReset();
  vi.mocked(startShapeJob).mockImplementation(request => ({ promise: Promise.resolve({ result: generateLayout(request.parameters, request.shape, request.image), elapsedMs: 1 }), cancel: vi.fn() }));
});
describe('atomic design generation', () => {
  it('preserves generated groups across manual colors, base edits and undo without rematching', async () => {
    const materials = Array(committed.layout.pins.length).fill(DEFAULT_MODEL_MATERIALS.pins);
    const colors = { materials, palette: [{ material: DEFAULT_MODEL_MATERIALS.pins, count: materials.length }], notice: null };
    vi.mocked(sampleImagePixels).mockReturnValue(new Uint8ClampedArray(materials.length * 4));
    vi.mocked(startColorMapping).mockImplementation(() => ({ promise: Promise.resolve({ result: colors, elapsedMs: 1 }), cancel: vi.fn() }));
    const input: GenerationSettings = { ...settings, mode: 'color', source: { name: 'test', bitmap: {}, url: 'blob:test' } as SourceImage };
    const { result, rerender } = renderHook(({ currentEditor, currentSettings }) => useDesignGeneration(currentSettings, committed, currentEditor), { initialProps: { currentEditor: editor, currentSettings: input } });
    await waitFor(() => expect(result.current.design?.colors).toBe(colors));
    const changedEditor = { ...editor, state: { ...editor.state, base: { color: '#ffffff', filamentId: 'basic-77' }, overrides: new Map([[0, { material: { color: '#123456', filamentId: null } }]]) } } as PinEditor;
    rerender({ currentEditor: changedEditor, currentSettings: input });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.design?.colors).toBe(colors);
    expect(startColorMapping).toHaveBeenCalledTimes(1);
    rerender({ currentEditor: editor, currentSettings: input });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(startColorMapping).toHaveBeenCalledTimes(1);
    rerender({ currentEditor: editor, currentSettings: { ...input, options: { ...input.options, maximum: 2 } } });
    await waitFor(() => expect(startColorMapping).toHaveBeenCalledTimes(2));
  });
  it('marks only ID or XY changes as topology changes', async () => {
    const { result, rerender } = renderHook(({ input }) => useDesignGeneration(input, committed, editor), { initialProps: { input: settings } });
    await waitFor(() => expect(result.current.design?.changed).toBe(false));
    const initialCalls = vi.mocked(startShapeJob).mock.calls.length;
    rerender({ input: { ...settings, parameters: { ...DEFAULTS, extension: 25 } } });
    await waitFor(() => expect(result.current.design?.parameters.extension).toBe(25));
    expect(vi.mocked(startShapeJob)).toHaveBeenCalledTimes(initialCalls);
    rerender({ input: { ...settings, parameters: { ...DEFAULTS, width: 121, diameter: 2.1, thickness: 4 } } });
    await waitFor(() => expect(result.current.design?.changed).toBe(false));
    rerender({ input: { ...settings, parameters: { ...DEFAULTS, spacing: 6 } } });
    await waitFor(() => expect(result.current.design?.changed).toBe(true));
  });
  it('cancels stale jobs and prevents their results from replacing a newer layout', async () => {
    let finish!: (value: Awaited<ReturnType<typeof startShapeJob>['promise']>) => void;
    const cancel = vi.fn();
    vi.mocked(startShapeJob).mockImplementationOnce(() => ({ promise: new Promise(resolve => { finish = resolve; }), cancel }));
    const { result, rerender, unmount } = renderHook(({ input }) => useDesignGeneration(input, committed, editor), { initialProps: { input: settings } });
    expect(result.current.loading).toBe(true);
    rerender({ input: { ...settings, parameters: { ...DEFAULTS, spacing: 10 } } });
    await waitFor(() => expect(result.current.design?.parameters.layout?.pins).toHaveLength(99));
    expect(cancel).toHaveBeenCalled();
    await act(async () => { finish({ result: generateLayout(DEFAULTS, DEFAULT_SHAPE), elapsedMs: 1 }); });
    expect(result.current.design?.parameters.layout?.pins).toHaveLength(99);
    unmount();
  });
  it('rejects image-only mode without an image and invalid generated heights without publishing geometry', async () => {
    const input: GenerationSettings = { ...settings, shape: { ...DEFAULT_SHAPE, source: 'image' } };
    const { result, rerender } = renderHook(({ input }) => useDesignGeneration(input, committed, editor), { initialProps: { input } });
    await waitFor(() => expect(result.current.error).toMatch(/Upload an image/));
    expect(result.current.design).toBeUndefined();
    vi.mocked(mapImageToPins).mockReturnValue({ heights: new Float32Array([NaN]), minimum: 2, maximum: 20 });
    rerender({ input: { ...settings, source: { name: 'test', bitmap: {}, url: 'blob:test' } as SourceImage } });
    await waitFor(() => expect(result.current.error).toMatch(/Generated heights/));
    expect(result.current.design).toBeUndefined();
  });
});
