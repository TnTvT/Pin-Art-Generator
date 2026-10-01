import { describe, expect, it } from 'vitest';
import { OrthographicCamera, PerspectiveCamera, Vector3 } from 'three';
import { createOrientationHelper } from './orientation-helper';

function endpoint(container: HTMLElement, axis: string) {
  const head = container.querySelector(`[data-axis="${axis}"] circle`)!;
  return { horizontal: Number(head.getAttribute('cx')), vertical: Number(head.getAttribute('cy')) };
}

describe('XYZ orientation helper', () => {
  it('shows X right, Y up, and Z toward the viewer in orthographic top view', () => {
    const container = document.createElement('div');
    const helper = createOrientationHelper(container);
    const camera = new OrthographicCamera();
    camera.position.set(0, 0, 100);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
    helper.update(camera);
    expect(endpoint(container, 'X')).toEqual({ horizontal: 78, vertical: 48 });
    expect(endpoint(container, 'Y')).toEqual({ horizontal: 48, vertical: 18 });
    expect(endpoint(container, 'Z')).toEqual({ horizontal: 48, vertical: 48 });
    expect(container.querySelector('svg')).toHaveAttribute('aria-label', 'XYZ orientation helper');
    expect(container.querySelector('svg')?.lastElementChild).toHaveAttribute('data-axis', 'Z');
    helper.dispose();
    expect(container.childElementCount).toBe(0);
  });

  it('follows camera rotation without changing camera position, orientation, or zoom', () => {
    const container = document.createElement('div');
    const helper = createOrientationHelper(container);
    const camera = new PerspectiveCamera();
    camera.up.set(0, 0, 1);
    camera.position.set(100, -100, 100);
    camera.lookAt(0, 0, 0);
    helper.update(camera);
    const firstX = endpoint(container, 'X');
    camera.position.set(-100, -100, 100);
    camera.lookAt(0, 0, 0);
    const position = camera.position.clone();
    const rotation = camera.quaternion.clone();
    helper.update(camera);
    expect(endpoint(container, 'X')).not.toEqual(firstX);
    expect(endpoint(container, 'Z').vertical).toBeLessThan(48);
    expect(camera.position).toEqual(position);
    expect(camera.quaternion.angleTo(rotation)).toBeCloseTo(0);
    expect(camera.zoom).toBe(1);
    helper.dispose();
  });

  it('keeps the helper unchanged during pan, zoom, and projection changes', () => {
    const container = document.createElement('div');
    const helper = createOrientationHelper(container);
    const camera = new PerspectiveCamera();
    camera.up.set(0, 0, 1);
    camera.position.set(100, -100, 100);
    camera.lookAt(0, 0, 0);
    helper.update(camera);
    const before = container.innerHTML;
    camera.position.add(new Vector3(50, 20, 10));
    camera.zoom = 3;
    helper.update(camera);
    expect(container.innerHTML).toBe(before);
    const orthographic = new OrthographicCamera();
    orthographic.quaternion.copy(camera.quaternion);
    helper.update(orthographic);
    expect(container.innerHTML).toBe(before);
    helper.dispose();
  });
});
