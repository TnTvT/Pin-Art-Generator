import { CylinderGeometry, ExtrudeGeometry, Shape, type BufferGeometry } from 'three';
import { pinVertices, type PinShape } from './geometry';

export function createPinGeometry(shape: PinShape = 'round'): BufferGeometry {
  if (shape === 'round') return new CylinderGeometry(0.5, 0.5, 1, 16);
  const vertices = pinVertices(shape, 1);
  const outline = new Shape();
  outline.moveTo(...vertices[0]);
  for (const point of vertices.slice(1)) outline.lineTo(...point);
  outline.closePath();
  const geometry = new ExtrudeGeometry(outline, { depth: 1, steps: 1, bevelEnabled: false });
  geometry.translate(0, 0, -0.5);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}
