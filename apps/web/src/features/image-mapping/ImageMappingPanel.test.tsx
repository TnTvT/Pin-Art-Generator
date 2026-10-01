import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/render';
import ImageMappingPanel from './ImageMappingPanel';
import type { SourceImage } from './image-mapping';

function panelProps(source: SourceImage | null = null) {
  return {
    source,
    loading: false,
    error: null,
    minimum: 2,
    maximum: 20,
    inverted: false,
    heightMap: null,
    onUpload: vi.fn().mockResolvedValue(undefined),
    onRemove: vi.fn(),
    onSample: vi.fn().mockResolvedValue(undefined),
    onMinimumChange: vi.fn(),
    onInvertChange: vi.fn(),
  };
}

const source = { name: 'photo.png', url: 'blob:photo', bitmap: {} as ImageBitmap };

describe('image mapping controls', () => {
  it('allows choosing the same file twice through the actual file input', async () => {
    const props = panelProps();
    const user = userEvent.setup();
    const { container } = renderWithProviders(<ImageMappingPanel {...props} />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(['photo'], 'photo.png', { type: 'image/png' });
    await user.upload(input, file);
    await user.upload(input, file);
    expect(props.onUpload).toHaveBeenCalledTimes(2);
    expect(props.onUpload).toHaveBeenCalledWith(file);
  });

  it('keeps invalid minimum drafts local and only applies valid heights', async () => {
    const props = panelProps(source);
    const user = userEvent.setup();
    renderWithProviders(<ImageMappingPanel {...props} />);
    const input = screen.getByLabelText('Min extension');
    await user.clear(input);
    await user.type(input, '30');
    expect(screen.getByText('Enter a value above 0 and at most 20 mm.')).toBeInTheDocument();
    expect(props.onMinimumChange).not.toHaveBeenCalledWith(30);
    await user.clear(input);
    await user.type(input, '5');
    expect(props.onMinimumChange).toHaveBeenLastCalledWith(5);
  });

  it('routes inversion and removal controls to the mapping state', async () => {
    const props = panelProps(source);
    const user = userEvent.setup();
    renderWithProviders(<ImageMappingPanel {...props} />);
    await user.click(screen.getByRole('switch', { name: 'Invert mapping' }));
    expect(props.onInvertChange).toHaveBeenCalledWith(true);
    await user.click(screen.getByRole('button', { name: 'Remove image' }));
    expect(props.onRemove).toHaveBeenCalledOnce();
  });

  it('refreshes the minimum input when the parent clamps its value', () => {
    const props = panelProps(source);
    const { rerender } = renderWithProviders(<ImageMappingPanel {...props} minimum={5} />);
    rerender(<ImageMappingPanel {...props} minimum={3} maximum={3} />);
    expect(screen.getByLabelText('Min extension')).toHaveValue('3 mm');
  });
});
