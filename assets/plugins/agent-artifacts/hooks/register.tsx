// agent-artifacts: one place to see what customizes this session apart from the model (/artifacts), and to
// switch named profiles of it per repo (/agent-profile). Reads prefer what the session loaded, through `$`;
// a kind the API does not expose is read from disk and labelled so. No network, no processes, no model calls.
import { atom, read, update } from 'claude-code'
import type { ElementTable, EngineInterface, Hook, Register, RenderInput } from 'claude-code'

import type { Captured, Change, Inventory, Item, KindId, Plan, Profile, ProfileView, Scope, Selection, Status, View } from '../types'
import {
  type McpConfig,
  type PluginDisk,
  SETTINGS_SOURCES,
  SOURCE_CLASSES,
  type Shown,
  type Snapshot,
  buildInventory,
  inventoryText,
  mask,
  shownGroups,
  tilde,
} from './inventory'
import {
  PROFILE_NAME,
  RUNTIME_KEYS,
  SCOPES,
  changeText,
  compileRule,
  filterDeferredTools,
  filterSkillListing,
  parseProfile,
  planSettings,
  runtimeChanges,
  settingsPath,
} from './profile'

const INVENTORY_PANE = 'artifacts'
const PROFILE_PANE = 'agent-profile'

const DEFAULT_VIEW: View = { expanded: [], query: '', source: 'all', reveal: false }
const DEFAULT_PROFILES: ProfileView = {
  names: [],
  broken: [],
  selected: null,
  scope: 'local',
  plan: null,
  message: null,
  active: { repo: null, global: null },
}
const EMPTY_CAPTURED: Captured = { parents: {}, mcpProviders: {}, mods: [] }

const inventory = atom({ plugin: 'agent-artifacts', key: 'inventory' } as const, null)
const view = atom({ plugin: 'agent-artifacts', key: 'view' } as const, DEFAULT_VIEW)
const profiles = atom({ plugin: 'agent-artifacts', key: 'profiles' } as const, DEFAULT_PROFILES)
const captured = atom({ plugin: 'agent-artifacts', key: 'captured' } as const, EMPTY_CAPTURED)

type Json = Record<string, unknown>
const isRecord = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

// ------------------------------------------------------------------ reading

type Paths = { root: string; home: string; configDir: string; userJson: string }

async function paths($: EngineInterface): Promise<Paths> {
  const home = (await $.env.get('HOME')) ?? ''
  const custom = await $.env.get('CLAUDE_CONFIG_DIR')
  const configDir = custom ?? `${home}/.claude`
  return { root: await $.session.root(), home, configDir, userJson: custom === undefined ? `${home}/.claude.json` : `${custom}/.claude.json` }
}

async function readText($: EngineInterface, path: string): Promise<string | null> {
  if (!(await $.fs.exists(path))) return null
  return $.fs.read(path)
}

async function readJson($: EngineInterface, path: string, problems: string[]): Promise<Json | null> {
  try {
    const text = await readText($, path)
    if (text === null) return null
    const parsed: unknown = JSON.parse(text)
    if (isRecord(parsed)) return parsed
    problems.push(`${path}: not a JSON object`)
  } catch (err) {
    problems.push(`${path}: ${String(err)}`)
  }
  return null
}

async function listNames($: EngineInterface, dir: string, suffix: string): Promise<string[]> {
  if (!(await $.fs.exists(dir))) return []
  const entries = await $.fs.list(dir)
  return entries
    .filter(e => (e.kind === 'file' || e.isLink) && e.name.endsWith(suffix))
    .map(e => e.name)
    .sort()
}

function mcpRecord(v: unknown): Record<string, McpConfig> {
  if (!isRecord(v)) return {}
  const servers = isRecord(v.mcpServers) ? v.mcpServers : v
  const out: Record<string, McpConfig> = {}
  for (const [name, cfg] of Object.entries(servers)) {
    if (!isRecord(cfg)) continue
    out[name] = {
      type: typeof cfg.type === 'string' ? cfg.type : undefined,
      command: typeof cfg.command === 'string' ? cfg.command : undefined,
      url: typeof cfg.url === 'string' ? cfg.url : undefined,
    }
  }
  return out
}

/** A gathering in progress: the paths it reads under, and what failed so far. */
type Reading = { p: Paths; problems: string[] }

/** A plugin's hooks.json: named by its manifest's `hooks` (inline or a path), else the default place. */
async function pluginHooks($: EngineInterface, r: Reading, root: string, manifest: Json): Promise<Json | null> {
  if (isRecord(manifest.hooks)) return manifest.hooks
  const file = typeof manifest.hooks === 'string' ? `${root}/${manifest.hooks}` : `${root}/hooks/hooks.json`
  return readJson($, file, r.problems)
}

/** A plugin's MCP servers: inline in its manifest, else its .mcp.json. */
async function pluginMcp($: EngineInterface, r: Reading, root: string, manifest: Json): Promise<Record<string, McpConfig> | undefined> {
  const json = isRecord(manifest.mcpServers) ? { mcpServers: manifest.mcpServers } : await readJson($, `${root}/.mcp.json`, r.problems)
  return json === null ? undefined : mcpRecord(json)
}

/** One plugin folder as read from disk: its manifest, its hooks.json and its MCP servers. */
async function pluginFolder($: EngineInterface, r: Reading, id: string, root: string): Promise<PluginDisk> {
  const manifest = (await readJson($, `${root}/.claude-plugin/plugin.json`, r.problems)) ?? {}
  const hooksJson = await pluginHooks($, r, root, manifest)
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
  return {
    name: str(manifest.name) ?? id.slice(0, id.lastIndexOf('@')),
    root,
    version: str(manifest.version),
    hooks: isRecord(hooksJson?.hooks) ? hooksJson.hooks : undefined,
    modules: Array.isArray(hooksJson?.modules) ? strings(hooksJson.modules) : undefined,
    mcp: await pluginMcp($, r, root, manifest),
  }
}

/** Where an installed plugin lives for this repo: a project install here, else the user install. */
function installPath(installed: Json, id: string, root: string): string | null {
  const installs = Array.isArray(installed[id]) ? (installed[id] as Json[]) : []
  const install = installs.find(i => i.projectPath === root) ?? installs.find(i => i.scope === 'user') ?? installs[0]
  return typeof install?.installPath === 'string' ? install.installPath : null
}

/** The folder of each enabled plugin, read from disk. */
async function pluginFolders($: EngineInterface, r: Reading, installed: Json, enabled: Json): Promise<Record<string, PluginDisk>> {
  const out: Record<string, PluginDisk> = {}
  for (const [id, on] of Object.entries(enabled)) {
    const root = on === true ? installPath(installed, id, r.p.root) : null
    if (root !== null) out[id] = await pluginFolder($, r, id, root)
  }
  return out
}

async function readSettings($: EngineInterface, problems: string[]): Promise<Snapshot['settings']> {
  const settings: Snapshot['settings'] = {}
  for (const source of SETTINGS_SOURCES) {
    try {
      settings[source] = (await $.settings.read({ source })) as Json
    } catch (err) {
      problems.push(`settings (${source}): ${String(err)}`)
    }
  }
  return settings
}

async function readBreakdown($: EngineInterface, problems: string[]): Promise<Snapshot['breakdown']> {
  try {
    const b = (await $.session.usage({ breakdown: 'summary' })).context.breakdown
    if (b === undefined) return null
    const skills = b.skills?.skillFrontmatter ?? []
    return { skills, totalSkills: b.skills?.totalSkills ?? 0, agents: b.agents, memoryFiles: b.memoryFiles, mcpTools: b.mcpTools }
  } catch (err) {
    problems.push(`context breakdown: ${String(err)}`)
    return null
  }
}

/** The auto-memory folder: where the session's MEMORY.md was loaded from, else where the engine keeps it. */
function memoryDir(p: Paths, breakdown: Snapshot['breakdown']): string {
  const auto = breakdown?.memoryFiles.find(f => f.type === 'AutoMem')
  if (auto !== undefined) return auto.path.slice(0, auto.path.lastIndexOf('/'))
  return `${p.configDir}/projects/${p.root.replace(/[^A-Za-z0-9]/g, '-')}/memory`
}

async function outputStyles($: EngineInterface, p: Paths): Promise<Snapshot['disk']['outputStyles']> {
  const of = async (dir: string, source: string) => (await listNames($, dir, '.md')).map(f => ({ name: f.slice(0, -3), source }))
  return [...(await of(`${p.configDir}/output-styles`, 'user')), ...(await of(`${p.root}/.claude/output-styles`, 'project'))]
}

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

/** The MCP servers ~/.claude.json configures for every repo and for this one, and this repo's .mcp.json approvals. */
async function userMcp($: EngineInterface, { p, problems }: Reading): Promise<Pick<Snapshot['disk'], 'userMcp' | 'localMcp' | 'approvals'>> {
  const userJson = (await readJson($, p.userJson, problems)) ?? {}
  const projects = isRecord(userJson.projects) ? userJson.projects : {}
  const project = isRecord(projects[p.root]) ? (projects[p.root] as Json) : {}
  return {
    userMcp: mcpRecord({ mcpServers: userJson.mcpServers ?? {} }),
    localMcp: mcpRecord({ mcpServers: project.mcpServers ?? {} }),
    approvals: {
      enabled: strings(project.enabledMcpjsonServers),
      disabled: strings(project.disabledMcpjsonServers),
      enableAll: project.enableAllProjectMcpServers === true ? true : undefined,
    },
  }
}

async function readDisk($: EngineInterface, r: Reading, live: Pick<Snapshot, 'merged' | 'breakdown'>): Promise<Snapshot['disk']> {
  const { p, problems } = r
  const installedFile = await readJson($, `${p.configDir}/plugins/installed_plugins.json`, problems)
  const installed = isRecord(installedFile?.plugins) ? installedFile.plugins : {}
  const dir = memoryDir(p, live.breakdown)
  const memoryFiles = await listNames($, dir, '.md')
  return {
    ...(await userMcp($, r)),
    installed: installed as Snapshot['disk']['installed'],
    marketplaces: ((await readJson($, `${p.configDir}/plugins/known_marketplaces.json`, problems)) ?? {}) as Snapshot['disk']['marketplaces'],
    projectMcp: mcpRecord((await readJson($, `${p.root}/.mcp.json`, problems)) ?? {}),
    plugins: await pluginFolders($, r, installed, isRecord(live.merged.enabledPlugins) ? live.merged.enabledPlugins : {}),
    outputStyles: await outputStyles($, p),
    memory: memoryFiles.length === 0 ? null : { dir, files: memoryFiles },
  }
}

async function snapshot($: EngineInterface): Promise<Snapshot> {
  const problems: string[] = []
  const p = await paths($)
  const settings = await readSettings($, problems)
  const merged = ((await $.settings.read().catch(() => ({}))) ?? {}) as Json
  const breakdown = await readBreakdown($, problems)
  const commands = await $.command.list().catch(err => {
    problems.push(`commands: ${String(err)}`)
    return []
  })
  const act = await active($)
  return {
    root: p.root,
    home: p.home,
    self: { name: $.plugin.name, root: $.plugin.root },
    settings,
    merged,
    breakdown,
    commands,
    captured: await flushCaptured($),
    disk: await readDisk($, { p, problems }, { merged, breakdown }),
    keep: act === null ? null : { skill: act.keepSkill, agent: act.keepAgent, tool: act.keepTool },
    problems,
  }
}

// tool.describe fires for every tool at once, so its facts gather here and reach $.state in one write.
const seenProviders = new Map<string, string>()

async function flushCaptured($: EngineInterface): Promise<Captured> {
  const fresh = Object.fromEntries(seenProviders)
  seenProviders.clear()
  return update($, captured, c => ({ ...c, mcpProviders: { ...c.mcpProviders, ...fresh } }))
}

async function refresh($: EngineInterface): Promise<Inventory> {
  const inv = buildInventory(await snapshot($), await $.clock.now())
  await update($, inventory, () => inv)
  return inv
}

// ------------------------------------------------------------------ profiles

type Active = {
  name: string
  profile: Profile
  keepSkill: (n: string) => boolean
  keepAgent: (n: string) => boolean
  keepTool: (n: string) => boolean
}

// The active profile for this session's repo, read once and again after every apply.
let activeLoad: Promise<Active | null> | undefined

const profileDir = ($: EngineInterface) => `${$.plugin.root}/profiles`

async function selections($: EngineInterface): Promise<Record<string, Selection>> {
  const v = await $.store.get('selections')
  return isRecord(v) ? (v as Record<string, Selection>) : {}
}

async function readProfile($: EngineInterface, name: string): Promise<{ ok: true; profile: Profile } | { ok: false; reason: string }> {
  if (!PROFILE_NAME.test(name)) return { ok: false, reason: `"${name}" is not a profile name` }
  const text = await readText($, `${profileDir($)}/${name}.json`)
  if (text === null) return { ok: false, reason: `no profile "${name}" in ${profileDir($)}` }
  return parseProfile(text)
}

async function loadActive($: EngineInterface): Promise<Active | null> {
  const root = await $.session.root()
  const all = await selections($)
  const selection = all[root] ?? all['*']
  if (selection === undefined) return null
  const read = await readProfile($, selection.profile)
  if (!read.ok) {
    $.ui.log(`agent-artifacts: the selected profile is not applied at run time: ${read.reason}`)
    return null
  }
  return {
    name: selection.profile,
    profile: read.profile,
    keepSkill: compileRule(read.profile.skills),
    keepAgent: compileRule(read.profile.agents),
    keepTool: compileRule(read.profile.tools),
  }
}

async function active($: EngineInterface): Promise<Active | null> {
  activeLoad ??= loadActive($).catch(() => null)
  return activeLoad
}

async function loadProfiles($: EngineInterface): Promise<void> {
  const files = await listNames($, profileDir($), '.json')
  const names: string[] = []
  const broken: ProfileView['broken'] = []
  for (const file of files) {
    const name = file.slice(0, -'.json'.length)
    const r = await readProfile($, name)
    if (r.ok) names.push(name)
    else broken.push({ name, reason: r.reason })
  }
  const root = await $.session.root()
  const all = await selections($)
  await update($, profiles, v => ({ ...v, names, broken, active: { repo: all[root] ?? null, global: all['*'] ?? null } }))
}

const namesOf = (inv: Inventory, kind: KindId): string[] => inv.groups.find(g => g.kind === kind)?.items.map(i => i.name) ?? []

async function makePlan($: EngineInterface, name: string, scope: Scope): Promise<{ plan: Plan } | { reason: string }> {
  const r = await readProfile($, name)
  if (!r.ok) return { reason: r.reason }
  const p = await paths($)
  const file = settingsPath(scope, p.root, p.configDir)
  const before = await readText($, file)
  const planned = planSettings(r.profile, before)
  if (!planned.ok) return { reason: `${tilde(file, p.home)}: ${planned.reason}` }
  const act = await active($)
  const inv = (await read($, inventory)) ?? (await refresh($))
  const tools = (await $.tool.list()).map(t => t.name)
  const runtime = runtimeChanges(r.profile, act?.profile ?? null, { skills: namesOf(inv, 'skills'), agents: namesOf(inv, 'agents'), tools })
  return { plan: { profile: name, scope, file, before, after: planned.after, changes: [...planned.changes, ...runtime] } }
}

async function preview($: EngineInterface, name: string, scope: Scope): Promise<string | null> {
  const made = await makePlan($, name, scope)
  if ('reason' in made) {
    await update($, profiles, v => ({ ...v, selected: name, scope, plan: null, message: made.reason }))
    return made.reason
  }
  await update($, profiles, v => ({ ...v, selected: name, scope, plan: made.plan, message: null }))
  return null
}

function effectsLine(changes: readonly Change[]): string {
  const by = new Map<string, Set<string>>()
  for (const c of changes) by.set(c.effect, (by.get(c.effect) ?? new Set()).add(c.key))
  if (by.size === 0) return 'Nothing changes.'
  return `Takes effect: ${[...by].map(([effect, keys]) => `${effect} (${[...keys].join(', ')})`).join('; ')}.`
}

/** Records the profile as selected for this repo (or every repo, for the user scope) and drops cached answers. */
async function select($: EngineInterface, plan: Plan, root: string): Promise<void> {
  const all = await selections($)
  const selection: Selection = { profile: plan.profile, scope: plan.scope, appliedAt: await $.clock.now() }
  await $.store.set('selections', { ...all, [plan.scope === 'user' ? '*' : root]: selection })
  activeLoad = undefined
  $.ui.invalidate('tool.describe')
  $.ui.invalidate('prompt.attachment')
}

const isSettingsChange = (c: Change) => !(RUNTIME_KEYS as readonly string[]).includes(c.key)

/** Writes the plan the person saw, if the file still is what it was when they saw it. */
async function apply($: EngineInterface): Promise<string> {
  const { plan } = await read($, profiles)
  if (plan === null) return 'Nothing to apply: preview a profile first (/agent-profile <name>).'
  if ((await readText($, plan.file)) !== plan.before) {
    await preview($, plan.profile, plan.scope)
    return `${plan.file} changed since the preview. Review the new preview, then apply again.`
  }
  const p = await paths($)
  if (plan.changes.some(isSettingsChange)) await $.fs.write(plan.file, plan.after)
  await select($, plan, p.root)
  const message = `Applied "${plan.profile}" to ${tilde(plan.file, p.home)}. ${effectsLine(plan.changes)}`
  await update($, profiles, v => ({ ...v, plan: null, message }))
  await loadProfiles($)
  await refresh($)
  return message
}

function planText(plan: Plan, home: string): string {
  const lines = [`Profile "${plan.profile}" → ${tilde(plan.file, home)} (${plan.scope})`]
  if (plan.changes.length === 0) lines.push('  no changes')
  for (const c of plan.changes) lines.push(`  ${changeText(c)}   [${c.effect}]`)
  lines.push(effectsLine(plan.changes))
  return lines.join('\n')
}

type ProfileArgs = { name?: string; scope: Scope; isApply: boolean }

function parseProfileArgs(args: string): ProfileArgs {
  const words = args.trim().split(/\s+/).filter(w => w !== '')
  const isApply = words[0] === 'apply'
  const rest = isApply ? words.slice(1) : words
  const scope = (rest.find(w => (SCOPES as readonly string[]).includes(w)) as Scope | undefined) ?? 'local'
  const name = rest.find(w => !(SCOPES as readonly string[]).includes(w))
  return { name, scope, isApply }
}

/** `/agent-profile apply [name scope]`: applies the previewed plan; a named one must be the plan previewed. */
async function applyCommand($: EngineInterface, args: ProfileArgs): Promise<string> {
  if (args.name === undefined) return apply($)
  const { plan } = await read($, profiles)
  const isPreviewed = plan !== null && plan.profile === args.name && plan.scope === args.scope
  return isPreviewed ? apply($) : `Preview it first: /agent-profile ${args.name} ${args.scope}`
}

async function previewText($: EngineInterface): Promise<string> {
  const { plan } = await read($, profiles)
  if (plan === null) return ''
  return `${planText(plan, (await paths($)).home)}\nRun /agent-profile apply to write it.`
}

function profileListText(v: ProfileView): string {
  const act = v.active.repo ?? v.active.global
  return [
    `Profiles: ${v.names.join(', ') || '(none)'}`,
    `Active here: ${act === null ? 'none' : `${act.profile} (${act.scope})`}`,
    ...v.broken.map(b => `broken: ${b.name}: ${b.reason}`),
  ].join('\n')
}

// ------------------------------------------------------------------ drawing

const STATUS_MARK: Record<Status, { glyph: string; color: string }> = {
  on: { glyph: '●', color: 'success' },
  connected: { glyph: '●', color: 'success' },
  off: { glyph: '○', color: 'inactive' },
  'no-tools': { glyph: '◌', color: 'warning' },
  pending: { glyph: '◌', color: 'warning' },
  'scoped-off': { glyph: '⊘', color: 'warning' },
}

const ORIGIN_LABEL = { live: 'live', mixed: 'live + disk' } as const

function timeOf(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

const toggle = (list: readonly KindId[], kind: KindId): KindId[] => (list.includes(kind) ? list.filter(k => k !== kind) : [...list, kind])

function filterControls($: EngineInterface, e: RenderInput, v: View) {
  if (e.surface === 'mobile') return null
  const { Box, Input, Select } = $.ui.resolve(e)
  return (
    <Box flexDirection="row" gap={2} flexWrap="wrap">
      <Input key="query" label="filter " placeholder="name, source or detail" value={v.query} submitLabel="filter" onInput={q => void update($, view, x => ({ ...x, query: q }))} onSubmit={q => void update($, view, x => ({ ...x, query: q }))} />
      <Select key="source" label="source " value={v.source} options={SOURCE_CLASSES.map(s => ({ value: s, label: s }))} onSelect={s => void update($, view, x => ({ ...x, source: s }))} />
    </Box>
  )
}

type Els = Pick<ElementTable, 'Box' | 'Text' | 'Button'>

function inventoryToolbar($: EngineInterface, { Box, Button }: Els, inv: Inventory, v: View) {
  const openProfiles = () => void $.ui.open({ id: PROFILE_PANE, title: 'Agent profiles', focus: true, closeOnEscape: true })
  return (
    <Box flexDirection="row" gap={1} flexWrap="wrap">
      <Button key="refresh" label="refresh" hotkey="r" onPress={() => void refresh($)} />
      <Button key="expand" label="expand all" hotkey="e" onPress={() => update($, view, x => ({ ...x, expanded: inv.groups.map(g => g.kind) }))} />
      <Button key="collapse" label="collapse" hotkey="c" onPress={() => update($, view, x => ({ ...x, expanded: [] }))} />
      <Button key="reveal" label={v.reveal ? 'mask env' : 'reveal env'} hotkey="v" onPress={() => update($, view, x => ({ ...x, reveal: !x.reveal }))} />
      <Button key="profiles" label="profiles" hotkey="p" onPress={openProfiles} />
    </Box>
  )
}

function itemRow({ Text }: Els, item: Item, reveal: boolean, isMixed: boolean) {
  const mark = item.status === undefined ? null : STATUS_MARK[item.status]
  const detail = item.secret !== undefined ? `= ${reveal ? item.secret : mask(item.secret)}` : (item.detail ?? '')
  return (
    <Text wrap="truncate-end">
      {'     '}
      {mark === null ? '  ' : <Text color={mark.color}>{mark.glyph} </Text>}
      {item.name}
      <Text dimColor>
        {detail === '' ? '' : `  ${detail}`}
        {item.fromDisk === true && isMixed ? '  (disk)' : ''}
      </Text>
    </Text>
  )
}

function groupBlock($: EngineInterface, els: Els, s: Shown, reveal: boolean) {
  const { Box, Text, Button } = els
  const count = s.matched === s.total ? `${s.total}` : `${s.matched}/${s.total}`
  return (
    <Box key={`g-${s.group.kind}`} flexDirection="column">
      <Button
        key={`t-${s.group.kind}`}
        plain
        label={`${s.isOpen ? '▾' : '▸'} ${s.group.title}  ${count}  · ${ORIGIN_LABEL[s.group.origin]}`}
        dimColor={s.matched === 0}
        onPress={() => update($, view, x => ({ ...x, expanded: toggle(x.expanded, s.group.kind) }))}
      />
      {s.isOpen && s.group.note !== undefined && (
        <Text dimColor italic wrap="wrap">
          {'   '}
          {s.group.note}
        </Text>
      )}
      {s.isOpen &&
        s.sections.map(section => (
          <Box flexDirection="column">
            <Text color="suggestion" wrap="truncate-end">
              {'   '}
              {section.source} · {section.items.length}
            </Text>
            {section.items.map(item => itemRow(els, item, reveal, s.group.origin === 'mixed'))}
          </Box>
        ))}
    </Box>
  )
}

const SCOPE_LABEL: Record<Scope, string> = {
  local: 'local (.claude/settings.local.json)',
  project: 'project (committed)',
  user: 'user (every repo)',
}

function scopePicker($: EngineInterface, { Box, Text, Button }: Els, v: ProfileView) {
  const pick = (scope: Scope) => (v.selected === null ? update($, profiles, x => ({ ...x, scope })) : preview($, v.selected, scope))
  return (
    <Box flexDirection="row" gap={1}>
      <Text>write to</Text>
      {SCOPES.map(scope => (
        <Button key={`s-${scope}`} plain label={`${v.scope === scope ? '◉' : '○'} ${SCOPE_LABEL[scope]}`} onPress={() => void pick(scope)} />
      ))}
    </Box>
  )
}

function changeColor(c: Change): string {
  if (c.to === undefined) return 'error'
  return c.from === undefined ? 'success' : 'warning'
}

function planBlock($: EngineInterface, { Box, Text, Button }: Els, plan: Plan, home: string) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold wrap="truncate-end">
        {plan.profile} → {tilde(plan.file, home)}
      </Text>
      {plan.changes.length === 0 && <Text dimColor>No changes.</Text>}
      {plan.changes.map(c => (
        <Text wrap="truncate-end">
          <Text color={changeColor(c)}>
            {c.to === undefined ? '- ' : c.from === undefined ? '+ ' : '~ '}
            {changeText(c)}
          </Text>
          <Text dimColor>  [{c.effect}]</Text>
        </Text>
      ))}
      <Text dimColor wrap="wrap">
        {effectsLine(plan.changes)}
      </Text>
      <Box flexDirection="row" gap={1}>
        <Button key="apply" label="apply" hotkey="a" variant="primary" onPress={() => void apply($)} />
        <Button key="cancel" label="cancel" onPress={() => update($, profiles, x => ({ ...x, plan: null, selected: null }))} />
      </Box>
    </Box>
  )
}

// ------------------------------------------------------------------ hooks

/** Declares the two slash commands for this session. */
const registerCommands: Hook<'session.start'> = async ($, e, next) => {
  await $.command.register({
    name: 'artifacts',
    description: 'Show every skill, agent, command, hook, MCP server, plugin and setting active here',
    argumentHint: '[filter]',
  })
  await $.command.register({
    name: 'agent-profile',
    description: 'List, preview and apply agent-artifact profiles for this repo',
    argumentHint: '[name] [local|project|user] | apply',
  })
  return next(e)
}

/** `/artifacts [filter]`: gathers the inventory and opens its pane; answers in text with no surface. */
const runArtifacts: Hook<'command.run'> = async ($, e) => {
  const inv = await refresh($)
  await update($, view, v => ({ ...v, query: e.args.trim() }))
  if ((await $.session.surfaces()).length === 0) return { text: inventoryText(inv, (await paths($)).home) }
  const opened = await $.ui.open({ id: INVENTORY_PANE, title: 'Agent artifacts', focus: true })
  return opened.isPlaced ? {} : { text: inventoryText(inv, (await paths($)).home) }
}

/** `/agent-profile [name] [scope] | apply`: lists, previews or applies a profile. */
const runAgentProfile: Hook<'command.run'> = async ($, e) => {
  const args = parseProfileArgs(e.args)
  await loadProfiles($)
  if (args.isApply) return { text: await applyCommand($, args) }
  const hasSurface = (await $.session.surfaces()).length > 0
  if (args.name !== undefined) {
    const reason = await preview($, args.name, args.scope)
    if (!hasSurface) return { text: reason ?? (await previewText($)) }
  }
  if (!hasSurface) return { text: profileListText(await read($, profiles)) }
  await $.ui.open({ id: PROFILE_PANE, title: 'Agent profiles', focus: true, closeOnEscape: true })
  return {}
}

/** Notes each function-hook mod admitted after this one, which no other call lists. */
const capturePlugin: Hook<'plugin.register'> = async ($, e, next) => {
  const mod = { name: e.name, provenance: e.provenance, events: [...e.uses.events] }
  await update($, captured, c => (c.mods.some(m => m.name === mod.name) ? c : { ...c, mods: [...c.mods, mod] }))
  return next(e)
}

/** Notes which file `@`-imported each instruction file, which only this event carries. */
const captureInstructionParents: Hook<'prompt.context'> = async ($, e, next) => {
  const r = await next(e)
  const parents: Record<string, string> = {}
  for (const f of r.instructionFiles ?? []) if (f.parent !== undefined) parents[f.path] = f.parent
  if (Object.keys(parents).length > 0) await update($, captured, c => ({ ...c, parents: { ...c.parents, ...parents } }))
  return r
}

/** Notes who provides each MCP tool, and defers the tools the active profile turns off. */
const describeTool: Hook<'tool.describe'> = async ($, e, next) => {
  const r = await next(e)
  const server = /^mcp__(.+?)__/.exec(e.tool)?.[1]
  if (server !== undefined) seenProviders.set(server, e.provider.plugin)
  const act = await active($)
  return act === null || act.keepTool(e.tool) ? r : { ...r, isDeferred: true }
}

/** Removes the skills and deferred tools the active profile turns off from their listings. */
const filterAttachment: Hook<'prompt.attachment'> = async ($, e, next) => {
  const r = await next(e)
  if (e.origin.kind !== 'engine' || r.text === null) return r
  const act = await active($)
  if (act === null) return r
  if (e.type === 'skill_listing' && act.profile.skills !== undefined) {
    return { ...r, text: filterSkillListing(r.text, act.keepSkill)?.text ?? r.text }
  }
  if (e.type === 'deferred_tools_delta' && act.profile.tools !== undefined) {
    return { ...r, text: filterDeferredTools(r.text, act.keepTool).text }
  }
  return r
}

/** Keeps the agent types the active profile turns off from the model. */
const offerAgent: Hook<'agent.offer'> = async ($, e, next) => {
  const act = await active($)
  return act === null || act.keepAgent(e.agent) ? next(e) : { isOffered: false }
}

/** Refuses a tool, or a Skill call, the active profile turns off (the listing may still show it until /clear). */
const callTool: Hook<'tool.call'> = async ($, e, next) => {
  const act = await active($)
  if (act === null) return next(e)
  if (!act.keepTool(e.tool)) return { deny: `The tool ${e.tool} is turned off here by the agent profile "${act.name}".` }
  if (e.tool === 'Skill') {
    const name = String(e.skill ?? '').replace(/^\//, '')
    if (!act.keepSkill(name)) {
      return { deny: `The skill "${name}" is turned off here by the agent profile "${act.name}". If it is needed, ask the user to run /${name} themselves.` }
    }
  }
  return next(e)
}

/** The inventory pane: a header, the toolbar, the filter, then one collapsible group per kind. */
const drawInventory = async ($: EngineInterface, e: RenderInput) => {
  const els = $.ui.resolve(e)
  const { Box, Text } = els
  const inv = await read($, inventory)
  if (inv === null) return <Text dimColor>Gathering…</Text>
  const v = await read($, view)
  const prof = await read($, profiles)
  const act = prof.active.repo ?? prof.active.global
  return (
    <Box flexDirection="column">
      <Text wrap="truncate-end">
        <Text bold>{tilde(inv.root, (await paths($)).home)}</Text>
        <Text dimColor>
          {'  '}profile {act === null ? 'none' : `${act.profile} (${act.scope})`} · read {timeOf(inv.builtAt)}
        </Text>
      </Text>
      {inventoryToolbar($, els, inv, v)}
      {filterControls($, e, v)}
      {shownGroups(inv, v).map(shown => groupBlock($, els, shown, v.reveal))}
      {inv.problems.map(problem => (
        <Text color="warning" wrap="truncate-end">
          ! {problem}
        </Text>
      ))}
    </Box>
  )
}

/** The profile pane: the profiles, where to write, and the preview of the selected one with Apply. */
const drawProfiles = async ($: EngineInterface, e: RenderInput) => {
  const els = $.ui.resolve(e)
  const { Box, Text, Button } = els
  const v = await read($, profiles)
  const home = (await paths($)).home
  const sel = (x: Selection | null) => (x === null ? 'none' : `${x.profile} (${x.scope}, ${timeOf(x.appliedAt)})`)
  return (
    <Box flexDirection="column">
      <Text wrap="truncate-end">
        <Text bold>Profiles</Text>
        <Text dimColor>  {tilde(profileDir($), home)}</Text>
      </Text>
      <Text dimColor wrap="truncate-end">
        active here {sel(v.active.repo)} · everywhere {sel(v.active.global)}
      </Text>
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        {v.names.length === 0 && <Text dimColor>No profiles yet: add one as profiles/&lt;name&gt;.json.</Text>}
        {v.names.map(name => (
          <Button key={`p-${name}`} label={name} variant={v.selected === name ? 'primary' : undefined} onPress={() => void preview($, name, v.scope)} />
        ))}
      </Box>
      {v.broken.map(b => (
        <Text color="error" wrap="truncate-end">
          {b.name}: {b.reason}
        </Text>
      ))}
      {scopePicker($, els, v)}
      {v.plan !== null && planBlock($, els, v.plan, home)}
      {v.message !== null && (
        <Text color="suggestion" wrap="wrap">
          {v.message}
        </Text>
      )}
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', registerCommands)
  on('command.run', { command: 'artifacts' }, runArtifacts)
  on('command.run', { command: 'agent-profile' }, runAgentProfile)
  on('plugin.register', capturePlugin)
  on('prompt.context', captureInstructionParents)
  on('tool.describe', describeTool)
  on('prompt.attachment', filterAttachment)
  on('agent.offer', offerAgent)
  on('tool.call', callTool)
  on('ui.render', { component: 'Pane', requestId: INVENTORY_PANE }, drawInventory)
  on('ui.render', { component: 'Pane', requestId: PROFILE_PANE }, drawProfiles)
}
