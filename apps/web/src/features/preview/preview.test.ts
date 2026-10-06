import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Color, GridHelper, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, OrthographicCamera, PerspectiveCamera, Vector3, type Camera, type Scene } from 'three';
import { DEFAULTS, DEFAULT_MODEL_COLORS } from '../pin-design/model';
import { createPreview, type Preview } from './preview';
import { PREVIEW_COLORS } from './appearance';
import { pinTip, projectTip } from './pin-selection';

const renderer = vi.hoisted(() => ({ render: vi.fn(), dispose: vi.fn(), forceContextLoss: vi.fn() }));
const OriginalResizeObserver = window.ResizeObserver;

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  return {
    ...actual,
    WebGLRenderer: class {
      domElement = document.createElement('canvas');
      setPixelRatio() {}
      getPixelRatio() { return 1; }
      getClearColor() { return new Color('#f1f4f5'); }
      getClearAlpha() { return 1; }
      getRenderTarget() { return null; }
      setRenderTarget() {}
      clear() {}
      autoClear = true;
      setClearColor() {}
      setSize() {}
      render = renderer.render;
      dispose = renderer.dispose;
      forceContextLoss = renderer.forceContextLoss;
    },
  };
});

let preview: Preview;
let size: { width: number; height: number };
let resize: () => void;
let pendingFrames: Map<number, FrameRequestCallback>;
let frameId: number;
let canvas: HTMLCanvasElement;

function renderedScene() {
  return renderer.render.mock.calls.slice().reverse().find(([scene]) => (scene as Scene).children?.some(child => child instanceof GridHelper))![0] as Scene;
}

function renderedCamera() {
  const callbacks = [...pendingFrames.values()];
  pendingFrames.clear();
  callbacks.forEach((callback) => callback(0));
  const camera = renderer.render.mock.calls.slice().reverse().find(([scene]) => scene === renderedScene())![1] as Camera;
  camera.updateMatrixWorld();
  return camera;
}

beforeEach(() => {
  size = { width: 800, height: 400 };
  pendingFrames = new Map();
  frameId = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    pendingFrames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => pendingFrames.delete(id));
  window.ResizeObserver = class {
    constructor(callback: ResizeObserverCallback) { resize = () => callback([], this); }
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  const container = document.createElement('div');
  vi.spyOn(container, 'getBoundingClientRect').mockImplementation(() => ({ ...size } as DOMRect));
  preview = createPreview(container);
  canvas = container.querySelector('canvas')!;
  Object.defineProperty(canvas, 'clientHeight', { get: () => size.height });
  Object.defineProperty(canvas, 'clientWidth', { get: () => size.width });
  preview.update(DEFAULTS);
});

afterEach(() => {
  preview?.dispose();
  window.ResizeObserver = OriginalResizeObserver;
});

describe('preview camera projection', () => {
  it('recolors canonical pins after mixed-to-mixed regrouping without replacing shape geometry', () => {
    const parameters = { ...DEFAULTS, columns: 3, rows: 1, pinGeometries: [
      { shape: 'round' as const, rotation: 0 }, { shape: 'square' as const, rotation: 45 }, { shape: 'triangle' as const, rotation: 15 },
    ] };
    preview.setModelColors({ base: '#123456', pins: '#abcdef' });
    preview.update(parameters); renderedCamera();
    const groups = renderedScene().children.filter(child => child instanceof InstancedMesh) as InstancedMesh[];
    groups.forEach(group => expect((group.material as MeshStandardMaterial).color.getHexString()).toBe('abcdef'));
    const geometries = groups.map(group => group.geometry);
    preview.setPinColors(['#ff0000', '#00ff00', '#0000ff']);
    preview.update({ ...parameters, pinGeometries: parameters.pinGeometries.slice().reverse() }); renderedCamera();
    expect(groups.map(group => group.geometry)).toEqual(geometries);
    const color = new Color();
    groups.forEach((group, index) => {
      group.getColorAt(0, color);
      expect(color.getHexString()).toBe(['0000ff', '00ff00', 'ff0000'][index]);
      expect((group.material as MeshStandardMaterial).color.getHexString()).toBe('ffffff');
    });
    preview.setPinColors(['#0000ff', '#ff0000', '#00ff00']);
    groups.forEach((group, index) => {
      group.getColorAt(0, color); expect(color.getHexString()).toBe(['00ff00', 'ff0000', '0000ff'][index]);
    });
  });
  it('fits all grouped bounds and clears stale bounds when groups disappear', () => {
    const parameters = { ...DEFAULTS, columns: 3, rows: 1, spacing: 300, pinGeometries: [
      { shape: 'triangle' as const, rotation: 90 }, { shape: 'round' as const, rotation: 0 }, { shape: 'square' as const, rotation: 45 },
    ] };
    preview.update(parameters, new Float32Array([2, 4, 100]));
    preview.setView('fit');
    const camera = renderedCamera();
    const groups = renderedScene().children.filter(child => child instanceof InstancedMesh) as InstancedMesh[];
    const corners = groups.flatMap(group => {
      const bounds = group.boundingBox!;
      return [bounds.min, bounds.max];
    });
    for (const corner of corners) {
      const point = corner.clone().project(camera);
      expect(Math.abs(point.x)).toBeLessThan(1); expect(Math.abs(point.y)).toBeLessThan(1);
    }
    preview.update({ ...DEFAULTS, columns: 0, rows: 0 });
    preview.setView('top');
    const top = renderedCamera();
    expect(renderedScene().children.filter(child => child instanceof InstancedMesh)).toHaveLength(0);
    expect(new Vector3(0, 50, 0).project(top).y).toBeGreaterThan(.85);
    preview.update({ ...DEFAULTS, columns: 1, rows: 1, pinShape: 'square' });
    expect(renderedCamera()).toBe(top);
    expect(renderedScene().children.filter(child => child instanceof InstancedMesh)).toHaveLength(1);
  });
  it('regroups resolved shapes without changing canonical colors, outlines, heights or the camera', () => {
    const parameters = { ...DEFAULTS, columns: 4, rows: 1, pinGeometries: [
      { shape: 'square' as const, rotation: 0 }, { shape: 'round' as const, rotation: 0 },
      { shape: 'triangle' as const, rotation: 30 }, { shape: 'square' as const, rotation: 90 },
    ] };
    const heights = new Float32Array([2, 4, 6, 8]);
    const onSelect = vi.fn();
    vi.spyOn(canvas, 'getBoundingClientRect').mockImplementation(() => ({ ...size, left: 0, top: 0 } as DOMRect));
    canvas.setPointerCapture = vi.fn(); canvas.releasePointerCapture = vi.fn();
    preview.setPinColors(['#ff0000', '#00ff00', '#0000ff', '#ff0088']);
    preview.setEditing({ heightMode: 'set', selection: new Set([1, 2, 3]), active: 3,
      onSelect, onDragStart: () => true, onDragDelta: vi.fn(), onDragEnd: vi.fn(), onDragCancel: vi.fn() });
    preview.setView('top');
    const camera = renderedCamera() as OrthographicCamera;
    camera.zoom = 2;
    const position = camera.position.clone();
    preview.update(parameters, heights);
    expect(renderedCamera()).toBe(camera);
    expect(camera.zoom).toBe(2); expect(camera.position.equals(position)).toBe(true);
    function pickActive() {
      renderedScene().updateMatrixWorld();
      const point = projectTip(pinTip(3, parameters, heights), camera, size)!;
      for (const type of ['pointerdown', 'pointerup']) {
        canvas.dispatchEvent(new PointerEvent(type, { pointerId: 1, button: 0, clientX: point.x, clientY: point.y, bubbles: true }));
      }
      expect(onSelect).toHaveBeenLastCalledWith([3], 'replace');
    }
    pickActive();
    const handle = canvas.parentElement!.querySelector('[aria-label="Drag selected pin height"]')!;
    const handlePosition = handle.getAttribute('style');
    const groups = renderedScene().children.filter(child => child instanceof InstancedMesh) as InstancedMesh[];
    expect(groups).toHaveLength(3);
    expect(groups.map(group => group.count).sort()).toEqual([1, 1, 2]);
    const square = groups.find(group => group.count === 2)!;
    const color = new Color(); square.getColorAt(1, color);
    expect(color.getHexString()).toBe('ff0088');
    const matrix = new Matrix4(); square.getMatrixAt(1, matrix);
    expect(new Vector3().setFromMatrixPosition(matrix).toArray()).toEqual([5.25, 0, 7]);
    const maskScene = renderer.render.mock.calls.slice().reverse().find(([scene]) => (scene as Scene).children?.some(child => child.name === 'Selected pin outline mask'))![0] as Scene;
    const masks = maskScene.children as InstancedMesh[];
    expect(masks).toHaveLength(3);
    expect(masks.reduce((sum, mask) => sum + mask.count, 0)).toBe(3);
    const squareMask = masks.find(mask => mask.geometry === square.geometry)!;
    expect(squareMask.count).toBe(1); squareMask.getMatrixAt(0, matrix);
    expect(new Vector3().setFromMatrixPosition(matrix).x).toBe(5.25);
    const removed = groups.filter(group => group !== square);
    const disposal = removed.map(group => [vi.spyOn(group, 'dispose'), vi.spyOn(group.geometry, 'dispose')]);
    const maskDisposal = masks.filter(mask => mask !== squareMask).map(mask => vi.spyOn(mask, 'dispose'));
    preview.update({ ...parameters, pinGeometries: parameters.pinGeometries.map(() => ({ shape: 'square' as const, rotation: 45 })) }, heights);
    expect(renderedCamera()).toBe(camera);
    pickActive();
    expect(handle.getAttribute('style')).toBe(handlePosition);
    expect(handle.textContent).toBe('↑ 8.0 mm');
    expect(renderedScene().children.filter(child => child instanceof InstancedMesh)).toEqual([square]);
    expect(square.count).toBe(4);
    ['ff0000', '00ff00', '0000ff', 'ff0088'].forEach((expected, index) => {
      square.getColorAt(index, color); expect(color.getHexString()).toBe(expected);
    });
    disposal.flat().forEach(dispose => expect(dispose).toHaveBeenCalledOnce());
    maskDisposal.forEach(dispose => expect(dispose).toHaveBeenCalledOnce());
    expect(maskScene.children).toHaveLength(1);
    expect((maskScene.children[0] as InstancedMesh).count).toBe(3);
    const maskDispose = vi.spyOn(maskScene.children[0] as InstancedMesh, 'dispose');
    const meshDispose = vi.spyOn(square, 'dispose'), geometryDispose = vi.spyOn(square.geometry, 'dispose');
    preview.dispose();
    expect(meshDispose).toHaveBeenCalledOnce(); expect(geometryDispose).toHaveBeenCalledOnce();
    expect(maskDispose).toHaveBeenCalledOnce();
  });
  it('replaces pin and outline geometry without replacing the camera, canvas or printable colors', () => {
    preview.setPinColors(Array<string>(320).fill('#ff0088'));
    preview.setEditing({ heightMode: 'set', selection: new Set([0]), active: 0,
      onSelect: vi.fn(), onDragStart: () => true, onDragDelta: vi.fn(), onDragEnd: vi.fn(), onDragCancel: vi.fn() });
    preview.setView('top');
    const camera = renderedCamera() as OrthographicCamera;
    camera.zoom = 2;
    const pins = renderedScene().children.find(child => child instanceof InstancedMesh) as InstancedMesh;
    const original = pins.geometry;
    const dispose = vi.spyOn(original, 'dispose');
    preview.update({ ...DEFAULTS, pinShape: 'triangle', pinRotation: 30 });
    expect(renderedCamera()).toBe(camera);
    expect(camera.zoom).toBe(2);
    expect(pins.geometry).not.toBe(original);
    expect(dispose).toHaveBeenCalledOnce();
    expect(canvas.parentElement!.querySelector('canvas')).toBe(canvas);
    const color = new Color(); pins.getColorAt(0, color);
    expect(color.getHexString()).toBe('ff0088');
    const mask = (renderer.render.mock.calls.slice().reverse().find(([scene]) => (scene as Scene).children?.some(child => child.name === 'Selected pin outline mask'))![0] as Scene).children[0] as InstancedMesh;
    expect(mask.geometry).toBe(pins.geometry);
    expect(mask.count).toBe(1);
    const polygon = pins.geometry;
    preview.update({ ...DEFAULTS, pinShape: 'triangle', pinRotation: 90 });
    expect(pins.geometry).toBe(polygon);
  });
  it('renders per-instance printable colors with separate selection overlays', () => {
    preview.setPinColors(Array.from({ length: 320 }, (_, index) => index === 1 ? '#ff0000' : '#2dada3'));
    preview.setEditing({ heightMode: 'set', selection: new Set([0, 1]), active: 1,
      onSelect: vi.fn(), onDragStart: () => true, onDragDelta: vi.fn(), onDragEnd: vi.fn(), onDragCancel: vi.fn() });
    renderedCamera();
    const scene = renderedScene();
    const pins = scene.children.find(child => child instanceof InstancedMesh) as InstancedMesh;
    const highlights = (renderer.render.mock.calls.slice().reverse().find(([candidate]) => (candidate as Scene).children?.some(child => child.name === 'Selected pin outline mask'))![0] as Scene).children[0] as InstancedMesh;
    const color = new Color(); pins.getColorAt(1, color);
    expect(color.getHexString()).toBe('ff0000');
    expect((pins.material as MeshStandardMaterial).color.getHexString()).toBe('ffffff');
    expect(highlights.count).toBe(2);
    expect(scene.children).not.toContain(highlights);
    expect(highlights.instanceColor).toBeNull();
    const printableColors = pins.instanceColor!.array.slice();
    preview.setView('top'); preview.setColorScheme('dark'); renderedCamera();
    expect(pins.instanceColor!.array).toEqual(printableColors);
    expect(highlights.count).toBe(2);
    expect(canvas.parentElement!.querySelector('[aria-label="Drag selected pin height"]')).not.toHaveAttribute('hidden');
  });
  it('preserves printable material colors through theme, height and camera updates', () => {
    renderedCamera();
    const scene = renderedScene();
    const base = scene.children.find((child) => child instanceof Mesh && !(child instanceof InstancedMesh)) as Mesh;
    const pins = scene.children.find((child) => child instanceof InstancedMesh) as InstancedMesh;
    const baseMaterial = base.material as MeshStandardMaterial;
    const pinMaterial = pins.material as MeshStandardMaterial;
    expect(baseMaterial.color.getHexString()).toBe(DEFAULT_MODEL_COLORS.base.slice(1));
    expect(pinMaterial.color.getHexString()).toBe(DEFAULT_MODEL_COLORS.pins.slice(1));
    preview.setView('top');
    const camera = renderedCamera() as OrthographicCamera;
    camera.zoom = 2;
    const matrices = pins.instanceMatrix.array.slice();
    preview.setModelColors({ base: '#123456', pins: '#abcdef' });
    expect(renderedCamera()).toBe(camera);
    expect(camera.zoom).toBe(2);
    expect(pins.instanceMatrix.array).toEqual(matrices);
    preview.setColorScheme('dark');
    preview.update(DEFAULTS, new Float32Array(320).fill(2));
    preview.setColorScheme('light');
    renderedCamera();
    expect(base.material).toBe(baseMaterial);
    expect(pins.material).toBe(pinMaterial);
    expect(baseMaterial.color.getHexString()).toBe('123456');
    expect(pinMaterial.color.getHexString()).toBe('abcdef');
  });

  it('defaults and resets to a Z-up view with X down-left and Y down-right', () => {
    const initial = renderedCamera();
    const center = new Vector3(0, 0, 11.5);
    function expectDefaultOrientation(camera: Camera) {
      const origin = center.clone().project(camera);
      const horizontal = center.clone().add(new Vector3(20, 0, 0)).project(camera);
      const depth = center.clone().add(new Vector3(0, 20, 0)).project(camera);
      const vertical = center.clone().add(new Vector3(0, 0, 20)).project(camera);
      expect(camera).toBeInstanceOf(PerspectiveCamera);
      expect(horizontal.x).toBeLessThan(origin.x);
      expect(horizontal.y).toBeLessThan(origin.y);
      expect(depth.x).toBeGreaterThan(origin.x);
      expect(depth.y).toBeLessThan(origin.y);
      expect(vertical.x).toBeCloseTo(origin.x);
      expect(vertical.y).toBeGreaterThan(origin.y);
    }
    expectDefaultOrientation(initial);
    preview.setView('top');
    renderedCamera();
    preview.setView('reset');
    expectDefaultOrientation(renderedCamera());
  });

  it('updates the orientation helper on view changes and removes it on disposal', () => {
    renderedCamera();
    const container = canvas.parentElement!;
    const helper = container.querySelector('[aria-label="XYZ orientation helper"]')!;
    expect(helper).not.toBeNull();
    const firstOrientation = helper.innerHTML;
    preview.setView('top');
    renderedCamera();
    expect(helper.innerHTML).not.toBe(firstOrientation);
    expect(helper.querySelector('[data-axis="X"] circle')).toHaveAttribute('cx', '78.000');
    preview.setView('fit');
    renderedCamera();
    expect(helper.querySelector('[data-axis="X"] circle')).toHaveAttribute('cx', '78.000');
    preview.setView('reset');
    renderedCamera();
    expect(helper.innerHTML).toBe(firstOrientation);
    preview.dispose();
    expect(container.childElementCount).toBe(0);
  });

  it('recolors the scene in place while preserving the orthographic camera and pins', () => {
    preview.setView('top');
    const camera = renderedCamera() as OrthographicCamera;
    camera.zoom = 2;
    const position = camera.position.clone();
    const scene = renderedScene();
    const grid = scene.children.find((child) => child instanceof GridHelper) as GridHelper;
    const pins = scene.children.find((child) => child instanceof InstancedMesh) as InstancedMesh;
    const matrices = pins.instanceMatrix.array.slice();
    preview.setColorScheme('dark');
    expect(renderedCamera()).toBe(camera);
    expect((scene.background as Color).getHexString()).toBe('171f27');
    expect(grid.material.color.getHexString()).not.toBe('ffffff');
    expect(camera.position.distanceTo(position)).toBeCloseTo(0);
    expect(camera.zoom).toBe(2);
    expect(pins.instanceMatrix.array).toEqual(matrices);
    preview.setColorScheme('light');
    renderedCamera();
    expect((scene.background as Color).getHexString()).toBe('f1f4f5');
    expect(grid.material.color.getHexString()).toBe(new Color(PREVIEW_COLORS.light.gridTint).getHexString());
  });

  it('keeps light-mode grid lines distinct from the background initially and after theme changes', () => {
    renderedCamera();
    const scene = renderedScene();
    const grid = scene.children.find((child) => child instanceof GridHelper) as GridHelper;
    const luminance = (color: Color) => 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
    const expectVisibleGrid = () => {
      const backgroundLuminance = luminance(scene.background as Color);
      const vertexColors = grid.geometry.getAttribute('color');
      for (let index = 0; index < vertexColors.count; index++) {
        const lineColor = new Color().fromBufferAttribute(vertexColors, index).multiply(grid.material.color);
        expect((backgroundLuminance + 0.05) / (luminance(lineColor) + 0.05)).toBeGreaterThanOrEqual(3);
      }
    };
    expectVisibleGrid();
    preview.setColorScheme('dark');
    renderedCamera();
    preview.setColorScheme('light');
    renderedCamera();
    expectVisibleGrid();
  });

  it('fits the top-view footprint tightly even when pins are very tall', () => {
    preview.update({ ...DEFAULTS, extension: 1000 });
    preview.setView('top');
    const camera = renderedCamera();
    expect(new Vector3(0, 50, 0).project(camera).y).toBeGreaterThan(0.85);
    expect(new Vector3(0, 50, 0).project(camera).y).toBeLessThan(1);
  });

  it('clears pan damping so Fit model stays centered across subsequent frames', () => {
    const camera = renderedCamera();
    canvas.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowRight', bubbles: true }));
    preview.setView('fit');
    renderedCamera();
    const center = new Vector3(0, 0, 11.5).project(camera);
    expect(center.x).toBeCloseTo(0, 5);
    expect(center.y).toBeCloseTo(0, 5);
    for (let frame = 0; frame < 20; frame++) renderedCamera();
    expect(new Vector3(0, 0, 11.5).project(camera).x).toBeCloseTo(0, 5);
  });

  it('fits sampled pin heights and includes grids that extend beyond the base', () => {
    preview.update({ ...DEFAULTS, columns: 2, rows: 1, spacing: 300, extension: 1000 }, new Float32Array([2, 2]));
    preview.setView('fit');
    const camera = renderedCamera();
    const center = new Vector3(0, 0, 2.5).project(camera);
    expect(center.x).toBeCloseTo(0, 5);
    expect(center.y).toBeCloseTo(0, 5);
    for (const horizontal of [-151, 151]) {
      const edge = new Vector3(horizontal, 0, 5).project(camera);
      expect(Math.abs(edge.x)).toBeLessThan(1);
      expect(Math.abs(edge.y)).toBeLessThan(1);
    }
  });

  it('uses an upright orthographic top view without height-dependent distortion', () => {
    expect(renderedCamera()).toBeInstanceOf(PerspectiveCamera);
    preview.setView('top');
    const camera = renderedCamera();
    expect(camera).toBeInstanceOf(OrthographicCamera);
    const low = new Vector3(20, 15, 3).project(camera);
    const high = new Vector3(20, 15, 23).project(camera);
    expect(low.x).toBeCloseTo(high.x);
    expect(low.y).toBeCloseTo(high.y);
    expect(low.x).toBeGreaterThan(0);
    expect(low.y).toBeGreaterThan(0);
    expect(camera.getWorldDirection(new Vector3()).z).toBeCloseTo(-1);
  });

  it('keeps Fit model orthographic and returns Reset view to perspective', () => {
    preview.setView('top');
    const camera = renderedCamera() as OrthographicCamera;
    camera.zoom = 4;
    preview.update({ ...DEFAULTS, width: 500 });
    preview.setView('fit');
    expect(renderedCamera()).toBe(camera);
    expect(camera.zoom).toBe(1);
    expect(new Vector3(250, 50, 3).project(camera).x).toBeLessThan(1);
    preview.setView('reset');
    expect(renderedCamera()).toBeInstanceOf(PerspectiveCamera);
  });

  it('preserves the orthographic camera and zoom when parameters change', () => {
    preview.setView('top');
    const camera = renderedCamera() as OrthographicCamera;
    camera.zoom = 2;
    const position = camera.position.clone();
    preview.update({ ...DEFAULTS, columns: 30, extension: 40 });
    expect(renderedCamera()).toBe(camera);
    expect(camera.zoom).toBe(2);
    expect(camera.position.distanceTo(position)).toBeCloseTo(0);
  });

  it('updates the orthographic aspect ratio on resize without resetting zoom', () => {
    preview.setView('top');
    const camera = renderedCamera() as OrthographicCamera;
    const halfHeight = camera.top;
    camera.zoom = 2;
    size = { width: 400, height: 800 };
    resize();
    expect(renderedCamera()).toBe(camera);
    expect((camera.right - camera.left) / (camera.top - camera.bottom)).toBeCloseTo(0.5);
    expect(camera.top).toBe(halfHeight);
    expect(camera.zoom).toBe(2);
    preview.setView('fit');
    renderedCamera();
    expect(new Vector3(60, 50, 3).project(camera).x).toBeLessThan(1);
  });
});
