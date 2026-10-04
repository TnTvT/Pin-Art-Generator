import { contours } from 'd3-contour';
import RBush from 'rbush';
import { deltaE2000, Lab, sRGB, to } from 'colorjs.io/fn';
import type { Parameters } from '../pin-design/model';

export type Point = [number, number];
export interface Region { outer: Point[]; holes: Point[][] }
export interface PinPosition { id: string; x: number; y: number }
export interface Layout { regions: Region[]; pins: PinPosition[]; edgePadding: number; imageBounds?: [number, number, number, number] }
export interface ShapeOptions {
  source: 'preset' | 'image'; preset: 'rectangle' | 'rounded' | 'circle' | 'ellipse';
  padding: number; radius: number; detection: 'auto' | 'transparency' | 'background'; background: string; tolerance: number;
}
export interface ShapeImage { pixels: Uint8ClampedArray; width: number; height: number }
export const DEFAULT_SHAPE: ShapeOptions = { source: 'preset', preset: 'rectangle', padding: 5, radius: 10, detection: 'auto', background: '#ffffff', tolerance: 10 };
export const EPSILON = 1e-6;

export function cleanRing(points: Point[]): Point[] {
  const unique = points.filter((point, index) => index === 0 || point[0] !== points[index - 1][0] || point[1] !== points[index - 1][1]);
  if (unique.length > 1 && unique[0][0] === unique.at(-1)![0] && unique[0][1] === unique.at(-1)![1]) unique.pop();
  return unique.filter((point, index) => {
    const previous = unique[(index + unique.length - 1) % unique.length], next = unique[(index + 1) % unique.length];
    return Math.abs((point[0] - previous[0]) * (next[1] - point[1]) - (point[1] - previous[1]) * (next[0] - point[0])) > 1e-12;
  });
}

export function ringArea(ring: Point[]) {
  return ring.reduce((area, point, index) => {
    const next = ring[(index + 1) % ring.length];
    return area + point[0] * next[1] - next[0] * point[1];
  }, 0) / 2;
}

function oriented(points: Point[], outer: boolean) {
  const ring = cleanRing(points);
  if (ring.length < 3 || Math.abs(ringArea(ring)) < 1e-12) throw new Error('The image contains a degenerate contour. Adjust background tolerance or use a cleaner image.');
  return (ringArea(ring) > 0) === outer ? ring : ring.reverse();
}

function presetRegion(width: number, depth: number, shape: ShapeOptions): Region {
  const halfWidth = width / 2, halfDepth = depth / 2;
  if (shape.preset === 'circle' || shape.preset === 'ellipse') return { outer: Array.from({ length: 64 }, (_, index) => [Math.cos(index * Math.PI / 32) * halfWidth, Math.sin(index * Math.PI / 32) * halfDepth] as Point), holes: [] };
  if (shape.preset === 'rounded' && shape.radius > 0) {
    if (shape.radius > Math.min(halfWidth, halfDepth)) throw new Error('Corner radius must not exceed half the shorter base dimension.');
    const outer: Point[] = [];
    for (let quadrant = 0; quadrant < 4; quadrant++) {
      const centerX = (quadrant === 0 || quadrant === 3 ? 1 : -1) * (halfWidth - shape.radius);
      const centerY = (quadrant < 2 ? 1 : -1) * (halfDepth - shape.radius);
      for (let step = 0; step <= 15; step++) {
        const angle = (quadrant + step / 15) * Math.PI / 2;
        outer.push([centerX + Math.cos(angle) * shape.radius, centerY + Math.sin(angle) * shape.radius]);
      }
    }
    return { outer: oriented(outer, true), holes: [] };
  }
  return { outer: [[-halfWidth, -halfDepth], [halfWidth, -halfDepth], [halfWidth, halfDepth], [-halfWidth, halfDepth]], holes: [] };
}

export function traceImage(image: ShapeImage, shape: ShapeOptions) {
  if (image.pixels.length !== image.width * image.height * 4 || image.width > 1024 || image.height > 1024) throw new Error('Contour pixels must match an image up to 1,024 pixels per side.');
  if (!/^#[0-9a-f]{6}$/i.test(shape.background) || !Number.isFinite(shape.tolerance) || shape.tolerance < 0 || shape.tolerance > 50) throw new Error('Choose a valid background color and a tolerance from 0 to 50.');
  const transparency = shape.detection === 'transparency' || shape.detection === 'auto' && image.pixels.some((value, index) => index % 4 === 3 && value < 128);
  const background = [1, 3, 5].map(offset => parseInt(shape.background.slice(offset, offset + 2), 16));
  const lab = (rgb: number[]) => to({ space: sRGB, coords: rgb.map(channel => channel / 255) as [number, number, number], alpha: 1 }, Lab);
  const backgroundLab = lab(background), cache = new Map<string, number>();
  const mask = new Uint8Array(image.width * image.height);
  for (let index = 0; index < mask.length; index++) {
    const offset = index * 4, alpha = image.pixels[offset + 3];
    if (transparency) mask[index] = alpha >= 128 ? 1 : 0;
    else {
      const rgb = background.map((channel, axis) => Math.round(image.pixels[offset + axis] * alpha / 255 + channel * (1 - alpha / 255)));
      const key = rgb.join(',');
      let foreground = cache.get(key);
      if (foreground === undefined) { foreground = deltaE2000(lab(rgb), backgroundLab) > shape.tolerance ? 1 : 0; cache.set(key, foreground); }
      mask[index] = foreground;
    }
  }
  const polygons = contours().size([image.width, image.height]).smooth(false).contour(Array.from(mask), 0.5).coordinates;
  if (!polygons.length) throw new Error('No foreground found. Adjust contour detection, background color or tolerance.');
  const regions: Region[] = [];
  const outerIndex = new RBush<{ minX: number; minY: number; maxX: number; maxY: number; contains: ReturnType<typeof regionIndex> }>();
  let vertices = 0;
  const bounds: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  const outlines = polygons.map(polygon => cleanRing(polygon[0] as Point[])).sort((first, second) => Math.abs(ringArea(second)) - Math.abs(ringArea(first)));
  for (const outer of outlines) {
    const [firstX, firstY] = outer[0];
    if (outerIndex.search({ minX: firstX, maxX: firstX, minY: firstY, maxY: firstY }).some(region => region.contains(firstX, firstY, 0))) continue;
    const region: Region = { outer, holes: [] };
    vertices += outer.length;
    if (vertices > 20000) throw new Error('Contours exceed 20,000 vertices. Use a cleaner image or adjust background tolerance.');
    regions.push(region);
    const regionBounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const [horizontal, vertical] of region.outer) {
      regionBounds.minX = Math.min(regionBounds.minX, horizontal); regionBounds.minY = Math.min(regionBounds.minY, vertical);
      regionBounds.maxX = Math.max(regionBounds.maxX, horizontal); regionBounds.maxY = Math.max(regionBounds.maxY, vertical);
      bounds[0] = Math.min(bounds[0], horizontal); bounds[1] = Math.min(bounds[1], vertical);
      bounds[2] = Math.max(bounds[2], horizontal); bounds[3] = Math.max(bounds[3], vertical);
    }
    outerIndex.insert({ ...regionBounds, contains: regionIndex([region]) });
  }
  return { regions, bounds };
}

interface Segment { minX: number; minY: number; maxX: number; maxY: number; start: Point; end: Point }
export function regionIndex(regions: Region[]) {
  const tree = new RBush<Segment>();
  tree.load(regions.flatMap(region => [region.outer, ...region.holes].flatMap(ring => ring.map((start, index) => {
    const end = ring[(index + 1) % ring.length];
    return { start, end, minX: Math.min(start[0], end[0]), maxX: Math.max(start[0], end[0]), minY: Math.min(start[1], end[1]), maxY: Math.max(start[1], end[1]) };
  }))));
  function distanceSquared(horizontal: number, vertical: number, segment: Segment) {
    const [startX, startY] = segment.start, [endX, endY] = segment.end;
    const deltaX = endX - startX, deltaY = endY - startY;
    const amount = Math.max(0, Math.min(1, ((horizontal - startX) * deltaX + (vertical - startY) * deltaY) / (deltaX * deltaX + deltaY * deltaY)));
    return (horizontal - startX - amount * deltaX) ** 2 + (vertical - startY - amount * deltaY) ** 2;
  }
  return (horizontal: number, vertical: number, clearance: number) => {
    let intersections = 0;
    for (const segment of tree.search({ minX: horizontal, maxX: Infinity, minY: vertical, maxY: vertical })) {
      const [firstX, firstY] = segment.start, [lastX, lastY] = segment.end;
      if ((firstY > vertical) !== (lastY > vertical) && horizontal < firstX + (vertical - firstY) * (lastX - firstX) / (lastY - firstY)) intersections++;
    }
    if (intersections % 2 === 0) return false;
    const threshold = Math.max(0, clearance - EPSILON) ** 2;
    return tree.search({ minX: horizontal - clearance, maxX: horizontal + clearance, minY: vertical - clearance, maxY: vertical + clearance }).every(segment => distanceSquared(horizontal, vertical, segment) >= threshold);
  };
}

export function generateLayout(parameters: Parameters, shape: ShapeOptions, image?: ShapeImage) {
  if ([parameters.width, parameters.depth, parameters.spacing, parameters.diameter, parameters.thickness, parameters.extension].some(value => !Number.isFinite(value) || value <= 0)
    || !Number.isFinite(shape.padding) || shape.padding < 0 || !Number.isFinite(shape.radius) || shape.radius < 0) throw new Error('Use positive dimensions and nonnegative padding and radius.');
  let width = parameters.width, depth = shape.source === 'preset' && shape.preset === 'circle' ? width : parameters.depth;
  let regions: Region[], imageBounds: Layout['imageBounds'];
  if (shape.source === 'image') {
    if (!image) throw new Error('Upload an image to define the base, or choose Preset shape.');
    const traced = traceImage(image, shape);
    imageBounds = traced.bounds;
    const [left, top, right, bottom] = traced.bounds;
    const scale = width / (right - left);
    depth = (bottom - top) * scale;
    const convert = (ring: Point[], outer: boolean) => oriented(ring.map(([horizontal, vertical]) => [(horizontal - (left + right) / 2) * scale, ((top + bottom) / 2 - vertical) * scale]), outer);
    regions = traced.regions.map(region => ({ outer: convert(region.outer, true), holes: region.holes.map(hole => convert(hole, false)) }));
  } else regions = [presetRegion(width, depth, shape)];
  if (regions.reduce((count, region) => count + region.outer.length + region.holes.reduce((total, ring) => total + ring.length, 0), 0) > 20000) throw new Error('Contours exceed 20,000 vertices. Use a cleaner image or adjust background tolerance.');
  const clearance = shape.padding + parameters.diameter / 2;
  const limitX = Math.floor((width / 2 - clearance + EPSILON) / parameters.spacing), limitY = Math.floor((depth / 2 - clearance + EPSILON) / parameters.spacing);
  if ((2 * Math.max(0, limitX) + 1) * (2 * Math.max(0, limitY) + 1) > 1000000) throw new Error('Layout exceeds 1,000,000 candidate positions. Increase spacing or reduce the base.');
  const fits = regionIndex(regions), pins: PinPosition[] = [];
  for (let row = -limitY; row <= limitY; row++) for (let column = -limitX; column <= limitX; column++) {
    const horizontal = column * parameters.spacing, vertical = row * parameters.spacing;
    if (fits(horizontal, vertical, clearance)) pins.push({ id: `g:${row}:${column}`, x: horizontal, y: vertical });
    if (pins.length > 10000) throw new Error('The shape contains more than 10,000 pins. Increase spacing or padding, or reduce the base.');
  }
  if (!pins.length) throw new Error('No pins fit inside the base. Reduce padding or pin diameter, or enlarge the base.');
  const layout: Layout = { regions, pins, edgePadding: shape.padding, ...(imageBounds ? { imageBounds } : {}) };
  return { layout, width, depth };
}

export function samePins(first: Layout, second: Layout) {
  return first.pins.length === second.pins.length && first.pins.every((pin, index) => pin.id === second.pins[index].id && pin.x === second.pins[index].x && pin.y === second.pins[index].y);
}

export function pinsHaveSeparation(pins: PinPosition[], minimum: number) {
  const tree = new RBush<PinPosition & { minX: number; maxX: number; minY: number; maxY: number }>();
  tree.load(pins.map(pin => ({ ...pin, minX: pin.x, maxX: pin.x, minY: pin.y, maxY: pin.y })));
  const threshold = Math.max(0, minimum - EPSILON) ** 2;
  return pins.every(pin => tree.search({ minX: pin.x - minimum, maxX: pin.x + minimum, minY: pin.y - minimum, maxY: pin.y + minimum })
    .every(neighbour => neighbour.id === pin.id || (pin.x - neighbour.x) ** 2 + (pin.y - neighbour.y) ** 2 >= threshold));
}
