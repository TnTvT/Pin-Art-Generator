import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../test/render';
import { DEFAULTS } from '../pin-design/model';
import usePinEditor from './usePinEditor';
import PinEditorToolbar from './PinEditorToolbar';

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
    await user.click(screen.getByText('Offset height', { exact: true }));
    fireEvent.change(screen.getByLabelText('Height offset'), { target: { value: '3' } });
    await user.click(screen.getByText('Set height', { exact: true }));
    expect(screen.getByLabelText('Selected height')).toHaveValue('32 mm');
    await user.click(screen.getByText('Offset height', { exact: true }));
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
