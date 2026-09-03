/** Pure label-edit draft machine for ShapeCard (blur/Enter commit, Esc cancel). */

export interface LabelEditState {
  editing: boolean;
  draft: string;
  baseline: string;
}

export function startLabelEdit(baseline: string): LabelEditState {
  return { editing: true, draft: baseline, baseline };
}

export function typeLabelDraft(state: LabelEditState, draft: string): LabelEditState {
  return { ...state, draft };
}

/** Persist only when draft differs from baseline; always leave edit mode. */
export function commitLabelEdit(state: LabelEditState): {
  state: LabelEditState;
  persist: string | null;
} {
  const persist = state.draft !== state.baseline ? state.draft : null;
  return {
    state: { editing: false, draft: state.baseline, baseline: state.baseline },
    persist,
  };
}

/** Discard draft; never persists. */
export function cancelLabelEdit(state: LabelEditState): LabelEditState {
  return {
    editing: false,
    draft: state.baseline,
    baseline: state.baseline,
  };
}
