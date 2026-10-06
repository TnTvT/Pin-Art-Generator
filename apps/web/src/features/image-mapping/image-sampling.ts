export type ImageSampling = 'smooth' | 'pixel';

export const DEFAULT_IMAGE_SAMPLING: ImageSampling = 'smooth';

export interface MappingTimings {
  preparationMs: number;
  samplingMs: number;
  paletteMs: number;
}
