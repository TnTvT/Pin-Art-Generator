import { describe, expect, it } from 'vitest';
import { fitImage, pixelsToHeights, pixelsToPinRGB } from './sampling';

const pixels = (...brightness: number[]) => new Uint8ClampedArray(brightness.flatMap((value) => [value, value, value, 255]));

describe('grayscale height mapping', () => {
  it('uses exactly the same row orientation for color and height samples', () => {
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]);
    expect([...pixelsToPinRGB(rgba, 2, 2)]).toEqual([0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255, 0]);
    expect(pixelsToHeights(rgba, 2, 2, 2, 20, false).heights[1]).toBe(2);
    expect(() => pixelsToPinRGB(rgba, 3, 2)).toThrow(/grid/);
  });
  it('maps black to the maximum and white to the minimum extension', () => {
    const result = pixelsToHeights(pixels(0, 255), 2, 1, 2, 20, false);
    expect(Array.from(result.heights)).toEqual([20, 2]);
    expect(result.minimum).toBeCloseTo(2);
    expect(result.maximum).toBe(20);
  });

  it('reverses the brightness mapping without changing the configured range', () => {
    const result = pixelsToHeights(pixels(0, 255), 2, 1, 2, 20, true);
    expect(Array.from(result.heights)).toEqual([2, 20]);
  });

  it('keeps image top at positive Y by reversing image rows, not columns', () => {
    const result = pixelsToHeights(pixels(0, 85, 170, 255), 2, 2, 2, 20, false);
    expect(Array.from(result.heights)).toEqual([8, 2, 20, 14]);
  });

  it('uses weighted RGB brightness rather than a simple channel average', () => {
    const result = pixelsToHeights(new Uint8ClampedArray([255, 0, 0, 255]), 1, 1, 2, 20, false);
    expect(result.heights[0]).toBeCloseTo(2 + (1 - 0.2126) * 18, 4);
  });

  it('supports a flat range and calculates sampled extrema', () => {
    expect(Array.from(pixelsToHeights(pixels(0, 255), 2, 1, 5, 5, false).heights)).toEqual([5, 5]);
    const result = pixelsToHeights(pixels(85, 170), 2, 1, 2, 20, false);
    expect(result.minimum).toBeCloseTo(8);
    expect(result.maximum).toBeCloseTo(14);
  });
});

describe('aspect-preserving placement', () => {
  it('centers a portrait image with horizontal margins', () => {
    expect(fitImage(100, 200, 100, 100, 20, 20)).toEqual({ x: 5, y: 0, width: 10, height: 20 });
  });

  it('centers a landscape image with vertical margins', () => {
    expect(fitImage(200, 100, 100, 100, 20, 20)).toEqual({ x: 0, y: 5, width: 20, height: 10 });
  });

  it('uses the physical grid aspect ratio rather than just row and column counts', () => {
    expect(fitImage(200, 100, 200, 100, 10, 10)).toEqual({ x: 0, y: 0, width: 10, height: 10 });
  });
});
