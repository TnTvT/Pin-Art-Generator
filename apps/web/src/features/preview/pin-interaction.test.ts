import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoxGeometry, CylinderGeometry, InstancedMesh, Mesh, MeshBasicMaterial, OrthographicCamera, PerspectiveCamera } from 'three';
import { DEFAULTS } from '../pin-design/model';
import { updatePinInstances, type PinInstanceGroup } from './pin-grid';
import { createPinGeometry } from '../pin-shape/preview-geometry';
import type { PinShape } from '../pin-shape/geometry';
import { createPinInteraction, type PreviewEditing } from './pin-interaction';
import { pinTip, projectTip } from './pin-selection';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach(cleanup => cleanup()));
function fixture(perspective = false, dense = false, grouped = false) {
  const shapes: PinShape[] = ['round', 'square', 'triangle'];
  const parameters = { ...DEFAULTS, columns: dense ? 100 : 2, rows: dense ? 50 : 2, spacing: dense ? 0.3 : 10, diameter: dense ? 0.1 : 2,
    pinGeometries: grouped ? Array.from({ length: dense ? 5000 : 4 }, (_, index) => ({ shape: shapes[index % 3], rotation: index % 3 * 30 })) : undefined };
  const heights = dense ? new Float32Array(5000).fill(10) : new Float32Array([5, 10, 15, 20]);
  const container = document.createElement('div');
  const canvas = document.createElement('canvas'); container.append(canvas); document.body.append(container);
  const rectangle = { left: 0, top: 0, width: 400, height: 400 } as DOMRect;
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(rectangle);
  let captured = false;
  for (const owner of [canvas as HTMLElement, container as HTMLElement]) {
    owner.setPointerCapture = () => { captured = true; };
    owner.hasPointerCapture = () => captured;
    owner.releasePointerCapture = () => { captured = false; };
  }
  const geometry = new CylinderGeometry(0.5, 0.5, 1, 16), material = new MeshBasicMaterial();
  const pins = new InstancedMesh(geometry, material, parameters.columns * parameters.rows); updatePinInstances(pins, parameters, heights); pins.updateMatrixWorld();
  const groups: PinInstanceGroup[] = grouped ? shapes.map(shape => {
    const indices = parameters.pinGeometries!.flatMap((geometry, index) => geometry.shape === shape ? [index] : []);
    const mesh = shape === 'round' ? pins : new InstancedMesh(createPinGeometry(shape), material, parameters.columns * parameters.rows);
    updatePinInstances(mesh, parameters, heights, indices); mesh.updateMatrixWorld();
    return { shape, mesh, indices, canonicalToLocal: new Map(indices.map((index, localIndex) => [index, localIndex])) };
  }) : [];
  const baseGeometry = new BoxGeometry(120, 100, 3), base = new Mesh(baseGeometry, material); base.position.z = 1.5; base.updateMatrixWorld();
  const camera = perspective ? new PerspectiveCamera(36, 1, 0.1, 1000) : new OrthographicCamera(-20, 20, 20, -20, 0.1, 500);
  camera.position.set(perspective ? 60 : 0, perspective ? 80 : 0, 100);
  camera.up.set(0, perspective ? 0 : 1, perspective ? 1 : 0); camera.lookAt(0, 0, 10); camera.updateMatrixWorld();
  const editing: PreviewEditing = { heightMode: 'offset', selection: new Set([0]), active: 0,
    onSelect: vi.fn(), onDragStart: vi.fn(() => true), onDragDelta: vi.fn(), onDragEnd: vi.fn(), onDragCancel: vi.fn() };
  const navigation = vi.fn();
  const interaction = createPinInteraction(container, canvas, grouped ? () => groups : pins, base, () => camera, navigation);
  interaction.update(parameters, heights); interaction.setEditing(editing); interaction.render();
  const handle = container.querySelector('button')!;
  handle.setPointerCapture = canvas.setPointerCapture; handle.hasPointerCapture = canvas.hasPointerCapture; handle.releasePointerCapture = canvas.releasePointerCapture;
  cleanups.push(() => {
    interaction.dispose(); container.remove(); geometry.dispose(); baseGeometry.dispose(); material.dispose(); pins.dispose();
    groups.filter(group => group.mesh !== pins).forEach(group => { group.mesh.geometry.dispose(); group.mesh.dispose(); });
  });
  function pointer(owner: HTMLElement, type: string, x: number, y: number, shift = false) {
    owner.dispatchEvent(new PointerEvent(type, { pointerId: 1, button: 0, clientX: x, clientY: y, shiftKey: shift, bubbles: true, cancelable: true }));
  }
  return { interaction, editing, pointer, canvas, handle, navigation, camera, parameters, heights, groups, base };
}
describe('preview pointer interaction', () => {
  it.each([false, true])('maps grouped local hits to canonical pins in both projections (perspective=%s)', perspective => {
    const { editing, pointer, canvas, camera, parameters, heights, groups } = fixture(perspective, false, true);
    for (const index of [0, 1, 2, 3]) {
      const point = projectTip(pinTip(index, parameters, heights), camera, { width: 400, height: 400 })!;
      pointer(canvas, 'pointerdown', point.x, point.y, true); pointer(canvas, 'pointerup', point.x, point.y, true);
      expect(editing.onSelect).toHaveBeenLastCalledWith([index], 'toggle');
    }
    const round = groups[0];
    round.indices = [3, 0]; round.canonicalToLocal = new Map([[3, 0], [0, 1]]);
    updatePinInstances(round.mesh, parameters, heights, round.indices);
    const point = projectTip(pinTip(3, parameters, heights), camera, { width: 400, height: 400 })!;
    pointer(canvas, 'pointerdown', point.x, point.y); pointer(canvas, 'pointerup', point.x, point.y);
    expect(editing.onSelect).toHaveBeenLastCalledWith([3], 'replace');
  });
  it('chooses the nearest group hit and keeps the base occlusion policy', () => {
    const { interaction, editing, pointer, canvas, camera, parameters, heights, groups, base } = fixture(false, false, true);
    const overlapping = { ...parameters, spacing: 0 };
    groups.forEach(group => updatePinInstances(group.mesh, overlapping, heights, group.indices));
    interaction.update(overlapping, heights);
    const point = projectTip(pinTip(3, overlapping, heights), camera, { width: 400, height: 400 })!;
    pointer(canvas, 'pointerdown', point.x, point.y); pointer(canvas, 'pointerup', point.x, point.y);
    expect(editing.onSelect).toHaveBeenLastCalledWith([3], 'replace');
    base.position.z = 80; base.updateMatrixWorld();
    pointer(canvas, 'pointerdown', point.x, point.y); pointer(canvas, 'pointerup', point.x, point.y);
    expect(editing.onSelect).toHaveBeenLastCalledWith([], 'replace');
  });
  it('maps the final grouped instance of a 5,000-pin grid to its canonical index', () => {
    const { editing, pointer, canvas, camera, parameters, heights } = fixture(false, true, true);
    const point = projectTip(pinTip(4999, parameters, heights), camera, { width: 400, height: 400 })!;
    pointer(canvas, 'pointerdown', point.x, point.y); pointer(canvas, 'pointerup', point.x, point.y);
    expect(editing.onSelect).toHaveBeenLastCalledWith([4999], 'replace');
  });
  it('picks the correct final instance in a 5,000-pin grid', () => {
    const { editing, pointer, canvas, camera, parameters, heights } = fixture(false, true);
    const point = projectTip(pinTip(4999, parameters, heights), camera, { width: 400, height: 400 })!;
    pointer(canvas, 'pointerdown', point.x, point.y); pointer(canvas, 'pointerup', point.x, point.y);
    expect(editing.onSelect).toHaveBeenLastCalledWith([4999], 'replace');
  });
  it.each([false, true])('picks instances in both projections and respects Shift toggles (perspective=%s)', perspective => {
    const { editing, pointer, canvas, camera, parameters, heights } = fixture(perspective);
    const point = projectTip(pinTip(3, parameters, heights), camera, { width: 400, height: 400 })!;
    pointer(canvas, 'pointerdown', point.x, point.y); pointer(canvas, 'pointerup', point.x, point.y);
    expect(editing.onSelect).toHaveBeenLastCalledWith([3], 'replace');
    pointer(canvas, 'pointerdown', point.x, point.y, true); pointer(canvas, 'pointerup', point.x, point.y, true);
    expect(editing.onSelect).toHaveBeenLastCalledWith([3], 'toggle');
  });
  it('box-selects projected tips only with Shift and adds to the selection', () => {
    const { editing, pointer, canvas, navigation } = fixture();
    pointer(canvas, 'pointerdown', 0, 0, true); pointer(canvas, 'pointermove', 399, 399, true); pointer(canvas, 'pointerup', 399, 399, true);
    expect(editing.onSelect).toHaveBeenLastCalledWith([0, 1, 2, 3], 'add');
    expect(navigation.mock.calls.map(([enabled]) => enabled)).toEqual([false, true]);
  });
  it('lets ordinary drags orbit without changing selection, even when returning to the starting point', () => {
    const { editing, pointer, canvas, navigation, camera, parameters, heights } = fixture();
    const point = projectTip(pinTip(3, parameters, heights), camera, { width: 400, height: 400 })!;
    const cameraEvents = vi.fn();
    canvas.addEventListener('pointerdown', cameraEvents);
    canvas.addEventListener('pointermove', cameraEvents);
    canvas.addEventListener('pointerup', cameraEvents);
    pointer(canvas, 'pointerdown', point.x, point.y);
    pointer(canvas, 'pointermove', point.x + 50, point.y);
    pointer(canvas, 'pointermove', point.x, point.y);
    pointer(canvas, 'pointerup', point.x, point.y);
    expect(cameraEvents).toHaveBeenCalledTimes(4);
    expect(navigation).not.toHaveBeenCalled();
    expect(editing.onSelect).not.toHaveBeenCalled();
    expect(document.querySelector('.pin-selection-box')).toHaveProperty('hidden', true);
  });
  it('does not select the base and right-drag remains navigation', () => {
    const { editing, pointer, canvas } = fixture();
    pointer(canvas, 'pointerdown', 20, 20); pointer(canvas, 'pointerup', 20, 20);
    expect(editing.onSelect).toHaveBeenLastCalledWith([], 'replace');
    canvas.dispatchEvent(new PointerEvent('pointerdown', { button: 2, pointerId: 1, bubbles: true }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { button: 2, pointerId: 1, bubbles: true }));
    expect(editing.onSelect).toHaveBeenCalledOnce();
  });
  it('captures a height drag, commits once, and cancels on Escape or pointer cancellation', () => {
    const { editing, pointer, handle, navigation } = fixture();
    pointer(handle, 'pointerdown', 150, 250); pointer(handle, 'pointermove', 150, 200); pointer(handle, 'pointermove', 150, 150);
    expect(editing.onDragDelta).toHaveBeenLastCalledWith(10);
    pointer(handle, 'pointerup', 150, 150);
    expect(editing.onDragEnd).toHaveBeenCalledOnce();
    expect(navigation.mock.calls.map(([enabled]) => enabled)).toEqual([false, true]);
    pointer(handle, 'pointerdown', 150, 250);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    pointer(handle, 'pointerdown', 150, 250); pointer(handle, 'pointercancel', 150, 200);
    expect(editing.onDragCancel).toHaveBeenCalledTimes(2);
    expect(editing.onDragEnd).toHaveBeenCalledOnce();
  });
});
