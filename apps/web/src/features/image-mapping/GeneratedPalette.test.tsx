import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/render';
import { DEFAULT_MODEL_MATERIALS } from '../filaments/materials';
import type { ColorMappingResult } from './color-mapping';
import GeneratedPalette from './GeneratedPalette';

const white = { color: '#ffffff', filamentId: 'basic-77' };
const colors: ColorMappingResult = {
  materials: [white, DEFAULT_MODEL_MATERIALS.pins, white],
  palette: [{ material: white, count: 2 }, { material: DEFAULT_MODEL_MATERIALS.pins, count: 1 }],
  notice: null,
};

describe('generated palette group editing', () => {
  it('replaces a generated group with a chosen preset and displays its current material without merging groups', async () => {
    const user = userEvent.setup();
    const onReplace = vi.fn();
    const { rerender } = renderWithProviders(<GeneratedPalette colors={colors} onReplace={onReplace} />);
    await user.click(screen.getByRole('button', { name: 'Edit Jade White Basic group' }));
    expect(screen.getByRole('dialog', { name: 'Change group material' })).toHaveTextContent('2 pins');
    await user.click(screen.getByRole('combobox', { name: 'Group filament' }));
    await user.click(screen.getByRole('option', { name: 'Turquoise (10605)' }));
    await user.click(screen.getByRole('button', { name: 'Apply to group' }));
    expect(onReplace).toHaveBeenCalledWith(white, DEFAULT_MODEL_MATERIALS.pins);
    rerender(<GeneratedPalette colors={colors} resolvedMaterials={Array(3).fill(DEFAULT_MODEL_MATERIALS.pins)} onReplace={onReplace} />);
    expect(screen.getByRole('button', { name: 'Apply to group' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('button', { name: 'Edit Jade White Basic group' })).toHaveTextContent('→ Turquoise');
    expect(screen.getByRole('button', { name: 'Edit Turquoise Basic group' })).toHaveTextContent('1 pin');
    await user.click(screen.getByRole('button', { name: 'Edit Jade White Basic group' }));
    expect(screen.getByRole('combobox', { name: 'Group filament' })).toHaveValue('Turquoise (10605)');
  });
  it('supports custom group colors, mixed actual materials, cancellation and generation blockers', async () => {
    const user = userEvent.setup();
    const onReplace = vi.fn();
    const props = { colors, resolvedMaterials: [white, DEFAULT_MODEL_MATERIALS.pins, DEFAULT_MODEL_MATERIALS.base], onReplace };
    const { rerender } = renderWithProviders(<GeneratedPalette {...props} />);
    expect(screen.getByRole('button', { name: 'Edit Jade White Basic group' })).toHaveTextContent('→ Mixed');
    await user.click(screen.getByRole('button', { name: 'Edit Jade White Basic group' }));
    await user.click(screen.getByRole('combobox', { name: 'Group filament' }));
    await user.click(screen.getByRole('option', { name: 'Custom color' }));
    fireEvent.change(screen.getByLabelText('Group color'), { target: { value: '#123456' } });
    rerender(<GeneratedPalette {...props} disabled />);
    expect(screen.getByRole('button', { name: 'Apply to group' })).toBeDisabled();
    rerender(<GeneratedPalette {...props} error="Use at most 16 materials including the base." />);
    expect(screen.getByText(/Use at most 16/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Apply to group' }));
    expect(onReplace).toHaveBeenCalledWith(white, { color: '#123456', filamentId: null });
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit Jade White Basic group' })).toHaveFocus());
    await user.click(screen.getByRole('button', { name: 'Edit Jade White Basic group' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onReplace).toHaveBeenCalledTimes(1);
  });
  it('invalidates an open group dialog when a new mapping replaces the generated groups', async () => {
    const user = userEvent.setup();
    const onReplace = vi.fn();
    const { rerender } = renderWithProviders(<GeneratedPalette colors={colors} onReplace={onReplace} />);
    await user.click(screen.getByRole('button', { name: 'Edit Jade White Basic group' }));
    await act(async () => rerender(<GeneratedPalette colors={{ ...colors }} onReplace={onReplace} />));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onReplace).not.toHaveBeenCalled();
  });
});
