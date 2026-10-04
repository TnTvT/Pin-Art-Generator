import { InstancedMesh, Object3D } from 'three';
import { pinCount, pinPosition, type Parameters } from '../pin-design/model';

export function updatePinInstances(pins: InstancedMesh, parameters: Parameters, heights?: Float32Array) {
  const instance = new Object3D();
  instance.rotation.x = Math.PI / 2;
  pins.count = pinCount(parameters);
  for (let index = 0; index < pins.count; index++) {
    const position = pinPosition(parameters, index);
    const extension = heights?.[index] ?? parameters.extension;
    instance.scale.set(parameters.diameter, extension, parameters.diameter);
    instance.position.set(position.x, position.y, parameters.thickness + extension / 2);
    instance.updateMatrix();
    pins.setMatrixAt(index, instance.matrix);
  }
  pins.instanceMatrix.needsUpdate = true;
  pins.computeBoundingBox();
  pins.computeBoundingSphere();
}
