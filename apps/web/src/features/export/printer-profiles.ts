export const PRINTER_PROFILES = {
  'bambu-x1c': { name: 'Bambu Lab X1 Carbon 0.4 nozzle', label: 'Bambu Lab X1 Carbon · 0.4 mm', shortName: 'Bambu X1C', slicer: 'Bambu Studio', downloadName: 'Bambu 3MF', width: 256, depth: 256, height: 250, maxMaterials: 16 },
  'snapmaker-u1': { name: 'Snapmaker U1 (0.4 nozzle)', label: 'Snapmaker U1 · 0.4 mm', shortName: 'Snapmaker U1', slicer: 'Snapmaker Orca', downloadName: 'Snapmaker 3MF', width: 270, depth: 270, height: 270, maxMaterials: 4 },
} as const;

export type PrinterId = keyof typeof PRINTER_PROFILES;
export const DEFAULT_PRINTER: PrinterId = 'bambu-x1c';

export function validatePrinterMaterials(printer: PrinterId, count: number): string | null {
  const profile = PRINTER_PROFILES[printer];
  return count > profile.maxMaterials
    ? `${profile.shortName} 3MF supports at most ${profile.maxMaterials} materials including the base. This design uses ${count}. Change or merge materials, choose another printer, or download STL.`
    : null;
}
