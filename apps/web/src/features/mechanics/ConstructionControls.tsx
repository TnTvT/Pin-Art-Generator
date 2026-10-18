import { Accordion, Alert, Button, SegmentedControl } from '@mantine/core';
import ShapeNumberField from '../base-shape/ShapeNumberField';
import InfoPopover from '../../components/InfoPopover/InfoPopover';
import type { Construction } from './model';
import { DEFAULT_LOWER_HEAD_GAP, DEFAULT_LOWER_HEAD_ANGLE } from './dimensions';
import { TRIANGLE_FIXED_ONLY } from '../pin-shape/availability';
import { formatDimension } from '../pin-design/model';

export default function ConstructionControls({ value, onChange, disabled, hasTrianglePins = false, suggestedSpacing, onUseSuggestedSpacing }: { value: Construction; onChange: (value: Construction) => void; disabled: boolean; hasTrianglePins?: boolean; suggestedSpacing?: number; onUseSuggestedSpacing?: (spacing: number) => void }) {
  return <div className="export-settings construction-controls">
    <div className="section-title"><h3>Construction</h3><InfoPopover label="Construction help">
      <p>Fixed sculpture joins pins to the base. Print-in-place uses a through-hole guide base and separate pins with top and bottom retaining heads, printed together without assembly.</p>
      <p>Pin extension is measured from the base top to the pin top, including the head, in its initial printing position. It is not the total pin length or sliding travel.</p>
      <p>Switching to Print-in-place raises Pin spacing when needed to leave room for the retaining heads and guide mouths. Larger spacing and all other parameters are kept. Layout changes still require confirmation when you have pin edits.</p>
      <p>A thicker base gives pins a longer straight guide. The straight guide length is Base thickness minus both tapered mouth heights. We show a tilt advisory when it is shorter than one Pin size; this is a geometry-based heuristic, not a predicted angle or a pass/fail printing limit. Longer guides can still have play, depending on clearance, pin extension and print tolerances. Keep release gaps that already print well rather than tightening them just to remove wobble.</p>
      <p>Clearance needs a physical fit sample. These defaults do not guarantee release, smooth sliding, or position holding. Keep support, brim and other slicer structures out of the gaps.</p>
    </InfoPopover></div>
    <SegmentedControl aria-label="Construction mode" fullWidth size="xs" value={value.mode} disabled={disabled}
      data={[{ label: 'Fixed sculpture', value: 'fixed' }, { label: 'Print-in-place', value: 'print-in-place', disabled: hasTrianglePins }]}
      onChange={mode => { if (mode !== 'print-in-place' || !hasTrianglePins) onChange({ ...value, mode: mode as Construction['mode'] }); }} />
    {hasTrianglePins && <p className="field-help" role="status">{TRIANGLE_FIXED_ONLY}</p>}
    {value.mode === 'print-in-place' && suggestedSpacing !== undefined && onUseSuggestedSpacing && <Alert color="orange" title="Print-in-place needs more spacing">
      <p>The current spacing leaves too little material around the pin holes. You are seeing the last valid preview. Apply the suggested spacing or adjust your parameters; your pending base shape is kept.</p>
      <Button size="xs" variant="light" disabled={disabled} onClick={() => onUseSuggestedSpacing(suggestedSpacing)}>Use {formatDimension(suggestedSpacing)} mm spacing</Button>
    </Alert>}
    {value.mode === 'print-in-place' && <Accordion variant="default" order={4}>
      <Accordion.Item value="mechanics"><Accordion.Control>Advanced settings</Accordion.Control><Accordion.Panel>
        <div className="field-pair">
          <ShapeNumberField label="Sliding clearance" value={value.sliding.clearance} disabled={disabled} onChange={clearance => onChange({ ...value, sliding: { ...value.sliding, clearance } })} />
          <ShapeNumberField label="Head flare" value={value.sliding.headFlare} disabled={disabled} onChange={headFlare => onChange({ ...value, sliding: { ...value.sliding, headFlare } })} />
        </div>
        <ShapeNumberField label="Lower taper angle (°)" millimeters={false} maximum={89.9} value={value.sliding.lowerHeadAngle ?? DEFAULT_LOWER_HEAD_ANGLE} disabled={disabled} onChange={lowerHeadAngle => onChange({ ...value, sliding: { ...value.sliding, lowerHeadAngle } })} />
        <ShapeNumberField label="Lower head surface gap" value={value.sliding.lowerHeadGap ?? DEFAULT_LOWER_HEAD_GAP} disabled={disabled} onChange={lowerHeadGap => onChange({ ...value, sliding: { ...value.sliding, lowerHeadGap } })} />
        <InfoPopover label="Mechanical dimensions help"><p>Sliding clearance is total: half on each shaft wall. Head flare controls both heads' outward width. Lower taper angle is measured from the print bed; the lower head and matching mouth default to 45°. Lower head surface gap defaults to 0.3 mm and is the shortest distance between their sloping surfaces, not a horizontal gap or distance to the print bed. Mouth width and depth are calculated from that gap and angle, with a small correction for rounded mesh facets. Shaft clearance, head widths, upper head and upper mouth stay unchanged; upper tapers remain 45°. Steeper angles or larger gaps may need more base thickness or spacing. The guide section must be at least 1 mm thick; guide walls 0.8 mm; mouth walls and head gaps 0.2 mm. These are model dimensions, not a guarantee of physical release.</p></InfoPopover>
      </Accordion.Panel></Accordion.Item>
    </Accordion>}
  </div>;
}
