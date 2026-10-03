import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/render';
import App from '../../app/App';
import useSourceImage from '../image-mapping/useSourceImage';
import { mapImageToPins, type SourceImage } from '../image-mapping/image-mapping';
import { type ModelColors } from '../pin-design/model';

vi.mock('../image-mapping/useSourceImage', () => ({ default: vi.fn() }));
vi.mock('../image-mapping/image-mapping', () => ({ mapImageToPins: vi.fn() }));
vi.mock('../preview/ModelPreview', () => ({
  default: ({ colors }: { colors: ModelColors }) => <div data-testid="preview-colors">{colors?.base} {colors?.pins}</div>,
}));

const source = { name: 'test.png', url: 'blob:image', bitmap: {} } as SourceImage;
const imageState = (overrides = {}) => ({ source: null, loading: false, error: null, upload: vi.fn(), remove: vi.fn(), useSample: vi.fn(), ...overrides });

beforeEach(() => {
  vi.mocked(useSourceImage).mockReturnValue(imageState());
  vi.mocked(mapImageToPins).mockReset();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('binary', { headers: { 'X-Plate-Count': '1' } })));
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:download'), revokeObjectURL: vi.fn() }));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

describe('app export integration', () => {
  it('uses catalog colors and material profiles in the preview and 3MF snapshot', async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />);
    await user.click(screen.getByRole('combobox', { name: 'Base filament' }));
    await user.click(screen.getByRole('option', { name: 'Jade White (10100)' }));
    await user.click(screen.getByRole('combobox', { name: 'Pin filament' }));
    await user.click(screen.getByRole('option', { name: 'Sakura Pink (11201)' }));
    expect(screen.getByTestId('preview-colors')).toHaveTextContent('#ffffff #e8afcf');
    await user.click(screen.getByRole('button', { name: 'Switch to dark mode' }));
    expect(screen.getByRole('combobox', { name: 'Base filament' })).toHaveValue('Jade White (10100)');
    expect(screen.getByRole('combobox', { name: 'Pin filament' })).toHaveValue('Sakura Pink (11201)');
    expect(screen.getByTestId('preview-colors')).toHaveTextContent('#ffffff #e8afcf');
    await user.click(screen.getByRole('button', { name: 'Download Bambu 3MF' }));
    const payload = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(payload.materials).toEqual(['#ffffff', '#e8afcf']);
    expect(payload.baseMaterial).toBe(0);
    expect(payload.pinMaterials).toEqual(Array(320).fill(1));
    expect(payload.filamentProfiles).toEqual(['bambu-pla-basic', 'bambu-pla-matte']);
  });

  it('keeps Basic and Matte with identical RGB in separate slots and clears the profile on custom selection', async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />);
    await user.click(screen.getByRole('combobox', { name: 'Base filament' }));
    await user.click(screen.getByRole('option', { name: 'Jade White (10100)' }));
    await user.click(screen.getByRole('combobox', { name: 'Pin filament' }));
    await user.click(screen.getByRole('option', { name: 'Ivory White (11100)' }));
    await user.click(screen.getByRole('button', { name: 'Download Bambu 3MF' }));
    const first = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(first.materials).toEqual(['#ffffff', '#ffffff']);
    expect(first.filamentProfiles).toEqual(['bambu-pla-basic', 'bambu-pla-matte']);
    expect(first.baseMaterial).toBe(0);
    expect(first.pinMaterials).toEqual(Array(320).fill(1));
    await user.click(screen.getByRole('combobox', { name: 'Pin filament' }));
    await user.click(screen.getByRole('option', { name: 'Custom color' }));
    await user.click(screen.getByRole('button', { name: 'Download Bambu 3MF' }));
    const second = JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string);
    expect(second.materials).toEqual(['#ffffff', '#ffffff']);
    expect(second.filamentProfiles).toEqual(['bambu-pla-basic', 'generic-pla']);
  });

  it('shares printable colors with the preview and exports last-valid numeric parameters', async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />);
    fireEvent.change(screen.getByLabelText('Base color'), { target: { value: '#abcdef' } });
    expect(screen.getByTestId('preview-colors')).toHaveTextContent('#abcdef #2dada3');
    await user.clear(screen.getByLabelText('Base width'));
    await user.type(screen.getByLabelText('Base width'), '150');
    await user.clear(screen.getByLabelText('Base width'));
    await user.click(screen.getByRole('button', { name: 'Download STL' }));
    const payload = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(payload.parameters.width).toBe(150);
    expect(payload.materials).toEqual(['#abcdef', '#2dada3']);
    expect(payload.heights).toEqual(Array(320).fill(20));
  });

  it('blocks while loading or when decoding or mapping fails, with the reason shown', () => {
    vi.mocked(useSourceImage).mockReturnValue(imageState({ loading: true }));
    const { rerender } = renderWithProviders(<App />);
    expect(screen.getByRole('button', { name: 'Download STL' })).toBeDisabled();
    expect(screen.getByText(/Export blocked:.*processing.*running/i)).toBeInTheDocument();
    vi.mocked(useSourceImage).mockReturnValue(imageState({ error: 'This image could not be read.' }));
    rerender(<App />);
    expect(screen.getByRole('button', { name: 'Download STL' })).toBeDisabled();
    expect(screen.getByText(/Export blocked:.*This image could not be read/i)).toBeInTheDocument();
    vi.mocked(useSourceImage).mockReturnValue(imageState({ source }));
    vi.mocked(mapImageToPins).mockImplementation(() => { throw new Error('Canvas pixels are unavailable.'); });
    rerender(<App />);
    expect(screen.getByRole('button', { name: 'Download STL' })).toBeDisabled();
    expect(screen.getByText(/Export blocked:.*Canvas pixels are unavailable/i)).toBeInTheDocument();
    vi.mocked(useSourceImage).mockReturnValue(imageState());
    rerender(<App />);
    expect(screen.getByRole('button', { name: 'Download STL' })).toBeEnabled();
  });

  it('exports the current resolved image heights only, never the image', async () => {
    const user = userEvent.setup();
    vi.mocked(useSourceImage).mockReturnValue(imageState({ source }));
    const heights = new Float32Array(320).fill(4);
    heights[1] = 10;
    vi.mocked(mapImageToPins).mockReturnValue({ heights, minimum: 4, maximum: 10 });
    renderWithProviders(<App />);
    await user.click(screen.getByRole('button', { name: 'Download Bambu 3MF' }));
    const payload = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(payload.heights).toEqual(Array.from(heights));
    expect(Object.keys(payload)).toEqual(['format', 'mode', 'parameters', 'heights', 'materials', 'filamentProfiles', 'baseMaterial', 'pinMaterials', 'socket', 'plate']);
  });
});
