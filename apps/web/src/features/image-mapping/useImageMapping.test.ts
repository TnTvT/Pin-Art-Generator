import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULTS } from '../pin-design/model';
import { DEFAULT_MODEL_MATERIALS } from '../filaments/materials';
import usePinEditor from '../pin-editing/usePinEditor';
import { mapImageToPins, sampleImagePixels, type SourceImage } from './image-mapping';
import { startColorMapping } from './color-worker';
import { DEFAULT_COLOR_MAPPING, mapPinColors, type ColorMappingRequest, type ColorMappingResult, type MappingMode } from './color-mapping';
import useImageMapping from './useImageMapping';

vi.mock('./color-worker', () => ({ startColorMapping: vi.fn() }));
vi.mock('./image-mapping', () => ({ sampleImagePixels: vi.fn(), mapImageToPins: vi.fn() }));

const parameters = { ...DEFAULTS, columns: 2, rows: 1 };
const source = { name: 'image.png', url: 'blob:test', bitmap: {} } as SourceImage;
const options = { ...DEFAULT_COLOR_MAPPING, source: 'manual' as const, filamentIds: ['basic-77', 'basic-903'] };
const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 177, 183, 255]);
const jobs: { request: ColorMappingRequest; cancel: ReturnType<typeof vi.fn>; resolve: (reply: { result: ColorMappingResult; elapsedMs: number }) => void; reject: (error: Error) => void }[] = [];

beforeEach(() => {
  jobs.length = 0;
  vi.mocked(sampleImagePixels).mockReturnValue(rgba);
  vi.mocked(mapImageToPins).mockReturnValue({ heights: new Float32Array([3, 8]), minimum: 3, maximum: 8 });
  vi.mocked(startColorMapping).mockImplementation(request => {
    const cancel = vi.fn();
    const promise = new Promise<{ result: ColorMappingResult; elapsedMs: number }>((resolve, reject) => jobs.push({ request, cancel, resolve, reject }));
    return { promise, cancel };
  });
});

function fixture(initialMode: MappingMode = 'color') {
  return renderHook(({ image, mode, grid }) => {
    const editor = usePinEditor(grid);
    const mapping = useImageMapping({ source: image, mode, parameters: grid, minimum: 2, inverted: false, options, editor });
    return { editor, mapping };
  }, { initialProps: { image: source as SourceImage | null, mode: initialMode, grid: parameters } });
}

async function finish(index: number) {
  await act(async () => jobs[index].resolve({ result: mapPinColors(jobs[index].request), elapsedMs: 12 }));
}

describe('image generation lifecycle', () => {
  it('rejects malformed height baselines rather than publishing a successful status', () => {
    vi.mocked(mapImageToPins).mockReturnValue({ heights: new Float32Array([NaN, 2]), minimum: 2, maximum: 2 });
    const { result } = fixture('height');
    expect(result.current.mapping.error).toMatch(/finite and positive/);
    expect([...result.current.editor.heights]).toEqual([20, 20]);
  });
  it('publishes color-only baseline atomically, blocks edits during processing and restores latest colors', async () => {
    const { result } = fixture();
    expect(result.current.mapping.loading).toBe(true);
    expect(result.current.editor.blocked).toBe(true);
    act(() => result.current.editor.select([0], 'replace'));
    act(() => result.current.editor.dispatch({ type: 'height', heights: result.current.editor.committed.heights, value: 30, mode: 'set' }));
    expect(result.current.editor.state.overrides.size).toBe(0);
    await finish(0);
    expect(result.current.mapping.loading).toBe(false);
    expect(result.current.editor.committed.pinSelections.map(material => material.filamentId)).toEqual(['basic-77', 'basic-903']);
    expect([...result.current.editor.heights]).toEqual([20, 20]);
    act(() => result.current.editor.dispatch({ type: 'material', target: 'selection', material: { color: '#123456', filamentId: null } }));
    expect(result.current.mapping.loading).toBe(true);
    await finish(1);
    expect(result.current.editor.committed.pinSelections[0].color).toBe('#123456');
    expect(result.current.editor.state.past).toHaveLength(1);
    act(() => result.current.editor.dispatch({ type: 'reset', target: 'material' }));
    await finish(2);
    expect(result.current.editor.committed.pinSelections[0].filamentId).toBe('basic-77');
    expect(result.current.editor.state.past).toHaveLength(2);
  });

  it('shares color and height samples and does not reprocess color on a manual height edit', async () => {
    const { result } = fixture('height-color');
    await finish(0);
    expect(sampleImagePixels).toHaveBeenCalledTimes(1);
    expect(mapImageToPins).not.toHaveBeenCalled();
    expect(result.current.editor.heights[0]).toBe(2);
    act(() => result.current.editor.select([0], 'replace'));
    act(() => result.current.editor.dispatch({ type: 'height', heights: result.current.editor.heights, value: 33, mode: 'set' }));
    expect(result.current.editor.heights[0]).toBe(33);
    expect(jobs).toHaveLength(1);
  });

  it('terminates replaced jobs, ignores late results and releases jobs on unmount', async () => {
    const { result, rerender, unmount } = fixture();
    rerender({ image: { ...source, name: 'replacement.png' }, mode: 'color', grid: parameters });
    expect(jobs[0].cancel).toHaveBeenCalled();
    await finish(0);
    expect(result.current.mapping.loading).toBe(true);
    expect(result.current.editor.state.generatedMaterials).toBeUndefined();
    await finish(1);
    expect(result.current.mapping.loading).toBe(false);
    unmount();
    expect(jobs[1].cancel).toHaveBeenCalled();
  });

  it('keeps the valid design on failure, retries and drops generator colors when the image is removed', async () => {
    const { result, rerender } = fixture();
    await finish(0);
    const baseline = result.current.editor.committed.pinSelections;
    rerender({ image: { ...source, name: 'bad.png' }, mode: 'color', grid: parameters });
    await act(async () => jobs[1].reject(new Error('Choose at least one preset.')));
    expect(result.current.mapping.error).toMatch(/Choose at least/);
    expect(result.current.editor.committed.pinSelections).toEqual(baseline);
    expect(result.current.editor.blocked).toBe(false);
    act(() => result.current.mapping.retry());
    await finish(2);
    expect(result.current.mapping.error).toBeNull();
    rerender({ image: null, mode: 'color', grid: parameters });
    expect(result.current.editor.committed.pinSelections).toEqual([DEFAULT_MODEL_MATERIALS.pins, DEFAULT_MODEL_MATERIALS.pins]);
    expect(result.current.mapping.colors).toBeNull();
  });

  it('uses the existing synchronous height path and resets topology before a failed new-grid result', async () => {
    const { result, rerender } = fixture('height');
    expect([...result.current.editor.heights]).toEqual([3, 8]);
    expect(jobs).toHaveLength(0);
    rerender({ image: source, mode: 'color', grid: parameters });
    await finish(0);
    act(() => result.current.editor.dispatch({ type: 'topology', count: 3 }));
    vi.mocked(sampleImagePixels).mockImplementation(() => { throw new Error('Canvas unavailable'); });
    rerender({ image: source, mode: 'color', grid: { ...parameters, columns: 3 } });
    expect(result.current.editor.heights).toHaveLength(3);
    expect(result.current.editor.committed.pinSelections).toHaveLength(3);
    expect(result.current.mapping.colors).toBeNull();
    expect(result.current.mapping.error).toMatch(/Canvas unavailable/);
  });
});
