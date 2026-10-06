import { useState } from 'react';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/render';
import { DEFAULTS } from '../pin-design/model';
import { DEFAULT_SHAPE, generateLayout } from '../base-shape/layout';
import { DEFAULT_IMAGE_PLACEMENT, type ImagePlacement } from './image-placement';
import ImagePlacementDialog from './ImagePlacementDialog';

const source = { name: 'photo.png', url: 'blob:photo', bitmap: { width: 200, height: 100 } as ImageBitmap };
const parameters = { ...DEFAULTS, ...generateLayout(DEFAULTS, DEFAULT_SHAPE) };
afterEach(() => vi.unstubAllGlobals());

function Harness({ initial = DEFAULT_IMAGE_PLACEMENT, onChange = vi.fn(), blocked = false }: { initial?: ImagePlacement; onChange?: (placement: ImagePlacement) => void; blocked?: boolean }) {
  const [placement, setPlacement] = useState(initial);
  return <ImagePlacementDialog opened source={source} parameters={parameters} placement={placement} blocked={blocked} processing={false} error={null}
    onClose={vi.fn()} onChange={next => { onChange(next); setPlacement(next); }} />;
}

describe('image adjustment dialog', () => {
  it('displays rounded gesture values without changing the actual sampling transform', () => {
    renderWithProviders(<Harness initial={{ offsetX: 12.3456789, offsetY: -3.333333333, zoom: 1.1 }} />);
    expect(screen.getByLabelText('Zoom')).toHaveValue('110 %');
    expect(screen.getByLabelText('Offset X')).toHaveValue('12.35 mm');
    expect(screen.getByLabelText('Offset Y')).toHaveValue('-3.33 mm');
  });
  it('shows the original image, base and actual pin overlay with keyboard-accessible controls', () => {
    const { container } = renderWithProviders(<Harness />);
    expect(screen.getByRole('dialog', { name: 'Adjust image' })).toBeInTheDocument();
    expect(screen.getByRole('application', { name: 'Image placement canvas' })).toHaveAttribute('tabindex', '0');
    expect(document.querySelector('svg image')).toHaveAttribute('href', 'blob:photo');
    expect(document.querySelector('[data-overlay="pins"]')).toHaveAttribute('d', expect.stringContaining('M'));
    expect(document.querySelector('[data-overlay="mapping-background"]')).toHaveAttribute('fill', '#ffffff');
    expect(screen.getByRole('slider', { name: 'Image zoom' })).toHaveAttribute('aria-valuenow', '100');
    expect(container).toBeInTheDocument();
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
    expect(onChange.mock.lastCall![0].zoom).toBeLessThan(1);
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(onChange).toHaveBeenLastCalledWith(DEFAULT_IMAGE_PLACEMENT);
    fireEvent.keyDown(screen.getByRole('application'), { key: 'ArrowUp', shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith({ offsetX: 0, offsetY: 5, zoom: 1 });
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
    expect(onChange.mock.lastCall![0].offsetX).toBeCloseTo(12.4);
    expect(onChange.mock.lastCall![0].offsetY).toBeCloseTo(12.4);
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
