import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/render';
import ShapeNumberField from './ShapeNumberField';

describe('shape numeric drafts', () => {
  it('allows zero and retains incomplete or invalid drafts without changing valid geometry', () => {
    const change = vi.fn();
    renderWithProviders(<ShapeNumberField label="Tolerance" value={10} maximum={50} millimeters={false} onChange={change} />);
    const field = screen.getByLabelText('Tolerance');
    fireEvent.change(field, { target: { value: '' } });
    expect(field).toHaveValue('');
    expect(change).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: '51' } });
    expect(screen.getByText('Enter a number from 0 to 50.')).toBeInTheDocument();
    expect(change).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: '0' } });
    expect(change).toHaveBeenCalledWith(0);
  });
});
