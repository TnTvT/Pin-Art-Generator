import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../test/render';
import App from './App';
import type { Parameters } from '../features/pin-design/model';

vi.mock('../features/preview/ModelPreview', () => ({
  default: ({ parameters }: { parameters: Parameters }) => <div data-testid="preview-parameters">{parameters.columns} × {parameters.rows}</div>,
}));

describe('workspace parameter flow', () => {
  it('groups image mapping before parameters in the sidebar and puts units in the header', () => {
    renderWithProviders(<App />);
    const sidebar = screen.getByRole('complementary', { name: 'Design controls' });
    const imageMapping = within(sidebar).getByRole('region', { name: 'Image mapping' });
    const parameters = within(sidebar).getByRole('heading', { name: 'Parameters' });
    expect(imageMapping.compareDocumentPosition(parameters) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(screen.getByRole('banner')).getByText(/All dimensions in/)).toHaveTextContent('All dimensions in mm');
    expect(screen.queryByRole('heading', { name: 'Workspace' })).not.toBeInTheDocument();
  });

  it('collapses parameter groups independently and preserves edited values', async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />);
    const baseToggle = screen.getByRole('button', { name: /Base plate/ });
    const pinsToggle = screen.getByRole('button', { name: /Pin array/ });
    expect(baseToggle).toHaveAttribute('aria-expanded', 'true');
    expect(pinsToggle).toHaveAttribute('aria-expanded', 'true');
    await user.clear(screen.getByLabelText('Base width'));
    await user.type(screen.getByLabelText('Base width'), '150');
    await user.click(baseToggle);
    expect(baseToggle).toHaveAttribute('aria-expanded', 'false');
    expect(pinsToggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByRole('textbox', { name: 'Base width' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Columns')).toBeVisible();
    await user.click(pinsToggle);
    expect(pinsToggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(baseToggle);
    expect(screen.getByLabelText('Base width')).toHaveValue('150 mm');
    expect(pinsToggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(screen.getByRole('button', { name: 'Reset parameters' }));
    expect(screen.getByLabelText('Base width')).toHaveValue('120 mm');
  });

  it('updates metrics and the preview only for valid grid counts', async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />);
    const columns = screen.getByLabelText('Columns');
    await user.clear(columns);
    await user.type(columns, '10');
    expect(screen.getByTestId('preview-parameters')).toHaveTextContent('10 × 16');
    expect(within(screen.getByLabelText('Design measurements')).getByText('160')).toBeInTheDocument();
    await user.clear(columns);
    expect(screen.getByTestId('preview-parameters')).toHaveTextContent('10 × 16');
    await user.type(columns, '101');
    expect(screen.getByTestId('preview-parameters')).toHaveTextContent('10 × 16');
    expect(screen.getByText('Use a whole number from 1 to 100.')).toBeInTheDocument();
  });

  it('shows layout warnings and restores default parameters', async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />);
    const width = screen.getByLabelText('Base width');
    await user.clear(width);
    await user.type(width, '50');
    expect(screen.getByRole('alert')).toHaveTextContent('beyond the base');
    await user.click(screen.getByRole('button', { name: 'Reset parameters' }));
    expect(width).toHaveValue('120 mm');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByTestId('preview-parameters')).toHaveTextContent('20 × 16');
  });
});
