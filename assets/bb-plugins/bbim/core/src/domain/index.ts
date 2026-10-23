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
  expire,
  within,
  feed,
  type Keymap,
  type KeymapConflict,
  type KeymapOptions,
  type MatchState,
  type Step,
  typed,
} from "./matcher.ts";
export { current, INITIAL_STACK, leave, Mode, type ModeStack, ownsKeyboard, push } from "./modes.ts";
export {
  BRIDGE_PROTOCOL,
  decodeFrameMessage,
  decodeParentMessage,
  type FrameMessage,
  type FrameTarget,
  isBridgeMessage,
  isOpenableUrl,
  FRAME_MESSAGE_BUDGET,
  MAX_FRAME_TARGETS,
  MODE_HEARTBEAT_MS,
  MODE_TTL_MS,
  type ParentMessage,
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
  TARGET_KINDS,
  type TargetKind,
} from "./targets.ts";
