import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../test/render';
import InfoPopover from './InfoPopover';

describe('on-demand help', () => {
  it('opens with the keyboard, closes with Escape, and returns focus', async () => {
    const user = userEvent.setup();
    renderWithProviders(<InfoPopover label="Tool help"><p>How the tool works.</p></InfoPopover>);
    expect(screen.queryByText('How the tool works.')).not.toBeInTheDocument();
    await user.tab();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog', { name: 'Tool help' })).toHaveTextContent('How the tool works.');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tool help' })).toHaveFocus();
  });
  it('closes on an outside click', async () => {
    const user = userEvent.setup();
    renderWithProviders(<><InfoPopover label="Tool help"><p>How the tool works.</p></InfoPopover><button>Outside</button></>);
    await user.click(screen.getByRole('button', { name: 'Tool help' }));
    await user.click(screen.getByRole('button', { name: 'Outside' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
