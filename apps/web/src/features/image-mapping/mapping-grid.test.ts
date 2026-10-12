import { describe, expect, it } from 'vitest';
import { DEFAULTS } from '../pin-design/model';
import { getMappingGrid } from './mapping-grid';

const parameters = { ...DEFAULTS, diameter: 2, spacing: 5, layout: { regions: [], edgePadding: 5,
  pins: [{ id: 'left', x: -5, y: 5 }, { id: 'right', x: 0, y: 5 }, { id: 'bottom', x: 0, y: -5 }] } };

describe('compact pin-top mapping grid', () => {
  it('removes physical gaps without changing IDs, order or physical positions', () => {
    const grid = getMappingGrid(parameters);
    expect(grid.cellSize).toBe(2);
    expect(grid.width).toBe(4);
    expect(grid.depth).toBe(6);
    expect(grid.pins).toEqual([{ id: 'left', x: -1, y: 2 }, { id: 'right', x: 1, y: 2 }, { id: 'bottom', x: 1, y: -2 }]);
    expect(parameters.layout.pins[0]).toEqual({ id: 'left', x: -5, y: 5 });
  });

  it('keeps an unchanged lattice invariant to physical spacing and base padding', () => {
    const wider = { ...parameters, width: 240, spacing: 10, layout: { ...parameters.layout, edgePadding: 20,
      pins: parameters.layout.pins.map(pin => ({ ...pin, x: pin.x * 2, y: pin.y * 2 })) } };
    expect(getMappingGrid(wider).pins).toEqual(getMappingGrid(parameters).pins);
    expect(getMappingGrid(wider).width).toBe(4);
  });

  it('keeps missing lattice positions blank instead of shifting later pins', () => {
    expect(getMappingGrid(parameters).pins.filter(pin => pin.y === 0)).toHaveLength(0);
  });

  it('uses the head envelope in print-in-place mode and supports legacy grids and single pins', () => {
    const movable = { ...parameters, construction: { mode: 'print-in-place' as const, sliding: { clearance: .4, headFlare: .6 } } };
    expect(getMappingGrid(movable).cellSize).toBe(3.2);
    const legacy = getMappingGrid({ ...DEFAULTS, columns: 2, rows: 3, spacing: 7, diameter: 2 });
    expect([legacy.width, legacy.depth]).toEqual([4, 6]);
    const single = getMappingGrid({ ...parameters, layout: { ...parameters.layout, pins: [{ id: 'one', x: 15, y: -10 }] } });
    expect(single.pins).toEqual([{ id: 'one', x: 0, y: 0 }]);
    expect([single.width, single.depth]).toEqual([2, 2]);
  });
});
