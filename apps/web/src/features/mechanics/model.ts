import { formatDimension, getPinPositions, type Parameters } from '../pin-design/model';
import { createPinContainment, geometryParameters, minimumPinClearance, pinVertices, resolvePinGeometries, type PinShape } from '../pin-shape/geometry';
import type { Point, Region } from '../base-shape/layout';
import { DEFAULT_LOWER_HEAD_GAP, DEFAULT_LOWER_HEAD_ANGLE, guideDimensions, type SlidingSettings } from './dimensions';

export interface Construction {
  mode: 'fixed' | 'print-in-place';
  sliding: SlidingSettings;
}
export const DEFAULT_CONSTRUCTION: Construction = { mode: 'fixed', sliding: { clearance: 0.6, headFlare: 0.7, lowerHeadGap: DEFAULT_LOWER_HEAD_GAP, lowerHeadAngle: DEFAULT_LOWER_HEAD_ANGLE } };

export class MechanicalSpacingError extends Error {
  constructor(readonly suggestedSpacing: number) {
    super(`Guide walls must be at least 0.8 mm; mouth walls and head gaps at least 0.2 mm. Try Pin spacing ${suggestedSpacing} mm or reduce pin size.`);
    this.name = 'MechanicalSpacingError';
  }
}

function requiredPinClearance(sliding: SlidingSettings) {
  const { clearance, headFlare } = sliding;
  const { lowerMouthOffset, upperMouthOffset } = guideDimensions(sliding);
  return Math.max(2 * headFlare + 0.2, clearance + 0.8, 2 * Math.max(lowerMouthOffset, upperMouthOffset) + 0.2);
}

export function minimumPrintInPlaceSpacing(diameter: number, sliding: SlidingSettings) {
  return Math.ceil((diameter + requiredPinClearance(sliding)) * 10 - 1e-8) / 10;
}

export function profilePoints(shape: PinShape, diameter: number, offset = 0): Point[] {
  if (shape === 'round') return pinVertices(shape, diameter + 2 * offset);
  const vertices = pinVertices(shape, diameter);
  if (offset === 0) return vertices;
  return vertices.flatMap((vertex, index) => {
    const previous = vertices[(index + vertices.length - 1) % vertices.length], next = vertices[(index + 1) % vertices.length];
    const first = Math.atan2(previous[0] - vertex[0], vertex[1] - previous[1]);
    const last = Math.atan2(vertex[0] - next[0], next[1] - vertex[1]);
    const sweep = (last - first + Math.PI * 2) % (Math.PI * 2), steps = Math.max(1, Math.floor(sweep * 32 / Math.PI + 0.5));
    return Array.from({ length: steps + 1 }, (_, step) => {
      const angle = first + sweep * step / steps;
      return [vertex[0] + offset * Math.cos(angle), vertex[1] + offset * Math.sin(angle)] as Point;
    });
  });
}

export function baseRegions(parameters: Parameters): Region[] {
  return parameters.layout?.regions ?? [{ outer: [[-parameters.width / 2, -parameters.depth / 2], [parameters.width / 2, -parameters.depth / 2], [parameters.width / 2, parameters.depth / 2], [-parameters.width / 2, parameters.depth / 2]], holes: [] }];
}

export function mechanicalPadding(parameters: Parameters) {
  if (parameters.construction?.mode !== 'print-in-place') return 0;
  const { clearance, headFlare } = parameters.construction.sliding;
  const { lowerMouthOffset, upperMouthOffset } = guideDimensions(parameters.construction.sliding);
  return Math.max((parameters.layout?.edgePadding ?? 0) + headFlare, clearance / 2 + 0.8, Math.max(lowerMouthOffset, upperMouthOffset) + 0.2);
}

export function validateMechanics(parameters: Parameters, heights?: Float32Array) {
  if (parameters.construction?.mode !== 'print-in-place') return;
  const { clearance, headFlare } = parameters.construction.sliding;
  const { lowerMouthHeight, upperMouthHeight, lowerHeadHeight, upperHeadHeight } = guideDimensions(parameters.construction.sliding);
  if (![clearance, headFlare].every(value => Number.isFinite(value) && value > 0)) throw new Error('Sliding clearance and Head flare must be positive finite numbers.');
  if (headFlare - clearance / 2 < 0.2 - 1e-6) throw new Error('Head flare must exceed half the Sliding clearance by at least 0.2 mm.');
  if (parameters.thickness - lowerMouthHeight - upperMouthHeight < 1 - 1e-6) throw new Error('Guide thickness must be at least 1 mm. Increase base thickness or reduce Lower taper angle, Head flare or Lower head surface gap.');
  if ((heights ?? [parameters.extension]).some(value => !Number.isFinite(value) || value < 2 * headFlare - 1e-6)) throw new Error('Every pin extension must be at least twice the Head flare.');
  if ((heights ?? [parameters.extension]).some(value => parameters.thickness + value <= lowerHeadHeight + upperHeadHeight)) throw new Error('Retaining head tapers must leave a positive shaft length. Increase pin extension or reduce Lower taper angle or Head flare.');
  const pins = getPinPositions(parameters), geometries = resolvePinGeometries(parameters), regions = baseRegions(parameters);
  const checks = new Map<string, ReturnType<typeof createPinContainment>>();
  const required = mechanicalPadding(parameters);
  for (let index = 0; index < pins.length; index++) {
    const geometry = geometries[index], key = `${geometry.shape}:${geometry.rotation}`;
    if (!checks.has(key)) checks.set(key, createPinContainment(regions, geometryParameters(parameters, geometry)));
    if (!checks.get(key)!(pins[index].x, pins[index].y, required)) throw new Error(`Pin ${pins[index].id} needs more head padding or guide/mouth edge wall. Increase Edge padding or base size.`);
  }
  const gap = minimumPinClearance(parameters, pins);
  const minimum = requiredPinClearance(parameters.construction.sliding);
  if (gap !== null && gap < minimum - 1e-6) {
    const suggestedSpacing = Math.ceil(Math.max(parameters.spacing + 0.1, parameters.diameter + minimum) * 10 - 1e-8) / 10;
    throw new MechanicalSpacingError(suggestedSpacing);
  }
}

export function mechanicalWarnings(parameters: Parameters) {
  if (parameters.construction?.mode !== 'print-in-place') return [];
  const { lowerMouthOffset, upperMouthOffset, lowerMouthHeight, upperMouthHeight } = guideDimensions(parameters.construction.sliding);
  const mouthOffset = Math.max(lowerMouthOffset, upperMouthOffset);
  const gap = minimumPinClearance(parameters, getPinPositions(parameters));
  const thin = gap !== null && gap - 2 * mouthOffset < 0.8 - 1e-6;
  const edgeThin = (() => {
    const checks = new Map<string, ReturnType<typeof createPinContainment>>(), regions = baseRegions(parameters), pins = getPinPositions(parameters);
    return resolvePinGeometries(parameters).some((geometry, index) => {
      const key = `${geometry.shape}:${geometry.rotation}`;
      if (!checks.has(key)) checks.set(key, createPinContainment(regions, geometryParameters(parameters, geometry)));
      const pin = pins[index];
      return !checks.get(key)!(pin.x, pin.y, mouthOffset + 0.8);
    });
  })();
  const warnings = thin || edgeThin ? ['Guide mouths have less than 0.8 mm of material. Thin lips may be fragile; try a small fit sample first.'] : [];
  const guideLength = parameters.thickness - lowerMouthHeight - upperMouthHeight;
  if (guideLength < parameters.diameter - 1e-6) {
    warnings.push(`Pins may tilt: the straight guide is only ${formatDimension(guideLength)} mm long for ${formatDimension(parameters.diameter)} mm pins (${formatDimension(parameters.construction.sliding.clearance)} mm total shaft clearance). Increase Base thickness for longer guidance. This is an advisory, not a prediction of printed play.`);
  }
  return warnings;
}
