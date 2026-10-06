// The inventory, built from a snapshot of what the session loaded (read through `$` in register.tsx) and the
// files it was loaded from. Pure: no `$`, so every rule here is tested with plain data.
import type { Captured, Group, Inventory, Item, KindId, Origin, Status, View } from '../types'

type Json = Record<string, unknown>

/** The settings sources, lowest precedence first, as `$.settings.read({ source })` names them. */
export const SETTINGS_SOURCES = ['user', 'project', 'local', 'flag', 'policy'] as const
export type SettingsSourceName = (typeof SETTINGS_SOURCES)[number]

export type McpConfig = { type?: string; command?: string; url?: string }

/** What one enabled plugin's folder declares, read from disk. */
export type PluginDisk = {
  /** The plugin's own name, from its plugin.json (it can differ in case from the id's). */
  name: string
  root: string
  version?: string
  /** hooks/hooks.json `hooks`: settings-shaped command hooks. */
  hooks?: Json
  /** hooks/hooks.json `modules`: function-hook modules. */
  modules?: string[]
  mcp?: Record<string, McpConfig>
}

export type Snapshot = {
  root: string
  home: string
  self: { name: string; root: string }
  settings: Partial<Record<SettingsSourceName, Json>>
  merged: Json
  breakdown: {
    skills: { name: string; source: string; pluginName?: string; tokens: number }[]
    totalSkills: number
    agents: { agentType: string; source: string; tokens: number }[]
    memoryFiles: { path: string; type: string; tokens: number }[]
    mcpTools: { name: string; serverName: string }[]
  } | null
  commands: { name: string; description: string; source: string; plugin?: string }[]
  captured: Captured
  disk: {
    installed: Record<string, { scope?: string; version?: string; projectPath?: string | null }[]>
    marketplaces: Record<string, Json>
    userMcp: Record<string, McpConfig>
    localMcp: Record<string, McpConfig>
    projectMcp: Record<string, McpConfig>
    approvals: { enabled: string[]; disabled: string[]; enableAll?: boolean }
    plugins: Record<string, PluginDisk>
    outputStyles: { name: string; source: string }[]
    memory: { dir: string; files: string[] } | null
  }
  /** The active profile's run-time rules; absent, nothing is scoped off. */
  keep: { skill: (n: string) => boolean; agent: (n: string) => boolean; tool: (n: string) => boolean } | null
  problems: string[]
}

export const KINDS: { kind: KindId; title: string }[] = [
  { kind: 'skills', title: 'Skills' },
  { kind: 'agents', title: 'Subagents' },
  { kind: 'commands', title: 'Slash commands' },
  { kind: 'hooks', title: 'Hooks (command)' },
  { kind: 'mods', title: 'Mods (function hooks)' },
  { kind: 'mcp', title: 'MCP servers' },
  { kind: 'plugins', title: 'Plugins' },
  { kind: 'marketplaces', title: 'Marketplaces' },
  { kind: 'instructions', title: 'CLAUDE.md and rules' },
  { kind: 'memory', title: 'Auto memory' },
  { kind: 'outputStyle', title: 'Output style' },
  { kind: 'statusLine', title: 'Status line' },
  { kind: 'permissions', title: 'Permissions' },
  { kind: 'env', title: 'Env vars' },
]

// ------------------------------------------------------------------ sources

/** The engine's words for where a thing was defined, as the pane labels them. */
const ENGINE_SOURCES: Record<string, string> = {
  userSettings: 'user',
  projectSettings: 'project',
  localSettings: 'local',
  policySettings: 'managed',
  flagSettings: 'flag',
  'built-in': 'built-in',
  builtin: 'built-in',
  bundled: 'built-in',
  syncedSkills: 'claude.ai sync',
  mcp: 'mcp',
  user: 'user',
  policy: 'managed',
}

/** The source classes the pane's source filter offers, in order. */
export const SOURCE_CLASSES = ['all', 'managed', 'user', 'project', 'local', 'plugin', 'built-in', 'other'] as const

export function sourceClass(source: string): string {
  if (source === 'managed' || source === 'user' || source === 'project' || source === 'local') return source
  if (source.startsWith('plugin')) return 'plugin'
  if (source === 'built-in') return 'built-in'
  return 'other'
}

const RANK = ['this mod', 'managed', 'user', 'project', 'local', 'flag', 'plugin', 'claude.ai', 'built-in']
function rank(source: string): number {
  const at = RANK.findIndex(r => source === r || source.startsWith(`${r} `))
  return at === -1 ? RANK.length : at
}

/** `name` of a plugin, as its skills and agents report it, to the `name@marketplace` id settings key it by. */
export function pluginId(name: string, ids: readonly string[]): string {
  const lower = name.toLowerCase()
  return ids.find(id => id.slice(0, id.lastIndexOf('@')).toLowerCase() === lower) ?? name
}

function sourceOf(word: string, plugin: string | undefined, ids: readonly string[]): string {
  if (word === 'plugin') return plugin === undefined ? 'plugin' : `plugin ${pluginId(plugin, ids)}`
  return ENGINE_SOURCES[word] ?? word
}

/** A settings source as the pane labels it: the managed tier is `policy` to the API. */
const labelOf = (source: SettingsSourceName): string => (source === 'policy' ? 'managed' : source)

/** The settings source a key's merged value comes from: the last one that sets it. */
export function decidingSource(settings: Snapshot['settings'], has: (s: Json) => boolean): string | undefined {
  let found: string | undefined
  for (const source of SETTINGS_SOURCES) {
    const s = settings[source]
    if (s !== undefined && has(s)) found = labelOf(source)
  }
  return found
}

// ------------------------------------------------------------------ helpers

const isRecord = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const firstLine = (s: string, max = 80): string => {
  const line = s.trim().split('\n', 1)[0] ?? ''
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

export function tilde(path: string, home: string): string {
  return home !== '' && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path
}

export function normalizeServer(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, '_')
}

/** Where a server runs, without what can carry credentials: a URL's origin, a command's program name. */
function endpoint(cfg: McpConfig): string {
  if (cfg.url === undefined) return (cfg.command ?? '').split('/').pop() ?? ''
  try {
    return new URL(cfg.url).origin
  } catch {
    return ''
  }
}

function describeMcp(cfg: McpConfig): string {
  const type = cfg.type ?? (cfg.url === undefined ? 'stdio' : 'http')
  const where = endpoint(cfg)
  return where === '' ? type : `${type} ${where}`
}

const byRankThenName = (a: Item, b: Item) => rank(a.source) - rank(b.source) || a.source.localeCompare(b.source) || a.name.localeCompare(b.name)

type GroupText = { note?: string; isOrdered?: boolean }

/** A kind's group; its items sorted by source then name, unless their own order says more (load order). */
function group(kind: KindId, origin: Origin, items: Item[], { note, isOrdered = false }: GroupText = {}): Group {
  const title = KINDS.find(k => k.kind === kind)?.title ?? kind
  return { kind, title, origin, note, items: isOrdered ? items : [...items].sort(byRankThenName) }
}

// ------------------------------------------------------------------ kinds

function enabledIds(s: Snapshot): string[] {
  const ids = new Set<string>(Object.keys(isRecord(s.merged.enabledPlugins) ? s.merged.enabledPlugins : {}))
  for (const id of Object.keys(s.disk.plugins)) ids.add(id)
  return [...ids]
}

function skills(s: Snapshot, ids: string[]): Group {
  if (s.breakdown === null) return group('skills', 'live', [], { note: 'The session reported no context breakdown.' })
  const items = s.breakdown.skills.map<Item>(k => ({
    name: k.name,
    source: sourceOf(k.source, k.pluginName, ids),
    detail: `${k.tokens} tok`,
    status: s.keep !== null && !s.keep.skill(k.name) ? 'scoped-off' : undefined,
  }))
  const unlisted = s.breakdown.totalSkills - items.length
  return group('skills', 'live', items, { note: unlisted > 0 ? `${unlisted} more skills fell outside the listing's token budget.` : undefined })
}

function agents(s: Snapshot, ids: string[]): Group {
  if (s.breakdown === null) return group('agents', 'live', [], { note: 'The session reported no context breakdown.' })
  const items = s.breakdown.agents.map<Item>(a => {
    const plugin = a.source === 'plugin' ? a.agentType.split(':')[0] : undefined
    return {
      name: a.agentType,
      source: sourceOf(a.source, plugin, ids),
      detail: `${a.tokens} tok`,
      status: s.keep !== null && !s.keep.agent(a.agentType) ? 'scoped-off' : undefined,
    }
  })
  return group('agents', 'live', items, { note: 'Custom agents only; the built-in types (general-purpose, Explore, Plan) are not listed.' })
}

function commands(s: Snapshot, ids: string[]): Group {
  const skillNames = new Set((s.breakdown?.skills ?? []).map(k => k.name))
  const items = s.commands
    .filter(c => !skillNames.has(c.name))
    .map<Item>(c => ({
      name: `/${c.name}`,
      source: c.source === 'plugin' ? sourceOf('plugin', c.plugin, ids) : (ENGINE_SOURCES[c.source] ?? c.source),
      detail: firstLine(c.description, 70),
    }))
  return group('commands', 'live', items, { note: 'Skills that also run as /commands are listed under Skills.' })
}

type HookEntry = { matcher?: unknown; hooks?: unknown }

/** One line per hook of a settings-shaped entry: `[matcher] type: first line of its command`. */
function entryDetails(entry: HookEntry): string[] {
  const matcher = typeof entry.matcher === 'string' && entry.matcher !== '' ? `[${entry.matcher}] ` : ''
  const hooks = Array.isArray(entry.hooks) ? (entry.hooks as Json[]) : []
  return hooks.map(h => {
    const type = typeof h.type === 'string' ? h.type : 'hook'
    const body = [h.command, h.url, h.prompt].find((v): v is string => typeof v === 'string') ?? ''
    return `${matcher}${type}: ${firstLine(body, 70)}`
  })
}

function hookItems(hooks: unknown, source: string, fromDisk: boolean): Item[] {
  if (!isRecord(hooks)) return []
  return Object.entries(hooks).flatMap(([event, entries]) =>
    (Array.isArray(entries) ? (entries as HookEntry[]) : [])
      .flatMap(entryDetails)
      .map(detail => ({ name: event, source, detail, fromDisk: fromDisk || undefined })),
  )
}

function hooks(s: Snapshot): Group {
  const items: Item[] = []
  for (const source of SETTINGS_SOURCES) {
    items.push(...hookItems(s.settings[source]?.hooks, labelOf(source), false))
  }
  for (const [id, p] of Object.entries(s.disk.plugins)) items.push(...hookItems(p.hooks, `plugin ${id}`, true))
  const off = s.merged.disableAllHooks === true ? 'disableAllHooks is set: none of these run. ' : ''
  return group('hooks', 'mixed', items, { note: `${off}Settings hooks are live; a plugin's hooks.json is read from disk.` })
}

function provenanceSource(provenance: string): string {
  if (provenance.endsWith('@inline')) return '--plugin-dir'
  if (provenance.endsWith('@builtin')) return 'built-in'
  return `plugin ${provenance}`
}

function mods(s: Snapshot): Group {
  const items: Item[] = [{ name: s.self.name, source: 'this mod', detail: tilde(s.self.root, s.home), status: 'on' }]
  const seen = new Set([s.self.name])
  for (const m of s.captured.mods) {
    if (seen.has(m.name)) continue
    seen.add(m.name)
    items.push({ name: m.name, source: provenanceSource(m.provenance), detail: `${m.events.length} events: ${m.events.join(', ')}`, status: 'on' })
  }
  for (const [id, p] of Object.entries(s.disk.plugins)) {
    if (p.modules === undefined || seen.has(p.name)) continue
    seen.add(p.name)
    items.push({ name: p.name, source: `plugin ${id}`, detail: `modules: ${p.modules.join(', ')}`, fromDisk: true })
  }
  return group('mods', 'mixed', items, { note: 'Mods loaded after this one are seen live; the rest are found in enabled plugins on disk.' })
}

/** A server's tool count, and how many of them the active profile hides. */
function toolsDetail(tools: readonly string[], keep: Snapshot['keep']): string {
  const hidden = keep === null ? 0 : tools.filter(t => !keep.tool(t)).length
  return `${tools.length} tools${hidden > 0 ? `, ${hidden} scoped off` : ''}`
}

type Configured = { name: string; source: string; cfg: McpConfig; key: string; gate?: Status }

/** Whether a project .mcp.json server may start: disabled, approved, or awaiting approval. */
function projectGate(s: Snapshot): (name: string) => Status | undefined {
  const disabled = new Set([...strings(s.merged.disabledMcpjsonServers), ...s.disk.approvals.disabled])
  const enabled = new Set([...strings(s.merged.enabledMcpjsonServers), ...s.disk.approvals.enabled])
  const enableAll = s.merged.enableAllProjectMcpServers === true || s.disk.approvals.enableAll === true
  return name => (disabled.has(name) ? 'off' : enableAll || enabled.has(name) ? undefined : 'pending')
}

/** Every server a file configures, keyed as the engine names its tools (`plugin:<plugin>:<server>` for a plugin's). */
function configuredServers(s: Snapshot): Configured[] {
  const of = (servers: Record<string, McpConfig>, source: string) =>
    Object.entries(servers).map(([name, cfg]) => ({ name, source, cfg, key: normalizeServer(name) }))
  const gate = projectGate(s)
  return [
    ...of(s.disk.userMcp, 'user'),
    ...of(s.disk.localMcp, 'local'),
    ...of(s.disk.projectMcp, 'project .mcp.json').map(c => ({ ...c, gate: gate(c.name) })),
    ...Object.entries(s.disk.plugins).flatMap(([id, p]) =>
      Object.entries(p.mcp ?? {}).map(([name, cfg]) => ({ name, source: `plugin ${id}`, cfg, key: normalizeServer(`plugin:${p.name}:${name}`) })),
    ),
  ]
}

const GATE_DETAIL: Partial<Record<Status, string>> = { off: 'disabled for this project', pending: 'awaiting approval' }

function configuredItem(c: Configured, tools: readonly string[] | undefined, keep: Snapshot['keep']): Item {
  const status: Status = c.gate ?? (tools === undefined ? 'no-tools' : 'connected')
  const detail = (c.gate === undefined ? undefined : GATE_DETAIL[c.gate]) ?? (tools === undefined ? 'no tools loaded' : toolsDetail(tools, keep))
  return { name: c.name, source: c.source, status, detail: `${describeMcp(c.cfg)} · ${detail}`, fromDisk: true }
}

/** A server with tools that no file configures: a claude.ai connector, or anything else the engine added. */
function unconfiguredItem(key: string, tools: readonly string[], s: Snapshot): Item {
  const isClaudeAi = key.startsWith('claude_ai_')
  const derived = isClaudeAi ? `claude.ai ${key.slice('claude_ai_'.length)}` : key
  const name = s.captured.mcpProviders[key]?.replace(/^mcp:/, '') ?? derived
  return { name, source: isClaudeAi ? 'claude.ai' : 'other', status: 'connected', detail: toolsDetail(tools, s.keep) }
}

function mcp(s: Snapshot): Group {
  const live = new Map<string, string[]>()
  for (const t of s.breakdown?.mcpTools ?? []) live.set(t.serverName, [...(live.get(t.serverName) ?? []), t.name])
  const configured = configuredServers(s)
  const items = configured.map(c => configuredItem(c, live.get(c.key), s.keep))
  const claimed = new Set(configured.map(c => c.key))
  for (const [key, tools] of live) if (!claimed.has(key)) items.push(unconfiguredItem(key, tools, s))
  const note = 'Configs are read from disk; tools are what the session loaded. "no tools loaded" can mean failed, needs auth, still connecting or disabled: the hooks API does not say which.'
  return group('mcp', 'mixed', items, { note })
}

function enabledPluginItem(s: Snapshot, id: string, on: unknown): Item {
  const source = decidingSource(s.settings, x => isRecord(x.enabledPlugins) && id in x.enabledPlugins) ?? 'user'
  const installs = s.disk.installed[id] ?? []
  const version = s.disk.plugins[id]?.version ?? installs[0]?.version
  const detail = installs.length === 0 ? 'not installed' : version === undefined ? 'installed' : `v${version}`
  return { name: id, source, status: on === true ? 'on' : 'off', detail }
}

/** Plugins installed for every repo or for this one that no settings source names. */
function unnamedInstalls(s: Snapshot, named: Json): Item[] {
  return Object.entries(s.disk.installed)
    .filter(([id]) => !(id in named))
    .map(([id, installs]) => ({ id, here: installs.find(i => i.scope === 'user' || i.projectPath === s.root) }))
    .filter(x => x.here !== undefined)
    .map(x => ({ name: x.id, source: x.here?.scope ?? 'user', status: 'off', detail: 'installed, not in enabledPlugins', fromDisk: true }))
}

function plugins(s: Snapshot): Group {
  const named = isRecord(s.merged.enabledPlugins) ? s.merged.enabledPlugins : {}
  const items = [...Object.entries(named).map(([id, on]) => enabledPluginItem(s, id, on)), ...unnamedInstalls(s, named)]
  return group('plugins', 'mixed', items, { note: 'Enabled state is the merged settings the session runs under; versions are read from disk.' })
}

function describeSource(source: unknown): string {
  if (!isRecord(source)) return ''
  for (const key of ['repo', 'path', 'url', 'package']) if (typeof source[key] === 'string') return `${source.source ?? ''} ${source[key]}`.trim()
  return typeof source.source === 'string' ? source.source : ''
}

function marketplaces(s: Snapshot): Group {
  const items: Item[] = []
  const declared = new Set<string>()
  for (const source of SETTINGS_SOURCES) {
    const extra = s.settings[source]?.extraKnownMarketplaces
    if (!isRecord(extra)) continue
    for (const [name, v] of Object.entries(extra)) {
      declared.add(name)
      items.push({ name, source: labelOf(source), detail: describeSource(isRecord(v) ? v.source : undefined) })
    }
  }
  for (const [name, v] of Object.entries(s.disk.marketplaces)) {
    if (declared.has(name)) continue
    items.push({ name, source: 'installed', detail: describeSource(v.source), fromDisk: true })
  }
  return group('marketplaces', 'mixed', items, { note: 'Settings-declared marketplaces are live; the rest come from known_marketplaces.json on disk.' })
}

function instructions(s: Snapshot): Group {
  const files = (s.breakdown?.memoryFiles ?? []).filter(f => f.type !== 'AutoMem')
  const items = files.map<Item>(f => {
    const parent = s.captured.parents[f.path]
    return {
      name: tilde(f.path, s.home),
      source: ENGINE_SOURCES[f.type] ?? f.type.toLowerCase(),
      detail: `${f.tokens} tok${parent === undefined ? '' : ` · @-imported by ${tilde(parent, s.home)}`}`,
    }
  })
  // Load order, not names: an import reads right after the file importing it.
  return group('instructions', 'live', items, { note: 'Files loaded so far; nested CLAUDE.md and path-scoped rules join as files are read. @-imports are marked once a prompt has been composed.', isOrdered: true })
}

function memory(s: Snapshot): Group {
  const auto = (s.breakdown?.memoryFiles ?? []).filter(f => f.type === 'AutoMem')
  const items: Item[] = auto.map(f => ({ name: tilde(f.path, s.home), source: 'auto memory', detail: `${f.tokens} tok, in context`, status: 'on' }))
  const loaded = new Set(auto.map(f => f.path))
  if (s.disk.memory !== null) {
    for (const file of s.disk.memory.files) {
      const path = `${s.disk.memory.dir}/${file}`
      if (!loaded.has(path)) items.push({ name: tilde(path, s.home), source: 'auto memory', detail: 'read on demand', fromDisk: true })
    }
  }
  return group('memory', 'mixed', items, { note: auto.length === 0 ? 'No MEMORY.md is in context for this session.' : undefined, isOrdered: true })
}

function outputStyle(s: Snapshot): Group {
  const active = typeof s.merged.outputStyle === 'string' ? s.merged.outputStyle : 'default'
  const source = decidingSource(s.settings, x => typeof x.outputStyle === 'string') ?? 'built-in'
  const items: Item[] = [{ name: active, source, status: 'on', detail: 'active' }]
  for (const o of s.disk.outputStyles) if (o.name !== active) items.push({ name: o.name, source: o.source, status: 'off', fromDisk: true })
  return group('outputStyle', 'mixed', items, { note: 'The active style is the merged settings; the other styles are files on disk.' })
}

function statusLine(s: Snapshot): Group {
  const line = s.merged.statusLine
  if (!isRecord(line)) return group('statusLine', 'live', [], { note: 'None configured.' })
  const source = decidingSource(s.settings, x => isRecord(x.statusLine)) ?? 'user'
  const body = typeof line.command === 'string' ? firstLine(line.command, 70) : ''
  return group('statusLine', 'live', [{ name: typeof line.type === 'string' ? line.type : 'statusLine', source, detail: body, status: 'on' }])
}

/** One settings source's permission rules, deny before ask before allow, as the engine weighs them. */
function permissionItems(settings: Json, source: string): Item[] {
  const p = isRecord(settings.permissions) ? settings.permissions : {}
  const mode = typeof p.defaultMode === 'string' ? [{ name: `defaultMode ${p.defaultMode}`, source, detail: 'mode' }] : []
  return [
    ...(['deny', 'ask', 'allow'] as const).flatMap(verdict => strings(p[verdict]).map(rule => ({ name: rule, source, detail: verdict }))),
    ...strings(settings.allowedTools).map(rule => ({ name: rule, source, detail: 'allow (legacy allowedTools)' })),
    ...mode,
    ...strings(p.additionalDirectories).map(dir => ({ name: dir, source, detail: 'additional directory' })),
  ]
}

function permissions(s: Snapshot): Group {
  const items = SETTINGS_SOURCES.flatMap(from => {
    const settings = s.settings[from]
    return settings === undefined ? [] : permissionItems(settings, labelOf(from))
  })
  return group('permissions', 'live', items, { isOrdered: true })
}

function env(s: Snapshot): Group {
  const items: Item[] = []
  for (const from of SETTINGS_SOURCES) {
    const vars = s.settings[from]?.env
    if (!isRecord(vars)) continue
    for (const [name, value] of Object.entries(vars)) {
      items.push({ name, source: labelOf(from), secret: String(value) })
    }
  }
  return group('env', 'live', items, { note: 'From settings files only, not the shell. Values are masked until revealed.' })
}

export function buildInventory(s: Snapshot, builtAt: number): Inventory {
  const ids = enabledIds(s)
  return {
    root: s.root,
    builtAt,
    problems: s.problems,
    groups: [
      skills(s, ids),
      agents(s, ids),
      commands(s, ids),
      hooks(s),
      mods(s),
      mcp(s),
      plugins(s),
      marketplaces(s),
      instructions(s),
      memory(s),
      outputStyle(s),
      statusLine(s),
      permissions(s),
      env(s),
    ],
  }
}

// ------------------------------------------------------------------ the pane's view of it

export type Section = { source: string; items: Item[] }
export type Shown = { group: Group; total: number; matched: number; isOpen: boolean; sections: Section[] }

export function matches(item: Item, query: string, source: string): boolean {
  if (source !== 'all' && sourceClass(item.source) !== source) return false
  if (query === '') return true
  const q = query.toLowerCase()
  return [item.name, item.source, item.detail ?? '', item.status ?? ''].some(t => t.toLowerCase().includes(q))
}

/**
 * What the pane draws for each group under the view's filter: a group is open when the person opened it, or
 * when a query is typed and it has matches; its items are cut into sections by source.
 */
export function shownGroups(inv: Inventory, view: View): Shown[] {
  const isFiltering = view.query !== '' || view.source !== 'all'
  return inv.groups.map(group => {
    const kept = group.items.filter(i => matches(i, view.query, view.source))
    const isOpen = view.expanded.includes(group.kind) || (view.query !== '' && kept.length > 0)
    const sections: Section[] = []
    for (const item of kept) {
      const last = sections[sections.length - 1]
      if (last !== undefined && last.source === item.source) last.items.push(item)
      else sections.push({ source: item.source, items: [item] })
    }
    return { group, total: group.items.length, matched: isFiltering ? kept.length : group.items.length, isOpen, sections }
  })
}

/** A plain-text rendering, for a session with no surface to draw a pane on (`claude -p`). */
export function inventoryText(inv: Inventory, home: string): string {
  const lines = [`Agent artifacts in ${tilde(inv.root, home)}`]
  for (const g of inv.groups) {
    const bySource = new Map<string, number>()
    for (const i of g.items) bySource.set(i.source, (bySource.get(i.source) ?? 0) + 1)
    const parts = [...bySource].map(([s, n]) => `${s} ${n}`).join(', ')
    lines.push(`${g.title} (${g.items.length}, ${g.origin})${parts === '' ? '' : `: ${parts}`}`)
  }
  for (const p of inv.problems) lines.push(`problem: ${p}`)
  return lines.join('\n')
}

export function mask(value: string): string {
  return value === '' ? '(empty)' : `${'•'.repeat(Math.min(8, value.length))} (${value.length} chars)`
}
