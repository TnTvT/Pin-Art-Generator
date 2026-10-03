import { describe, expect, it } from 'vitest';
import { summarizeColors } from './color-summary';

describe('printable color counts', () => {
  const base = { color: '#FFFFFF', filamentId: 'basic-77' };
  const pins = [base, { color: '#ffffff', filamentId: 'matte-321' }, { color: '#00b1b7', filamentId: 'basic-903' }];
  it('counts RGB colors, not filament slots, and includes the base in the design total', () => {
    expect(summarizeColors(base, pins, new Set([0, 1]))).toEqual({ design: ['#ffffff', '#00b1b7'], selected: ['#ffffff'] });
  });
  it('handles empty selection and a color used only by the base', () => {
    expect(summarizeColors({ color: '#8e9089', filamentId: 'basic-128' }, pins, new Set())).toEqual({ design: ['#8e9089', '#ffffff', '#00b1b7'], selected: [] });
  });
});
