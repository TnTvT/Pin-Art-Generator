import type { Parameters } from '../pin-design/model';
import { resolvePinGeometries, type PinShape } from './geometry';

const options: { value: PinShape; label: string }[] = [
  { value: 'round', label: 'Round' },
  { value: 'square', label: 'Square' },
  { value: 'triangle', label: 'Triangle' }
];

export const TRIANGLE_FIXED_ONLY = 'Triangle pins are available only in Fixed sculpture. Change Triangle pins to Round or Square before using Print-in-place.';

export function pinShapeOptions(mode?: NonNullable<Parameters['construction']>['mode']) {
  return options.filter(option => mode !== 'print-in-place' || option.value !== 'triangle');
}

export function validatePinShapeAvailability(parameters: Parameters) {
  if (parameters.construction?.mode === 'print-in-place' && resolvePinGeometries(parameters).some(geometry => geometry.shape === 'triangle')) {
    throw new Error(TRIANGLE_FIXED_ONLY);
  }
}
