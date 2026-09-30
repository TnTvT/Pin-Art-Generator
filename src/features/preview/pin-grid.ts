import { InstancedMesh, Object3D } from 'three';
import { type Parameters } from '../pin-design/model';

export function updatePinInstances(pins: InstancedMesh, parameters: Parameters, heights?: Float32Array) {
  const instance = new Object3D();
  instance.rotation.x = Math.PI / 2;
  const xOffset = (parameters.columns - 1) * parameters.spacing / 2;
  const yOffset = (parameters.rows - 1) * parameters.spacing / 2;
  pins.count = parameters.columns * parameters.rows;
  for (let row = 0; row < parameters.rows; row += 1) {
    for (let column = 0; column < parameters.columns; column += 1) {
      const extension = heights?.[row * parameters.columns + column] ?? parameters.extension;
      instance.scale.set(parameters.diameter, extension, parameters.diameter);
      instance.position.set(
        column * parameters.spacing - xOffset,
        row * parameters.spacing - yOffset,
        parameters.thickness + extension / 2,
      );
      instance.updateMatrix();
      pins.setMatrixAt(row * parameters.columns + column, instance.matrix);
    }
  }
  pins.instanceMatrix.needsUpdate = true;
  pins.computeBoundingBox();
  pins.computeBoundingSphere();
}
