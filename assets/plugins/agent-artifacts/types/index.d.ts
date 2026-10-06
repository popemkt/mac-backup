// agent-artifacts: the mod's type contract. Every value it keeps in $.state is declared here, and the
// domain types the hooks module and its pure helpers share are exported from here, so they are written once.

/** One kind of artifact: a group of the inventory pane, in the order the pane draws them. */
export type KindId =
  | 'skills'
  | 'agents'
  | 'commands'
  | 'hooks'
  | 'mods'
  | 'mcp'
  | 'plugins'
  | 'marketplaces'
  | 'instructions'
  | 'memory'
  | 'outputStyle'
  | 'statusLine'
  | 'permissions'
  | 'env'

/**
 * Where a kind's facts came from. `live`: what this session loaded, read through the hooks API.
 * `mixed`: partly files re-read now, which may differ from what the session loaded; each such item
 * carries `fromDisk`. No kind is disk-only: each has a live part.
 */
export type Origin = 'live' | 'mixed'

/** A state an item is in, when it has one. `scoped-off`: hidden from the model by the active profile. */
export type Status = 'on' | 'off' | 'connected' | 'no-tools' | 'pending' | 'scoped-off'

export type Item = {
  name: string
  /** Where it is defined: `user`, `project`, `local`, `managed`, `flag`, `plugin <id>`, `built-in`, ... */
  source: string
  detail?: string
  status?: Status
  /** A value drawn masked until the person reveals values (env vars). */
  secret?: string
  /** Set on an item of a `mixed` kind that was read from disk. */
  fromDisk?: boolean
}

export type Group = {
  kind: KindId
  title: string
  origin: Origin
  /** One line on what the kind's facts can and cannot say. */
  note?: string
  items: Item[]
}

export type Inventory = {
  root: string
  builtAt: number
  groups: Group[]
  /** Files or calls that failed while gathering, so a missing kind is explained rather than silent. */
  problems: string[]
}

/** A glob rule over names: keep only the matches (`allow`) or drop them (`deny`). */
export type Rule = { allow: string[] } | { deny: string[] }

/**
 * A named profile. Each key it names it owns; a key it leaves out it leaves alone.
 * `plugins` becomes the target settings file's `enabledPlugins` exactly; `mcpjson` its
 * `enabledMcpjsonServers`, `disabledMcpjsonServers` and `enableAllProjectMcpServers` (each sub-key
 * owned only when named). `skills`, `agents` and `tools` are filtered by this mod's hooks at run time.
 */
export type Profile = {
  description?: string
  plugins?: Record<string, boolean>
  mcpjson?: { enable?: string[]; disable?: string[]; enableAll?: boolean }
  skills?: Rule
  agents?: Rule
  tools?: Rule
}

/** Which settings file a profile is applied to. `local` is the default and is never committed. */
export type Scope = 'local' | 'project' | 'user'

/** When a change takes effect, as the preview labels it. */
export type Effect = 'next turn' | 'after /clear' | '/reload-plugins' | 'restart'

/** One line of a profile's preview: a settings key's entry changing, or a run-time rule changing. */
export type Change = {
  /** `enabledPlugins`, `disabledMcpjsonServers`, ... or `skills` / `agents` / `tools` for run-time rules. */
  key: string
  entry?: string
  from?: string
  to?: string
  effect: Effect
}

/** The profile selected for a repo (or for every repo, `*`), kept in $.store across sessions. */
export type Selection = { profile: string; scope: Scope; appliedAt: number }

/** A computed, not yet written, application of a profile: what the preview shows and Apply writes. */
export type Plan = {
  profile: string
  scope: Scope
  file: string
  /** The target file's text when the plan was made; Apply refuses if the file changed since. */
  before: string | null
  after: string
  /** The settings entries that change, then the run-time rules' effect on what this session lists now. */
  changes: Change[]
}

export type ProfileView = {
  names: string[]
  /** Profiles that did not parse, with the reason. */
  broken: { name: string; reason: string }[]
  selected: string | null
  scope: Scope
  plan: Plan | null
  message: string | null
  active: { repo: Selection | null; global: Selection | null }
}

export type View = {
  expanded: KindId[]
  query: string
  source: string
  reveal: boolean
}

/** Facts only events carry, captured as they fire so the inventory can use them later. */
export type Captured = {
  /** Instruction file path -> the file whose `@` import brought it in (prompt.context). */
  parents: Record<string, string>
  /** Normalized MCP server name -> how the engine names its provider (`claude.ai Notion`, `sigrid@...`). */
  mcpProviders: Record<string, string>
  /** Function-hook mods admitted after this one (plugin.register). */
  mods: { name: string; provenance: string; events: string[] }[]
}

declare module 'claude-code' {
  interface PluginState {
    'agent-artifacts': {
      inventory: Inventory | null
      view: View
      profiles: ProfileView
      captured: Captured
    }
  }
}
