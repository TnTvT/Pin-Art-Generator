import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/render';
import ImageMappingPanel from './ImageMappingPanel';
import type { SourceImage } from './image-mapping';
import { DEFAULT_COLOR_MAPPING } from './color-mapping';

function panelProps(source: SourceImage | null = null) {
  return {
    source,
    loading: false,
    error: null,
    minimum: 2,
    maximum: 20,
    inverted: false,
    heightMap: null,
    mode: 'height' as const,
    options: DEFAULT_COLOR_MAPPING,
    colors: null,
    processing: false,
    resolvedMaterialsCount: 2,
    elapsedMs: null,
    onModeChange: vi.fn(),
    onOptionsChange: vi.fn(),
    onRetry: vi.fn(),
    onUpload: vi.fn().mockResolvedValue(undefined),
    onRemove: vi.fn(),
    onSample: vi.fn().mockResolvedValue(undefined),
    onHeightRangeChange: vi.fn(),
    onInvertChange: vi.fn(),
  };
}

const source = { name: 'photo.png', url: 'blob:photo', bitmap: {} as ImageBitmap };

describe('image mapping controls', () => {
  it('offers three modes and shows palette controls instead of height controls in Color mode', async () => {
    const props = panelProps(source);
    const user = userEvent.setup();
    const { rerender } = renderWithProviders(<ImageMappingPanel {...props} />);
    await user.click(screen.getByText('Height + Color', { exact: true }));
    expect(props.onModeChange).toHaveBeenCalledWith('height-color');
    rerender(<ImageMappingPanel {...props} mode="color" />);
    expect(screen.queryByRole('slider', { name: 'Minimum mapped height' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Min height')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Max pin materials')).toHaveValue('4');
    await user.click(screen.getByText('My filaments', { exact: true }));
    expect(props.onOptionsChange).toHaveBeenCalledWith({ ...DEFAULT_COLOR_MAPPING, source: 'manual' });
  });

  it('keeps invalid maximum drafts local and explains processing, final materials and errors', async () => {
    const props = panelProps(source);
    const user = userEvent.setup();
    const { rerender } = renderWithProviders(<ImageMappingPanel {...props} mode="color" processing />);
    expect(screen.getByRole('status')).toHaveTextContent('Updating mapping');
    const input = screen.getByLabelText('Max pin materials');
    await user.clear(input);
    expect(props.onOptionsChange).not.toHaveBeenCalled();
    expect(screen.getByText('Enter an integer from 1 to 16.')).toBeInTheDocument();
    rerender(<ImageMappingPanel {...props} mode="color" error="Choose at least one filament." />);
    await user.click(screen.getByRole('button', { name: 'Retry mapping' }));
    expect(props.onRetry).toHaveBeenCalledOnce();
    expect(screen.getByText(/Final design: 2 materials/)).toBeInTheDocument();
  });
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
    const input = screen.getByLabelText('Min height');
    await user.clear(input);
    await user.type(input, '30');
    expect(props.onHeightRangeChange).not.toHaveBeenCalledWith([30, 20]);
    await user.clear(input);
    await user.type(input, '5');
    expect(props.onHeightRangeChange).toHaveBeenLastCalledWith([5, 20]);
  });

  it('controls both height bounds from one labeled range slider', () => {
    const props = panelProps(source);
    const { rerender } = renderWithProviders(<ImageMappingPanel {...props} />);
    const lower = screen.getByRole('slider', { name: 'Minimum mapped height' });
    const upper = screen.getByRole('slider', { name: 'Maximum mapped height' });
    expect(lower).toHaveAttribute('aria-valuenow', '2');
    expect(upper).toHaveAttribute('aria-valuenow', '20');
    fireEvent.focus(lower);
    fireEvent.keyDown(lower, { key: 'ArrowRight' });
    expect(props.onHeightRangeChange).toHaveBeenLastCalledWith([2.1, 20]);
    rerender(<ImageMappingPanel {...props} minimum={2.1} />);
    fireEvent.focus(upper);
    fireEvent.keyDown(upper, { key: 'ArrowRight' });
    expect(props.onHeightRangeChange).toHaveBeenLastCalledWith([2.1, 20.1]);
    expect(screen.queryByText('Adjust in Pin array')).not.toBeInTheDocument();
  });

  it('keeps incomplete ranges local and accepts equal or larger precise heights', () => {
    const props = panelProps(source);
    const { rerender } = renderWithProviders(<ImageMappingPanel {...props} />);
    fireEvent.change(screen.getByLabelText('Max height'), { target: { value: '' } });
    expect(props.onHeightRangeChange).not.toHaveBeenCalled();
    expect(screen.getByRole('slider', { name: 'Maximum mapped height' })).toHaveAttribute('aria-valuenow', '20');
    fireEvent.change(screen.getByLabelText('Min height'), { target: { value: '30' } });
    expect(props.onHeightRangeChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Max height'), { target: { value: '30' } });
    expect(props.onHeightRangeChange).toHaveBeenLastCalledWith([30, 30]);
    rerender(<ImageMappingPanel {...props} minimum={30} maximum={30} />);
    fireEvent.change(screen.getByLabelText('Max height'), { target: { value: '100.25' } });
    expect(props.onHeightRangeChange).toHaveBeenLastCalledWith([30, 100.25]);
    rerender(<ImageMappingPanel {...props} minimum={30} maximum={100.25} />);
    expect(screen.getByRole('slider', { name: 'Maximum mapped height' })).toHaveAttribute('aria-valuenow', '100.25');
    expect(screen.getByRole('slider', { name: 'Maximum mapped height' })).toHaveAttribute('aria-valuemax', '100.25');
    rerender(<ImageMappingPanel {...props} minimum={30} maximum={90} />);
    expect(screen.getByRole('slider', { name: 'Maximum mapped height' })).toHaveAttribute('aria-valuenow', '90');
    expect(screen.getByRole('slider', { name: 'Maximum mapped height' })).toHaveAttribute('aria-valuemax', '100.25');
  });

  it('replaces invalid drafts when a height thumb is moved', () => {
    const props = panelProps(source);
    renderWithProviders(<ImageMappingPanel {...props} mode="height-color" />);
    fireEvent.change(screen.getByLabelText('Min height'), { target: { value: '30' } });
    const upper = screen.getByRole('slider', { name: 'Maximum mapped height' });
    fireEvent.focus(upper);
    fireEvent.keyDown(upper, { key: 'ArrowLeft' });
    expect(props.onHeightRangeChange).toHaveBeenLastCalledWith([2, 19.9]);
    expect(screen.getByLabelText('Min height')).toHaveValue('2 mm');
    expect(screen.getByLabelText('Max height')).toHaveValue('19.9 mm');
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
    expect(screen.getByLabelText('Min height')).toHaveValue('3 mm');
    expect(screen.getByLabelText('Max height')).toHaveValue('3 mm');
    expect(screen.getByRole('slider', { name: 'Minimum mapped height' })).toHaveAttribute('aria-valuenow', '3');
  });
});
