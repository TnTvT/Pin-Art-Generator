import { describe, expect, it } from 'vitest';
import { Box3, InstancedMesh, Matrix4, MeshBasicMaterial, Vector3 } from 'three';
import { DEFAULTS } from '../pin-design/model';
import { updatePinInstances } from '../preview/pin-grid';
import { createPinGeometry } from './preview-geometry';
import { pinBounds } from './geometry';

describe('pin preview cross-sections', () => {
  it.each(['square', 'triangle'] as const)('renders the %s at its actual rotated bounds and base height', pinShape => {
    for (const pinRotation of [0, 30, 45, 90, 360]) {
      const parameters = { ...DEFAULTS, columns: 1, rows: 1, pinShape, pinRotation, diameter: 8 };
      const geometry = createPinGeometry(pinShape);
      const material = new MeshBasicMaterial();
      const mesh = new InstancedMesh(geometry, material, 1);
      updatePinInstances(mesh, parameters, new Float32Array([7]));
      const matrix = new Matrix4(); mesh.getMatrixAt(0, matrix);
      const bounds = new Box3().makeEmpty();
      const positions = geometry.getAttribute('position');
      for (let index = 0; index < positions.count; index++) bounds.expandByPoint(new Vector3().fromBufferAttribute(positions, index).applyMatrix4(matrix));
      const expected = pinBounds(parameters);
      expect(bounds.min.x).toBeCloseTo(expected.minX, 5);
      expect(bounds.max.x).toBeCloseTo(expected.maxX, 5);
      expect(bounds.min.y).toBeCloseTo(expected.minY, 5);
      expect(bounds.max.y).toBeCloseTo(expected.maxY, 5);
      expect(bounds.min.z).toBeCloseTo(3);
      expect(bounds.max.z).toBeCloseTo(10);
      mesh.dispose(); material.dispose(); geometry.dispose();
    }
  });
});
