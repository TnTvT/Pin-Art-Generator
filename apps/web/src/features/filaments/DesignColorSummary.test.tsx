import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../test/render';
import { DEFAULT_MODEL_MATERIALS } from './materials';
import DesignColorSummary from './DesignColorSummary';

describe('design color details', () => {
  it('shows preset name, code, RGB, material and usage on hover', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DesignColorSummary selections={[DEFAULT_MODEL_MATERIALS.base, DEFAULT_MODEL_MATERIALS.pins, DEFAULT_MODEL_MATERIALS.pins]} />);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    await user.hover(screen.getByRole('button', { name: '#00B1B7 color details' }));
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('Turquoise (10605)');
    expect(tooltip).toHaveTextContent('Bambu Lab · PLA Basic');
    expect(tooltip).toHaveTextContent('#00B1B7');
    expect(tooltip).toHaveTextContent('RGB 0, 177, 183');
    expect(tooltip).toHaveTextContent('2 pins');
    await user.unhover(screen.getByRole('button', { name: '#00B1B7 color details' }));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
  it('keeps one swatch for identical RGB while showing every used filament identity', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DesignColorSummary selections={[
      { color: '#FFFFFF', filamentId: 'basic-10100' },
      { color: '#ffffff', filamentId: 'matte-11100' },
      { color: '#ffffff', filamentId: 'matte-11100' },
      { color: '#ffffff', filamentId: null },
    ]} />);
    expect(screen.getByLabelText('Design colors')).toHaveTextContent('1 color');
    expect(within(screen.getByLabelText('Design colors')).getAllByRole('button')).toHaveLength(1);
    await user.tab();
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('Jade White (10100)');
    expect(tooltip).toHaveTextContent('Ivory White (11100)');
    expect(tooltip).toHaveTextContent('Bambu Lab · PLA Basic');
    expect(tooltip).toHaveTextContent('Bambu Lab · PLA Matte');
    expect(tooltip).toHaveTextContent('Custom color');
    expect(tooltip).toHaveTextContent('Generic PLA');
    expect(tooltip).toHaveTextContent('Base · 3 pins');
    expect(within(tooltip).getAllByText('Ivory White (11100)')).toHaveLength(1);
  });
  it('does not infer a preset from RGB and updates details when the design changes', async () => {
    const user = userEvent.setup();
    const { rerender } = renderWithProviders(<DesignColorSummary selections={[{ color: '#00b1b7', filamentId: null }]} />);
    await user.tab();
    expect(screen.getByRole('tooltip')).toHaveTextContent('Custom color');
    expect(screen.getByRole('tooltip')).not.toHaveTextContent('Turquoise');
    rerender(<DesignColorSummary selections={[DEFAULT_MODEL_MATERIALS.pins]} />);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Turquoise (10605)');
    expect(screen.getByRole('tooltip')).not.toHaveTextContent('Custom color');
    rerender(<DesignColorSummary selections={[DEFAULT_MODEL_MATERIALS.base]} />);
    expect(screen.queryByRole('button', { name: '#00B1B7 color details' })).not.toBeInTheDocument();
  });
});
