import { useState } from 'react';
import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULTS, type Parameters } from '../pin-design/model';
import PinShapeControls from './PinShapeControls';
import { DEFAULT_CONSTRUCTION } from '../mechanics/model';

describe('pin shape controls', () => {
  it('hides Triangle in print-in-place without silently replacing an existing choice', () => {
    const changed = vi.fn();
    const parameters = { ...DEFAULTS, pinShape: 'triangle' as const, construction: { ...DEFAULT_CONSTRUCTION, mode: 'print-in-place' as const } };
    render(<MantineProvider><PinShapeControls parameters={parameters} onChange={changed} /></MantineProvider>);
    expect(screen.queryByRole('radio', { name: 'Triangle' })).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Round' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Square' })).not.toBeChecked();
    expect(changed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Round'));
    expect(changed).toHaveBeenCalledExactlyOnceWith({ pinShape: 'round' });
  });
  it('retains rotation when switching to round and ignores incomplete or invalid drafts', () => {
    const changed = vi.fn();
    function Fixture() {
      const [parameters, setParameters] = useState<Parameters>({ ...DEFAULTS, pinShape: 'square', pinRotation: 30 });
      return <PinShapeControls parameters={parameters} onChange={value => { changed(value); setParameters(current => ({ ...current, ...value })); }} />;
    }
    render(<MantineProvider><Fixture /></MantineProvider>);
    const input = screen.getByRole('textbox', { name: 'Pin rotation' });
    fireEvent.change(input, { target: { value: '' } });
    expect(changed).not.toHaveBeenCalled();
    expect(screen.getByText('Using last valid rotation: 30°.')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: '361' } });
    expect(changed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Round'));
    expect(screen.queryByRole('textbox', { name: 'Pin rotation' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Triangle'));
    expect(screen.getByRole('textbox', { name: 'Pin rotation' })).toHaveValue('30°');
    fireEvent.change(screen.getByRole('textbox', { name: 'Pin rotation' }), { target: { value: '0' } });
    expect(changed).toHaveBeenLastCalledWith({ pinRotation: 0 });
    fireEvent.change(screen.getByRole('textbox', { name: 'Pin rotation' }), { target: { value: '360' } });
    expect(changed).toHaveBeenLastCalledWith({ pinRotation: 360 });
    expect(screen.getByRole('textbox', { name: 'Pin rotation' })).toHaveValue('360°');
  });
});
