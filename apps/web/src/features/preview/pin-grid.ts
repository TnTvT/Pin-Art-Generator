import { InstancedMesh, Object3D } from 'three';
import { pinCount, pinPosition, type Parameters } from '../pin-design/model';
import { effectivePinRotation, type PinShape } from '../pin-shape/geometry';

export interface PinInstanceGroup {
  shape: PinShape;
  mesh: InstancedMesh;
  indices: readonly number[];
  canonicalToLocal: ReadonlyMap<number, number>;
}

export function updatePinInstances(pins: InstancedMesh, parameters: Parameters, heights?: Float32Array, indices?: readonly number[]) {
  const instance = new Object3D();
  pins.count = indices?.length ?? pinCount(parameters);
  for (let localIndex = 0; localIndex < pins.count; localIndex++) {
    const index = indices?.[localIndex] ?? localIndex;
    const geometry = parameters.pinGeometries?.[index];
    const rotation = geometry ? effectivePinRotation({ ...parameters, pinShape: geometry.shape, pinRotation: geometry.rotation }) : effectivePinRotation(parameters);
    instance.rotation.set(Math.PI / 2, 0, rotation * Math.PI / 180, 'ZYX');
    const position = pinPosition(parameters, index);
    const extension = heights?.[index] ?? parameters.extension;
    instance.scale.set(parameters.diameter, extension, parameters.diameter);
    instance.position.set(position.x, position.y, parameters.thickness + extension / 2);
    instance.updateMatrix();
    pins.setMatrixAt(localIndex, instance.matrix);
  }
  pins.instanceMatrix.needsUpdate = true;
  pins.computeBoundingBox();
  pins.computeBoundingSphere();
}
