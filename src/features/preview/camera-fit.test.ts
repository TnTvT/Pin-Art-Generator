import { describe, expect, it } from 'vitest';
import { Box3, OrthographicCamera, PerspectiveCamera, Vector3 } from 'three';
import { fitCameraToBounds } from './camera-fit';

describe('camera fitting', () => {
  it.each([0.5, 2])('fits all corners tightly in perspective at aspect %s', (aspect) => {
    const camera = new PerspectiveCamera(36, aspect, 0.01, 100000);
    camera.up.set(0, 0, 1);
    const bounds = new Box3(new Vector3(-200, -10, 0), new Vector3(200, 10, 80));
    const direction = new Vector3(1.15, -1.55, 1.3).normalize();
    fitCameraToBounds(camera, bounds, aspect, direction);
    camera.updateMatrixWorld();
    let largestCoordinate = 0;
    for (const horizontal of [-200, 200]) {
      for (const vertical of [-10, 10]) {
        for (const height of [0, 80]) {
          const point = new Vector3(horizontal, vertical, height).project(camera);
          largestCoordinate = Math.max(largestCoordinate, Math.abs(point.x), Math.abs(point.y));
          expect(Math.abs(point.x)).toBeLessThan(1);
          expect(Math.abs(point.y)).toBeLessThan(1);
        }
      }
    }
    expect(largestCoordinate).toBeGreaterThan(0.85);
    expect(camera.getWorldDirection(new Vector3()).dot(direction)).toBeCloseTo(-1);
  });

  it('fits a panned and zoomed orthographic camera without using pin height for top-view scale', () => {
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0.01, 100000);
    camera.up.set(0, 1, 0);
    camera.zoom = 5;
    camera.position.set(100, 100, 100);
    const bounds = new Box3(new Vector3(-60, -50, 0), new Vector3(60, 50, 1000));
    fitCameraToBounds(camera, bounds, 2, new Vector3(0, 0, 1));
    camera.updateMatrixWorld();
    expect(camera.zoom).toBe(1);
    expect(new Vector3(0, 50, 0).project(camera).y).toBeGreaterThan(0.85);
    const center = bounds.getCenter(new Vector3()).project(camera);
    expect(center.x).toBeCloseTo(0);
    expect(center.y).toBeCloseTo(0);
  });
});
