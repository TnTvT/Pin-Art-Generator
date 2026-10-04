import { describe, expect, it } from 'vitest';
import { DEFAULTS } from '../pin-design/model';
import { DEFAULT_SHAPE, generateLayout, regionIndex, samePins, traceImage, type ShapeImage } from './layout';

describe('shape-owned layouts', () => {
  it('fills the default rectangle deterministically with wall padding', () => {
    const first = generateLayout(DEFAULTS, DEFAULT_SHAPE);
    expect(first.layout.pins).toHaveLength(357);
    expect(first.layout.pins[0]).toEqual({ id: 'g:-8:-10', x: -50, y: -40 });
    expect(first.layout.pins.every(pin => Math.abs(pin.x) + 1 + 5 <= 60 && Math.abs(pin.y) + 1 + 5 <= 50)).toBe(true);
    expect(samePins(first.layout, generateLayout(DEFAULTS, DEFAULT_SHAPE).layout)).toBe(true);
  });
  it.each(['circle', 'ellipse', 'rounded'] as const)('clips %s without changing spacing or diameter', preset => {
    const result = generateLayout(DEFAULTS, { ...DEFAULT_SHAPE, preset });
    expect(result.layout.pins.length).toBeGreaterThan(0);
    expect(result.layout.regions[0].outer.length).toBeGreaterThanOrEqual(64);
    expect(result.layout.pins.every(pin => pin.x % 5 === 0 && pin.y % 5 === 0)).toBe(true);
  });
  it('rejects zero pins, invalid corners, excessive candidates and pins', () => {
    expect(() => generateLayout(DEFAULTS, { ...DEFAULT_SHAPE, padding: 100 })).toThrow(/No pins/);
    expect(() => generateLayout(DEFAULTS, { ...DEFAULT_SHAPE, preset: 'rounded', radius: 60 })).toThrow(/radius/);
    expect(() => generateLayout({ ...DEFAULTS, spacing: 0.001 }, DEFAULT_SHAPE)).toThrow(/candidate/);
    expect(() => generateLayout({ ...DEFAULTS, spacing: 0.5 }, DEFAULT_SHAPE)).toThrow(/10,000/);
  });
  it('fills transparent interior gaps while keeping separate outer contours and their foreground dimensions', () => {
    const image: ShapeImage = { width: 12, height: 7, pixels: new Uint8ClampedArray(12 * 7 * 4) };
    for (let vertical = 0; vertical < 7; vertical++) for (let horizontal = 0; horizontal < 12; horizontal++) {
      const foreground = horizontal < 7 && !(horizontal >= 2 && horizontal <= 4 && vertical >= 2 && vertical <= 4) || horizontal >= 10 && vertical < 2;
      if (foreground) image.pixels.set([255, 0, 0, 255], (vertical * 12 + horizontal) * 4);
    }
    const shape = { ...DEFAULT_SHAPE, source: 'image' as const, padding: 0 };
    const result = generateLayout(DEFAULTS, shape, image);
    expect(result.layout.regions).toHaveLength(2);
    expect(result.layout.regions.flatMap(region => region.holes)).toHaveLength(0);
    expect(result.depth).toBeCloseTo(70);
    const fits = regionIndex(result.layout.regions);
    expect(result.layout.pins.every(pin => fits(pin.x, pin.y, 1))).toBe(true);
    expect(fits(-25, 0, 1)).toBe(true);
    expect(result.layout.pins.some(pin => pin.x === -25 && pin.y === 0)).toBe(true);
    expect(result.layout.imageBounds).toEqual([0, 0, 12, 7]);
    expect(samePins(result.layout, generateLayout(DEFAULTS, shape, image).layout)).toBe(true);
  });
  it.each(['transparency', 'background'] as const)('uses only the outer silhouette for %s detection, without overlapping nested islands', detection => {
    const image: ShapeImage = { width: 11, height: 11, pixels: new Uint8ClampedArray(11 * 11 * 4) };
    for (let vertical = 0; vertical < 11; vertical++) for (let horizontal = 0; horizontal < 11; horizontal++) {
      const foreground = horizontal < 2 || horizontal > 8 || vertical < 2 || vertical > 8 || horizontal === 5 && vertical === 5;
      image.pixels.set(foreground ? [255, 0, 0, 255] : [255, 255, 255, detection === 'background' ? 255 : 0], (vertical * 11 + horizontal) * 4);
    }
    const result = generateLayout(DEFAULTS, { ...DEFAULT_SHAPE, source: 'image', padding: 0, detection }, image);
    expect(result.layout.regions).toHaveLength(1);
    expect(result.layout.regions[0].holes).toEqual([]);
    expect(result.layout.pins.some(pin => pin.x === 0 && pin.y === 0)).toBe(true);
    expect(result.layout.pins.some(pin => pin.x === 10 && pin.y === 0)).toBe(true);
    expect(result.layout.imageBounds).toEqual([0, 0, 11, 11]);
  });
  it('composites transparent pixels onto the configured background and rejects empty masks', () => {
    const image = { width: 3, height: 1, pixels: new Uint8ClampedArray([255,255,255,255, 255,0,0,255, 255,0,0,0]) };
    const shape = { ...DEFAULT_SHAPE, detection: 'background' as const };
    expect(traceImage(image, shape).regions).toHaveLength(1);
    expect(traceImage(image, shape).bounds).toEqual([1, 0, 2, 1]);
    expect(() => traceImage({ width: 1, height: 1, pixels: new Uint8ClampedArray([255,255,255,255]) }, shape)).toThrow(/No foreground/);
    expect(traceImage(image, { ...shape, detection: 'auto' }).bounds).toEqual([0, 0, 2, 1]);
  });
  it('handles concave regions and exact padding against hole and outer boundaries', () => {
    const fits = regionIndex([{ outer: [[-10,-10], [10,-10], [10,0], [0,0], [0,10], [-10,10]], holes: [[[-8,-8],[-8,-6],[-6,-6],[-6,-8]]] }]);
    expect(fits(5,5,1)).toBe(false);
    expect(fits(-7,-7,0)).toBe(false);
    expect(fits(-4,-7,2)).toBe(true);
    expect(fits(-4.1,-7,2)).toBe(false);
    expect(fits(9,-5,1)).toBe(true);
  });
  it('rejects noisy topology without deleting tiny regions', () => {
    const image: ShapeImage = { width: 150, height: 150, pixels: new Uint8ClampedArray(150 * 150 * 4) };
    for (let vertical = 0; vertical < 150; vertical += 2) for (let horizontal = 0; horizontal < 150; horizontal += 2) image.pixels[(vertical * 150 + horizontal) * 4 + 3] = 255;
    expect(() => generateLayout(DEFAULTS, { ...DEFAULT_SHAPE, source: 'image' }, image)).toThrow(/20,000 vertices/);
  });
});
