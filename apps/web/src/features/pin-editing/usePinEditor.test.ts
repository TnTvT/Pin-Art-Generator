import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DEFAULTS } from '../pin-design/model';
import usePinEditor from './usePinEditor';

const parameters = { ...DEFAULTS, columns: 2, rows: 1 };
describe('pin editor gestures', () => {
  it('previews offsets against the start snapshot and commits one transaction', () => {
    const generated = new Float32Array([5, 10]);
    const { result } = renderHook(() => usePinEditor(parameters, generated));
    act(() => { result.current.select([0, 1], 'replace'); result.current.setHeightMode('offset'); });
    act(() => { expect(result.current.startDrag()).toBe(true); });
    act(() => result.current.updateDrag(2));
    act(() => result.current.updateDrag(3));
    expect([...result.current.heights]).toEqual([8, 13]);
    expect([...result.current.committed.heights]).toEqual([5, 10]);
    expect(result.current.state.past).toHaveLength(0);
    expect(result.current.isDragging).toBe(true);
    act(() => result.current.finishDrag());
    expect(result.current.state.past).toHaveLength(1);
    expect([...result.current.committed.heights]).toEqual([8, 13]);
    act(() => result.current.dispatch({ type: 'undo' }));
    expect([...result.current.heights]).toEqual([5, 10]);
  });

  it('sets to the active starting height plus delta, rejects invalid batches and cancels', () => {
    const generated = new Float32Array([5, 10]);
    const { result } = renderHook(() => usePinEditor(parameters, generated));
    act(() => result.current.select([0, 1], 'replace'));
    act(() => result.current.startDrag());
    act(() => result.current.updateDrag(2));
    expect([...result.current.heights]).toEqual([12, 12]);
    act(() => result.current.updateDrag(-20));
    expect([...result.current.heights]).toEqual([12, 12]);
    expect(result.current.error).toMatch(/greater than 0/);
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect([...result.current.heights]).toEqual([5, 10]);
    expect(result.current.state.past).toHaveLength(0);
    expect(result.current.isDragging).toBe(false);
  });

  it('cancels when regenerated heights change and ignores input undo shortcuts', () => {
    const { result, rerender } = renderHook(({ heights }) => usePinEditor(parameters, heights), { initialProps: { heights: new Float32Array([5, 10]) } });
    act(() => result.current.select([0], 'replace'));
    act(() => result.current.startDrag());
    act(() => result.current.updateDrag(2));
    rerender({ heights: new Float32Array([3, 6]) });
    expect([...result.current.heights]).toEqual([3, 6]);
    expect(result.current.state.past).toHaveLength(0);
    act(() => result.current.dispatch({ type: 'height', heights: result.current.heights, mode: 'set', value: 25 }));
    const input = document.createElement('input'); document.body.append(input);
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })));
    expect(result.current.state.past).toHaveLength(1);
    input.remove();
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true })));
    expect([...result.current.heights]).toEqual([3, 6]);
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true })));
    expect([...result.current.heights]).toEqual([25, 6]);
  });
});
