import { useEffect, useId, useRef, useState } from 'react';
import { ActionIcon, Alert, Button, Group, Menu, Modal, NumberInput, SegmentedControl, Tooltip } from '@mantine/core';
import InfoPopover from '../../components/InfoPopover/InfoPopover';
import FilamentColorField from '../filaments/FilamentColorField';
import { DEFAULT_MODEL_MATERIALS, type MaterialSelection } from '../filaments/materials';
import type { HeightMode } from './model';
import type { PinEditor } from './usePinEditor';
import { summarizeColors } from './color-summary';

export default function PinEditorToolbar({ editor, columns = 1, parameters }: { editor: PinEditor; columns?: number; parameters?: import('../pin-design/model').Parameters }) {
  const { state, committed, isDragging, blocked } = editor;
  const busy = isDragging || blocked;
  const [heightDrafts, setHeightDrafts] = useState<Partial<Record<HeightMode, number | string>>>({});
  const [materialDraft, setMaterialDraft] = useState<MaterialSelection | null>(null);
  const [popover, setPopover] = useState<'height' | 'material' | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const heightButton = useRef<HTMLButtonElement>(null);
  const materialButton = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const colorSummary = summarizeColors(state.base, committed.pinSelections, state.selection);
  const selected = [...state.selection];
  const first = selected[0];
  const selectedHeight = first === undefined ? null : editor.heights[first];
  const mixedHeight = selected.some(index => editor.heights[index] !== selectedHeight);
  const mixedMaterial = selected.some(index => committed.pinSelections[index].color !== committed.pinSelections[first].color || committed.pinSelections[index].filamentId !== committed.pinSelections[first].filamentId);
  const value = heightDrafts[editor.heightMode] ?? (editor.heightMode === 'offset' ? 0 : first === undefined ? 20 : mixedHeight ? '' : committed.heights[first]);
  const material = materialDraft ?? (first === undefined ? DEFAULT_MODEL_MATERIALS.pins : committed.pinSelections[first]);
  const materialDirty = materialDraft !== null;
  useEffect(() => { if (!state.selection.size || busy) setPopover(null); }, [state.selection, busy]);
  const disabled = busy || !selected.length;

  function applyHeight() {
    if (typeof value === 'number' && Number.isFinite(value) && !disabled) {
      setHeightDrafts(current => ({ ...current, [editor.heightMode]: value }));
      editor.dispatch({ type: 'height', heights: committed.heights, value, mode: editor.heightMode });
    }
  }
  function selectAll() { editor.select(Array.from({ length: state.count }, (_, index) => index), 'replace'); }
  function closePanel() {
    (popover === 'height' ? heightButton : materialButton).current?.focus();
    setPopover(null);
  }

  return <div className="pin-editor-dock" data-expanded={popover !== null}>
    {editor.error && <Alert color="red" title="Edit not applied" className="pin-editor-error">{editor.error}</Alert>}
    <div className="pin-editor-toolbar" role="toolbar" aria-label="Edit pins">
      <div className="selection-summary" role="status">
        <strong>{selected.length.toLocaleString('en-US')} selected</strong>
        <span>{colorSummary.selected.length} {colorSummary.selected.length === 1 ? 'color' : 'colors'} selected</span>
        <div className="color-swatches" aria-label="Selected colors">{colorSummary.selected.map(color => <i key={color} title={color.toUpperCase()} style={{ backgroundColor: color }} />)}</div>
        {selected.length === 1 && <small>{parameters?.layout ? `Pin ${parameters.layout.pins[first].id} · X ${parameters.layout.pins[first].x.toFixed(2)}, Y ${parameters.layout.pins[first].y.toFixed(2)} mm` : `Row ${Math.floor(first / columns) + 1}, column ${first % columns + 1}`}</small>}
        {!!selected.length && <span>Height: {mixedHeight ? 'Mixed' : `${Number(selectedHeight!.toFixed(2))} mm`} · Material: {mixedMaterial ? 'Mixed' : committed.pinSelections[first].color.toUpperCase()}</span>}
      </div>
      {!selected.length && <Button variant="subtle" size="xs" disabled={busy} onClick={selectAll}>Select all</Button>}
      <Button ref={heightButton} variant="default" size="xs" disabled={disabled} aria-label="Height" aria-expanded={popover === 'height'} aria-controls={popover === 'height' ? panelId : undefined} onClick={() => setPopover(popover === 'height' ? null : 'height')}>Height <span aria-hidden="true">▾</span></Button>
      <Button ref={materialButton} variant="default" size="xs" disabled={disabled} aria-label="Material" aria-expanded={popover === 'material'} aria-controls={popover === 'material' ? panelId : undefined} onClick={() => setPopover(popover === 'material' ? null : 'material')}>Material <span aria-hidden="true">▾</span></Button>
      <div className="pin-editor-history">
        <Tooltip label="Undo (⌘ / Ctrl Z)"><ActionIcon variant="subtle" color="gray" size={30} aria-label="Undo" disabled={busy || !state.past.length} onClick={() => editor.dispatch({ type: 'undo' })}>↶</ActionIcon></Tooltip>
        <Tooltip label="Redo (⌘ / Ctrl Shift Z)"><ActionIcon variant="subtle" color="gray" size={30} aria-label="Redo" disabled={busy || !state.future.length} onClick={() => editor.dispatch({ type: 'redo' })}>↷</ActionIcon></Tooltip>
      </div>
      <Menu position="bottom-start" shadow="md">
        <Menu.Target><ActionIcon variant="subtle" color="gray" size={30} aria-label="More pin actions" disabled={busy}>⋯</ActionIcon></Menu.Target>
        <Menu.Dropdown>
          <Menu.Item className="pin-editor-mobile-action" disabled={busy || !state.past.length} onClick={() => editor.dispatch({ type: 'undo' })}>Undo</Menu.Item>
          <Menu.Item className="pin-editor-mobile-action" disabled={busy || !state.future.length} onClick={() => editor.dispatch({ type: 'redo' })}>Redo</Menu.Item>
          <Menu.Item onClick={selectAll}>Select all</Menu.Item>
          <Menu.Item className="pin-editor-mobile-action" disabled={disabled} onClick={() => editor.select([], 'replace')}>Clear selection</Menu.Item>
          <Menu.Item disabled={disabled} onClick={() => editor.dispatch({ type: 'reset', target: 'height' })}>Restore generated heights</Menu.Item>
          <Menu.Item disabled={disabled} onClick={() => editor.dispatch({ type: 'reset', target: 'material' })}>Restore generated colors</Menu.Item>
          <Menu.Divider />
          <Menu.Item disabled={busy || !state.overrides.size && !state.past.length} onClick={() => setConfirmReset(true)}>Reset all edits</Menu.Item>
        </Menu.Dropdown>
      </Menu>
      {!!selected.length && <Tooltip label="Clear selection"><ActionIcon className="pin-editor-clear" variant="subtle" color="gray" size={30} aria-label="Clear selection" disabled={isDragging} onClick={() => editor.select([], 'replace')}>×</ActionIcon></Tooltip>}
    </div>
    {popover && <section id={panelId} className="pin-editor-flyout" aria-label={popover === 'height' ? 'Edit selected pin heights' : 'Edit selected pin materials'} onKeyDown={event => {
      if (!event.currentTarget.contains(event.target as Node) || (event.target as HTMLElement).closest('[role="combobox"][aria-expanded="true"]')) return;
      if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); closePanel(); }
    }}>
      <div className="editor-panel-heading"><h3>{popover === 'height' ? 'Pin height' : 'Pin material'}</h3>
        <InfoPopover label={popover === 'height' ? 'Height editing help' : 'Material editing help'}>
          {popover === 'height' ? <p>Set makes selected heights equal. Offset preserves their differences. Each operation remembers your input when you select another pin. Use selected height reloads the selection. Drag the ↑ handle to adjust visually; Escape cancels a drag.</p> : <p>Your chosen material is remembered for the next selection until you use selected material. Bambu PLA Basic and Matte keep their official X1C presets. Custom colors use Generic PLA. Up to 16 used materials, including the base. Color counts group RGB values, not filament profiles.</p>}
        </InfoPopover>
        <ActionIcon variant="subtle" color="gray" size={28} aria-label="Close pin editor" onClick={closePanel}>×</ActionIcon>
      </div>
      {popover === 'height' ? <>
          <fieldset className="export-mode"><legend>Height operation</legend>
            <SegmentedControl fullWidth value={editor.heightMode} onChange={next => editor.setHeightMode(next as HeightMode)} disabled={busy}
              data={[{ label: 'Set height', value: 'set' }, { label: 'Offset height', value: 'offset' }]} size="sm" />
          </fieldset>
          <NumberInput label={editor.heightMode === 'set' ? 'Selected height' : 'Height offset'} value={value} placeholder={mixedHeight && editor.heightMode === 'set' ? 'Mixed' : undefined}
            onChange={next => setHeightDrafts(current => ({ ...current, [editor.heightMode]: next }))} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); applyHeight(); } }} suffix=" mm" step={0.1} decimalScale={2} clampBehavior="none" disabled={disabled} size="sm"
            error={typeof value === 'number' && Number.isFinite(value) || value === '' && mixedHeight ? undefined : 'Enter a number, then Apply.'} />
          <Group gap="xs"><Button size="xs" disabled={disabled || typeof value !== 'number'} onClick={applyHeight}>Apply height</Button>
            <Button variant="subtle" size="xs" disabled={disabled} onClick={() => setHeightDrafts(current => { const next = { ...current }; delete next[editor.heightMode]; return next; })}>Use selected height</Button></Group>
      </> : <>
          <FilamentColorField label="Selection color" value={material} mixed={mixedMaterial && !materialDirty}
            onChange={setMaterialDraft} disabled={disabled} />
          <Group gap="xs"><Button size="xs" disabled={disabled || mixedMaterial && !materialDirty} onClick={() => { setMaterialDraft(material); editor.dispatch({ type: 'material', target: 'selection', material }); }}>Apply material</Button>
            <Button variant="subtle" size="xs" disabled={disabled} onClick={() => setMaterialDraft(null)}>Use selected material</Button></Group>
      </>}
    </section>}
    <Modal opened={confirmReset} onClose={() => setConfirmReset(false)} title="Reset all edits?" centered>
      <p>Restore generated heights and colors for every pin and the default base material. Your image and mapping settings are kept. You can undo this change.</p>
      <Group justify="flex-end"><Button variant="default" onClick={() => setConfirmReset(false)}>Cancel</Button>
        <Button disabled={busy} onClick={() => { editor.dispatch({ type: 'reset', target: 'all' }); setConfirmReset(false); }}>Reset edits</Button></Group>
    </Modal>
  </div>;
}
