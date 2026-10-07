import { BufferGeometry, ExtrudeGeometry, Float32BufferAttribute, Shape, ShapeUtils, Vector2, Vector3 } from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { getPinPositions, type Parameters } from '../pin-design/model';
import { regionIndex, ringArea, type Point } from '../base-shape/layout';
import { resolvePinGeometries, type PinShape } from '../pin-shape/geometry';
import { baseRegions, profilePoints } from './model';
import RBush from 'rbush';

export type PinRole = 'shaft' | 'bottom-head' | 'top-head';
export interface MechanicalMesh { positions: Float32Array; elapsedMs: number }

export function createMechanicalPinGeometry(shape: PinShape, diameter: number, flare: number, role: PinRole) {
  const shaft = profilePoints(shape, diameter), head = profilePoints(shape, diameter, flare);
  if (role === 'shaft') {
    const outline = new Shape(shaft.map(point => new Vector2(...point)));
    return new ExtrudeGeometry(outline, { depth: 1, steps: 1, bevelEnabled: false });
  }
  const first = role === 'bottom-head' ? head : shaft, last = role === 'bottom-head' ? shaft : head;
  return new ConvexGeometry([...first.map(point => new Vector3(...point, 0)), ...last.map(point => new Vector3(...point, flare))]);
}

export function geometryFromMesh(mesh: MechanicalMesh) {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(mesh.positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export function buildMechanicalBase(parameters: Parameters): MechanicalMesh {
  const started = performance.now(), positions: number[] = [];
  const { clearance, headFlare } = parameters.construction!.sliding, thickness = parameters.thickness;
  const pins = getPinPositions(parameters), geometries = resolvePinGeometries(parameters);
  const regions = baseRegions(parameters);
  const groups = regions.map(region => ({ ...region, mouths: [] as Point[][], guides: [] as Point[][], contains: regionIndex([region]) }));
  const tree = new RBush<{ minX: number; minY: number; maxX: number; maxY: number; index: number }>();
  tree.load(regions.map((region, index) => ({ index, minX: Math.min(...region.outer.map(point => point[0])), maxX: Math.max(...region.outer.map(point => point[0])), minY: Math.min(...region.outer.map(point => point[1])), maxY: Math.max(...region.outer.map(point => point[1])) })));
  const profiles = new Map<string, { mouth: Point[]; guide: Point[] }>();
  for (let index = 0; index < pins.length; index++) {
    const pin = pins[index], geometry = geometries[index], identity = `${geometry.shape}:${geometry.rotation}`;
    if (!profiles.has(identity)) {
      const rotation = geometry.rotation * Math.PI / 180;
      const rotate = (point: Point): Point => [point[0] * Math.cos(rotation) - point[1] * Math.sin(rotation), point[0] * Math.sin(rotation) + point[1] * Math.cos(rotation)];
      profiles.set(identity, { mouth: profilePoints(geometry.shape, parameters.diameter, clearance / 2 + headFlare).map(rotate), guide: profilePoints(geometry.shape, parameters.diameter, clearance / 2).map(rotate) });
    }
    const profile = profiles.get(identity)!;
    const owner = tree.search({ minX: pin.x, maxX: pin.x, minY: pin.y, maxY: pin.y }).find(value => groups[value.index].contains(pin.x, pin.y, 0));
    if (!owner) throw new Error(`No base region contains pin ${pin.id}.`);
    const move = (point: Point): Point => [point[0] + pin.x, point[1] + pin.y];
    groups[owner.index].mouths.push(profile.mouth.map(move)); groups[owner.index].guides.push(profile.guide.map(move));
  }
  function triangle(first: number[], second: number[], third: number[]) { positions.push(...first, ...second, ...third); }
  function wall(lower: Point[], bottom: number, upper: Point[], top: number, inward: boolean) {
    for (let index = 0; index < lower.length; index++) {
      const next = (index + 1) % lower.length;
      const first = [...lower[index], bottom], second = [...lower[next], bottom], third = [...upper[next], top], fourth = [...upper[index], top];
      if (inward) { triangle(first, third, second); triangle(first, fourth, third); }
      else { triangle(first, second, third); triangle(first, third, fourth); }
    }
  }
  for (const region of groups) {
    const outer = ringArea(region.outer) > 0 ? region.outer : [...region.outer].reverse();
    const holes = [...region.holes, ...region.mouths].map(ring => ringArea(ring) < 0 ? ring : [...ring].reverse());
    const points = [...outer, ...holes.flat()];
    const triangles = ShapeUtils.triangulateShape(outer.map(point => new Vector2(...point)), holes.map(ring => ring.map(point => new Vector2(...point))));
    for (const [first, second, third] of triangles) {
      triangle([...points[first], thickness], [...points[second], thickness], [...points[third], thickness]);
      triangle([...points[first], 0], [...points[third], 0], [...points[second], 0]);
    }
    wall(outer, 0, outer, thickness, false);
    for (const hole of region.holes) {
      const ring = ringArea(hole) > 0 ? hole : [...hole].reverse();
      wall(ring, 0, ring, thickness, true);
    }
    region.mouths.forEach((mouth, index) => {
      const guide = region.guides[index];
      wall(mouth, 0, guide, headFlare, true);
      wall(guide, headFlare, guide, thickness - headFlare, true);
      wall(guide, thickness - headFlare, mouth, thickness, true);
    });
  }
  return { positions: new Float32Array(positions), elapsedMs: performance.now() - started };
}
