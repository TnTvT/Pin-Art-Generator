import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/render';
import ThemeToggle from '../../app/ThemeToggle';
import { DEFAULTS, type Parameters } from '../pin-design/model';
import { DEFAULT_MODEL_MATERIALS } from '../filaments/materials';
import ExportPanel from './ExportPanel';

const fetchMock = vi.fn();
const createObjectURL = vi.fn(() => 'blob:export');
const revokeObjectURL = vi.fn();
let clickDownload: ReturnType<typeof vi.spyOn>;

function Panel({ parameters = DEFAULTS, heights, blockedReason = null }: { parameters?: Parameters; heights?: Float32Array; blockedReason?: string | null }) {
  return <><ThemeToggle /><ExportPanel parameters={parameters} heights={heights} materials={DEFAULT_MODEL_MATERIALS} blockedReason={blockedReason} /></>;
}

function response() {
  return new Response('binary', { headers: { 'Content-Disposition': 'attachment; filename="pins.3mf"', 'X-Plate-Count': '1' } });
}

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue(response());
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));
  clickDownload = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

describe('export panel', () => {
  it('selects U1 without changing the design, keeps selection through theme changes and snapshots it', async () => {
    const user = userEvent.setup();
    const parameters = { ...DEFAULTS, columns: 2, rows: 1 };
    const heights = new Float32Array([4, 31]);
    renderWithProviders(<Panel parameters={parameters} heights={heights} />);
    await user.click(screen.getByRole('combobox', { name: 'Printer' }));
    await user.click(screen.getByRole('option', { name: 'Snapmaker U1 · 0.4 mm' }));
    expect(screen.getByText('2 / 4 materials for 3MF · Includes base')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Switch to dark mode' }));
    await user.click(screen.getByRole('button', { name: 'Download 3MF' }));
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.printer).toBe('snapmaker-u1');
    expect(payload.parameters).toEqual(parameters);
    expect(payload.heights).toEqual([4, 31]);
    expect(payload.materials).toEqual(['#8e9089', '#00b1b7']);
    expect(screen.getByRole('combobox', { name: 'Printer' })).toHaveValue('Snapmaker U1 · 0.4 mm');
  });

  it('blocks five used U1 materials but allows STL and switching back to X1C', async () => {
    const user = userEvent.setup();
    const pins = ['#111111', '#222222', '#333333', '#444444'].map(color => ({ color, filamentId: null }));
    renderWithProviders(<ExportPanel parameters={{ ...DEFAULTS, columns: 4, rows: 1 }} materials={DEFAULT_MODEL_MATERIALS} pinSelections={pins} />);
    await user.click(screen.getByRole('combobox', { name: 'Printer' }));
    await user.click(screen.getByRole('option', { name: 'Snapmaker U1 · 0.4 mm' }));
    expect(screen.getByRole('button', { name: 'Download 3MF' })).toBeDisabled();
    expect(screen.getByText(/3MF blocked:.*4 materials including the base/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download STL' })).toBeEnabled();
    await user.click(screen.getByRole('combobox', { name: 'Printer' }));
    await user.click(screen.getByRole('option', { name: 'Bambu Lab X1 Carbon · 0.4 mm' }));
    expect(screen.getByRole('button', { name: 'Download 3MF' })).toBeEnabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('blocks tangent fixed STL before submitting while keeping round 3MF available', () => {
    renderWithProviders(<Panel parameters={{ ...DEFAULTS, spacing: DEFAULTS.diameter }} />);
    expect(screen.getByRole('button', { name: 'Download STL' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Download 3MF' })).toBeEnabled();
    expect(screen.getByText(/STL blocked:.*positive gap/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('leaves material editing to the dedicated editor panel', () => {
    renderWithProviders(<ExportPanel parameters={DEFAULTS} materials={DEFAULT_MODEL_MATERIALS} />);
    expect(screen.queryByRole('combobox', { name: 'Base filament' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Pin filament' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Color reference:/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /PLA Basic source/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /PLA Matte source/ })).not.toBeInTheDocument();
  });

  it('leaves construction settings to Parameters', () => {
    renderWithProviders(<Panel />);
    expect(screen.queryByRole('radio', { name: 'Fixed sculpture' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Insertion depth')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Bed width')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download STL' })).toBeEnabled();
  });

  it('uses committed construction settings and colors through theme changes', async () => {
    const user = userEvent.setup();
    const parameters = { ...DEFAULTS, construction: { mode: 'print-in-place' as const, sliding: { clearance: 0.4, headFlare: 0.4 } } };
    renderWithProviders(<Panel parameters={parameters} />);
    await user.click(screen.getByRole('button', { name: 'Switch to dark mode' }));
    await user.click(screen.getByRole('button', { name: 'Download 3MF' }));
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.mode).toBe('print-in-place');
    expect(payload.sliding).toEqual(parameters.construction.sliding);
    expect(payload.materials).toEqual(['#8e9089', '#00b1b7']);
  });

  it('blocks invalid guides while keeping oversized fixed STL available', () => {
    const construction = { mode: 'print-in-place' as const, sliding: { clearance: 0.4, headFlare: 0.4 } };
    const { rerender } = renderWithProviders(<Panel parameters={{ ...DEFAULTS, thickness: 1, construction }} />);
    expect(screen.getByRole('button', { name: 'Download STL' })).toBeDisabled();
    expect(screen.getByText(/Guide thickness/)).toBeInTheDocument();
    rerender(<Panel parameters={{ ...DEFAULTS, width: 500, depth: 500 }} />);
    expect(screen.getByRole('button', { name: 'Download STL' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Download 3MF' })).toBeDisabled();
  });

  it('explains blocked image processing and blocks unsafe geometry', () => {
    const { rerender } = renderWithProviders(<Panel blockedReason="Image processing is still running. Wait before exporting." />);
    expect(screen.getByText(/Image processing is still running/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download STL' })).toBeDisabled();
    rerender(<Panel parameters={{ ...DEFAULTS, spacing: 1 }} />);
    expect(screen.getByText(/Pins overlap/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download 3MF' })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('snapshots parameters and heights, prevents duplicates and reports the single plate', async () => {
    let finish!: (response: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => { finish = resolve; }));
    const parameters = { ...DEFAULTS, columns: 2, rows: 1 };
    const heights = new Float32Array([2, 9]);
    const { unmount } = renderWithProviders(<Panel parameters={parameters} heights={heights} />);
    const button = screen.getByRole('button', { name: 'Download 3MF' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Download STL' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Printer' })).toBeDisabled();
    expect(screen.getByText('Preparing 3MF…')).toBeInTheDocument();
    parameters.width = 10;
    heights[0] = 7;
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).heights).toEqual([2, 9]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).parameters.width).toBe(120);
    await act(async () => { finish(response()); });
    expect(screen.getByText(/1 plate/)).toBeInTheDocument();
    expect(clickDownload).toHaveBeenCalledOnce();
    const anchor = clickDownload.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.download).toBe('pins.3mf');
    expect(anchor.href).toBe('blob:export');
    expect(revokeObjectURL).not.toHaveBeenCalled();
    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:export');
  });

  it('shows readable service errors, retries and clears errors', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'INVALID_DESIGN', message: 'Increase spacing for the guide walls.' } }), { status: 422 }));
    renderWithProviders(<Panel />);
    await user.click(screen.getByRole('button', { name: 'Download 3MF' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Increase spacing for the guide walls. (INVALID_DESIGN)');
    await user.click(screen.getByRole('button', { name: 'Retry export' }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await user.click(screen.getByRole('button', { name: 'Download STL' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not connect');
    await user.click(screen.getByRole('button', { name: 'Clear error' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('aborts on unmount and does not download a late response', async () => {
    let finish!: (response: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => { finish = resolve; }));
    const { unmount } = renderWithProviders(<Panel />);
    fireEvent.click(screen.getByRole('button', { name: 'Download STL' }));
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => { finish(response()); });
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('releases download URLs after allowing the browser to start the download', async () => {
    vi.useFakeTimers();
    try {
      const { unmount } = renderWithProviders(<Panel />);
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Download STL' })); });
      expect(revokeObjectURL).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(60_000));
      expect(revokeObjectURL).toHaveBeenCalledOnce();
      unmount();
      expect(revokeObjectURL).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
