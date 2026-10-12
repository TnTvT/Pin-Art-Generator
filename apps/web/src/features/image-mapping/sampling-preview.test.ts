import { describe, expect, it } from 'vitest';
import { DEFAULTS } from '../pin-design/model';
import { buildSamplingPreview } from './sampling-preview';

const parameters = { ...DEFAULTS, spacing: 4, layout: { regions: [], edgePadding: 0,
  pins: [{ id: 'left', x: -4, y: 4 }, { id: 'center', x: 0, y: 4 }, { id: 'bottom', x: 0, y: -4 }] } };
const pixels = new Uint8ClampedArray([255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255]);

describe('gap-free image adjustment samples', () => {
  it('fills touching cap-sized cells at compact pin centers and groups identical colors', () => {
    expect(buildSamplingPreview(pixels, parameters)).toEqual([
      { color: 'rgb(255, 0, 0)', path: 'M-2,-3h2v2h-2ZM0,-3h2v2h-2Z' },
      { color: 'rgb(0, 0, 255)', path: 'M0,1h2v2h-2Z' },
    ]);
  });

  it('does not repack cells based on shape or rotation or fill missing pin positions', () => {
    const expected = buildSamplingPreview(pixels, parameters);
    expect(buildSamplingPreview(pixels, { ...parameters, pinShape: 'triangle', pinRotation: 45 })).toEqual(expected);
    expect(expected.map(group => group.path).join('').match(/M/g)).toHaveLength(3);
    expect(parameters.layout.pins[0]).toEqual({ id: 'left', x: -4, y: 4 });
  });

  it('keeps legacy image rows oriented with image top at positive Y', () => {
    const legacy = { ...DEFAULTS, columns: 1, rows: 2, spacing: 4 };
    expect(buildSamplingPreview(new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]), legacy)).toEqual([
      { color: 'rgb(0, 0, 255)', path: 'M-1,0h2v2h-2Z' },
      { color: 'rgb(255, 0, 0)', path: 'M-1,-2h2v2h-2Z' },
    ]);
  });

  it('rejects stale sample counts rather than assigning colors to the wrong pins', () => {
    expect(() => buildSamplingPreview(pixels.subarray(0, 4), parameters)).toThrow(/match/);
  });

  it('keeps a 5,000-pin uniform preview in a single color path', () => {
    const large = { ...DEFAULTS, columns: 100, rows: 50 };
    const groups = buildSamplingPreview(new Uint8ClampedArray(5000 * 4).fill(255), large);
    expect(groups).toHaveLength(1);
    expect(groups[0].path.match(/M/g)).toHaveLength(5000);
  });
});
