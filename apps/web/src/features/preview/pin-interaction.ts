import { Camera, InstancedMesh, Object3D, Raycaster, Vector2, Vector3 } from 'three';
import type { Parameters } from '../pin-design/model';
import type { HeightMode, SelectionOperation } from '../pin-editing/model';
import { heightDragDelta, marqueeSelection, pinTip, projectTip, type ScreenPoint } from './pin-selection';
import type { PinInstanceGroup } from './pin-grid';

export interface PreviewEditing {
  heightMode: HeightMode;
  selection: ReadonlySet<number>;
  active: number | null;
  dragging?: boolean;
  onSelect: (ids: number[], operation: SelectionOperation) => void;
  onDragStart: () => boolean;
  onDragDelta: (delta: number) => void;
  onDragEnd: () => void;
  onDragCancel: () => void;
}

export function createPinInteraction(container: HTMLDivElement, canvas: HTMLCanvasElement, pins: InstancedMesh | (() => readonly PinInstanceGroup[]), base: Object3D, getCamera: () => Camera, enableNavigation: (enabled: boolean) => void) {
  let editing: PreviewEditing | undefined;
  let parameters: Parameters | undefined;
  let heights: Float32Array | undefined;
  let gesture: { id: number; start: ScreenPoint; last: ScreenPoint; shift: boolean; height: boolean; exclusive: boolean; moved: boolean; tip?: Vector3; camera: Camera; owner: HTMLElement } | null = null;
  const box = document.createElement('div');
  box.className = 'pin-selection-box'; box.hidden = true; box.setAttribute('aria-hidden', 'true');
  const handle = document.createElement('button');
  handle.type = 'button'; handle.className = 'pin-height-handle'; handle.hidden = true;
  handle.setAttribute('aria-label', 'Drag selected pin height');
  handle.title = 'Drag to adjust height. Escape cancels.';
  container.append(box, handle);
  function size() { const rect = canvas.getBoundingClientRect(); return { width: rect.width, height: rect.height }; }
  function local(event: PointerEvent) { const rect = canvas.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; }
  function pick(point: ScreenPoint) {
    const viewport = size();
    const ray = new Raycaster();
    ray.setFromCamera(new Vector2(point.x / viewport.width * 2 - 1, 1 - point.y / viewport.height * 2), getCamera());
    const groups = typeof pins === 'function' ? pins() : undefined;
    const meshes = groups ? groups.map(group => group.mesh) : [pins as InstancedMesh];
    for (const hit of ray.intersectObjects([...meshes, base], false)) {
      if (hit.object === base) return undefined;
      if (hit.instanceId === undefined) continue;
      const group = groups?.find(candidate => candidate.mesh === hit.object);
      const index = groups ? group?.indices[hit.instanceId] : hit.instanceId;
      if (index !== undefined) return index;
    }
    return undefined;
  }
  function down(event: PointerEvent) {
    if (!editing || !parameters || event.button !== 0 || gesture) return;
    const isHeight = event.currentTarget === handle;
    const point = local(event);
    if (isHeight && !editing.onDragStart()) return;
    const exclusive = isHeight || event.shiftKey;
    if (exclusive) { event.preventDefault(); event.stopImmediatePropagation(); }
    const owner = isHeight ? handle : canvas;
    gesture = { id: event.pointerId, start: point, last: point, shift: event.shiftKey, height: isHeight, exclusive, moved: false, camera: getCamera(), owner,
      tip: isHeight && editing.active !== null ? pinTip(editing.active, parameters, heights) : undefined };
    if (exclusive) {
      enableNavigation(false);
      owner.setPointerCapture(event.pointerId);
    }
    owner.focus({ preventScroll: true });
  }
  function move(event: PointerEvent) {
    if (!gesture || gesture.id !== event.pointerId || !editing) return;
    if (gesture.exclusive) { event.preventDefault(); event.stopImmediatePropagation(); }
    gesture.last = local(event);
    gesture.moved ||= Math.hypot(gesture.last.x - gesture.start.x, gesture.last.y - gesture.start.y) > 4;
    if (gesture.height && gesture.tip) {
      editing.onDragDelta(heightDragDelta(gesture.start, gesture.last, gesture.tip, gesture.camera, size()));
    } else if (gesture.shift && gesture.moved) {
      box.hidden = false;
      Object.assign(box.style, { left: `${Math.min(gesture.start.x, gesture.last.x)}px`, top: `${Math.min(gesture.start.y, gesture.last.y)}px`, width: `${Math.abs(gesture.last.x - gesture.start.x)}px`, height: `${Math.abs(gesture.last.y - gesture.start.y)}px` });
    }
  }
  function finish(event?: PointerEvent, cancelled = false) {
    if (!gesture || (event && gesture.id !== event.pointerId)) return;
    const snapshot = gesture;
    if (snapshot.exclusive) { event?.preventDefault(); event?.stopImmediatePropagation(); }
    if (event) {
      snapshot.last = local(event);
      snapshot.moved ||= Math.hypot(snapshot.last.x - snapshot.start.x, snapshot.last.y - snapshot.start.y) > 4;
    }
    gesture = null; box.hidden = true;
    if (snapshot.exclusive) {
      if (snapshot.owner.hasPointerCapture(snapshot.id)) snapshot.owner.releasePointerCapture(snapshot.id);
      enableNavigation(true);
    }
    if (!editing) return;
    if (snapshot.height) { if (cancelled) editing.onDragCancel(); else editing.onDragEnd(); }
    else if (!cancelled && parameters && (snapshot.shift || !snapshot.moved)) {
      const isBox = snapshot.shift && snapshot.moved;
      const hit = isBox ? undefined : pick(snapshot.last);
      const ids = isBox ? marqueeSelection(parameters, heights, getCamera(), size(), snapshot.start, snapshot.last) : hit === undefined ? [] : [hit];
      editing.onSelect(ids, snapshot.shift ? isBox ? 'add' : 'toggle' : 'replace');
    }
  }
  const up = (event: PointerEvent) => finish(event);
  const cancel = (event: PointerEvent) => finish(event, true);
  const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && gesture) { event.preventDefault(); finish(undefined, true); } };
  const blur = () => finish(undefined, true);
  const owners: HTMLElement[] = [canvas, handle];
  for (const owner of owners) {
    owner.addEventListener('pointerdown', down, true);
    owner.addEventListener('pointermove', move, true);
    owner.addEventListener('pointerup', up, true);
    owner.addEventListener('pointercancel', cancel, true);
    owner.addEventListener('lostpointercapture', cancel, true);
  }
  window.addEventListener('keydown', escape);
  window.addEventListener('blur', blur);
  return {
    setEditing(next?: PreviewEditing) {
      if (editing && next && editing.heightMode !== next.heightMode) finish(undefined, true);
      if (gesture?.height && editing?.dragging && !next?.dragging) finish(undefined, true);
      editing = next;
      canvas.style.cursor = 'grab';
    },
    update(nextParameters: Parameters, nextHeights?: Float32Array) { if (parameters && parameters !== nextParameters) finish(undefined, true); parameters = nextParameters; heights = nextHeights; },
    render() {
      const active = editing?.active;
      const point = active !== null && active !== undefined && parameters ? projectTip(pinTip(active, parameters, heights), getCamera(), size()) : null;
      handle.hidden = !point;
      if (point && active !== null && active !== undefined && parameters) {
        handle.style.left = `${point.x}px`; handle.style.top = `${point.y - 8}px`;
        handle.textContent = `↑ ${((heights?.[active] ?? parameters.extension)).toFixed(1)} mm`;
      }
    },
    cancel() { finish(undefined, true); },
    dispose() {
      finish(undefined, true);
      for (const owner of owners) {
        owner.removeEventListener('pointerdown', down, true); owner.removeEventListener('pointermove', move, true); owner.removeEventListener('pointerup', up, true);
        owner.removeEventListener('pointercancel', cancel, true); owner.removeEventListener('lostpointercapture', cancel, true);
      }
      window.removeEventListener('keydown', escape); window.removeEventListener('blur', blur); box.remove(); handle.remove();
    },
  };
}
