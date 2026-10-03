import { describe, expect, it } from 'vitest';
import { OrthographicCamera, PerspectiveCamera, Vector3 } from 'three';
import { DEFAULTS } from '../pin-design/model';
import { heightDragDelta, marqueeSelection, pinTip, projectTip } from './pin-selection';

const parameters = { ...DEFAULTS, columns: 2, rows: 2, spacing: 10 };
const size = { width: 400, height: 400 };
function topCamera() {
  const camera = new OrthographicCamera(-20, 20, 20, -20, 0.1, 500);
  camera.position.set(0, 0, 100); camera.up.set(0, 1, 0); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  return camera;
}
describe('pin screen selection and height gestures', () => {
  it('uses row-major pin tips and includes occluded pins without raycasting', () => {
    expect(pinTip(3, parameters, new Float32Array([1, 2, 3, 4])).toArray()).toEqual([5, 5, 7]);
    expect(marqueeSelection(parameters, undefined, topCamera(), size, { x: 140, y: 140 }, { x: 260, y: 160 })).toEqual([2, 3]);
    expect(marqueeSelection(parameters, undefined, topCamera(), size, { x: 400, y: 400 }, { x: 0, y: 0 })).toEqual([0, 1, 2, 3]);
  });
  it('excludes tips outside the viewport and behind the camera', () => {
    expect(projectTip(new Vector3(500, 0, 0), topCamera(), size)).toBeNull();
    expect(projectTip(new Vector3(0, 0, 200), topCamera(), size)).toBeNull();
  });
  it('maps vertical screen motion to world mm in orthographic top view', () => {
    expect(heightDragDelta({ x: 200, y: 200 }, { x: 200, y: 100 }, new Vector3(), topCamera(), size)).toBe(10);
  });
  it('measures perspective motion along world Z on a camera-facing plane', () => {
    const camera = new PerspectiveCamera(36, 1, 0.1, 1000);
    camera.up.set(0, 0, 1); camera.position.set(60, 80, 100); camera.lookAt(0, 0, 10); camera.updateMatrixWorld();
    const tip = new Vector3(0, 0, 20);
    const start = projectTip(tip, camera, size)!;
    const end = projectTip(tip.clone().add(new Vector3(0, 0, 15)), camera, size)!;
    expect(heightDragDelta(start, end, tip, camera, size)).toBe(15);
  });
});
