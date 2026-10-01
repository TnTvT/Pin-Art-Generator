import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../test/render';
import ThemeToggle from './ThemeToggle';

describe('theme preference', () => {
  it('defaults to light and supports switching both ways with the keyboard', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ThemeToggle />);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Switch to dark mode' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(document.documentElement).toHaveAttribute('data-mantine-color-scheme', 'dark');
    expect(screen.getByRole('button', { name: 'Switch to light mode' })).toBeVisible();
    await user.keyboard('{Enter}');
    expect(document.documentElement).toHaveAttribute('data-mantine-color-scheme', 'light');
  });

  it('remembers the selected theme when the provider remounts', async () => {
    const user = userEvent.setup();
    const { unmount } = renderWithProviders(<ThemeToggle />);
    await user.click(screen.getByRole('button', { name: 'Switch to dark mode' }));
    unmount();
    renderWithProviders(<ThemeToggle />);
    expect(document.documentElement).toHaveAttribute('data-mantine-color-scheme', 'dark');
    await user.click(screen.getByRole('button', { name: 'Switch to light mode' }));
    expect(document.documentElement).toHaveAttribute('data-mantine-color-scheme', 'light');
  });
});
