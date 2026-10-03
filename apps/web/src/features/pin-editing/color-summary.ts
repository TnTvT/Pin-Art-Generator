import type { MaterialSelection } from '../filaments/materials';

export function summarizeColors(base: MaterialSelection, pins: readonly MaterialSelection[], selection: ReadonlySet<number>) {
  const design = new Set([base.color.toLowerCase()]);
  const selected = new Set<string>();
  pins.forEach((pin, index) => {
    const color = pin.color.toLowerCase();
    design.add(color);
    if (selection.has(index)) selected.add(color);
  });
  return { design: [...design], selected: [...selected] };
}
