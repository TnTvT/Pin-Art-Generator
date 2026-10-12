import { useState } from 'react';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/render';
import { DEFAULTS } from '../pin-design/model';
import { DEFAULT_SHAPE, generateLayout } from '../base-shape/layout';
import { DEFAULT_IMAGE_PLACEMENT, type ImagePlacement } from './image-placement';
import ImagePlacementDialog from './ImagePlacementDialog';

const source = { name: 'photo.png', url: 'blob:photo', bitmap: { width: 200, height: 100 } as ImageBitmap };
const parameters = { ...DEFAULTS, ...generateLayout(DEFAULTS, DEFAULT_SHAPE) };
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn(),
    getImageData: () => ({ data: new Uint8ClampedArray(source.bitmap.width * source.bitmap.height * 4).fill(255) }),
  } as unknown as CanvasRenderingContext2D);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function Harness({ initial = DEFAULT_IMAGE_PLACEMENT, onChange = vi.fn(), blocked = false }: { initial?: ImagePlacement; onChange?: (placement: ImagePlacement) => void; blocked?: boolean }) {
  const [placement, setPlacement] = useState(initial);
  return <ImagePlacementDialog opened source={source} parameters={parameters} placement={placement} blocked={blocked} processing={false} error={null}
    onClose={vi.fn()} onChange={next => { onChange(next); setPlacement(next); }} />;
}

describe('image adjustment dialog', () => {
  it('shows original and sampled panels together and toggles shapes without changing placement', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const props = { opened: true, source, parameters, placement: DEFAULT_IMAGE_PLACEMENT, blocked: false, processing: false, error: null, onChange, onClose: vi.fn() };
    const { rerender } = renderWithProviders(<ImagePlacementDialog {...props} sampling="smooth" />);
    expect(screen.getByRole('checkbox', { name: 'Show pin shapes' })).not.toBeChecked();
    expect(screen.queryByRole('checkbox', { name: 'Show mapped samples' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Original image' })).toContainElement(screen.getByRole('application'));
    expect(screen.getByRole('region', { name: 'Mapped samples' })).toContainElement(screen.getByRole('img', { name: 'Mapped pin samples' }));
    expect(document.querySelector('[data-overlay="pins"]')).not.toBeInTheDocument();
    expect(document.querySelector('[data-overlay="original-image"]')).toHaveAttribute('opacity', '1');
    expect(document.querySelector('[data-overlay="pixel-grid"]')).toBeInTheDocument();
    expect(document.querySelector('[data-overlay="samples"]')).toHaveAttribute('clip-path');
    expect(document.querySelector('[data-overlay="samples"] path')).toHaveAttribute('fill', 'rgb(255, 255, 255)');
    await user.click(screen.getByRole('checkbox', { name: 'Show pin shapes' }));
    const pinPath = document.querySelector('[data-overlay="pins"]')!.getAttribute('d');
    const imageX = document.querySelector('svg image')!.getAttribute('x');
    rerender(<ImagePlacementDialog {...props} sampling="pixel" />);
    expect(screen.getByText('Sampling: Pixel · Compact pin tops')).toBeInTheDocument();
    expect(document.querySelector('svg image')).toHaveStyle({ imageRendering: 'pixelated' });
    expect(document.querySelector('svg image')).toHaveAttribute('x', imageX);
    expect(document.querySelector('[data-overlay="pins"]')).toHaveAttribute('d', pinPath);
    expect(onChange).not.toHaveBeenCalled();
  });
  it('displays rounded gesture values without changing the actual sampling transform', () => {
    renderWithProviders(<Harness initial={{ offsetX: 12.3456789, offsetY: -3.333333333, zoom: 1.1 }} />);
    expect(screen.getByLabelText('Zoom')).toHaveValue('110 %');
    expect(screen.getByLabelText('Offset X')).toHaveValue('12.35 mm');
    expect(screen.getByLabelText('Offset Y')).toHaveValue('-3.33 mm');
  });
  it('shows the original image and grid with keyboard-accessible controls', () => {
    const { container } = renderWithProviders(<Harness />);
    expect(screen.getByRole('dialog', { name: 'Adjust image' })).toBeInTheDocument();
    expect(screen.getByRole('application', { name: 'Image placement canvas' })).toHaveAttribute('tabindex', '0');
    expect(document.querySelector('svg image')).toHaveAttribute('href', 'blob:photo');
    expect(document.querySelector('[data-overlay="original-image"]')).toHaveAttribute('href', 'blob:photo');
    expect(document.querySelector('[data-overlay="pixel-grid"]')).toBeInTheDocument();
    expect(document.querySelector('[data-overlay="pins"]')).not.toBeInTheDocument();
    expect(document.querySelector('[data-overlay="mapping-background"]')).toHaveAttribute('fill', '#ffffff');
    expect(screen.getByRole('slider', { name: 'Image zoom' })).toHaveAttribute('aria-valuenow', '100');
    expect(container).toBeInTheDocument();
  });

  it('updates the right-hand cells from the same compact Pixel samples when the image moves', () => {
    const rgba = new Uint8ClampedArray([255,0,0,255, 0,0,255,255, 0,255,0,255, 255,255,255,255]);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn(), getImageData: () => ({ data: rgba }) } as unknown as CanvasRenderingContext2D);
    const small = { ...source, bitmap: { width: 2, height: 2 } as ImageBitmap };
    const layout = { ...parameters, width: 2, depth: 2, spacing: 1, diameter: 1, layout: { regions: [], edgePadding: 0,
      pins: [{ id: 'left', x: -.5, y: .5 }, { id: 'right', x: .5, y: .5 }, { id: 'bottom-left', x: -.5, y: -.5 }, { id: 'bottom-right', x: .5, y: -.5 }] } };
    const props = { opened: true, source: small, parameters: layout, blocked: false, processing: false, error: null,
      onChange: vi.fn(), onClose: vi.fn(), sampling: 'pixel' as const };
    const { rerender } = renderWithProviders(<ImagePlacementDialog {...props} placement={DEFAULT_IMAGE_PLACEMENT} />);
    expect([...document.querySelectorAll('[data-overlay="samples"] path')].map(path => path.getAttribute('fill'))).toEqual(['rgb(255, 0, 0)', 'rgb(0, 0, 255)', 'rgb(0, 255, 0)', 'rgb(255, 255, 255)']);
    rerender(<ImagePlacementDialog {...props} placement={{ ...DEFAULT_IMAGE_PLACEMENT, offsetX: 1 }} />);
    expect([...document.querySelectorAll('[data-overlay="samples"] path')].map(path => path.getAttribute('fill'))).toEqual(['rgb(255, 255, 255)', 'rgb(255, 0, 0)', 'rgb(0, 255, 0)']);
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it('reports sampling failures without crashing the controls and can retry', async () => {
    const user = userEvent.setup();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValueOnce(null);
    renderWithProviders(<Harness />);
    expect(screen.getByText('Image samples unavailable')).toBeInTheDocument();
    expect(document.querySelector('[data-overlay="samples"]')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry samples' }));
    expect(document.querySelector('[data-overlay="samples"]')).toBeInTheDocument();
    expect(screen.queryByText('Image samples unavailable')).not.toBeInTheDocument();
  });

  it('applies offsets live, keeps incomplete drafts local, and separates center, fit and reset', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<Harness initial={{ offsetX: 10, offsetY: -8, zoom: 2 }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Offset X'), { target: { value: '12' } });
    expect(onChange).toHaveBeenLastCalledWith({ offsetX: 12, offsetY: -8, zoom: 2 });
    onChange.mockClear();
    fireEvent.change(screen.getByLabelText('Offset Y'), { target: { value: '' } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Zoom'), { target: { value: '500' } });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('Enter 10–400%.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Center image' }));
    expect(onChange).toHaveBeenLastCalledWith({ offsetX: 0, offsetY: 0, zoom: 2 });
    await user.click(screen.getByRole('button', { name: 'Fit image' }));
    expect(onChange.mock.lastCall![0]).toEqual(DEFAULT_IMAGE_PLACEMENT);
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(onChange).toHaveBeenLastCalledWith(DEFAULT_IMAGE_PLACEMENT);
    fireEvent.keyDown(screen.getByRole('application'), { key: 'ArrowUp', shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith({ offsetX: 0, offsetY: 5, zoom: 1 });
  });

  it('keeps the sample panel read-only while sharing the original viewport', () => {
    const onChange = vi.fn();
    renderWithProviders(<Harness onChange={onChange} />);
    const original = screen.getByRole('application');
    const samples = screen.getByRole('img', { name: 'Mapped pin samples' });
    expect(samples).toHaveAttribute('viewBox', original.getAttribute('viewBox'));
    expect(samples).not.toHaveAttribute('tabindex');
    fireEvent.keyDown(samples, { key: 'ArrowUp' });
    fireEvent.pointerDown(samples, { button: 0 });
    fireEvent.pointerMove(samples, { clientX: 50, clientY: 50 });
    const wheel = new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true });
    fireEvent(samples, wheel);
    expect(wheel.defaultPrevented).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('adjusts original-image opacity without changing placement or sampled colors', () => {
    const onChange = vi.fn();
    renderWithProviders(<Harness onChange={onChange} blocked />);
    const opacity = screen.getByRole('slider', { name: 'Image opacity' });
    const original = document.querySelector('[data-overlay="original-image"]');
    const samples = document.querySelector('[data-overlay="samples"]')!.innerHTML;
    const sampleReads = vi.mocked(HTMLCanvasElement.prototype.getContext).mock.calls.length;
    expect(opacity).toHaveAttribute('aria-valuenow', '100');
    expect(original).toHaveAttribute('opacity', '1');
    fireEvent.keyDown(opacity, { key: 'ArrowLeft' });
    expect(opacity).toHaveAttribute('aria-valuenow', '95');
    expect(original).toHaveAttribute('opacity', '0.95');
    fireEvent.keyDown(opacity, { key: 'Home' });
    expect(original).toHaveAttribute('opacity', '0');
    expect(document.querySelector('[data-overlay="pixel-grid"]')).toHaveAttribute('opacity', '0.85');
    expect(document.querySelector('[data-overlay="samples"]')!.innerHTML).toEqual(samples);
    expect(HTMLCanvasElement.prototype.getContext).toHaveBeenCalledTimes(sampleReads);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(opacity, { key: 'End' });
    expect(original).toHaveAttribute('opacity', '1');
  });

  it('drags in world mm, cancels with Escape, and zooms at the cursor without scrolling the page', () => {
    vi.stubGlobal('PointerEvent', MouseEvent);
    const onChange = vi.fn();
    renderWithProviders(<Harness onChange={onChange} />);
    const canvas = screen.getByRole('application');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 600, height: 500 } as DOMRect);
    Object.assign(canvas, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn(), hasPointerCapture: vi.fn(() => true) });
    fireEvent.pointerDown(canvas, { button: 0, clientX: 300, clientY: 250 });
    fireEvent.pointerMove(canvas, { clientX: 350, clientY: 200 });
    expect(onChange.mock.lastCall![0].offsetX).toBeCloseTo(6.2);
    expect(onChange.mock.lastCall![0].offsetY).toBeCloseTo(6.2);
    fireEvent.keyDown(canvas, { key: 'Escape' });
    expect(onChange).toHaveBeenLastCalledWith(DEFAULT_IMAGE_PLACEMENT);
    const wheel = new WheelEvent('wheel', { clientX: 300, clientY: 250, deltaY: -100, bubbles: true, cancelable: true });
    fireEvent(canvas, wheel);
    expect(wheel.defaultPrevented).toBe(true);
    expect(onChange.mock.lastCall![0].zoom).toBeGreaterThan(1);
    expect(onChange.mock.lastCall![0].offsetX).toBeCloseTo(0);
    expect(onChange.mock.lastCall![0].offsetY).toBeCloseTo(0);
  });

  it('restores a cancelled pointer gesture and prevents changes during pin height dragging', () => {
    vi.stubGlobal('PointerEvent', MouseEvent);
    const onChange = vi.fn();
    const { rerender } = renderWithProviders(<Harness onChange={onChange} />);
    const canvas = screen.getByRole('application');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 600, height: 500 } as DOMRect);
    Object.assign(canvas, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn(), hasPointerCapture: vi.fn(() => true) });
    fireEvent.pointerDown(canvas, { button: 0, clientX: 300, clientY: 250 });
    fireEvent.pointerMove(canvas, { clientX: 350, clientY: 200 });
    fireEvent.pointerCancel(canvas);
    expect(onChange).toHaveBeenLastCalledWith(DEFAULT_IMAGE_PLACEMENT);
    rerender(<Harness onChange={onChange} blocked />);
    onChange.mockClear();
    fireEvent.keyDown(canvas, { key: 'ArrowRight' });
    fireEvent.wheel(canvas, { deltaY: -100 });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Reset' })).toBeDisabled();
  });
});
