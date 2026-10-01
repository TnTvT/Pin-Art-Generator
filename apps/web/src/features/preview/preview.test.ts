import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Color, GridHelper, InstancedMesh, Mesh, MeshStandardMaterial, OrthographicCamera, PerspectiveCamera, Vector3, type Camera, type Scene } from 'three';
import { DEFAULTS, DEFAULT_MODEL_COLORS } from '../pin-design/model';
import { createPreview, type Preview } from './preview';

const renderer = vi.hoisted(() => ({ render: vi.fn(), dispose: vi.fn(), forceContextLoss: vi.fn() }));
const OriginalResizeObserver = window.ResizeObserver;

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  return {
    ...actual,
    WebGLRenderer: class {
      domElement = document.createElement('canvas');
      setPixelRatio() {}
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

function renderedCamera() {
  const callbacks = [...pendingFrames.values()];
  pendingFrames.clear();
  callbacks.forEach((callback) => callback(0));
  const camera = renderer.render.mock.lastCall![1] as Camera;
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
  it('preserves printable material colors through theme, height and camera updates', () => {
    renderedCamera();
    const scene = renderer.render.mock.lastCall![0] as Scene;
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
    const scene = renderer.render.mock.lastCall![0] as Scene;
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
    expect(grid.material.color.getHexString()).toBe('ffffff');
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
