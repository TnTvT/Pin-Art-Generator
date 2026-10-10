import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../test/render';
import App from './App';
import type { Parameters } from '../features/pin-design/model';

vi.mock('../features/preview/ModelPreview', () => ({
  default: ({ parameters }: { parameters: Parameters }) => <div data-testid="preview-parameters">{parameters.layout?.pins.length} pins</div>,
}));
vi.mock('../features/base-shape/shape-worker', async () => {
  const { generateLayout } = await import('../features/base-shape/layout');
  return { startShapeJob: vi.fn(request => ({ promise: Promise.resolve({ result: generateLayout(request.parameters, request.shape, request.image), elapsedMs: 1 }), cancel: vi.fn() })) };
});

describe('workspace shape flow', () => {
  it('keeps scrollable controls separate from the fixed preview and units in the header', () => {
    renderWithProviders(<App />);
    const sidebar = screen.getByRole('complementary', { name: 'Design controls' });
    expect(sidebar).toHaveAttribute('tabindex', '0');
    expect(within(sidebar).getByRole('region', { name: 'Print export' })).toBeInTheDocument();
    expect(sidebar).not.toContainElement(screen.getByTestId('preview-parameters'));
    expect(sidebar).not.toContainElement(screen.getByLabelText('Design measurements'));
    const image = within(sidebar).getByRole('region', { name: 'Image mapping' });
    expect(image.compareDocumentPosition(within(sidebar).getByRole('heading', { name: 'Parameters' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(screen.getByRole('banner')).getByText(/All dimensions in/).parentElement).toHaveTextContent('All dimensions in mm');
    expect(screen.queryByText('MVP')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Rows')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Columns')).not.toBeInTheDocument();
  });

  it('preserves numeric drafts and independently collapsed groups across themes', async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Download STL' })).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Pin spacing'), { target: { value: '10' } });
    await waitFor(() => expect(screen.getByTestId('preview-parameters')).toHaveTextContent('99 pins'));
    await user.clear(screen.getByLabelText('Pin size'));
    const baseToggle = screen.getByRole('button', { name: /Base plate/ });
    await user.click(baseToggle);
    await user.click(screen.getByRole('button', { name: 'Switch to dark mode' }));
    expect(baseToggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: /Pin array/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Pin spacing')).toHaveValue('10 mm');
    expect(screen.getByLabelText('Pin size')).toHaveValue('');
    expect(screen.getByTestId('preview-parameters')).toHaveTextContent('99 pins');
  });

  it('applies valid positions and preserves last valid geometry for incomplete or invalid settings', async () => {
    renderWithProviders(<App />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Download STL' })).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Pin spacing'), { target: { value: '10' } });
    await waitFor(() => expect(screen.getByTestId('preview-parameters')).toHaveTextContent('99 pins'));
    fireEvent.change(screen.getByLabelText('Pin spacing'), { target: { value: '' } });
    expect(screen.getByTestId('preview-parameters')).toHaveTextContent('99 pins');
    fireEvent.change(screen.getByLabelText('Base width'), { target: { value: '1' } });
    await waitFor(() => expect(screen.getByText(/Export blocked:.*No pins fit/)).toBeInTheDocument());
    expect(screen.getByTestId('preview-parameters')).toHaveTextContent('99 pins');
  });

  it('automatically regenerates smaller bases, restores defaults, and retains collapse state', async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />);
    fireEvent.change(screen.getByLabelText('Base width'), { target: { value: '50' } });
    await waitFor(() => expect(screen.getByTestId('preview-parameters')).toHaveTextContent('207 pins'));
    const pinsToggle = screen.getByRole('button', { name: /Pin array/ });
    await user.click(pinsToggle);
    await user.click(screen.getByRole('button', { name: 'Reset parameters' }));
    await waitFor(() => expect(screen.getByTestId('preview-parameters')).toHaveTextContent('621 pins'));
    expect(screen.getByLabelText('Base width')).toHaveValue('120 mm');
    expect(pinsToggle).toHaveAttribute('aria-expanded', 'false');
  });
});
