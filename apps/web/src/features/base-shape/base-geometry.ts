import { ExtrudeGeometry, Path, Shape } from 'three';
import type { Layout, Point } from './layout';

function trace(path: Path, ring: Point[]) {
  path.moveTo(ring[0][0], ring[0][1]);
  ring.slice(1).forEach(point => path.lineTo(point[0], point[1]));
  path.closePath();
}

export function createBaseGeometry(layout: Layout, thickness: number) {
  const shapes = layout.regions.map(region => {
    const shape = new Shape();
    trace(shape, region.outer);
    shape.holes = region.holes.map(ring => { const hole = new Path(); trace(hole, ring); return hole; });
    return shape;
  });
  return new ExtrudeGeometry(shapes, { depth: thickness, bevelEnabled: false, steps: 1 });
}
