import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/render';
import { DEFAULTS, DEFAULT_MODEL_COLORS } from '../pin-design/model';
import ModelPreview from './ModelPreview';
import { createPreview } from './preview';
import ThemeToggle from '../../app/ThemeToggle';

vi.mock('./preview', () => ({ createPreview: vi.fn() }));

const update = vi.fn();
const setView = vi.fn();
const setColorScheme = vi.fn();
const setModelColors = vi.fn();
const dispose = vi.fn();

beforeEach(() => {
  vi.mocked(createPreview).mockReset().mockReturnValue({ update, setView, setColorScheme, setModelColors, setPinColors: vi.fn(), setEditing: vi.fn(), setTransparentBase: vi.fn(), dispose });
});

describe('preview integration', () => {
  it('counts complete design RGB colors including the base and updates after edits', () => {
    const { rerender } = renderWithProviders(<ModelPreview parameters={DEFAULTS} colors={{ base: '#FFFFFF', pins: '#ffffff' }} pinColors={['#FFFFFF', '#ffffff']} />);
    expect(screen.getByLabelText('Design colors')).toHaveTextContent('1 color');
    rerender(<ModelPreview parameters={DEFAULTS} pinColors={['#00b1b7', '#e8afcf', '#00B1B7']} />);
    expect(screen.getByLabelText('Design colors')).toHaveTextContent('3 colors');
  });
  it('floats editing tools inside the viewport and reveals help only on demand', async () => {
    const user = userEvent.setup();
    const { container } = renderWithProviders(<ModelPreview parameters={DEFAULTS} toolbar={<button>Edit tools</button>} />);
    expect(container.querySelector('.preview-tools')).toContainElement(screen.getByRole('button', { name: 'Edit tools' }));
    expect(container.querySelector('.viewport')).toContainElement(screen.getByRole('button', { name: 'Edit tools' }));
    expect(container.querySelector('.canvas-container')).not.toContainElement(screen.getByRole('button', { name: 'Edit tools' }));
    expect(screen.queryByText(/actual guide holes/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Preview help' }));
    expect(screen.getByText(/actual guide holes/i)).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByText(/actual guide holes/i)).not.toBeInTheDocument();
  });
  it('retains the canvas and camera when the floating editor opens or closes', () => {
    const { container, rerender } = renderWithProviders(<ModelPreview parameters={DEFAULTS} toolbar={<div data-expanded="false">Tools</div>} />);
    const canvasContainer = container.querySelector('.canvas-container');
    rerender(<ModelPreview parameters={DEFAULTS} toolbar={<div data-expanded="true">Tools<input aria-label="Height editor" /></div>} />);
    expect(container.querySelector('.canvas-container')).toBe(canvasContainer);
    expect(container.querySelector('.viewport')).toContainElement(screen.getByLabelText('Height editor'));
    rerender(<ModelPreview parameters={DEFAULTS} toolbar={<div data-expanded="false">Tools</div>} />);
    expect(container.querySelector('.canvas-container')).toBe(canvasContainer);
    expect(createPreview).toHaveBeenCalledOnce();
    expect(setView).not.toHaveBeenCalled();
  });
  it('sets default or supplied printable colors without recreating the scene', () => {
    const { rerender } = renderWithProviders(<ModelPreview parameters={DEFAULTS} />);
    expect(setModelColors).toHaveBeenLastCalledWith(DEFAULT_MODEL_COLORS);
    const colors = { base: '#123456', pins: '#abcdef' };
    rerender(<ModelPreview parameters={DEFAULTS} colors={colors} />);
    expect(setModelColors).toHaveBeenLastCalledWith(colors);
    expect(createPreview).toHaveBeenCalledOnce();
    expect(screen.queryByText(/actual guide holes/i)).not.toBeInTheDocument();
  });

  it('updates the scene theme without recreating the preview or resetting the view', async () => {
    const user = userEvent.setup();
    renderWithProviders(<><ThemeToggle /><ModelPreview parameters={DEFAULTS} /></>);
    expect(setColorScheme).toHaveBeenLastCalledWith('light');
    await user.click(screen.getByRole('button', { name: 'Switch to dark mode' }));
    expect(setColorScheme).toHaveBeenLastCalledWith('dark');
    expect(createPreview).toHaveBeenCalledOnce();
    expect(setView).not.toHaveBeenCalled();
    expect(dispose).not.toHaveBeenCalled();
  });

  it('passes parameter and height changes to the scene and cleans it up on unmount', () => {
    const { rerender, unmount } = renderWithProviders(<ModelPreview parameters={DEFAULTS} />);
    expect(update).toHaveBeenLastCalledWith(DEFAULTS, undefined, undefined);
    const heights = new Float32Array([2, 10]);
    const parameters = { ...DEFAULTS, columns: 2, rows: 1 };
    rerender(<ModelPreview parameters={parameters} heights={heights} />);
    expect(update).toHaveBeenLastCalledWith(parameters, heights, undefined);
    expect(screen.getByText('Image-mapped heights')).toBeInTheDocument();
    unmount();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('connects the view buttons to scene camera actions', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ModelPreview parameters={DEFAULTS} />);
    await user.click(screen.getByRole('button', { name: 'Top view' }));
    await user.click(screen.getByRole('button', { name: 'Fit model' }));
    await user.click(screen.getByRole('button', { name: 'Reset view' }));
    expect(setView.mock.calls.map(([action]) => action)).toEqual(['top', 'fit', 'reset']);
  });

  it('shows an actionable error and disables camera controls when WebGL fails', () => {
    vi.mocked(createPreview).mockImplementation(() => { throw new Error('WebGL unavailable'); });
    renderWithProviders(<ModelPreview parameters={DEFAULTS} />);
    expect(screen.getByRole('alert')).toHaveTextContent('3D preview unavailable');
    expect(screen.getByRole('button', { name: 'Fit model' })).toBeDisabled();
    expect(screen.queryByText('Z ↑')).not.toBeInTheDocument();
  });
});
