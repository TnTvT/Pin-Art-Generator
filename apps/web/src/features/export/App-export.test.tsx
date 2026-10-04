import type { ReactNode } from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/render';
import App from '../../app/App';
import useSourceImage from '../image-mapping/useSourceImage';
import { mapImageToPins, sampleImagePixels, type SourceImage } from '../image-mapping/image-mapping';
import { startColorMapping } from '../image-mapping/color-worker';
import { mapPinColors } from '../image-mapping/color-mapping';
import { type ModelColors } from '../pin-design/model';
import type { PreviewEditing } from '../preview/pin-interaction';

vi.mock('../image-mapping/useSourceImage', () => ({ default: vi.fn() }));
vi.mock('../image-mapping/image-mapping', () => ({ mapImageToPins: vi.fn(), sampleImagePixels: vi.fn() }));
vi.mock('../image-mapping/color-worker', () => ({ startColorMapping: vi.fn() }));
vi.mock('../preview/ModelPreview', () => ({
  default: ({ colors, pinColors, heights, editing, toolbar }: { toolbar?: ReactNode; colors: ModelColors; pinColors?: string[]; heights: Float32Array; editing: PreviewEditing }) => <div>
    {toolbar}
    <div data-testid="preview-colors">{colors?.base} {pinColors?.[0] ?? colors?.pins}</div>
    <div data-testid="preview-heights">{[...heights].slice(0, 2).join(',')}</div>
    <button onClick={() => editing.onSelect([0], 'replace')}>Pick first pin</button>
    <button onClick={() => editing.onSelect([1], 'toggle')}>Toggle second pin</button>
    <button onClick={editing.onDragStart}>Start height drag</button>
    <button onClick={() => editing.onDragDelta(2)}>Move height drag</button>
    <button onClick={editing.onDragEnd}>Finish height drag</button>
    <button onClick={editing.onDragCancel}>Cancel height drag</button>
  </div>,
}));

async function openEditor(user: ReturnType<typeof userEvent.setup>, name: 'Height' | 'Material') {
  const button = screen.getByRole('button', { name });
  if (button.getAttribute('aria-expanded') !== 'true') await user.click(button);
}

const source = { name: 'test.png', url: 'blob:image', bitmap: {} } as SourceImage;
const imageState = (overrides = {}) => ({ source: null, loading: false, error: null, upload: vi.fn(), remove: vi.fn(), useSample: vi.fn(), ...overrides });

beforeEach(() => {
  vi.mocked(useSourceImage).mockReturnValue(imageState());
  vi.mocked(mapImageToPins).mockReset();
  vi.mocked(sampleImagePixels).mockReturnValue(new Uint8ClampedArray(Array.from({ length: 320 }, (_, index) => index % 2 === 0 ? [255, 255, 255, 255] : [0, 177, 183, 255]).flat()));
  vi.mocked(startColorMapping).mockImplementation(request => ({ promise: Promise.resolve({ result: mapPinColors(request), elapsedMs: 10 }), cancel: vi.fn() }));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('binary', { headers: { 'X-Plate-Count': '1' } })));
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:download'), revokeObjectURL: vi.fn() }));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

describe('app export integration', () => {
  it('maps and exports one height range while keeping manual heights and invalid drafts intact', async () => {
    const user = userEvent.setup();
    vi.mocked(useSourceImage).mockReturnValue(imageState({ source }));
    vi.mocked(mapImageToPins).mockImplementation((_source, parameters, minimum) => ({
      heights: Float32Array.from({ length: parameters.columns * parameters.rows }, (_, index) => index % 2 === 0 ? minimum : parameters.extension),
      minimum, maximum: parameters.extension,
    }));
    renderWithProviders(<App />);
    expect(screen.queryByLabelText('Generated pin height')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Mapping max height')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Min height'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Max height'), { target: { value: '30' } });
    expect(screen.getByTestId('preview-heights')).toHaveTextContent('5,30');
    await user.click(screen.getByRole('button', { name: 'Pick first pin' }));
    await openEditor(user, 'Height');
    fireEvent.change(screen.getByLabelText('Selected height'), { target: { value: '45' } });
    await user.click(screen.getByRole('button', { name: 'Apply height' }));
    const lower = screen.getByRole('slider', { name: 'Minimum mapped height' });
    fireEvent.focus(lower);
    fireEvent.keyDown(lower, { key: 'ArrowLeft' });
    expect(screen.getByLabelText('Min height')).toHaveValue('4.9 mm');
    const upper = screen.getByRole('slider', { name: 'Maximum mapped height' });
    fireEvent.focus(upper);
    fireEvent.keyDown(upper, { key: 'ArrowRight' });
    expect(screen.getByLabelText('Max height')).toHaveValue('30.1 mm');
    expect(screen.getByTestId('preview-heights')).toHaveTextContent('45,30.100');
    fireEvent.change(screen.getByLabelText('Max height'), { target: { value: '' } });
    await user.click(screen.getByRole('button', { name: 'Download Bambu 3MF' }));
    const request = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(request.parameters.extension).toBe(30.1);
    expect(request.heights[0]).toBe(45);
    expect(request.heights[1]).toBeCloseTo(30.1);
    await user.click(screen.getByText('Color', { exact: true }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Download Bambu 3MF' })).toBeEnabled());
    expect(screen.getByLabelText('Generated pin height')).toHaveValue('30.1 mm');
    expect(screen.queryByRole('slider', { name: 'Minimum mapped height' })).not.toBeInTheDocument();
    await user.click(within(screen.getByRole('region', { name: 'Image mapping' })).getByText('Height', { exact: true }));
    expect(screen.getByLabelText('Min height')).toHaveValue('4.9 mm');
    expect(screen.getByLabelText('Max height')).toHaveValue('30.1 mm');
  });

  it.each(['fixed', 'detachable'] as const)('exports image-mapped colors and original-image heights in %s mode', async mode => {
    const user = userEvent.setup();
    vi.mocked(useSourceImage).mockReturnValue(imageState({ source }));
    vi.mocked(mapImageToPins).mockReturnValue({ heights: new Float32Array(320).fill(4), minimum: 4, maximum: 4 });
    renderWithProviders(<App />);
    await user.click(screen.getByText('Height + Color', { exact: true }));
    await waitFor(() => expect(screen.getByText(/Mapping updated · 10 ms/)).toBeInTheDocument());
    expect(screen.getByTestId('preview-colors')).toHaveTextContent('#8e9089 #ffffff');
    expect(screen.getByTestId('preview-heights')).toHaveTextContent('2,10.131');
    if (mode === 'detachable') await user.click(screen.getByText('Detachable', { exact: true }));
    await user.click(screen.getByRole('button', { name: 'Download Bambu 3MF' }));
    const request = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(request.mode).toBe(mode);
    expect(request.materials).toEqual(['#8e9089', '#ffffff', '#00b1b7']);
    expect(request.filamentProfiles).toEqual(['bambu-pla-basic', 'bambu-pla-basic', 'bambu-pla-basic']);
    expect(request.pinMaterials).toEqual(Array.from({ length: 320 }, (_, index) => index % 2 + 1));
    expect(request.heights[0]).toBe(2);
    expect(request.heights[1]).toBeCloseTo(10.13155, 3);
    expect(request).not.toHaveProperty('image');
  });

  it('blocks export on a worker failure and recovers with Retry mapping', async () => {
    const user = userEvent.setup();
    vi.mocked(useSourceImage).mockReturnValue(imageState({ source }));
    vi.mocked(mapImageToPins).mockReturnValue({ heights: new Float32Array(320).fill(4), minimum: 4, maximum: 4 });
    vi.mocked(startColorMapping).mockImplementationOnce(() => ({ promise: Promise.reject(new Error('No matching filament slots.')), cancel: vi.fn() }));
    renderWithProviders(<App />);
    await user.click(screen.getByText('Color', { exact: true }));
    await waitFor(() => expect(screen.getByText(/Export blocked:.*No matching filament slots/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Download Bambu 3MF' })).toBeDisabled();
    expect(screen.getByTestId('preview-heights')).toHaveTextContent('4,4');
    await user.click(screen.getByRole('button', { name: 'Retry mapping' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Download Bambu 3MF' })).toBeEnabled());
    expect(screen.getByTestId('preview-heights')).toHaveTextContent('20,20');
  });
  it('starts with PLA catalog defaults and exports their official filament identities', async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />);
    expect(screen.getByRole('combobox', { name: 'Base filament' })).toHaveValue('Gray (10103)');
    await user.click(screen.getByRole('button', { name: 'Select all' }));
    await openEditor(user, 'Material');
    expect(screen.getByRole('combobox', { name: 'Selection filament' })).toHaveValue('Turquoise (10605)');
    expect(screen.queryByLabelText('Selection color')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Download Bambu 3MF' }));
    const payload = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(payload.materials).toEqual(['#8e9089', '#00b1b7']);
    expect(payload.filamentProfiles).toEqual(['bambu-pla-basic', 'bambu-pla-basic']);
  });
  it('restores generator defaults when a parameter reset requires grid confirmation', async () => {
    const user = userEvent.setup();
    vi.mocked(useSourceImage).mockReturnValue(imageState({ source }));
    vi.mocked(mapImageToPins).mockImplementation((_source, parameters) => ({ heights: new Float32Array(parameters.columns * parameters.rows).fill(5), minimum: 5, maximum: 5 }));
    renderWithProviders(<App />);
    fireEvent.change(screen.getByLabelText('Columns'), { target: { value: '10' } });
    await user.click(screen.getByRole('button', { name: 'Pick first pin' }));
    await openEditor(user, 'Height');
    fireEvent.change(screen.getByLabelText('Selected height'), { target: { value: '30' } });
    await user.click(screen.getByRole('button', { name: 'Apply height' }));
    fireEvent.change(screen.getByLabelText('Min height'), { target: { value: '8' } });
    await user.click(screen.getByRole('switch', { name: 'Invert mapping' }));
    await user.click(screen.getByRole('button', { name: 'Reset parameters' }));
    await user.click(screen.getByRole('button', { name: 'Change grid' }));
    expect(screen.getByLabelText('Columns')).toHaveValue('20');
    expect(screen.getByLabelText('Min height')).toHaveValue('2 mm');
    expect(screen.getByRole('switch', { name: 'Invert mapping' })).not.toBeChecked();
  });
  it('shows Mixed fields instead of the first pin value for differing materials and heights', async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />);
    await user.click(screen.getByRole('button', { name: 'Pick first pin' }));
    await openEditor(user, 'Height');
    fireEvent.change(screen.getByLabelText('Selected height'), { target: { value: '30' } });
    await user.click(screen.getByRole('button', { name: 'Apply height' }));
    await openEditor(user, 'Material');
    await user.click(screen.getByRole('combobox', { name: 'Selection filament' }));
    await user.click(screen.getByRole('option', { name: 'Custom color' }));
    fireEvent.change(screen.getByLabelText('Selection color'), { target: { value: '#ff0000' } });
    await user.click(screen.getByRole('button', { name: 'Apply material' }));
    await user.click(screen.getByRole('button', { name: 'Toggle second pin' }));
    await openEditor(user, 'Height');
    expect(screen.getByLabelText('Selected height')).toHaveValue('');
    expect(screen.getByLabelText('Selected height')).toHaveAttribute('placeholder', 'Mixed');
    await openEditor(user, 'Material');
    expect(screen.getByRole('combobox', { name: 'Selection filament' })).toHaveAttribute('placeholder', 'Mixed');
    expect(screen.getByLabelText('Selection color')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Apply material' })).toBeDisabled();
    await openEditor(user, 'Material');
    await user.click(screen.getByRole('combobox', { name: 'Selection filament' }));
    await user.click(screen.getByRole('option', { name: 'Custom color' }));
    fireEvent.change(screen.getByLabelText('Selection color'), { target: { value: '#00ff00' } });
    await user.click(screen.getByRole('button', { name: 'Apply material' }));
    expect(screen.getByText(/Material: #00FF00/)).toBeInTheDocument();
  });
  it('preserves manual heights and colors on image regeneration, restoring the latest mapped value', async () => {
    const user = userEvent.setup();
    vi.mocked(useSourceImage).mockReturnValue(imageState({ source }));
    vi.mocked(mapImageToPins).mockReturnValue({ heights: new Float32Array(320).fill(4), minimum: 4, maximum: 4 });
    const { rerender } = renderWithProviders(<App />);
    await user.click(screen.getByRole('button', { name: 'Pick first pin' }));
    await openEditor(user, 'Height');
    fireEvent.change(screen.getByLabelText('Selected height'), { target: { value: '35' } });
    await user.click(screen.getByRole('button', { name: 'Apply height' }));
    await openEditor(user, 'Material');
    await user.click(screen.getByRole('combobox', { name: 'Selection filament' }));
    await user.click(screen.getByRole('option', { name: 'Custom color' }));
    fireEvent.change(screen.getByLabelText('Selection color'), { target: { value: '#ff0000' } });
    await user.click(screen.getByRole('button', { name: 'Apply material' }));
    vi.mocked(useSourceImage).mockReturnValue(imageState({ source: { ...source, name: 'replacement.png' } }));
    vi.mocked(mapImageToPins).mockReturnValue({ heights: new Float32Array(320).fill(6), minimum: 6, maximum: 6 });
    rerender(<App />);
    expect(screen.getByTestId('preview-heights')).toHaveTextContent('35,6');
    expect(screen.getByTestId('preview-colors')).toHaveTextContent('#ff0000');
    await user.click(screen.getByRole('button', { name: 'More pin actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Restore generated heights' }));
    expect(screen.getByTestId('preview-heights')).toHaveTextContent('6,6');
    expect(screen.getByTestId('preview-colors')).toHaveTextContent('#ff0000');
  });

  it('confirms resetting all edits and makes the reset undoable', async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />);
    await user.click(screen.getByRole('button', { name: 'Pick first pin' }));
    await openEditor(user, 'Height');
    fireEvent.change(screen.getByLabelText('Selected height'), { target: { value: '30' } });
    await user.click(screen.getByRole('button', { name: 'Apply height' }));
    await user.click(screen.getByRole('button', { name: 'More pin actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Reset all edits' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByTestId('preview-heights')).toHaveTextContent('30,20');
    await user.click(screen.getByRole('button', { name: 'More pin actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Reset all edits' }));
    await user.click(screen.getByRole('button', { name: 'Reset edits' }));
    expect(screen.getByTestId('preview-heights')).toHaveTextContent('20,20');
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByTestId('preview-heights')).toHaveTextContent('30,20');
  });
  it('edits one and multiple pins, reports Mixed, and exports resolved heights and materials', async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />);
    await user.click(screen.getByRole('button', { name: 'Pick first pin' }));
    expect(screen.getByText(/Row 1, column 1/)).toBeInTheDocument();
    await openEditor(user, 'Height');
    fireEvent.change(screen.getByLabelText('Selected height'), { target: { value: '30' } });
    fireEvent.keyDown(screen.getByLabelText('Selected height'), { key: 'Enter' });
    await user.click(screen.getByRole('button', { name: 'Toggle second pin' }));
    expect(screen.getByText(/Height: Mixed/)).toBeInTheDocument();
    await openEditor(user, 'Height');
    await user.click(screen.getByText('Offset height', { exact: true }));
    fireEvent.change(screen.getByLabelText('Height offset'), { target: { value: '2' } });
    await user.click(screen.getByRole('button', { name: 'Apply height' }));
    await openEditor(user, 'Material');
    await user.click(screen.getByRole('combobox', { name: 'Selection filament' }));
    await user.click(screen.getByRole('option', { name: 'Custom color' }));
    fireEvent.change(screen.getByLabelText('Selection color'), { target: { value: '#ff0000' } });
    await user.click(screen.getByRole('button', { name: 'Apply material' }));
    expect(screen.getByTestId('preview-heights')).toHaveTextContent('32,22');
    await user.click(screen.getByRole('button', { name: 'Download Bambu 3MF' }));
    const request = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(request.heights.slice(0, 3)).toEqual([32, 22, 20]);
    expect(request.materials).toEqual(['#8e9089', '#ff0000', '#00b1b7']);
    expect(request.pinMaterials.slice(0, 3)).toEqual([1, 1, 2]);
    await user.click(screen.getByRole('button', { name: 'More pin actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Restore generated heights' }));
    expect(screen.getByTestId('preview-heights')).toHaveTextContent('20,20');
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByTestId('preview-heights')).toHaveTextContent('32,22');
  });

  it('keeps edits when spacing changes and confirms topology changes before clearing them', async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />);
    await user.click(screen.getByRole('button', { name: 'Pick first pin' }));
    await openEditor(user, 'Height');
    fireEvent.change(screen.getByLabelText('Selected height'), { target: { value: '35' } });
    await user.click(screen.getByRole('button', { name: 'Apply height' }));
    fireEvent.change(screen.getByLabelText('Pin spacing'), { target: { value: '5.5' } });
    expect(screen.getByTestId('preview-heights')).toHaveTextContent('35,20');
    fireEvent.change(screen.getByLabelText('Columns'), { target: { value: '21' } });
    fireEvent.blur(screen.getByLabelText('Columns'));
    expect(screen.getByRole('dialog', { name: 'Change pin grid?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keep grid' }));
    expect(screen.getByLabelText('Columns')).toHaveValue('20');
    expect(screen.getByTestId('preview-heights')).toHaveTextContent('35,20');
    fireEvent.change(screen.getByLabelText('Columns'), { target: { value: '21' } });
    fireEvent.keyDown(screen.getByLabelText('Columns'), { key: 'Enter' });
    await user.click(screen.getByRole('button', { name: 'Change grid' }));
    expect(screen.getByTestId('preview-heights')).toHaveTextContent('20,20');
    expect(screen.getByText(/0 selected/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });

  it('blocks downloads during transient drags, cancels cleanly, and commits one undo operation', async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />);
    await user.click(screen.getByRole('button', { name: 'Pick first pin' }));
    await user.click(screen.getByRole('button', { name: 'Start height drag' }));
    await user.click(screen.getByRole('button', { name: 'Move height drag' }));
    expect(screen.getByTestId('preview-heights')).toHaveTextContent('22,20');
    expect(screen.getByRole('button', { name: 'Download STL' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Cancel height drag' }));
    expect(screen.getByTestId('preview-heights')).toHaveTextContent('20,20');
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Start height drag' }));
    await user.click(screen.getByRole('button', { name: 'Move height drag' }));
    await user.click(screen.getByRole('button', { name: 'Finish height drag' }));
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    expect(screen.getByTestId('preview-heights')).toHaveTextContent('20,20');
  });
  it('uses catalog colors and material profiles in the preview and 3MF snapshot', async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />);
    await user.click(screen.getByRole('combobox', { name: 'Base filament' }));
    await user.click(screen.getByRole('option', { name: 'Jade White (10100)' }));
    await user.click(screen.getByRole('button', { name: 'Select all' }));
    await openEditor(user, 'Material');
    await user.click(screen.getByRole('combobox', { name: 'Selection filament' }));
    await user.click(screen.getByRole('option', { name: 'Sakura Pink (11201)' }));
    await user.click(screen.getByRole('button', { name: 'Apply material' }));
    expect(screen.getByTestId('preview-colors')).toHaveTextContent('#ffffff #e8afcf');
    await user.click(screen.getByRole('button', { name: 'Switch to dark mode' }));
    expect(screen.getByRole('combobox', { name: 'Base filament' })).toHaveValue('Jade White (10100)');
    await openEditor(user, 'Material');
    expect(screen.getByRole('combobox', { name: 'Selection filament' })).toHaveValue('Sakura Pink (11201)');
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
    await user.click(screen.getByRole('button', { name: 'Select all' }));
    await openEditor(user, 'Material');
    await user.click(screen.getByRole('combobox', { name: 'Selection filament' }));
    await user.click(screen.getByRole('option', { name: 'Ivory White (11100)' }));
    await user.click(screen.getByRole('button', { name: 'Apply material' }));
    await user.click(screen.getByRole('button', { name: 'Download Bambu 3MF' }));
    const first = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(first.materials).toEqual(['#ffffff', '#ffffff']);
    expect(first.filamentProfiles).toEqual(['bambu-pla-basic', 'bambu-pla-matte']);
    expect(first.baseMaterial).toBe(0);
    expect(first.pinMaterials).toEqual(Array(320).fill(1));
    await openEditor(user, 'Material');
    await user.click(screen.getByRole('combobox', { name: 'Selection filament' }));
    await user.click(screen.getByRole('option', { name: 'Custom color' }));
    await user.click(screen.getByRole('button', { name: 'Apply material' }));
    await user.click(screen.getByRole('button', { name: 'Download Bambu 3MF' }));
    const second = JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string);
    expect(second.materials).toEqual(['#ffffff', '#ffffff']);
    expect(second.filamentProfiles).toEqual(['bambu-pla-basic', 'generic-pla']);
  });

  it('shares printable colors with the preview and exports last-valid numeric parameters', async () => {
    const user = userEvent.setup();
    renderWithProviders(<App />);
    await user.click(screen.getByRole('combobox', { name: 'Base filament' }));
    await user.click(screen.getByRole('option', { name: 'Custom color' }));
    fireEvent.change(screen.getByLabelText('Base color'), { target: { value: '#abcdef' } });
    expect(screen.getByTestId('preview-colors')).toHaveTextContent('#abcdef #00b1b7');
    await user.clear(screen.getByLabelText('Base width'));
    await user.type(screen.getByLabelText('Base width'), '150');
    await user.clear(screen.getByLabelText('Base width'));
    await user.click(screen.getByRole('button', { name: 'Download STL' }));
    const payload = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(payload.parameters.width).toBe(150);
    expect(payload.materials).toEqual(['#abcdef', '#00b1b7']);
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
