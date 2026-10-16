import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/render';
import ConstructionControls from './ConstructionControls';
import { DEFAULT_CONSTRUCTION } from './model';

describe('construction controls', () => {
  it('offers an explicit spacing recovery action without changing parameters on render', async () => {
    const user = userEvent.setup(), onChange = vi.fn(), apply = vi.fn();
    renderWithProviders(<ConstructionControls value={{ ...DEFAULT_CONSTRUCTION, mode: 'print-in-place' }} disabled={false} onChange={onChange} suggestedSpacing={4.5} onUseSuggestedSpacing={apply} />);
    expect(screen.getByText(/last valid preview/i)).toBeInTheDocument();
    expect(apply).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Use 4.5 mm spacing' }));
    expect(apply).toHaveBeenCalledExactlyOnceWith(4.5);
  });
  it('blocks switching designs with Triangle pins to print-in-place without changing them', () => {
    const onChange = vi.fn();
    renderWithProviders(<ConstructionControls value={DEFAULT_CONSTRUCTION} disabled={false} hasTrianglePins onChange={onChange} />);
    expect(screen.getByRole('radio', { name: 'Print-in-place' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Fixed sculpture' })).toBeChecked();
    expect(screen.getByText(/Change Triangle pins to Round or Square/)).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
  it('edits surface gap and angle without changing shaft clearance or head width', async () => {
    const user = userEvent.setup(), onChange = vi.fn();
    const value = { ...DEFAULT_CONSTRUCTION, mode: 'print-in-place' as const };
    renderWithProviders(<ConstructionControls value={value} disabled={false} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Advanced settings' }));
    expect(screen.getByLabelText('Sliding clearance')).toHaveValue('0.6 mm');
    expect(screen.getByLabelText('Head flare')).toHaveValue('0.7 mm');
    const gap = screen.getByLabelText('Lower head surface gap');
    expect(gap).toHaveValue('0.3 mm');
    const angle = screen.getByLabelText('Lower taper angle (°)');
    expect(angle).toHaveValue('45');
    fireEvent.change(angle, { target: { value: '60' } });
    expect(onChange).toHaveBeenLastCalledWith({ ...value, sliding: { ...value.sliding, lowerHeadAngle: 60 } });
    fireEvent.change(gap, { target: { value: '0.2' } });
    expect(onChange).toHaveBeenLastCalledWith({ ...value, sliding: { ...value.sliding, lowerHeadGap: 0.2 } });
    onChange.mockClear();
    fireEvent.change(gap, { target: { value: '' } });
    expect(onChange).not.toHaveBeenCalled();
  });
});
