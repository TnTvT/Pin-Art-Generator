import { Box3, MathUtils, OrthographicCamera, PerspectiveCamera, Vector3 } from 'three';

export function fitCameraToBounds(
  camera: PerspectiveCamera | OrthographicCamera,
  bounds: Box3,
  aspect: number,
  direction: Vector3,
) {
  const center = bounds.getCenter(new Vector3());
  const radius = bounds.getSize(new Vector3()).length() / 2;
  camera.position.copy(center).add(direction);
  camera.lookAt(center);
  camera.zoom = 1;
  const inverseRotation = camera.quaternion.clone().invert();
  const padding = 1.12;
  let halfHeight = 0;
  let distance = camera.near * 2;
  const verticalTangent = camera instanceof PerspectiveCamera
    ? Math.tan(MathUtils.degToRad(camera.fov) / 2)
    : 1;

  for (const horizontal of [bounds.min.x, bounds.max.x]) {
    for (const vertical of [bounds.min.y, bounds.max.y]) {
      for (const height of [bounds.min.z, bounds.max.z]) {
        const corner = new Vector3(horizontal, vertical, height).sub(center).applyQuaternion(inverseRotation);
        if (camera instanceof OrthographicCamera) {
          halfHeight = Math.max(halfHeight, Math.abs(corner.y), Math.abs(corner.x) / aspect);
        } else {
          distance = Math.max(distance, corner.z + camera.near * 2, corner.z + padding * Math.max(
            Math.abs(corner.y) / verticalTangent,
            Math.abs(corner.x) / (verticalTangent * aspect),
          ));
        }
      }
    }
  }

  if (camera instanceof OrthographicCamera) {
    camera.top = halfHeight * padding;
    camera.bottom = -camera.top;
    camera.right = camera.top * aspect;
    camera.left = -camera.right;
    distance = radius * 3;
  } else {
    camera.aspect = aspect;
  }
  camera.position.copy(center).addScaledVector(direction, distance);
  camera.far = Math.max(100000, distance + radius * 5);
  camera.updateProjectionMatrix();
  return distance;
}
