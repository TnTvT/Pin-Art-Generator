import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/render';
import { DEFAULTS } from '../pin-design/model';
import ModelPreview from './ModelPreview';
import { createPreview } from './preview';

vi.mock('./preview', () => ({ createPreview: vi.fn() }));

const update = vi.fn();
const setView = vi.fn();
const dispose = vi.fn();

beforeEach(() => {
  vi.mocked(createPreview).mockReset().mockReturnValue({ update, setView, dispose });
});

describe('preview integration', () => {
  it('passes parameter and height changes to the scene and cleans it up on unmount', () => {
    const { rerender, unmount } = renderWithProviders(<ModelPreview parameters={DEFAULTS} />);
    expect(update).toHaveBeenLastCalledWith(DEFAULTS, undefined);
    const heights = new Float32Array([2, 10]);
    const parameters = { ...DEFAULTS, columns: 2, rows: 1 };
    rerender(<ModelPreview parameters={parameters} heights={heights} />);
    expect(update).toHaveBeenLastCalledWith(parameters, heights);
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
  });
});
