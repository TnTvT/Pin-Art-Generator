import { describe, expect, it } from 'vitest';
import { DEFAULTS, getMetrics, getWarnings } from './model';

describe('pin grid measurements', () => {
  it('includes the outer pin diameter in the default footprint', () => {
    expect(getMetrics(DEFAULTS)).toEqual({ count: 320, width: 97, depth: 77, clearance: 3 });
  });

  it('gives a single pin a footprint equal to its diameter', () => {
    expect(getMetrics({ ...DEFAULTS, columns: 1, rows: 1 })).toEqual({ count: 1, width: 2, depth: 2, clearance: 3 });
  });

  it('supports the maximum 10,000-pin grid', () => {
    expect(getMetrics({ ...DEFAULTS, columns: 100, rows: 100 }).count).toBe(10000);
  });
});

describe('layout warnings', () => {
  it('accepts a grid that exactly fits the base with touching pins', () => {
    expect(getWarnings({ ...DEFAULTS, width: 4, depth: 4, columns: 2, rows: 2, spacing: 2 })).toEqual([]);
  });

  it.each([{ width: 96 }, { depth: 76 }])('warns when either footprint dimension exceeds the base: %o', (dimensions) => {
    expect(getWarnings({ ...DEFAULTS, ...dimensions })).toEqual([expect.stringContaining('beyond the base')]);
  });

  it('warns about overlapping pins while allowing a single pin', () => {
    expect(getWarnings({ ...DEFAULTS, spacing: 1 })).toEqual([expect.stringContaining('overlap')]);
    expect(getWarnings({ ...DEFAULTS, spacing: 1, columns: 1, rows: 1 })).toEqual([]);
  });

  it('reports overflow and overlap together', () => {
    expect(getWarnings({ ...DEFAULTS, width: 1, spacing: 1 })).toHaveLength(2);
  });
});
