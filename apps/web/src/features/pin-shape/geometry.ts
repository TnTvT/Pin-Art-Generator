import RBush from 'rbush';
import { EPSILON, regionIndex, type PinPosition, type Point, type Region } from '../base-shape/layout';
import type { Parameters } from '../pin-design/model';

export type PinShape = 'round' | 'square' | 'triangle';
export interface PinGeometry { shape: PinShape; rotation: number }
interface Bounds { minX: number; minY: number; maxX: number; maxY: number }
interface Segment extends Bounds { start: Point; end: Point }
interface IndexedPin extends Bounds { pin: PinPosition; index: number }
interface SpatialNode extends Bounds { children: (SpatialNode | IndexedPin)[] }
interface BoundaryIndex { containsCenter: ReturnType<typeof regionIndex>; tree?: RBush<Segment> }

function validateShape(shape: PinShape, size: number, rotation: number) {
  if (!['round', 'square', 'triangle'].includes(shape)) throw new Error('Pin shape must be round, square or triangle.');
  if (!Number.isFinite(size) || size <= 0) throw new Error('Pin size must be a positive finite number.');
  if (!Number.isFinite(rotation) || rotation < 0 || rotation > 360) throw new Error('Pin rotation must be a finite angle from 0 to 360 degrees.');
}

export function validatePinGeometry(parameters: Parameters): void {
  validateShape(parameters.pinShape === undefined ? 'round' : parameters.pinShape, parameters.diameter, parameters.pinRotation === undefined ? 0 : parameters.pinRotation);
}

export function effectivePinRotation(parameters: Parameters): number {
  validatePinGeometry(parameters);
  return (parameters.pinShape ?? 'round') === 'round' || parameters.pinRotation === 360 ? 0 : parameters.pinRotation ?? 0;
}

export function resolvePinGeometries(parameters: Parameters): PinGeometry[] {
  validatePinGeometry(parameters);
  const count = parameters.layout?.pins.length ?? parameters.columns * parameters.rows;
  if (parameters.pinGeometries && parameters.pinGeometries.length !== count) throw new Error('Pin geometries must match the committed pin count.');
  const values = parameters.pinGeometries ?? Array<PinGeometry>(count).fill({ shape: parameters.pinShape ?? 'round', rotation: parameters.pinRotation ?? 0 });
  return values.map(value => {
    if (!value) throw new Error('Every pin requires a shape and rotation.');
    validateShape(value.shape, parameters.diameter, value.rotation);
    return { shape: value.shape, rotation: value.shape === 'round' || value.rotation === 360 ? 0 : value.rotation };
  });
}

export function geometryParameters(parameters: Parameters, geometry: PinGeometry): Parameters {
  return { ...parameters, pinGeometries: undefined, pinShape: geometry.shape, pinRotation: geometry.rotation };
}

export function resolvedContainment(parameters: Parameters, regions: Region[]) {
  const geometries = resolvePinGeometries(parameters);
  const boundary = { containsCenter: regionIndex(regions), tree: geometries.some(geometry => geometry.shape !== 'round') ? boundaryTree(regions) : undefined };
  const checks = new Map<string, ReturnType<typeof createPinContainment>>();
  return geometries.map(geometry => {
    const key = `${geometry.shape}:${geometry.rotation}`;
    if (!checks.has(key)) checks.set(key, createPinContainment(regions, geometryParameters(parameters, geometry), boundary));
    return checks.get(key)!;
  });
}

export function validateResolvedGeometry(parameters: Parameters) {
  const regions = parameters.layout?.regions ?? [{ outer: [[-parameters.width / 2, -parameters.depth / 2], [parameters.width / 2, -parameters.depth / 2], [parameters.width / 2, parameters.depth / 2], [-parameters.width / 2, parameters.depth / 2]] as Point[], holes: [] }];
  const pins = parameters.layout?.pins ?? Array.from({ length: parameters.columns * parameters.rows }, (_, index) => ({
    id: `R${Math.floor(index / parameters.columns) + 1}:C${index % parameters.columns + 1}`,
    x: (index % parameters.columns - (parameters.columns - 1) / 2) * parameters.spacing,
    y: (Math.floor(index / parameters.columns) - (parameters.rows - 1) / 2) * parameters.spacing,
  }));
  const checks = resolvedContainment(parameters, regions);
  const invalid = pins.findIndex((pin, index) => !checks[index](pin.x, pin.y, parameters.layout?.edgePadding ?? 0));
  if (invalid !== -1) throw new Error(`Pin ${pins[invalid].id} violates base boundary or Edge padding. Undo the setting or restore its default shape. No pins were changed.`);
  const gap = minimumPinClearance(parameters, pins);
  if (gap !== null && gap < -EPSILON) throw new Error('Pin footprints overlap. Select the affected pins and reduce rotation or change shape. No pins were changed.');
}

export function pinVertices(shape: PinShape, size: number, rotation = 0): Point[] {
  validateShape(shape, size, rotation);
  const count = shape === 'round' ? 64 : shape === 'square' ? 4 : 3;
  const offset = shape === 'round' ? 0 : (shape === 'square' ? -3 * Math.PI / 4 : Math.PI / 2) + (rotation === 360 ? 0 : rotation) * Math.PI / 180;
  return Array.from({ length: count }, (_, index) => {
    const angle = offset + index * 2 * Math.PI / count;
    const cosine = Math.cos(angle), sine = Math.sin(angle);
    return [(Math.abs(cosine) < 1e-14 ? 0 : cosine) * size / 2, (Math.abs(sine) < 1e-14 ? 0 : sine) * size / 2];
  });
}

export function pinBounds(parameters: Parameters): Bounds {
  const rotation = effectivePinRotation(parameters);
  if ((parameters.pinShape ?? 'round') === 'round') {
    const radius = parameters.diameter / 2;
    return { minX: -radius, minY: -radius, maxX: radius, maxY: radius };
  }
  const vertices = pinVertices(parameters.pinShape!, parameters.diameter, rotation);
  return { minX: Math.min(...vertices.map(point => point[0])), minY: Math.min(...vertices.map(point => point[1])),
    maxX: Math.max(...vertices.map(point => point[0])), maxY: Math.max(...vertices.map(point => point[1])) };
}

function cross(first: Point, second: Point, third: Point) {
  return (second[0] - first[0]) * (third[1] - first[1]) - (second[1] - first[1]) * (third[0] - first[0]);
}

function pointSegmentDistanceSquared(point: Point, start: Point, end: Point) {
  const deltaX = end[0] - start[0], deltaY = end[1] - start[1];
  const lengthSquared = deltaX ** 2 + deltaY ** 2;
  const amount = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point[0] - start[0]) * deltaX + (point[1] - start[1]) * deltaY) / lengthSquared));
  return (point[0] - start[0] - amount * deltaX) ** 2 + (point[1] - start[1] - amount * deltaY) ** 2;
}

function segmentDistanceSquared(firstStart: Point, firstEnd: Point, secondStart: Point, secondEnd: Point) {
  if (cross(firstStart, firstEnd, secondStart) * cross(firstStart, firstEnd, secondEnd) < 0
    && cross(secondStart, secondEnd, firstStart) * cross(secondStart, secondEnd, firstEnd) < 0) return 0;
  return Math.min(pointSegmentDistanceSquared(firstStart, secondStart, secondEnd), pointSegmentDistanceSquared(firstEnd, secondStart, secondEnd),
    pointSegmentDistanceSquared(secondStart, firstStart, firstEnd), pointSegmentDistanceSquared(secondEnd, firstStart, firstEnd));
}

function entersPolygon(start: Point, end: Point, vertices: Point[]) {
  let lower = 0, upper = 1;
  for (let index = 0; index < vertices.length; index++) {
    const first = vertices[index], second = vertices[(index + 1) % vertices.length];
    const tolerance = EPSILON * Math.hypot(second[0] - first[0], second[1] - first[1]);
    const initial = cross(first, second, start) - tolerance;
    const change = cross(first, second, end) - tolerance - initial;
    if (change === 0) { if (initial <= 0) return false; }
    else if (change > 0) lower = Math.max(lower, -initial / change);
    else upper = Math.min(upper, -initial / change);
    if (lower >= upper) return false;
  }
  return lower < upper;
}

function boundaryTree(regions: Region[]) {
  const tree = new RBush<Segment>();
  tree.load(regions.flatMap(region => [region.outer, ...region.holes].flatMap(ring => ring.map((start, index) => {
    const end = ring[(index + 1) % ring.length];
    return { start, end, minX: Math.min(start[0], end[0]), minY: Math.min(start[1], end[1]), maxX: Math.max(start[0], end[0]), maxY: Math.max(start[1], end[1]) };
  }))));
  return tree;
}

export function createPinContainment(regions: Region[], parameters: Parameters, shared?: BoundaryIndex): (x: number, y: number, padding: number) => boolean {
  validatePinGeometry(parameters);
  const containsCenter = shared?.containsCenter ?? regionIndex(regions);
  if ((parameters.pinShape ?? 'round') === 'round') {
    const radius = parameters.diameter / 2;
    return (horizontal, vertical, padding) => containsCenter(horizontal, vertical, radius + padding);
  }
  const vertices = pinVertices(parameters.pinShape!, parameters.diameter, effectivePinRotation(parameters));
  const bounds = pinBounds(parameters);
  const tree = shared?.tree ?? boundaryTree(regions);
  return (horizontal, vertical, padding) => {
    if (!containsCenter(horizontal, vertical, 0)) return false;
    const threshold = Math.max(0, padding - EPSILON) ** 2;
    for (const segment of tree.search({ minX: horizontal + bounds.minX - padding, minY: vertical + bounds.minY - padding,
      maxX: horizontal + bounds.maxX + padding, maxY: vertical + bounds.maxY + padding })) {
      const start: Point = [segment.start[0] - horizontal, segment.start[1] - vertical];
      const end: Point = [segment.end[0] - horizontal, segment.end[1] - vertical];
      if (entersPolygon(start, end, vertices)) return false;
      if (threshold > 0 && vertices.some((point, index) => segmentDistanceSquared(start, end, point, vertices[(index + 1) % vertices.length]) < threshold)) return false;
    }
    return true;
  };
}

function convexHull(points: Point[]) {
  const sorted = points.sort((first, second) => first[0] - second[0] || first[1] - second[1]);
  const tolerance = (sorted.at(-1)![0] - sorted[0][0]) ** 2 * 1e-14;
  const half = (vertices: Point[]) => {
    const hull: Point[] = [];
    for (const point of vertices) {
      while (hull.length > 1 && cross(hull[hull.length - 2], hull[hull.length - 1], point) <= tolerance) hull.pop();
      hull.push(point);
    }
    return hull.slice(0, -1);
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

function signedPolygonDistance(point: Point, vertices: Point[], tolerance: number) {
  let inside = true, distanceSquared = Infinity;
  for (let index = 0; index < vertices.length; index++) {
    const start = vertices[index], end = vertices[(index + 1) % vertices.length];
    if (cross(start, end, point) < 0) inside = false;
    distanceSquared = Math.min(distanceSquared, pointSegmentDistanceSquared(point, start, end));
  }
  const distance = Math.sqrt(distanceSquared);
  return distance < tolerance ? 0 : inside ? -distance : distance;
}

export function minimumPinClearance(parameters: Parameters, pins: readonly PinPosition[]): number | null {
  validatePinGeometry(parameters);
  if (parameters.pinGeometries) {
    const geometries = resolvePinGeometries(parameters), first = geometries[0];
    if (first && geometries.every(geometry => geometry.shape === first.shape && geometry.rotation === first.rotation)) return minimumPinClearance(geometryParameters(parameters, first), pins);
    return mixedPinClearance(parameters, pins, geometries);
  }
  if (pins.length < 2) return null;
  const shape = parameters.pinShape ?? 'round';
  const tolerance = parameters.diameter * 1e-12;
  const vertices = shape === 'round' ? [] : pinVertices(shape, parameters.diameter, effectivePinRotation(parameters));
  const difference = shape === 'round' ? [] : convexHull(vertices.flatMap(first => vertices.map(second => [first[0] - second[0], first[1] - second[1]] as Point)));
  const gap = (first: PinPosition, second: PinPosition) => shape === 'round'
    ? Math.hypot(first.x - second.x, first.y - second.y) - parameters.diameter
    : signedPolygonDistance([first.x - second.x, first.y - second.y], difference, tolerance);
  const lowest = shape === 'round' ? -parameters.diameter : signedPolygonDistance([0, 0], difference, tolerance);
  let minimum = Infinity;
  const sorted = [...pins].sort((first, second) => first.x - second.x || first.y - second.y);
  for (let index = 1; index < sorted.length; index++) minimum = Math.min(minimum, gap(sorted[index - 1], sorted[index]));
  if (minimum <= lowest + tolerance) return minimum;
  const planes = difference.map((start, index) => {
    const end = difference[(index + 1) % difference.length];
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
    const normalX = (end[1] - start[1]) / length, normalY = (start[0] - end[0]) / length;
    return { normalX, normalY, offset: normalX * start[0] + normalY * start[1] };
  });
  const lowerBound = (pin: PinPosition, bounds: Bounds) => {
    const deltaX = Math.max(bounds.minX - pin.x, 0, pin.x - bounds.maxX);
    const deltaY = Math.max(bounds.minY - pin.y, 0, pin.y - bounds.maxY);
    let lower = Math.hypot(deltaX, deltaY) - parameters.diameter;
    for (const { normalX, normalY, offset } of planes) {
      lower = Math.max(lower, normalX * (pin.x - (normalX >= 0 ? bounds.maxX : bounds.minX))
        + normalY * (pin.y - (normalY >= 0 ? bounds.maxY : bounds.minY)) - offset);
    }
    return lower;
  };
  const tree = new RBush<IndexedPin>();
  tree.load(pins.map((pin, index) => ({ pin, index, minX: pin.x, maxX: pin.x, minY: pin.y, maxY: pin.y })));
  const root = tree.toJSON() as SpatialNode;
  for (let index = 0; index < pins.length; index++) {
    const pin = pins[index], pending: (SpatialNode | IndexedPin)[] = [root];
    while (pending.length) {
      const neighbour = pending.pop()!;
      if ('index' in neighbour && neighbour.index <= index) continue;
      if (lowerBound(pin, neighbour) > minimum + tolerance) continue;
      if ('children' in neighbour) pending.push(...neighbour.children);
      else if (neighbour.index > index) {
        minimum = Math.min(minimum, gap(pin, neighbour.pin));
        if (minimum <= lowest + tolerance) return minimum;
      }
    }
  }
  return Math.abs(minimum) < tolerance ? 0 : minimum;
}

function mixedPinClearance(parameters: Parameters, pins: readonly PinPosition[], geometries: PinGeometry[]): number | null {
  if (pins.length < 2) return null;
  const tolerance = parameters.diameter * 1e-12;
  const vertices = new Map<string, Point[]>(), differences = new Map<string, Point[]>();
  const key = (geometry: PinGeometry) => `${geometry.shape}:${geometry.rotation}`;
  const polygon = (geometry: PinGeometry) => {
    const identity = key(geometry);
    if (!vertices.has(identity)) vertices.set(identity, pinVertices(geometry.shape, parameters.diameter, geometry.rotation));
    return vertices.get(identity)!;
  };
  const difference = (first: PinGeometry, second: PinGeometry) => {
    const identity = `${key(first)}|${key(second)}`;
    if (!differences.has(identity)) {
      differences.set(identity, first.shape === 'round' ? polygon(second).map(point => [-point[0], -point[1]] as Point)
        : second.shape === 'round' ? polygon(first)
        : convexHull(polygon(first).flatMap(start => polygon(second).map(end => [start[0] - end[0], start[1] - end[1]] as Point))));
    }
    return differences.get(identity)!;
  };
  const gap = (firstIndex: number, secondIndex: number) => {
    const first = geometries[firstIndex], second = geometries[secondIndex];
    const delta: Point = [pins[secondIndex].x - pins[firstIndex].x, pins[secondIndex].y - pins[firstIndex].y];
    if (first.shape === 'round' && second.shape === 'round') return Math.hypot(...delta) - parameters.diameter;
    if (first.shape === 'round') return signedPolygonDistance([-delta[0], -delta[1]], polygon(second), tolerance) - parameters.diameter / 2;
    if (second.shape === 'round') return signedPolygonDistance(delta, polygon(first), tolerance) - parameters.diameter / 2;
    return signedPolygonDistance(delta, difference(first, second), tolerance);
  };
  const sorted = pins.map((pin, index) => ({ pin, index })).sort((first, second) => first.pin.x - second.pin.x || first.pin.y - second.pin.y);
  let minimum = Infinity;
  for (let index = 1; index < sorted.length; index++) minimum = Math.min(minimum, gap(sorted[index - 1].index, sorted[index].index));
  const tree = new RBush<IndexedPin>();
  tree.load(pins.map((pin, index) => ({ pin, index, minX: pin.x, maxX: pin.x, minY: pin.y, maxY: pin.y })));
  const root = tree.toJSON() as SpatialNode;
  const summaries = new Map<SpatialNode | IndexedPin, number[]>();
  function summarize(node: SpatialNode | IndexedPin): number[] | null {
    if ('index' in node) return [node.index];
    const identities = new Map<string, number>();
    let complete = true;
    for (const child of node.children) {
      const indices = summarize(child);
      if (!indices) complete = false;
      else if (identities.size <= 8) for (const index of indices) identities.set(key(geometries[index]), index);
    }
    if (!complete || identities.size > 8) return null;
    const result = [...identities.values()];
    summaries.set(node, result);
    return result;
  }
  summarize(root);
  const planeCache = new Map<string, { normalX: number; normalY: number; offset: number }[]>();
  function polygonLowerBound(first: PinGeometry, second: PinGeometry, pin: PinPosition, node: Bounds) {
    if (first.shape === 'round' && second.shape === 'round') return -Infinity;
    const identity = `${key(first)}|${key(second)}`;
    if (!planeCache.has(identity)) {
      const vertices = difference(first, second);
      const radius = first.shape === 'round' || second.shape === 'round' ? parameters.diameter / 2 : 0;
      planeCache.set(identity, vertices.map((start, index) => {
        const end = vertices[(index + 1) % vertices.length], length = Math.hypot(end[0] - start[0], end[1] - start[1]);
        const normalX = (end[1] - start[1]) / length, normalY = (start[0] - end[0]) / length;
        return { normalX, normalY, offset: normalX * start[0] + normalY * start[1] + radius };
      }));
    }
    let bound = -Infinity;
    for (const { normalX, normalY, offset } of planeCache.get(identity)!) {
      bound = Math.max(bound, normalX * ((normalX >= 0 ? node.minX : node.maxX) - pin.x)
        + normalY * ((normalY >= 0 ? node.minY : node.maxY) - pin.y) - offset);
    }
    return bound;
  }
  for (let index = 0; index < pins.length; index++) {
    const pin = pins[index], pending: (SpatialNode | IndexedPin)[] = [root];
    while (pending.length) {
      const node = pending.pop()!;
      const deltaX = Math.max(node.minX - pin.x, 0, pin.x - node.maxX), deltaY = Math.max(node.minY - pin.y, 0, pin.y - node.maxY);
      if (Math.hypot(deltaX, deltaY) - parameters.diameter > minimum + tolerance) continue;
      if (minimum < 0) {
        const candidates = 'index' in node ? [node.index] : summaries.get(node);
        if (candidates && Math.min(...candidates.map(candidate => polygonLowerBound(geometries[index], geometries[candidate], pin, node))) > minimum + tolerance) continue;
      }
      if ('children' in node) pending.push(...node.children);
      else if (node.index > index) minimum = Math.min(minimum, gap(index, node.index));
    }
  }
  return Math.abs(minimum) < tolerance ? 0 : minimum;
}
