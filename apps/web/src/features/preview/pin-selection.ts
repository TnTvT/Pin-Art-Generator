import { Camera, OrthographicCamera, Plane, Raycaster, Vector2, Vector3 } from 'three';
import type { Parameters } from '../pin-design/model';

export interface ScreenPoint { x: number; y: number }
export interface ViewportSize { width: number; height: number }

export function pinTip(index: number, parameters: Parameters, heights?: Float32Array) {
  return new Vector3((index % parameters.columns - (parameters.columns - 1) / 2) * parameters.spacing,
    (Math.floor(index / parameters.columns) - (parameters.rows - 1) / 2) * parameters.spacing,
    parameters.thickness + (heights?.[index] ?? parameters.extension));
}

export function projectTip(tip: Vector3, camera: Camera, size: ViewportSize): ScreenPoint | null {
  const point = tip.clone().project(camera);
  if (point.z < -1 || point.z > 1 || Math.abs(point.x) > 1 || Math.abs(point.y) > 1) return null;
  return { x: (point.x + 1) * size.width / 2, y: (1 - point.y) * size.height / 2 };
}

export function marqueeSelection(parameters: Parameters, heights: Float32Array | undefined, camera: Camera, size: ViewportSize, start: ScreenPoint, end: ScreenPoint) {
  const result: number[] = [];
  const left = Math.min(start.x, end.x), right = Math.max(start.x, end.x);
  const top = Math.min(start.y, end.y), bottom = Math.max(start.y, end.y);
  for (let index = 0; index < parameters.columns * parameters.rows; index++) {
    const point = projectTip(pinTip(index, parameters, heights), camera, size);
    if (point && point.x >= left && point.x <= right && point.y >= top && point.y <= bottom) result.push(index);
  }
  return result;
}

export function heightDragDelta(start: ScreenPoint, end: ScreenPoint, tip: Vector3, camera: Camera, size: ViewportSize) {
  const normal = camera.position.clone().sub(tip).setZ(0);
  if (camera instanceof OrthographicCamera || normal.lengthSq() < 0.000001) {
    const worldHeight = camera instanceof OrthographicCamera ? (camera.top - camera.bottom) / camera.zoom : tip.distanceTo(camera.position) * 0.65;
    return Math.round((start.y - end.y) * worldHeight / size.height * 10) / 10;
  }
  const plane = new Plane().setFromNormalAndCoplanarPoint(normal.normalize(), tip);
  const raycaster = new Raycaster();
  function intersection(point: ScreenPoint) {
    raycaster.setFromCamera(new Vector2(point.x / size.width * 2 - 1, 1 - point.y / size.height * 2), camera);
    return raycaster.ray.intersectPlane(plane, new Vector3());
  }
  const first = intersection(start), last = intersection(end);
  if (!first || !last) return 0;
  return Math.round((last.z - first.z) * 10) / 10;
}
