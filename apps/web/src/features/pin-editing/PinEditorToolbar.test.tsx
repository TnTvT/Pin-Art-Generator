import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/render';
import { DEFAULTS } from '../pin-design/model';
import usePinEditor from './usePinEditor';
import PinEditorToolbar from './PinEditorToolbar';
import type { PinShape } from '../pin-shape/geometry';
import type { PinEditor } from './usePinEditor';
import { DEFAULT_CONSTRUCTION } from '../mechanics/model';

function geometryEditor(geometries: { shape: PinShape; rotation: number }[], selection = [0, 1]) {
  const dispatch = vi.fn();
  const editor = {
    state: { count: geometries.length, base: { color: '#ffffff' }, selection: new Set(selection), overrides: new Map(), past: [], future: [] },
    committed: { heights: new Float32Array(geometries.length).fill(20), pinSelections: geometries.map(() => ({ color: '#00b1b7' })), pinGeometries: geometries },
    heights: new Float32Array(geometries.length).fill(20), isDragging: false, blocked: false,
    heightMode: 'set', dispatch, select: vi.fn(), setHeightMode: vi.fn(), error: null,
  } as unknown as PinEditor;
  return { editor, dispatch };
}

function Fixture() {
  const editor = usePinEditor({ ...DEFAULTS, rows: 1, columns: 2 });
  return <><PinEditorToolbar editor={editor} columns={2} /><div>{editor.committed.heights.join(',')}</div>
    <button onClick={() => editor.select([0], 'replace')}>Pick first</button>
    <button onClick={() => editor.select([1], 'replace')}>Pick second</button>
    <button onClick={() => editor.select([0], 'toggle')}>Toggle first</button></>;
}

async function openMaterial(user: ReturnType<typeof userEvent.setup>) {
  const button = screen.getByRole('button', { name: 'Material' });
  if (button.getAttribute('aria-expanded') !== 'true') await user.click(button);
}

describe('preview editing toolbar', () => {
  it('hides Triangle and blocks a cached Triangle draft in print-in-place without discarding it', async () => {
    const user = userEvent.setup();
    const { editor, dispatch } = geometryEditor([{ shape: 'round', rotation: 0 }], [0]);
    const view = renderWithProviders(<PinEditorToolbar editor={editor} parameters={DEFAULTS} />);
    await user.click(screen.getByRole('button', { name: 'Shape' }));
    await user.click(screen.getByRole('radio', { name: 'Triangle' }));
    const parameters = { ...DEFAULTS, construction: { ...DEFAULT_CONSTRUCTION, mode: 'print-in-place' as const } };
    view.rerender(<PinEditorToolbar editor={editor} parameters={parameters} />);
    expect(screen.queryByRole('radio', { name: 'Triangle' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply shape' })).toBeDisabled();
    fireEvent.keyDown(screen.getByLabelText('Selected rotation'), { key: 'Enter' });
    expect(dispatch).not.toHaveBeenCalled();
    view.rerender(<PinEditorToolbar editor={editor} parameters={DEFAULTS} />);
    expect(screen.getByRole('radio', { name: 'Triangle' })).toBeChecked();
    view.rerender(<PinEditorToolbar editor={editor} parameters={parameters} />);
    await user.click(screen.getByRole('radio', { name: 'Square' }));
    await user.click(screen.getByRole('button', { name: 'Apply shape' }));
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: 'geometry', geometry: { shape: 'square', rotation: 0 } });
  });
  it('requires an explicit mixed shape and submits shape and rotation together with Apply or Enter', async () => {
    const user = userEvent.setup();
    const { editor, dispatch } = geometryEditor([{ shape: 'square', rotation: 15 }, { shape: 'triangle', rotation: 45 }]);
    renderWithProviders(<PinEditorToolbar editor={editor} />);
    expect(screen.getByRole('status')).toHaveTextContent('Shape: Mixed · Rotation: Mixed');
    await user.click(screen.getByRole('button', { name: 'Shape' }));
    for (const name of ['Round', 'Square', 'Triangle']) expect(screen.getByRole('radio', { name })).not.toBeChecked();
    expect(screen.getByLabelText('Selected rotation')).toHaveAttribute('placeholder', 'Mixed');
    expect(screen.getByRole('button', { name: 'Apply shape' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Selected rotation'), { target: { value: '60' } });
    fireEvent.keyDown(screen.getByLabelText('Selected rotation'), { key: 'Enter' });
    expect(dispatch).not.toHaveBeenCalled();
    await user.click(screen.getByRole('radio', { name: 'Triangle' }));
    await user.click(screen.getByRole('button', { name: 'Apply shape' }));
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: 'geometry', geometry: { shape: 'triangle', rotation: 60 } });
    fireEvent.change(screen.getByLabelText('Selected rotation'), { target: { value: '90' } });
    fireEvent.keyDown(screen.getByLabelText('Selected rotation'), { key: 'Enter' });
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'geometry', geometry: { shape: 'triangle', rotation: 90 } });
    await user.click(screen.getByRole('button', { name: 'Use selected shape' }));
    expect(screen.getByRole('button', { name: 'Apply shape' })).toBeDisabled();
    expect(screen.getByLabelText('Selected rotation')).toHaveAttribute('placeholder', 'Mixed');
  });

  it('follows untouched selections but preserves chosen geometry through selection, round, and reopening', async () => {
    const user = userEvent.setup();
    const { editor, dispatch } = geometryEditor([{ shape: 'square', rotation: 15 }, { shape: 'triangle', rotation: 45 }], [0]);
    const view = renderWithProviders(<PinEditorToolbar editor={editor} />);
    await user.click(screen.getByRole('button', { name: 'Shape' }));
    expect(screen.getByRole('radio', { name: 'Square' })).toBeChecked();
    expect(screen.getByLabelText('Selected rotation')).toHaveValue('15°');
    const second = { ...editor, state: { ...editor.state, selection: new Set([1]) } };
    view.rerender(<PinEditorToolbar editor={second} />);
    expect(screen.getByRole('radio', { name: 'Triangle' })).toBeChecked();
    expect(screen.getByLabelText('Selected rotation')).toHaveValue('45°');
    fireEvent.change(screen.getByLabelText('Selected rotation'), { target: { value: '75' } });
    view.rerender(<PinEditorToolbar editor={editor} />);
    expect(screen.getByRole('radio', { name: 'Triangle' })).toBeChecked();
    expect(screen.getByLabelText('Selected rotation')).toHaveValue('75°');
    await user.click(screen.getByRole('radio', { name: 'Round' }));
    expect(screen.getByLabelText('Selected rotation')).toHaveValue('0°');
    expect(screen.getByLabelText('Selected rotation')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Apply shape' }));
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: 'geometry', geometry: { shape: 'round', rotation: 0 } });
    view.rerender(<PinEditorToolbar editor={{ ...editor, state: { ...editor.state, selection: new Set() } }} />);
    expect(screen.getByRole('button', { name: 'Shape' })).toBeDisabled();
    expect(screen.queryByRole('region', { name: 'Edit selected pin shapes' })).not.toBeInTheDocument();
    view.rerender(<PinEditorToolbar editor={second} />);
    await user.click(screen.getByRole('button', { name: 'Shape' }));
    await user.click(screen.getByRole('radio', { name: 'Square' }));
    expect(screen.getByLabelText('Selected rotation')).toHaveValue('75°');
    await user.click(screen.getByRole('button', { name: 'Use selected shape' }));
    expect(screen.getByRole('radio', { name: 'Triangle' })).toBeChecked();
    expect(screen.getByLabelText('Selected rotation')).toHaveValue('45°');
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Shape' })).toHaveFocus();
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('validates polygon angles, supports a slider, and compares effective rotation', async () => {
    const user = userEvent.setup();
    const { editor, dispatch } = geometryEditor([{ shape: 'square', rotation: 0 }, { shape: 'square', rotation: 360 }]);
    renderWithProviders(<PinEditorToolbar editor={editor} />);
    expect(screen.getByRole('status')).toHaveTextContent('Shape: Square · Rotation: 0°');
    await user.click(screen.getByRole('button', { name: 'Shape' }));
    for (const value of ['-1', '361', '']) {
      fireEvent.change(screen.getByLabelText('Selected rotation'), { target: { value } });
      expect(screen.getByRole('button', { name: 'Apply shape' })).toBeDisabled();
      fireEvent.keyDown(screen.getByLabelText('Selected rotation'), { key: 'Enter' });
    }
    expect(dispatch).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Selected rotation'), { target: { value: '360' } });
    await user.click(screen.getByRole('button', { name: 'Apply shape' }));
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: 'geometry', geometry: { shape: 'square', rotation: 0 } });
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Selected rotation slider' }), { key: 'ArrowLeft' });
    expect(screen.getByLabelText('Selected rotation')).toHaveValue('359°');
    expect(dispatch).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Selected rotation slider' }), { key: 'Enter' });
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'geometry', geometry: { shape: 'square', rotation: 359 } });
  });

  it('reloads mixed angles and blocks submission until a polygon angle is chosen', async () => {
    const user = userEvent.setup();
    const { editor, dispatch } = geometryEditor([{ shape: 'square', rotation: 15 }, { shape: 'square', rotation: 45 }]);
    renderWithProviders(<PinEditorToolbar editor={editor} />);
    await user.click(screen.getByRole('button', { name: 'Shape' }));
    expect(screen.getByRole('radio', { name: 'Square' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Apply shape' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Selected rotation'), { target: { value: '30' } });
    expect(screen.getByRole('button', { name: 'Apply shape' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Use selected shape' }));
    expect(screen.getByLabelText('Selected rotation')).toHaveAttribute('placeholder', 'Mixed');
    expect(screen.getByRole('button', { name: 'Apply shape' })).toBeDisabled();
    await user.click(screen.getByRole('radio', { name: 'Round' }));
    await user.click(screen.getByRole('button', { name: 'Apply shape' }));
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: 'geometry', geometry: { shape: 'round', rotation: 0 } });
  });

  it.each(['blocked', 'isDragging'] as const)('disables shape actions and closes the popup while %s', async busyFlag => {
    const user = userEvent.setup();
    const { editor, dispatch } = geometryEditor([{ shape: 'square', rotation: 30 }], [0]);
    const view = renderWithProviders(<PinEditorToolbar editor={editor} />);
    await user.click(screen.getByRole('button', { name: 'Shape' }));
    const input = screen.getByLabelText('Selected rotation');
    view.rerender(<PinEditorToolbar editor={{ ...editor, [busyFlag]: true }} />);
    expect(screen.getByRole('button', { name: 'Shape' })).toBeDisabled();
    expect(screen.queryByRole('region', { name: 'Edit selected pin shapes' })).not.toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('restores only default shape from the menu and includes shapes in reset confirmation', async () => {
    const user = userEvent.setup();
    const { editor, dispatch } = geometryEditor([{ shape: 'round', rotation: 75 }, { shape: 'round', rotation: 30 }]);
    editor.state.overrides.set(0, { height: 30 });
    renderWithProviders(<PinEditorToolbar editor={editor} />);
    expect(screen.getByRole('status')).toHaveTextContent('Shape: Round · Rotation: 0°');
    await user.click(screen.getByRole('button', { name: 'More pin actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Restore default shape' }));
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: 'reset', target: 'geometry' });
    await user.click(screen.getByRole('button', { name: 'More pin actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Reset all edits' }));
    expect(screen.getByRole('dialog', { name: 'Reset all edits?' })).toHaveTextContent('heights, colors and shapes');
    await user.click(screen.getByRole('button', { name: 'Reset edits' }));
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'reset', target: 'all' });
  });

  it('applies to the real selection and restores geometry without removing other edits, with undo and redo', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Fixture />);
    await user.click(screen.getByRole('button', { name: 'Pick first' }));
    await user.click(screen.getByRole('button', { name: 'Height' }));
    fireEvent.change(screen.getByLabelText('Selected height'), { target: { value: '30' } });
    await user.click(screen.getByRole('button', { name: 'Apply height' }));
    await openMaterial(user);
    await user.click(screen.getByRole('combobox', { name: 'Selection filament' }));
    await user.click(screen.getByRole('option', { name: 'Sakura Pink (11201)' }));
    await user.click(screen.getByRole('button', { name: 'Apply material' }));
    await user.click(screen.getByRole('button', { name: 'Shape' }));
    await user.click(screen.getByRole('radio', { name: 'Triangle' }));
    fireEvent.change(screen.getByLabelText('Selected rotation'), { target: { value: '45' } });
    await user.click(screen.getByRole('button', { name: 'Apply shape' }));
    expect(screen.getByRole('status')).toHaveTextContent('Shape: Triangle · Rotation: 45°');
    await user.click(screen.getByRole('button', { name: 'Pick second' }));
    expect(screen.getByRole('status')).toHaveTextContent('Shape: Round · Rotation: 0°');
    await user.click(screen.getByRole('button', { name: 'Pick first' }));
    await user.click(screen.getByRole('button', { name: 'More pin actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Restore default shape' }));
    expect(screen.getByRole('status')).toHaveTextContent('Shape: Round · Rotation: 0°');
    expect(screen.getByRole('status')).toHaveTextContent('Height: 30 mm · Material: #E8AFCF');
    expect(screen.getByText('30,20')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByRole('status')).toHaveTextContent('Shape: Triangle · Rotation: 45°');
    await user.click(screen.getByRole('button', { name: 'Redo' }));
    expect(screen.getByRole('status')).toHaveTextContent('Shape: Round · Rotation: 0°');
  });

  it('keeps nested picker Escape separate from closing the editor and returns focus on close', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Fixture />);
    await user.click(screen.getByRole('button', { name: 'Select all' }));
    await openMaterial(user);
    await user.click(screen.getByRole('combobox', { name: 'Selection filament' }));
    await user.keyboard('{Escape}');
    expect(screen.getByRole('region', { name: 'Edit selected pin materials' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Selection filament' })).toHaveAttribute('aria-expanded', 'false');
    await user.click(screen.getByRole('button', { name: 'Material editing help' }));
    expect(screen.getByRole('dialog', { name: 'Material editing help' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Material editing help' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Edit selected pin materials' })).toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: 'Selection filament' }));
    await user.keyboard('{Escape}{Escape}');
    expect(screen.queryByRole('region', { name: 'Edit selected pin materials' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Material' })).toHaveFocus();
  });
  it('updates selected RGB counts after painting, multiselection, and undo', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Fixture />);
    await user.click(screen.getByRole('button', { name: 'Pick first' }));
    await openMaterial(user);
    await user.click(screen.getByRole('combobox', { name: 'Selection filament' }));
    await user.click(screen.getByRole('option', { name: 'Sakura Pink (11201)' }));
    await user.click(screen.getByRole('button', { name: 'Apply material' }));
    await user.click(screen.getByRole('button', { name: 'Pick second' }));
    await user.click(screen.getByRole('button', { name: 'Toggle first' }));
    expect(screen.getByText('2 colors selected')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByText('1 color selected')).toBeInTheDocument();
  });
  it('shows Mixed for different catalog identities even when RGB and export profile match', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Fixture />);
    await user.click(screen.getByRole('button', { name: 'Pick first' }));
    await openMaterial(user);
    await user.click(screen.getByRole('combobox', { name: 'Selection filament' }));
    await user.click(screen.getByRole('option', { name: 'Blue (10600)' }));
    await user.click(screen.getByRole('button', { name: 'Apply material' }));
    await user.click(screen.getByRole('button', { name: 'Pick second' }));
    await openMaterial(user);
    await user.click(screen.getByRole('combobox', { name: 'Selection filament' }));
    await user.click(screen.getByRole('option', { name: 'Blue (10601)' }));
    await user.click(screen.getByRole('button', { name: 'Apply material' }));
    await user.click(screen.getByRole('button', { name: 'Toggle first' }));
    expect(screen.getByText(/Material: Mixed/)).toBeInTheDocument();
    expect(screen.getByText('1 color selected')).toBeInTheDocument();
    await openMaterial(user);
    expect(screen.getByRole('combobox', { name: 'Selection filament' })).toHaveValue('Blue (10601)');
    expect(screen.getByRole('button', { name: 'Apply material' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Use selected material' }));
    expect(screen.getByRole('combobox', { name: 'Selection filament' })).toHaveAttribute('placeholder', 'Mixed');
    expect(screen.getByRole('button', { name: 'Apply material' })).toBeDisabled();
  });
  it('offers selection and history without a navigation mode or expanded editing fields', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Fixture />);
    expect(screen.getByRole('toolbar', { name: 'Edit pins' })).toBeInTheDocument();
    expect(screen.queryByText('Navigate')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Selected height')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Height' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Shape' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Select all' }));
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.getByText('0 selected')).toBeInTheDocument();
  });
  it('edits from a height popover, supports Enter, and restores from the more menu', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Fixture />);
    await user.click(screen.getByRole('button', { name: 'Select all' }));
    await user.click(screen.getByRole('button', { name: 'Height' }));
    fireEvent.change(screen.getByLabelText('Selected height'), { target: { value: '30' } });
    fireEvent.keyDown(screen.getByLabelText('Selected height'), { key: 'Enter' });
    expect(screen.getByRole('status')).toHaveTextContent('Height: 30 mm');
    expect(screen.getByText('30,30')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'More pin actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Restore generated heights' }));
    expect(screen.getByText('20,20')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByText('30,30')).toBeInTheDocument();
  });
  it('keeps printable color edits in their own popover and history', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Fixture />);
    await user.click(screen.getByRole('button', { name: 'Select all' }));
    await user.click(screen.getByRole('button', { name: 'Material' }));
    await user.click(screen.getByRole('combobox', { name: 'Selection filament' }));
    await user.click(screen.getByRole('option', { name: 'Custom color' }));
    fireEvent.change(screen.getByLabelText('Selection color'), { target: { value: '#ff0000' } });
    await user.click(screen.getByRole('button', { name: 'Apply material' }));
    expect(screen.getByRole('status')).toHaveTextContent('Material: #FF0000');
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();
    expect(screen.queryByLabelText('Base color')).not.toBeInTheDocument();
    expect(screen.getByText('1 color selected')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close pin editor' }));
    expect(screen.getByRole('button', { name: 'Material' })).toHaveFocus();
    expect(screen.queryByLabelText('Selection filament')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await openMaterial(user);
    expect(screen.getByLabelText('Selection color')).toHaveValue('#ff0000');
    await user.click(screen.getByRole('button', { name: 'Use selected material' }));
    expect(screen.getByRole('combobox', { name: 'Selection filament' })).toHaveValue('Turquoise (10605)');
  });
  it('reuses height drafts between pins, clear selection and reopening, without silently changing pins', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Fixture />);
    await user.click(screen.getByRole('button', { name: 'Pick first' }));
    await user.click(screen.getByRole('button', { name: 'Height' }));
    fireEvent.change(screen.getByLabelText('Selected height'), { target: { value: '32' } });
    await user.click(screen.getByRole('button', { name: 'Apply height' }));
    await user.click(screen.getByRole('button', { name: 'Clear selection' }));
    await user.click(screen.getByRole('button', { name: 'Pick second' }));
    await user.click(screen.getByRole('button', { name: 'Height' }));
    expect(screen.getByLabelText('Selected height')).toHaveValue('32 mm');
    expect(screen.getByText('32,20')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Apply height' }));
    expect(screen.getByText('32,32')).toBeInTheDocument();
    await user.click(screen.getByText('Offset extension', { exact: true }));
    fireEvent.change(screen.getByLabelText('Height offset'), { target: { value: '3' } });
    await user.click(screen.getByText('Set extension', { exact: true }));
    expect(screen.getByLabelText('Selected height')).toHaveValue('32 mm');
    await user.click(screen.getByText('Offset extension', { exact: true }));
    expect(screen.getByLabelText('Height offset')).toHaveValue('3 mm');
    await user.click(screen.getByRole('button', { name: 'Use selected height' }));
    expect(screen.getByLabelText('Height offset')).toHaveValue('0 mm');
  });
  it('reuses a chosen preset for another pin and a mixed selection', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Fixture />);
    await user.click(screen.getByRole('button', { name: 'Pick first' }));
    await openMaterial(user);
    await user.click(screen.getByRole('combobox', { name: 'Selection filament' }));
    await user.click(screen.getByRole('option', { name: 'Sakura Pink (11201)' }));
    await user.click(screen.getByRole('button', { name: 'Apply material' }));
    await user.click(screen.getByRole('button', { name: 'Pick second' }));
    expect(screen.getByRole('combobox', { name: 'Selection filament' })).toHaveValue('Sakura Pink (11201)');
    await user.click(screen.getByRole('button', { name: 'Toggle first' }));
    expect(screen.getByText(/Material: Mixed/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply material' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Apply material' }));
    expect(screen.getByText('1 color selected')).toBeInTheDocument();
  });
});
