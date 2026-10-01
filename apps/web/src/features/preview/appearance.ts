export type PreviewColorScheme = 'light' | 'dark';

export const PREVIEW_COLORS = {
  light: {
    background: '#f1f4f5',
    edges: '#354652',
    gridTint: '#ffffff',
  },
  dark: {
    background: '#171f27',
    edges: '#a1b3c0',
    gridTint: '#435460',
  },
} satisfies Record<PreviewColorScheme, Record<string, string>>;
