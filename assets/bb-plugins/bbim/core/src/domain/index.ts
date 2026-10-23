// The pure domain: no DOM, no host. Everything here runs anywhere.
export { Action, ACTION_INFO, ACTIONS, type ActionInfo } from "./actions.ts";
export {
  foldCase,
  formatSequence,
  isChord,
  isModifierOnly,
  type KeyEventLike,
  KeySequenceError,
  type KeyStroke,
  parseSequence,
  stroke,
  strokeFromEvent,
  strokeId,
} from "./keys.ts";
export { DEFAULT_ALPHABET, generateLabels, HintAlphabet } from "./labels.ts";
export {
  back,
  type Binding,
  compileKeymap,
  EMPTY_STATE,
  feed,
  type Keymap,
  type KeymapConflict,
  type KeymapOptions,
  type MatchState,
  reachable,
  type Step,
  typed,
} from "./matcher.ts";
export { current, INITIAL_STACK, leave, Mode, type ModeStack, ownsKeyboard, push } from "./modes.ts";
export {
  ActivateRequest,
  BRIDGE_PROTOCOL,
  CollectRequest,
  decodeFrameMessage,
  decodeParentMessage,
  FrameMessage,
  FrameTarget,
  isOpenableUrl,
  KeyForward,
  MAX_FRAME_TARGETS,
  ModeRequest,
  OpenRequest,
  ParentMessage,
  TargetsReply,
} from "./protocol.ts";
export {
  decodeSettings,
  DEFAULT_SETTINGS,
  KeySequence,
  keyBindings,
  SETTING_SCHEMAS,
  type Settings,
  type SettingsInput,
  type SettingsProblem,
} from "./settings.ts";
export {
  area,
  type Candidate,
  classify,
  dedupe,
  type ElementFacts,
  intersect,
  order,
  overlap,
  type Rect,
  TargetKind,
} from "./targets.ts";
