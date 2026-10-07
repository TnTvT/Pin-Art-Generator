import { Accordion, SegmentedControl } from '@mantine/core';
import ShapeNumberField from '../base-shape/ShapeNumberField';
import InfoPopover from '../../components/InfoPopover/InfoPopover';
import type { Construction } from './model';

export default function ConstructionControls({ value, onChange, disabled }: { value: Construction; onChange: (value: Construction) => void; disabled: boolean }) {
  return <div className="export-settings construction-controls">
    <div className="section-title"><h3>Construction</h3><InfoPopover label="Construction help">
      <p>Fixed sculpture joins pins to the base. Print-in-place uses a through-hole guide base and separate pins with top and bottom retaining heads, printed together without assembly.</p>
      <p>Pin extension is measured from the base top to the pin top, including the head, in its initial printing position. It is not the total pin length or sliding travel.</p>
      <p>Clearance needs a physical fit sample. These defaults do not guarantee release, smooth sliding, or position holding. Keep support, brim and other slicer structures out of the gaps.</p>
    </InfoPopover></div>
    <SegmentedControl aria-label="Construction mode" fullWidth size="xs" value={value.mode} disabled={disabled}
      data={[{ label: 'Fixed sculpture', value: 'fixed' }, { label: 'Print-in-place', value: 'print-in-place' }]}
      onChange={mode => onChange({ ...value, mode: mode as Construction['mode'] })} />
    {value.mode === 'print-in-place' && <Accordion variant="default" order={4}>
      <Accordion.Item value="mechanics"><Accordion.Control>Advanced settings</Accordion.Control><Accordion.Panel>
        <div className="field-pair">
          <ShapeNumberField label="Sliding clearance" value={value.sliding.clearance} disabled={disabled} onChange={clearance => onChange({ ...value, sliding: { ...value.sliding, clearance } })} />
          <ShapeNumberField label="Head flare" value={value.sliding.headFlare} disabled={disabled} onChange={headFlare => onChange({ ...value, sliding: { ...value.sliding, headFlare } })} />
        </div>
        <InfoPopover label="Mechanical dimensions help"><p>Sliding clearance is total: half on each wall. Head flare is the outward offset and tapered head height. The guide section must be at least 1 mm thick; guide walls 0.8 mm; mouth walls and head gaps 0.2 mm.</p></InfoPopover>
      </Accordion.Panel></Accordion.Item>
    </Accordion>}
  </div>;
}
