export const DEFAULT_LOWER_HEAD_GAP = 0.3;
export const DEFAULT_LOWER_HEAD_ANGLE = 45;
const MIN_PROFILE_FACET_FACTOR = Math.cos(Math.PI / 63);

export interface SlidingSettings {
  clearance: number;
  headFlare: number;
  lowerHeadGap?: number;
  lowerHeadAngle?: number;
}

export function guideDimensions(sliding: SlidingSettings) {
  const gap = sliding.lowerHeadGap ?? DEFAULT_LOWER_HEAD_GAP;
  const angle = sliding.lowerHeadAngle ?? DEFAULT_LOWER_HEAD_ANGLE;
  if (!Number.isFinite(gap) || gap <= 0) throw new Error('Lower head surface gap must be a positive finite number.');
  if (!Number.isFinite(angle) || angle <= 0 || angle >= 90) throw new Error('Lower taper angle must be greater than 0 and less than 90 degrees.');
  const slope = Math.tan(angle * Math.PI / 180);
  const horizontalGap = gap * Math.sqrt(1 / MIN_PROFILE_FACET_FACTOR ** 2 + 1 / slope ** 2);
  return {
    lowerHeadHorizontalGap: horizontalGap,
    lowerHeadHeight: sliding.headFlare * slope,
    upperHeadHeight: sliding.headFlare,
    lowerMouthHeight: (sliding.headFlare + horizontalGap - sliding.clearance / 2) * slope,
    lowerMouthOffset: sliding.headFlare + horizontalGap,
    upperMouthHeight: sliding.headFlare,
    upperMouthOffset: sliding.clearance / 2 + sliding.headFlare
  };
}
