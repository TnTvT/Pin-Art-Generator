import { useMemo, useState } from 'react';
import { Alert, Button, Group, Modal, Tooltip } from '@mantine/core';
import InfoPopover from '../../components/InfoPopover/InfoPopover';
import { getFilament } from '../filaments/catalog';
import FilamentColorField from '../filaments/FilamentColorField';
import { materialKey, type MaterialSelection } from '../filaments/materials';
import type { ColorMappingResult } from './color-mapping';

interface GeneratedPaletteProps {
  colors: ColorMappingResult;
  resolvedMaterials?: readonly MaterialSelection[];
  disabled?: boolean;
  error?: string | null;
  onReplace?: (source: MaterialSelection, replacement: MaterialSelection) => void;
}

function sameMaterial(first: MaterialSelection, second: MaterialSelection) {
  return first.color.toLowerCase() === second.color.toLowerCase() && first.filamentId === second.filamentId;
}

function materialName(material: MaterialSelection) {
  const filament = material.filamentId ? getFilament(material.filamentId) : null;
  return filament ? `${filament.color} · ${filament.type}` : `Custom ${material.color.toUpperCase()}`;
}

function MaterialDetails({ material }: { material: MaterialSelection }) {
  const filament = material.filamentId ? getFilament(material.filamentId) : null;
  const rgb = [1, 3, 5].map(start => parseInt(material.color.slice(start, start + 2), 16));
  return <div className="design-color-tooltip"><strong>{filament ? `${filament.color} (${filament.code})` : 'Custom color'}</strong>
    <span>{filament ? `${filament.brand} · PLA ${filament.type}` : 'Generic PLA'}</span>
    <span>{material.color.toUpperCase()} · RGB {rgb.join(', ')}</span></div>;
}

export default function GeneratedPalette({ colors, resolvedMaterials, disabled = false, error, onReplace }: GeneratedPaletteProps) {
  const [editing, setEditing] = useState<{ mapping: ColorMappingResult; key: string; material: MaterialSelection } | null>(null);
  const groups = useMemo(() => {
    const current = new Map<string, { material: MaterialSelection; mixed: boolean }>();
    colors.materials.forEach((source, index) => {
      const key = materialKey(source);
      const material = resolvedMaterials?.[index] ?? source;
      const group = current.get(key);
      if (!group) current.set(key, { material, mixed: false });
      else if (!sameMaterial(group.material, material)) group.mixed = true;
    });
    return colors.palette.map(usage => ({ ...usage, key: materialKey(usage.material), current: current.get(materialKey(usage.material))! }));
  }, [colors, resolvedMaterials]);
  const active = editing?.mapping === colors ? groups.find(group => group.key === editing.key) : undefined;
  const unchanged = active && !active.current.mixed && sameMaterial(active.current.material, editing!.material);
  const blocked = disabled || !onReplace;

  return <div className="mapping-palette" aria-label="Generated palette">
    <div className="section-title"><strong>Generated palette · {colors.palette.length} {colors.palette.length === 1 ? 'material' : 'materials'}</strong>
      <InfoPopover label="Generated group editing help"><p>Click a group to replace the material of all its pins, including manually colored pins. Membership and heights stay unchanged. Different groups stay separate even when assigned the same color. Undo restores the whole group. Changing image or mapping settings generates new groups; your pin edits remain.</p></InfoPopover></div>
    {groups.map(group => {
      const filament = getFilament(group.material.filamentId!);
      const changed = group.current.mixed || !sameMaterial(group.material, group.current.material);
      return <Tooltip key={group.key} withArrow multiline position="right" events={{ hover: true, focus: true, touch: true }}
        label={<div><MaterialDetails material={group.material} />{changed && <><strong>Current group: {group.current.mixed ? 'Mixed' : materialName(group.current.material)}</strong>
          {!group.current.mixed && <MaterialDetails material={group.current.material} />}</>}<p>Click to change this group’s material.</p></div>}>
        <button type="button" className="mapping-palette-item" disabled={blocked} aria-label={`Edit ${filament?.color ?? group.material.color} ${filament?.type ?? 'custom'} group`}
          onClick={() => setEditing({ mapping: colors, key: group.key, material: group.current.mixed ? group.material : group.current.material })}>
          <i style={{ backgroundColor: group.material.color }} aria-hidden="true" /><span>{materialName(group.material)}{changed && <> → {group.current.mixed ? 'Mixed' : materialName(group.current.material)}</>}</span>
          <small>{group.count.toLocaleString('en-US')} {group.count === 1 ? 'pin' : 'pins'}</small><span aria-hidden="true">↗</span>
        </button>
      </Tooltip>;
    })}
    <span>Click a group to change its material. Counts use the original matched groups.</span>
    {colors.notice && <p className="mapping-description">{colors.notice}</p>}
    <Modal opened={!!active} onClose={() => setEditing(null)} title="Change group material" zIndex={400} centered>
      {active && editing && <>
        <p>{active.count.toLocaleString('en-US')} pins matched to {materialName(active.material)}. Replace every pin in this group without changing heights or membership.</p>
        <FilamentColorField label="Group color" value={editing.material} disabled={blocked} withinPortal={false} onChange={material => setEditing({ ...editing, material })} />
        {error && <Alert color="red" title="Group not changed" mt="sm">{error}</Alert>}
        <Group justify="flex-end" mt="md"><Button variant="default" onClick={() => setEditing(null)}>Done</Button>
          <Button disabled={blocked || !!unchanged} onClick={() => onReplace?.(active.material, editing.material)}>Apply to group</Button></Group>
      </>}
    </Modal>
  </div>;
}
