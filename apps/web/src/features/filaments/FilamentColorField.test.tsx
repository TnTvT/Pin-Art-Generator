import { useState } from 'react';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/render';
import FilamentColorField from './FilamentColorField';
import { type MaterialSelection } from './materials';

function Field({ disabled = false }: { disabled?: boolean }) {
  const [value, setValue] = useState<MaterialSelection>({ color: '#5b6b78', filamentId: null });
  return <><FilamentColorField label="Base color" value={value} onChange={setValue} disabled={disabled} /><output aria-label="Resolved color">{value.color}</output><output aria-label="Filament identity">{value.filamentId || 'custom'}</output></>;
}

describe('filament color selection', () => {
  it('offers grouped filament presets before a custom fallback, retaining current colors', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Field />);
    expect(screen.getByLabelText('Base color')).toHaveValue('#5b6b78');
    await user.click(screen.getByRole('combobox', { name: 'Base filament' }));
    expect(screen.getByText('Bambu Lab · PLA Basic')).toBeInTheDocument();
    expect(screen.getByText('Bambu Lab · PLA Matte')).toBeInTheDocument();
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveTextContent('Bambu Green');
    expect(options.at(-1)).toHaveTextContent('Custom color');
    await user.click(screen.getByRole('option', { name: 'Sakura Pink (11201)' }));
    expect(screen.getByLabelText('Resolved color')).toHaveTextContent('#e8afcf');
    expect(screen.queryByLabelText('Base color')).not.toBeInTheDocument();
    expect(screen.getByText('RGB 232, 175, 207')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Source for Sakura Pink' })).toHaveAttribute('href', 'https://3dfilamentprofiles.com/filament/details/155');
  });

  it('searches by color and code and distinguishes identical hex colors', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Field />);
    const select = screen.getByRole('combobox', { name: 'Base filament' });
    await user.clear(select);
    await user.type(select, '10600');
    await user.click(screen.getByRole('option', { name: 'Blue (10600)' }));
    expect(select).toHaveValue('Blue (10600)');
    expect(screen.getByLabelText('Resolved color')).toHaveTextContent('#0a2989');
    await user.clear(select);
    await user.type(select, '10601');
    await user.click(screen.getByRole('option', { name: 'Blue (10601)' }));
    expect(select).toHaveValue('Blue (10601)');
  });

  it('supports custom palette editing and keeps the last valid color for incomplete drafts', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Field />);
    const input = screen.getByLabelText('Base color');
    fireEvent.change(input, { target: { value: '#abcdef' } });
    fireEvent.change(input, { target: { value: '#ab' } });
    expect(screen.getByLabelText('Resolved color')).toHaveTextContent('#abcdef');
    expect(screen.getByText(/Using last valid color: #abcdef/)).toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: 'Base filament' }));
    await user.click(screen.getByRole('option', { name: 'Bambu Green (10501)' }));
    await user.click(screen.getByRole('combobox', { name: 'Base filament' }));
    await user.click(screen.getByRole('option', { name: 'Custom color' }));
    expect(screen.getByLabelText('Base color')).toHaveValue('#00ae42');
    await user.click(screen.getByLabelText('Base color'));
    expect(screen.getByRole('button', { name: '#ffffff' })).toBeInTheDocument();
  });

  it('locks both preset and custom controls while export is pending', () => {
    const onChange = vi.fn();
    renderWithProviders(<FilamentColorField label="Pin color" value={{ color: '#2dada3', filamentId: null }} onChange={onChange} disabled />);
    expect(screen.getByRole('combobox', { name: 'Pin filament' })).toBeDisabled();
    expect(screen.getByLabelText('Pin color')).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('retains externally owned identity across remounts and clears it when choosing custom without changing RGB', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const value = { color: '#ffffff', filamentId: 'basic-77' };
    const { unmount } = renderWithProviders(<FilamentColorField label="Base color" value={value} onChange={onChange} />);
    expect(screen.getByRole('combobox', { name: 'Base filament' })).toHaveValue('Jade White (10100)');
    unmount();
    renderWithProviders(<FilamentColorField label="Base color" value={value} onChange={onChange} />);
    expect(screen.getByRole('combobox', { name: 'Base filament' })).toHaveValue('Jade White (10100)');
    await user.click(screen.getByRole('combobox', { name: 'Base filament' }));
    await user.click(screen.getByRole('option', { name: 'Custom color' }));
    expect(onChange).toHaveBeenCalledWith({ color: '#ffffff', filamentId: null });
  });

  it('keeps custom colors available when search does not match any filament', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Field />);
    const select = screen.getByRole('combobox', { name: 'Base filament' });
    await user.clear(select);
    await user.type(select, 'not-in-the-catalog');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    await user.click(screen.getByRole('option', { name: 'Custom color' }));
    expect(screen.getByLabelText('Base color')).toHaveValue('#5b6b78');
    expect(screen.getByLabelText('Resolved color')).toHaveTextContent('#5b6b78');
  });
});
