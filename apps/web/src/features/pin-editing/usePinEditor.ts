import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Parameters } from '../pin-design/model';
import type { MaterialSelection } from '../filaments/materials';
import { createEditorState, editorReducer, heightBatch, resolveDesign, type EditorAction, type HeightMode, type SelectionOperation } from './model';

export default function usePinEditor(parameters: Parameters, generated?: Float32Array, blocked = false) {
  const [state, rawDispatch] = useReducer(editorReducer, parameters.rows * parameters.columns, createEditorState);
  blocked = blocked || state.mappingPending;
  const dispatch = useCallback((action: EditorAction) => {
    if (!blocked || action.type === 'select' || action.type === 'topology') rawDispatch(action);
  }, [blocked]);
  const [heightMode, setHeightMode] = useState<HeightMode>('set');
  const [transient, setTransient] = useState<Float32Array | null>(null);
  const [dragError, setDragError] = useState<string | null>(null);
  const committed = useMemo(() => resolveDesign(state, parameters, generated), [state.overrides, state.generatedMaterials, state.generatedHeights, parameters, generated]);
  const regenerate = useCallback((heights?: Float32Array, nextMaterials?: readonly MaterialSelection[]) => {
    rawDispatch({ type: 'generation', heights, materials: nextMaterials });
  }, []);
  const setMappingPending = useCallback((pending: boolean) => rawDispatch({ type: 'mapping-status', pending }), []);
  const drag = useRef<{ heights: Float32Array; selected: number[]; mode: HeightMode; activeHeight: number; value: number | null } | null>(null);
  const cancelDrag = useCallback(() => {
    drag.current = null;
    setTransient(null);
    setDragError(null);
  }, []);

  useEffect(() => { cancelDrag(); }, [parameters, generated, state.generatedHeights, blocked, heightMode, cancelDrag]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { cancelDrag(); return; }
      if (drag.current || !(event.ctrlKey || event.metaKey) || event.altKey) return;
      const target = event.target;
      if (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
      if (event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'y') {
        event.preventDefault();
        dispatch({ type: event.key.toLowerCase() === 'y' || event.shiftKey ? 'redo' : 'undo' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cancelDrag, dispatch]);

  const select = useCallback((ids: number[], operation: SelectionOperation) => {
    if (!drag.current) dispatch({ type: 'select', ids, operation });
  }, [dispatch]);

  function startDrag() {
    if (blocked || state.active === null || !state.selection.size) return false;
    drag.current = { heights: committed.heights, selected: [...state.selection], mode: heightMode, activeHeight: committed.heights[state.active], value: null };
    setTransient(committed.heights);
    setDragError(null);
    return true;
  }

  function updateDrag(delta: number) {
    const snapshot = drag.current;
    if (!snapshot) return;
    const value = snapshot.mode === 'set' ? Math.round((snapshot.activeHeight + delta) * 10) / 10 : delta;
    try {
      const heights = heightBatch(snapshot.heights, snapshot.selected, value, snapshot.mode);
      snapshot.value = value;
      setTransient(heights);
      setDragError(null);
    } catch (error) {
      setDragError(error instanceof Error ? error.message : 'Invalid height.');
    }
  }

  function finishDrag() {
    const snapshot = drag.current;
    if (snapshot?.value !== null && snapshot?.value !== undefined) dispatch({ type: 'height', heights: snapshot.heights, value: snapshot.value, mode: snapshot.mode });
    cancelDrag();
  }

  return { state, dispatch, committed, heights: transient ?? committed.heights, heightMode, setHeightMode,
    isDragging: transient !== null, blocked, error: dragError ?? state.error, regenerate, setMappingPending, select, startDrag, updateDrag, finishDrag, cancelDrag };
}

export type PinEditor = ReturnType<typeof usePinEditor>;
