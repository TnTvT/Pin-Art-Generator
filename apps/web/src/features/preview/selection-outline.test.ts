import { describe, expect, it, vi } from 'vitest';
import { Color, CylinderGeometry, InstancedMesh, Matrix4, MeshBasicMaterial, OrthographicCamera, PerspectiveCamera, Scene, ShaderMaterial, WebGLRenderTarget, type WebGLRenderer } from 'three';
import { createSelectionOutline } from './selection-outline';

function fixture() {
  const geometry = new CylinderGeometry(), material = new MeshBasicMaterial({ color: '#ff0088' });
  const pins = new InstancedMesh(geometry, material, 3);
  pins.setMatrixAt(2, new Matrix4().makeTranslation(5, 10, 20));
  pins.setColorAt(2, new Color('#ff0088'));
  const renderer = { render: vi.fn(), getPixelRatio: () => 2, getRenderTarget: () => null, setRenderTarget: vi.fn(),
    getClearColor: () => new Color('#f1f4f5'), getClearAlpha: () => 1, autoClear: true, setClearColor: vi.fn(), clear: vi.fn() };
  const outline = createSelectionOutline(renderer as unknown as WebGLRenderer, geometry);
  return { outline, renderer, pins, geometry, material };
}

describe('selection outlines', () => {
  it('renders selected instances in an isolated mask and only their exterior edges on the main canvas', () => {
    const { outline, renderer, pins, geometry, material } = fixture();
    const printableColors = pins.instanceColor!.array.slice();
    outline.resize(400, 300); outline.update(pins, new Set([2, 100, -1]));
    const camera = new PerspectiveCamera(); outline.render(camera);
    const scene = renderer.render.mock.calls[0][0] as Scene;
    const mask = scene.children[0] as InstancedMesh;
    expect(mask.count).toBe(1);
    const matrix = new Matrix4(); mask.getMatrixAt(0, matrix);
    expect(matrix.elements.slice(12, 15)).toEqual([5, 10, 20]);
    expect(material.color.getHexString()).toBe('ff0088');
    expect(pins.instanceColor!.array).toEqual(printableColors);
    const target = renderer.setRenderTarget.mock.calls[0][0] as WebGLRenderTarget;
    expect([target.width, target.height]).toEqual([800, 600]);
    const screenQuad = renderer.render.mock.calls[1][0] as { material: ShaderMaterial };
    expect(screenQuad.material.fragmentShader).toContain('surrounding - center');
    expect(screenQuad.material.depthWrite).toBe(false);
    expect(screenQuad.material.uniforms.outlineColor.value.getHexString()).toBe('ffd43b');
    expect(renderer.autoClear).toBe(true);
    expect(renderer.setClearColor).toHaveBeenLastCalledWith(new Color('#f1f4f5'), 1);
    outline.update(pins, new Set()); outline.render(camera);
    expect(renderer.render).toHaveBeenCalledTimes(2);
    const dispose = vi.spyOn(target, 'dispose'); outline.dispose();
    expect(scene.children).toHaveLength(0); expect(dispose).toHaveBeenCalledOnce();
    geometry.dispose(); material.dispose(); pins.dispose();
  });
  it('uses the current projection and restores renderer state even if a mask render fails', () => {
    const { outline, renderer, pins, geometry, material } = fixture();
    outline.update(pins, new Set([0]));
    const camera = new OrthographicCamera(); outline.render(camera);
    expect(renderer.render.mock.calls[0][1]).toBe(camera);
    renderer.render.mockImplementationOnce(() => { throw new Error('Render failed'); });
    expect(() => outline.render(new PerspectiveCamera())).toThrow('Render failed');
    expect(renderer.setRenderTarget).toHaveBeenLastCalledWith(null);
    expect(renderer.autoClear).toBe(true);
    expect(renderer.setClearColor).toHaveBeenLastCalledWith(new Color('#f1f4f5'), 1);
    outline.dispose(); geometry.dispose(); material.dispose(); pins.dispose();
  });
});
