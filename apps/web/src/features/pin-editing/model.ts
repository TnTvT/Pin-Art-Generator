import { DEFAULT_MODEL_MATERIALS, materialKey, type MaterialSelection } from '../filaments/materials';
export { materialKey } from '../filaments/materials';
import { validateMechanics } from '../mechanics/model';
import { pinCount, type Parameters } from '../pin-design/model';
import { resolvePinGeometries, validateResolvedGeometry, type PinGeometry } from '../pin-shape/geometry';

export type HeightMode = 'set' | 'offset';
export type SelectionOperation = 'replace' | 'add' | 'toggle';
export interface PinOverride { height?: number; material?: MaterialSelection; geometry?: PinGeometry }
interface Delta { index: number; before?: PinOverride; after?: PinOverride }
interface Transaction { deltas: Delta[]; beforeBase: MaterialSelection; afterBase: MaterialSelection; bytes: number }
export interface EditorState {
  count: number;
  base: MaterialSelection;
  overrides: Map<number, PinOverride>;
  selection: Set<number>;
  active: number | null;
  past: Transaction[];
  future: Transaction[];
  historyBytes: number;
  error: string | null;
  generatedMaterials?: readonly MaterialSelection[];
  generatedHeights?: Float32Array;
  mappingPending: boolean;
  parameters?: Parameters;
}
export type EditorAction =
  | { type: 'generation'; materials?: readonly MaterialSelection[]; heights?: Float32Array; parameters?: Parameters }
  | { type: 'mapping-status'; pending: boolean }
  | { type: 'select'; ids: number[]; operation: SelectionOperation }
  | { type: 'height'; heights: Float32Array; value: number; mode: HeightMode }
  | { type: 'geometry'; geometry: PinGeometry }
  | { type: 'material'; material: MaterialSelection; target: 'base' | 'selection' }
  | { type: 'material-group'; source: MaterialSelection; material: MaterialSelection }
  | { type: 'reset'; target: 'height' | 'material' | 'geometry' | 'all' }
  | { type: 'undo' | 'redo' }
  | { type: 'topology'; count: number };

export function createEditorState(count: number, parameters?: Parameters): EditorState {
  return { count, parameters, base: { ...DEFAULT_MODEL_MATERIALS.base }, overrides: new Map(), selection: new Set(), active: null, past: [], future: [], historyBytes: 0, error: null, mappingPending: false };
}

export function hasPinEdits(state: EditorState) {
  return state.overrides.size > 0 || [...state.past, ...state.future].some(transaction => transaction.deltas.length > 0);
}

function equalOverride(first?: PinOverride, second?: PinOverride) {
  return first?.height === second?.height && first?.material?.color === second?.material?.color && first?.material?.filamentId === second?.material?.filamentId
    && first?.geometry?.shape === second?.geometry?.shape && first?.geometry?.rotation === second?.geometry?.rotation;
}

export function resolveEditedGeometries(parameters: Parameters, overrides: ReadonlyMap<number, PinOverride>) {
  const geometries = resolvePinGeometries({ ...parameters, pinGeometries: undefined });
  for (const [index, value] of overrides) if (index < geometries.length && value.geometry) geometries[index] = value.geometry;
  return resolvePinGeometries({ ...parameters, pinGeometries: geometries });
}

export function validateGeometryOverrides(parameters: Parameters, overrides: ReadonlyMap<number, PinOverride>) {
  if ([...overrides.values()].some(value => value.geometry)) validateResolvedGeometry({ ...parameters, pinGeometries: resolveEditedGeometries(parameters, overrides) });
}

export function validateMaterials(count: number, overrides: Map<number, PinOverride>, base: MaterialSelection, generated?: readonly MaterialSelection[]) {
  if (generated && generated.length !== count) throw new Error('Generated materials do not match the pin grid.');
  const used = new Set([materialKey(base)]);
  for (let index = 0; index < count; index++) used.add(materialKey(overrides.get(index)?.material ?? generated?.[index] ?? DEFAULT_MODEL_MATERIALS.pins));
  if (used.size > 16) throw new Error('Use at most 16 materials including the base. Replace an existing material or reset some pin colors first.');
}

export function validateEditedMechanics(parameters: Parameters, overrides: ReadonlyMap<number, PinOverride>, generated?: Float32Array) {
  if (parameters.construction?.mode !== 'print-in-place') return;
  const heights = generated?.slice() ?? new Float32Array(pinCount(parameters)).fill(parameters.extension);
  for (const [index, value] of overrides) if (value.height !== undefined && index < heights.length) heights[index] = value.height;
  validateMechanics({ ...parameters, pinGeometries: resolveEditedGeometries(parameters, overrides) }, heights);
}

function commit(state: EditorState, overrides: Map<number, PinOverride>, base = state.base): EditorState {
  if (state.parameters) validateEditedMechanics(state.parameters, overrides, state.generatedHeights);
  const deltas: Delta[] = [];
  for (const index of new Set([...state.overrides.keys(), ...overrides.keys()])) {
    const before = state.overrides.get(index);
    const after = overrides.get(index);
    if (!equalOverride(before, after)) deltas.push({ index, before, after });
  }
  if (!deltas.length && base.color === state.base.color && base.filamentId === state.base.filamentId) return { ...state, error: null };
  const transaction = { deltas, beforeBase: state.base, afterBase: base, bytes: 0 };
  transaction.bytes = new TextEncoder().encode(JSON.stringify(transaction)).byteLength;
  const past = [...state.past, transaction];
  let historyBytes = past.reduce((total, entry) => total + entry.bytes, 0);
  while (past.length > 50 || historyBytes > 16 * 1024 * 1024) historyBytes -= past.shift()!.bytes;
  return { ...state, overrides, base, past, future: [], historyBytes, error: null };
}

export function heightBatch(heights: Float32Array, selection: Iterable<number>, value: number, mode: HeightMode) {
  if (!Number.isFinite(value)) throw new Error('Enter a finite height or offset in mm.');
  const next = heights.slice();
  for (const index of selection) {
    const height = Math.fround(mode === 'set' ? value : heights[index] + value);
    if (!Number.isFinite(height) || height <= 0) throw new Error('Every selected pin must have a finite height greater than 0 mm. No pins were changed.');
    next[index] = height;
  }
  return next;
}

export function resolveDesign(state: EditorState, parameters: Parameters, generated?: Float32Array) {
  const count = pinCount(parameters);
  const heights = (generated ?? state.generatedHeights)?.slice() ?? new Float32Array(count).fill(parameters.extension);
  const pinSelections = state.generatedMaterials ? [...state.generatedMaterials] : Array<MaterialSelection>(count).fill(DEFAULT_MODEL_MATERIALS.pins);
  for (const [index, override] of state.overrides) {
    if (index >= count) continue;
    if (override.height !== undefined) heights[index] = override.height;
    if (override.material) pinSelections[index] = override.material;
  }
  return { heights, pinSelections, pinGeometries: resolveEditedGeometries(parameters, state.overrides) };
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  try {
    if (action.type === 'mapping-status') return { ...state, mappingPending: action.pending };
    if (action.type === 'generation') {
      const parameters = action.parameters ?? state.parameters;
      if (parameters) { validateGeometryOverrides(parameters, state.overrides); validateEditedMechanics(parameters, state.overrides, action.heights); }
      validateMaterials(state.count, state.overrides, state.base, action.materials);
      if (action.heights && (action.heights.length !== state.count || action.heights.some(height => !Number.isFinite(height) || height <= 0))) throw new Error('Generated heights must match the grid and be finite and positive.');
      return { ...state, parameters, generatedMaterials: action.materials, generatedHeights: action.heights, mappingPending: false, error: null };
    }
    if (action.type === 'topology') return { ...createEditorState(action.count), base: state.base };
    if (action.type === 'select') {
      const selection = action.operation === 'replace' ? new Set<number>() : new Set(state.selection);
      for (const index of action.ids) {
        if (!Number.isInteger(index) || index < 0 || index >= state.count) continue;
        if (action.operation === 'toggle' && selection.has(index)) selection.delete(index);
        else selection.add(index);
      }
      return { ...state, selection, active: [...selection].at(-1) ?? null, error: null };
    }
    if (action.type === 'undo' || action.type === 'redo') {
      const isUndo = action.type === 'undo';
      const transaction = (isUndo ? state.past : state.future).at(-1);
      if (!transaction) return state;
      const overrides = new Map(state.overrides);
      for (const delta of transaction.deltas) {
        const value = isUndo ? delta.before : delta.after;
        if (value) overrides.set(delta.index, value);
        else overrides.delete(delta.index);
      }
      const base = isUndo ? transaction.beforeBase : transaction.afterBase;
      if (state.parameters) validateEditedMechanics(state.parameters, overrides, state.generatedHeights);
      validateMaterials(state.count, overrides, base, state.generatedMaterials);
      if (state.parameters && transaction.deltas.some(delta => delta.before?.geometry || delta.after?.geometry)) validateResolvedGeometry({ ...state.parameters, pinGeometries: resolveEditedGeometries(state.parameters, overrides) });
      return { ...state, overrides, base,
        past: isUndo ? state.past.slice(0, -1) : [...state.past, transaction],
        future: isUndo ? [...state.future, transaction] : state.future.slice(0, -1), error: null };
    }
    if (action.type === 'material' || action.type === 'material-group') {
      materialKey(action.material);
      const overrides = new Map(state.overrides);
      const material = { ...action.material, color: action.material.color.toLowerCase() };
      const base = action.type === 'material' && action.target === 'base' ? material : state.base;
      if (action.type === 'material-group') {
        const key = materialKey(action.source);
        const indices = state.generatedMaterials?.flatMap((source, index) => materialKey(source) === key ? [index] : []) ?? [];
        if (!indices.length) throw new Error('This generated group is no longer available. Choose a group from the current palette.');
        for (const index of indices) overrides.set(index, { ...overrides.get(index), material });
      } else if (action.target === 'selection') for (const index of state.selection) overrides.set(index, { ...overrides.get(index), material });
      validateMaterials(state.count, overrides, base, state.generatedMaterials);
      return commit(state, overrides, base);
    }
    const overrides = new Map(state.overrides);
    if (action.type === 'geometry') {
      if (!state.parameters) throw new Error('Wait for the committed design before changing shapes.');
      const geometry = resolvePinGeometries({ ...state.parameters, columns: 1, rows: 1, layout: undefined, pinGeometries: [action.geometry] })[0];
      for (const index of state.selection) overrides.set(index, { ...overrides.get(index), geometry });
      validateResolvedGeometry({ ...state.parameters, pinGeometries: resolveEditedGeometries(state.parameters, overrides) });
    } else if (action.type === 'height') {
      if (action.heights.length !== state.count) throw new Error('Pin heights do not match the grid.');
      const heights = heightBatch(action.heights, state.selection, action.value, action.mode);
      for (const index of state.selection) overrides.set(index, { ...overrides.get(index), height: heights[index] });
    } else if (action.type === 'reset') {
      if (action.target === 'all') {
        if (state.parameters && [...state.overrides.values()].some(value => value.geometry)) validateResolvedGeometry({ ...state.parameters, pinGeometries: resolveEditedGeometries(state.parameters, new Map()) });
        validateMaterials(state.count, new Map(), DEFAULT_MODEL_MATERIALS.base, state.generatedMaterials);
        return commit(state, new Map(), { ...DEFAULT_MODEL_MATERIALS.base });
      }
      for (const index of state.selection) {
        const next = { ...overrides.get(index) };
        delete next[action.target];
        if (next.height === undefined && !next.material && !next.geometry) overrides.delete(index);
        else overrides.set(index, next);
      }
      if (action.target === 'geometry' && state.parameters) validateResolvedGeometry({ ...state.parameters, pinGeometries: resolveEditedGeometries(state.parameters, overrides) });
    }
    validateMaterials(state.count, overrides, state.base, state.generatedMaterials);
    return commit(state, overrides);
  } catch (error) {
    return { ...state, error: error instanceof Error ? error.message : 'The edit could not be applied.' };
  }
}
