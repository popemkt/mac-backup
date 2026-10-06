// Profiles: parsing, the settings a profile owns, the preview of applying one, and the run-time filters.
// Pure: no `$`. The glob rules and the two listing filters are adapted from harness-scope
// (github.com/shimo4228/harness-scope, MIT), which filters the same listings on this engine.
import type { Change, Effect, Profile, Rule, Scope } from '../types'

type Json = Record<string, unknown>
export type Parsed<T> = ({ ok: true } & T) | { ok: false; reason: string }

export const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
export const SCOPES: readonly Scope[] = ['local', 'project', 'user']
/** The profile keys this mod applies at run time through its hooks; every other key is a settings key. */
export const RUNTIME_KEYS = ['skills', 'agents', 'tools'] as const

const isRecord = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string')

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

// ------------------------------------------------------------------ parsing

function parseRule(key: string, v: unknown): Parsed<{ rule: Rule }> {
  if (!isRecord(v)) return { ok: false, reason: `"${key}" must be an object` }
  const keys = Object.keys(v)
  const mode = keys[0]
  if (keys.length !== 1 || (mode !== 'allow' && mode !== 'deny')) return { ok: false, reason: `"${key}" takes exactly one of "allow" or "deny"` }
  const patterns = v[mode]
  if (!isStrings(patterns)) return { ok: false, reason: `"${key}.${mode}" must be a list of strings` }
  return { ok: true, rule: mode === 'allow' ? { allow: patterns } : { deny: patterns } }
}

function parsePlugins(v: unknown): Parsed<{ plugins: Record<string, boolean> }> {
  if (!isRecord(v) || !Object.values(v).every(b => typeof b === 'boolean')) {
    return { ok: false, reason: '"plugins" maps "name@marketplace" to true or false' }
  }
  return { ok: true, plugins: v as Record<string, boolean> }
}

function parseMcpjson(v: unknown): Parsed<{ mcpjson: NonNullable<Profile['mcpjson']> }> {
  if (!isRecord(v)) return { ok: false, reason: '"mcpjson" must be an object' }
  const mcpjson: NonNullable<Profile['mcpjson']> = {}
  for (const [sub, value] of Object.entries(v)) {
    if (sub === 'enable' || sub === 'disable') {
      if (!isStrings(value)) return { ok: false, reason: `"mcpjson.${sub}" must be a list of server names` }
      mcpjson[sub] = value
    } else if (sub === 'enableAll' && typeof value === 'boolean') {
      mcpjson.enableAll = value
    } else {
      return { ok: false, reason: `"mcpjson.${sub}": use enable and disable (lists) or enableAll (true or false)` }
    }
  }
  return { ok: true, mcpjson }
}

/** One reader per profile key: it sets the key on the profile, or says what is wrong with the value. */
const KEY_PARSERS: Record<string, (profile: Profile, value: unknown) => string | null> = {
  $schema: () => null,
  description: (profile, value) => {
    if (typeof value !== 'string') return '"description" must be a string'
    profile.description = value
    return null
  },
  plugins: (profile, value) => {
    const r = parsePlugins(value)
    if (r.ok) profile.plugins = r.plugins
    return r.ok ? null : r.reason
  },
  mcpjson: (profile, value) => {
    const r = parseMcpjson(value)
    if (r.ok) profile.mcpjson = r.mcpjson
    return r.ok ? null : r.reason
  },
  ...Object.fromEntries(
    RUNTIME_KEYS.map(key => [
      key,
      (profile: Profile, value: unknown) => {
        const r = parseRule(key, value)
        if (r.ok) profile[key] = r.rule
        return r.ok ? null : r.reason
      },
    ]),
  ),
}

export function parseProfile(text: string): Parsed<{ profile: Profile }> {
  const v = parseJson(text)
  if (!isRecord(v)) return { ok: false, reason: 'not a JSON object' }
  const profile: Profile = {}
  for (const [key, value] of Object.entries(v)) {
    const parse = Object.hasOwn(KEY_PARSERS, key) ? KEY_PARSERS[key] : undefined
    const reason = parse === undefined ? `unknown key "${key}" (use description, plugins, mcpjson, skills, agents, tools)` : parse(profile, value)
    if (reason !== null) return { ok: false, reason }
  }
  return { ok: true, profile }
}

// ------------------------------------------------------------------ rules

function globToRegExp(glob: string): RegExp {
  const body = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
  return new RegExp(`^${body}$`)
}

/** Whether a name is kept under the rule; no rule keeps everything. */
export function compileRule(rule: Rule | undefined): (name: string) => boolean {
  if (rule === undefined) return () => true
  const isAllow = 'allow' in rule
  const regs = (isAllow ? rule.allow : rule.deny).map(globToRegExp)
  const hit = (name: string) => regs.some(r => r.test(name))
  return isAllow ? hit : name => !hit(name)
}

function ruleText(rule: Rule): string {
  return 'allow' in rule ? `allow ${rule.allow.join(', ') || '(none)'}` : `deny ${rule.deny.join(', ')}`
}

export type Filtered = { text: string; removed: string[] }

const SKILL_HEADER = 'The following skills are available for use with the Skill tool:'

/** An item runs from a line starting "- " to the next; its name ends at the first ": ". */
function itemName(item: string): string {
  const first = item.slice(2).split('\n', 1)[0] ?? ''
  const cut = first.indexOf(': ')
  return cut === -1 ? first : first.slice(0, cut)
}

/**
 * The skill listing with the skills `keep` rejects removed, kept items byte for byte; null when the text is
 * not the listing format this build writes, so the caller passes it through rather than guess.
 */
export function filterSkillListing(text: string, keep: (name: string) => boolean): Filtered | null {
  if (!text.startsWith(SKILL_HEADER)) return null
  const parts = text.split(/\n(?=- )/)
  const items: string[] = []
  for (const part of parts.slice(1)) {
    // Skill names hold no whitespace: a "- " line whose name would is a bullet inside the previous description.
    const last = items.length - 1
    if (/\s/.test(itemName(part)) && last >= 0) items[last] = `${items[last]}\n${part}`
    else items.push(part)
  }
  if (items.length === 0) return null
  const removed: string[] = []
  const kept = items.filter(item => {
    const name = itemName(item)
    if (keep(name)) return true
    removed.push(name)
    return false
  })
  return { text: [parts[0] ?? '', ...kept].join('\n'), removed }
}

/** The deferred-tools listing (one name per line) with the tools `keep` rejects removed. */
export function filterDeferredTools(text: string, keep: (name: string) => boolean): Filtered {
  const removed: string[] = []
  const lines = text.split('\n').filter(line => {
    const isName = line.length > 0 && !/\s/.test(line)
    if (!isName || keep(line)) return true
    removed.push(line)
    return false
  })
  return { text: lines.join('\n'), removed }
}

// ------------------------------------------------------------------ the preview

const EFFECT = {
  enabledPlugins: '/reload-plugins',
  enabledMcpjsonServers: 'restart',
  disabledMcpjsonServers: 'restart',
  enableAllProjectMcpServers: 'restart',
  skills: 'after /clear',
  agents: 'next turn',
  tools: 'next turn',
} as const satisfies Record<string, Effect>

const show = (v: unknown): string | undefined => (v === undefined ? undefined : JSON.stringify(v))

function listChanges(key: 'enabledMcpjsonServers' | 'disabledMcpjsonServers', before: unknown, after: string[]): Change[] {
  const was = new Set(isStrings(before) ? before : [])
  const now = new Set(after)
  const changes: Change[] = []
  for (const name of now) if (!was.has(name)) changes.push({ key, entry: name, to: 'listed', effect: EFFECT[key] })
  for (const name of was) if (!now.has(name)) changes.push({ key, entry: name, from: 'listed', effect: EFFECT[key] })
  return changes
}

/** Makes `enabledPlugins` exactly the profile's map (none: no key) and says which entries change. */
function setPlugins(next: Json, current: unknown, plugins: Record<string, boolean>): Change[] {
  const before = isRecord(current) ? current : {}
  const changes: Change[] = []
  for (const id of new Set([...Object.keys(before), ...Object.keys(plugins)])) {
    const from = before[id]
    const to = plugins[id]
    if (from !== to) changes.push({ key: 'enabledPlugins', entry: id, from: show(from), to: show(to), effect: EFFECT.enabledPlugins })
  }
  if (Object.keys(plugins).length === 0) delete next.enabledPlugins
  else next.enabledPlugins = { ...plugins }
  return changes
}

/** Makes the `.mcp.json` approval keys the profile names exactly what it says, and says what changes. */
function setMcpjson(next: Json, current: Json, m: NonNullable<Profile['mcpjson']>): Change[] {
  const changes: Change[] = []
  const lists = [
    ['enable', 'enabledMcpjsonServers'],
    ['disable', 'disabledMcpjsonServers'],
  ] as const
  for (const [sub, key] of lists) {
    const list = m[sub]
    if (list === undefined) continue
    changes.push(...listChanges(key, current[key], list))
    if (list.length === 0) delete next[key]
    else next[key] = [...list]
  }
  if (m.enableAll !== undefined && current.enableAllProjectMcpServers !== m.enableAll) {
    changes.push({ key: 'enableAllProjectMcpServers', from: show(current.enableAllProjectMcpServers), to: show(m.enableAll), effect: EFFECT.enableAllProjectMcpServers })
    next.enableAllProjectMcpServers = m.enableAll
  }
  return changes
}

function parseSettings(text: string | null): Json | null {
  if (text === null || text.trim() === '') return {}
  const parsed = parseJson(text)
  return isRecord(parsed) ? parsed : null
}

/**
 * The target settings file after the profile is applied: every key the profile names is set to exactly what
 * it says (an empty map or list removes the key), every other key is kept as it was.
 */
export function planSettings(profile: Profile, currentText: string | null): Parsed<{ after: string; changes: Change[] }> {
  const current = parseSettings(currentText)
  if (current === null) return { ok: false, reason: 'the target settings file is not a JSON object; fix it by hand first' }
  const next: Json = { ...current }
  const changes = [
    ...(profile.plugins === undefined ? [] : setPlugins(next, current.enabledPlugins, profile.plugins)),
    ...(profile.mcpjson === undefined ? [] : setMcpjson(next, current, profile.mcpjson)),
  ]
  return { ok: true, after: `${JSON.stringify(next, null, 2)}\n`, changes }
}

export type Names = { skills: string[]; agents: string[]; tools: string[] }

/** One run-time rule's line of the preview; none when neither profile has a rule for the key. */
function ruleChange(key: (typeof RUNTIME_KEYS)[number], rule: Rule | undefined, old: Rule | undefined, names: string[]): Change | null {
  const from = old === undefined ? undefined : ruleText(old)
  if (rule === undefined) return from === undefined ? null : { key, from, to: 'no rule: all shown', effect: EFFECT[key] }
  const keep = compileRule(rule)
  const hidden = names.filter(n => !keep(n)).length
  return { key, from, to: `${ruleText(rule)} (hides ${hidden} of ${names.length})`, effect: EFFECT[key] }
}

/** The run-time rules' effect on what the session lists now, and the rules the previous profile drops. */
export function runtimeChanges(profile: Profile, previous: Profile | null, names: Names): Change[] {
  return RUNTIME_KEYS.map(key => ruleChange(key, profile[key], previous?.[key], names[key])).filter((c): c is Change => c !== null)
}

export function changeText(c: Change): string {
  const what = c.entry === undefined ? c.key : `${c.key} ${c.entry}`
  return `${what}: ${c.from ?? '(unset)'} → ${c.to ?? '(unset)'}`
}

export function settingsPath(scope: Scope, root: string, configDir: string): string {
  if (scope === 'user') return `${configDir}/settings.json`
  return `${root}/.claude/${scope === 'local' ? 'settings.local.json' : 'settings.json'}`
}
