import type { PinRole } from '../mechanics/preview-geometry';
import { guideDimensions } from '../mechanics/dimensions';
import { InstancedMesh, Object3D } from 'three';
import { pinCount, pinPosition, type Parameters } from '../pin-design/model';
import { effectivePinRotation, type PinShape } from '../pin-shape/geometry';

export interface PinInstanceGroup {
  shape: PinShape;
  role?: PinRole;
  geometryKey?: string;
  mesh: InstancedMesh;
  indices: readonly number[];
  canonicalToLocal: ReadonlyMap<number, number>;
}

export function updatePinInstances(pins: InstancedMesh, parameters: Parameters, heights?: Float32Array, indices?: readonly number[], role?: PinRole) {
  const instance = new Object3D();
  pins.count = indices?.length ?? pinCount(parameters);
  const mechanics = role && parameters.construction?.mode === 'print-in-place' ? guideDimensions(parameters.construction.sliding) : undefined;
  for (let localIndex = 0; localIndex < pins.count; localIndex++) {
    const index = indices?.[localIndex] ?? localIndex;
    const geometry = parameters.pinGeometries?.[index];
    const rotation = geometry ? effectivePinRotation({ ...parameters, pinShape: geometry.shape, pinRotation: geometry.rotation }) : effectivePinRotation(parameters);
    instance.rotation.set(Math.PI / 2, 0, rotation * Math.PI / 180, 'ZYX');
    const position = pinPosition(parameters, index);
    const extension = heights?.[index] ?? parameters.extension;
    instance.scale.set(parameters.diameter, extension, parameters.diameter);
    instance.position.set(position.x, position.y, parameters.thickness + extension / 2);
    if (role && mechanics) {
      const { lowerHeadHeight, upperHeadHeight } = mechanics, length = parameters.thickness + extension;
      instance.rotation.set(0, 0, rotation * Math.PI / 180);
      instance.scale.set(1, 1, role === 'shaft' ? length - lowerHeadHeight - upperHeadHeight : 1);
      instance.position.z = role === 'shaft' ? lowerHeadHeight : role === 'bottom-head' ? 0 : length - upperHeadHeight;
    }
    instance.updateMatrix();
    pins.setMatrixAt(localIndex, instance.matrix);
  }
  pins.instanceMatrix.needsUpdate = true;
  pins.computeBoundingBox();
  pins.computeBoundingSphere();
}
