import { describe, expect, it } from 'vitest';
import { DEFAULTS } from '../pin-design/model';
import { DEFAULT_IMAGE_PLACEMENT, fitImageToPins, imageTransform, sourcePoint, zoomImage } from './image-placement';

const parameters = { ...DEFAULTS, width: 120, depth: 100, layout: { regions: [], edgePadding: 5, pins: [{ id: 'a', x: -40, y: -30 }, { id: 'b', x: 40, y: 30 }] } };
const bitmap = { width: 200, height: 100 };

describe('image placement', () => {
  it('contains within compact pin tops and moves both sampling axes in compact mm', () => {
    const initial = imageTransform(bitmap, parameters);
    expect(initial).toMatchObject({ scale: 0.21, centerX: 100, centerY: 50, left: -21, top: 10.5, width: 42, height: 21 });
    const moved = imageTransform(bitmap, parameters, { offsetX: 12, offsetY: 6, zoom: 2 });
    expect(sourcePoint({ x: 12, y: 6 }, moved)).toEqual({ x: 99.5, y: 49.5 });
    expect(sourcePoint({ x: 0, y: 0 }, moved).x).toBeCloseTo(70.928571);
    expect(sourcePoint({ x: 0, y: 0 }, moved).y).toBeCloseTo(63.785714);
    expect(moved).toMatchObject({ left: -30, top: 27, width: 84, height: 42 });
  });

  it('uses foreground bounds for image bases without changing their geometry', () => {
    const cropped = { ...parameters, layout: { ...parameters.layout, imageBounds: [20, 10, 140, 90] as [number, number, number, number] } };
    const transform = imageTransform(bitmap, cropped, { offsetX: 3, offsetY: -4, zoom: 0.5 });
    expect(transform).toMatchObject({ centerX: 80, centerY: 50, scale: 0.175, left: -11, top: 4.75 });
    expect(sourcePoint({ x: 3, y: -4 }, transform)).toEqual({ x: 79.5, y: 49.5 });
    expect(cropped.layout.pins).toBe(parameters.layout.pins);
  });

  it('zooms around the pointer, clamps the zoom range, and keeps finite placement values', () => {
    const initial = { offsetX: 10, offsetY: -5, zoom: 1 };
    const anchor = { x: 30, y: 20 };
    const next = zoomImage(initial, 2, anchor);
    expect(next).toEqual({ offsetX: -10, offsetY: -30, zoom: 2 });
    expect(sourcePoint(anchor, imageTransform(bitmap, parameters, next))).toEqual(sourcePoint(anchor, imageTransform(bitmap, parameters, initial)));
    expect(zoomImage(initial, 100).zoom).toBe(4);
    expect(zoomImage(initial, 0.001).zoom).toBe(0.1);
    expect(zoomImage(initial, 2)).toEqual({ ...initial, zoom: 2 });
    expect(() => imageTransform(bitmap, parameters, { ...initial, offsetX: NaN })).toThrow(/finite/);
    expect(() => imageTransform(bitmap, parameters, { ...initial, zoom: 0 })).toThrow(/zoom/i);
  });

  it('fits the source content to the centered compact domain, including a single pin', () => {
    expect(fitImageToPins(bitmap, parameters)).toEqual(DEFAULT_IMAGE_PLACEMENT);
    const single = { ...parameters, layout: { ...parameters.layout, pins: [{ id: 'a', x: 20, y: -10 }] } };
    expect(fitImageToPins(bitmap, single)).toEqual(DEFAULT_IMAGE_PLACEMENT);
    expect(DEFAULT_IMAGE_PLACEMENT).toEqual({ offsetX: 0, offsetY: 0, zoom: 1 });
  });
});
