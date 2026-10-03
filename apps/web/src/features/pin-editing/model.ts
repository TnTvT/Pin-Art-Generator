import { DEFAULT_MODEL_MATERIALS, resolveFilamentProfile, type MaterialSelection } from '../filaments/materials';
import type { Parameters } from '../pin-design/model';

export type HeightMode = 'set' | 'offset';
export type SelectionOperation = 'replace' | 'add' | 'toggle';
export interface PinOverride { height?: number; material?: MaterialSelection }
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
}
export type EditorAction =
  | { type: 'select'; ids: number[]; operation: SelectionOperation }
  | { type: 'height'; heights: Float32Array; value: number; mode: HeightMode }
  | { type: 'material'; material: MaterialSelection; target: 'base' | 'selection' }
  | { type: 'reset'; target: 'height' | 'material' | 'all' }
  | { type: 'undo' | 'redo' }
  | { type: 'topology'; count: number };

export function createEditorState(count: number): EditorState {
  return { count, base: { ...DEFAULT_MODEL_MATERIALS.base }, overrides: new Map(), selection: new Set(), active: null, past: [], future: [], historyBytes: 0, error: null };
}

export function materialKey(material: MaterialSelection) {
  if (!/^#[0-9a-f]{6}$/i.test(material.color)) throw new Error('Choose a valid #RRGGBB color.');
  return `${material.color.toLowerCase()}:${resolveFilamentProfile(material)}`;
}

function equalOverride(first?: PinOverride, second?: PinOverride) {
  return first?.height === second?.height && first?.material?.color === second?.material?.color && first?.material?.filamentId === second?.material?.filamentId;
}

function validateMaterials(count: number, overrides: Map<number, PinOverride>, base: MaterialSelection) {
  const used = new Set([materialKey(base)]);
  for (let index = 0; index < count; index++) used.add(materialKey(overrides.get(index)?.material ?? DEFAULT_MODEL_MATERIALS.pins));
  if (used.size > 16) throw new Error('Use at most 16 materials including the base. Replace an existing material or reset some pin colors first.');
}

function commit(state: EditorState, overrides: Map<number, PinOverride>, base = state.base): EditorState {
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
  const count = parameters.rows * parameters.columns;
  const heights = generated?.slice() ?? new Float32Array(count).fill(parameters.extension);
  const pinSelections = Array<MaterialSelection>(count).fill(DEFAULT_MODEL_MATERIALS.pins);
  for (const [index, override] of state.overrides) {
    if (index >= count) continue;
    if (override.height !== undefined) heights[index] = override.height;
    if (override.material) pinSelections[index] = override.material;
  }
  return { heights, pinSelections };
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  try {
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
      return { ...state, overrides, base: isUndo ? transaction.beforeBase : transaction.afterBase,
        past: isUndo ? state.past.slice(0, -1) : [...state.past, transaction],
        future: isUndo ? [...state.future, transaction] : state.future.slice(0, -1), error: null };
    }
    if (action.type === 'material') {
      materialKey(action.material);
      const overrides = new Map(state.overrides);
      const material = { ...action.material, color: action.material.color.toLowerCase() };
      const base = action.target === 'base' ? material : state.base;
      if (action.target === 'selection') for (const index of state.selection) overrides.set(index, { ...overrides.get(index), material });
      validateMaterials(state.count, overrides, base);
      return commit(state, overrides, base);
    }
    const overrides = new Map(state.overrides);
    if (action.type === 'height') {
      if (action.heights.length !== state.count) throw new Error('Pin heights do not match the grid.');
      const heights = heightBatch(action.heights, state.selection, action.value, action.mode);
      for (const index of state.selection) overrides.set(index, { ...overrides.get(index), height: heights[index] });
    } else if (action.type === 'reset') {
      if (action.target === 'all') return commit(state, new Map(), { ...DEFAULT_MODEL_MATERIALS.base });
      for (const index of state.selection) {
        const next = { ...overrides.get(index) };
        delete next[action.target];
        if (next.height === undefined && !next.material) overrides.delete(index);
        else overrides.set(index, next);
      }
    }
    validateMaterials(state.count, overrides, state.base);
    return commit(state, overrides);
  } catch (error) {
    return { ...state, error: error instanceof Error ? error.message : 'The edit could not be applied.' };
  }
}
