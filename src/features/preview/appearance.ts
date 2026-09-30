export type PreviewColorScheme = 'light' | 'dark';

export const PREVIEW_COLORS = {
  light: {
    background: '#f1f4f5',
    base: '#5b6b78',
    edges: '#354652',
    pins: '#2dada3',
    gridTint: '#ffffff',
  },
  dark: {
    background: '#171f27',
    base: '#6f8595',
    edges: '#a1b3c0',
    pins: '#3cc7b7',
    gridTint: '#435460',
  },
} satisfies Record<PreviewColorScheme, Record<string, string>>;
