import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/render';
import ParameterField from './ParameterField';

describe('parameter field', () => {
  it('forwards numeric edits with the parameter name', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<ParameterField name="columns" label="Columns" value="" validValue={20} integer onChange={onChange} />);
    await user.type(screen.getByLabelText('Columns'), '4');
    expect(onChange).toHaveBeenLastCalledWith('columns', 4);
  });

  it('explains invalid count and dimension drafts', () => {
    const onChange = vi.fn();
    const { rerender } = renderWithProviders(<ParameterField name="columns" label="Columns" value={101} validValue={20} integer onChange={onChange} />);
    expect(screen.getByText('Use a whole number from 1 to 100.')).toBeInTheDocument();
    rerender(<ParameterField name="diameter" label="Pin diameter" value="" validValue={2} onChange={onChange} />);
    expect(screen.getByText('Enter a positive number.')).toBeInTheDocument();
  });

  it('allows keyboard adjustments through the linked slider', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<ParameterField name="spacing" label="Pin spacing" value={5} validValue={5} sliderMax={20} onChange={onChange} />);
    screen.getByRole('slider').focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('spacing', 5.1);
  });
});
