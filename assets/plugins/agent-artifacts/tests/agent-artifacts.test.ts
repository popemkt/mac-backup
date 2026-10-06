import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { type Snapshot, buildInventory, mask, shownGroups } from '../hooks/inventory'
import { compileRule, filterSkillListing, parseProfile, planSettings, runtimeChanges } from '../hooks/profile'

// ---------------------------------------------------------------- pure: inventory

const EMPTY: Snapshot = {
  root: '/r',
  home: '/h',
  self: { name: 'agent-artifacts', root: '/r/assets/plugins/agent-artifacts' },
  settings: {},
  merged: {},
  breakdown: null,
  commands: [],
  captured: { parents: {}, mcpProviders: {}, mods: [] },
  disk: {
    installed: {},
    marketplaces: {},
    userMcp: {},
    localMcp: {},
    projectMcp: {},
    approvals: { enabled: [], disabled: [] },
    plugins: {},
    outputStyles: [],
    memory: null,
  },
  keep: null,
  problems: [],
}

const kind = (s: Snapshot, k: string) => buildInventory(s, 0).groups.find(g => g.kind === k)

test('every kind is a group, in a fixed order, even when empty', () => {
  const inv = buildInventory(EMPTY, 0)
  expect(inv.groups.map(g => g.kind)).toEqual([
    'skills', 'agents', 'commands', 'hooks', 'mods', 'mcp', 'plugins', 'marketplaces',
    'instructions', 'memory', 'outputStyle', 'statusLine', 'permissions', 'env',
  ])
  expect(kind(EMPTY, 'mods')?.items.map(i => i.name)).toEqual(['agent-artifacts'])
  expect(kind(EMPTY, 'outputStyle')?.items[0]).toEqual({ name: 'default', source: 'built-in', status: 'on', detail: 'active' })
})

test('a plugin skill is labelled by the id settings enable it under, whatever its case', () => {
  const s: Snapshot = {
    ...EMPTY,
    merged: { enabledPlugins: { 'notion@claude-plugins-official': true } },
    breakdown: {
      skills: [
        { name: 'Notion:find', source: 'plugin', pluginName: 'Notion', tokens: 4 },
        { name: 'tdd', source: 'userSettings', tokens: 9 },
      ],
      totalSkills: 3,
      agents: [],
      memoryFiles: [],
      mcpTools: [],
    },
  }
  const g = kind(s, 'skills')
  expect(g?.items.map(i => [i.name, i.source])).toEqual([['tdd', 'user'], ['Notion:find', 'plugin notion@claude-plugins-official']])
  expect(g?.note).toContain('1 more skills')
})

test('commands leave out the skills, which are listed once under Skills', () => {
  const s: Snapshot = {
    ...EMPTY,
    breakdown: { skills: [{ name: 'tdd', source: 'userSettings', tokens: 1 }], totalSkills: 1, agents: [], memoryFiles: [], mcpTools: [] },
    commands: [
      { name: 'tdd', description: 'x', source: 'user' },
      { name: 'flightdeck', description: 'Open the deck', source: 'plugin', plugin: 'flightdeck' },
    ],
    merged: { enabledPlugins: { 'flightdeck@claude-flightdeck': true } },
  }
  expect(kind(s, 'commands')?.items.map(i => [i.name, i.source])).toEqual([['/flightdeck', 'plugin flightdeck@claude-flightdeck']])
})

test('MCP: configured servers get their live tool count; unconfigured live ones are claude.ai or other', () => {
  const s: Snapshot = {
    ...EMPTY,
    breakdown: {
      skills: [], totalSkills: 0, agents: [], memoryFiles: [],
      mcpTools: [
        { name: 'mcp__skl__a', serverName: 'skl' },
        { name: 'mcp__skl__b', serverName: 'skl' },
        { name: 'mcp__claude_ai_Notion__x', serverName: 'claude_ai_Notion' },
        { name: 'mcp__plugin_sigrid_sigrid__y', serverName: 'plugin_sigrid_sigrid' },
      ],
    },
    disk: {
      ...EMPTY.disk,
      userMcp: { skl: { command: '/usr/bin/skl', type: 'stdio' }, serena: { command: 'uvx' } },
      projectMcp: { kb: { command: 'kb' }, other: { url: 'https://x.example/mcp?token=secret' } },
      plugins: { 'sigrid@sigrid-ai-toolkit': { name: 'sigrid', root: '/p', mcp: { sigrid: { type: 'http', url: 'https://mcp.example' } } } },
    },
    merged: { disabledMcpjsonServers: ['kb'] },
    captured: { ...EMPTY.captured, mcpProviders: { claude_ai_Notion: 'mcp:claude.ai Notion' } },
  }
  const items = kind(s, 'mcp')?.items ?? []
  const by = (n: string) => items.find(i => i.name === n)
  expect(by('skl')).toEqual({ name: 'skl', source: 'user', status: 'connected', detail: 'stdio skl · 2 tools', fromDisk: true })
  expect(by('serena')?.status).toBe('no-tools')
  expect(by('kb')?.status).toBe('off')
  expect(by('other')?.status).toBe('pending')
  expect(by('other')?.detail).not.toContain('secret')
  expect(by('sigrid')?.status).toBe('connected')
  expect(by('claude.ai Notion')?.source).toBe('claude.ai')
})

test('hooks are listed per event from every settings source and from plugin hooks.json', () => {
  const hooks = { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'rtk hook claude\nmore' }] }] }
  const s: Snapshot = {
    ...EMPTY,
    settings: { user: { hooks }, project: { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'x' }] }] } } },
    disk: { ...EMPTY.disk, plugins: { 'c@m': { name: 'c', root: '/c', hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'y' }] }] }, modules: ['./register.ts'] } } },
  }
  expect(kind(s, 'hooks')?.items.map(i => [i.name, i.source, i.detail])).toEqual([
    ['PreToolUse', 'user', '[Bash] command: rtk hook claude'],
    ['Stop', 'project', 'command: x'],
    ['SessionStart', 'plugin c@m', 'command: y'],
  ])
  expect(kind(s, 'mods')?.items.map(i => i.name)).toEqual(['agent-artifacts', 'c'])
})

test('permissions and env keep their source; env values are only ever drawn masked by default', () => {
  const s: Snapshot = {
    ...EMPTY,
    settings: {
      user: { permissions: { allow: ['Bash(ls*)'], deny: ['Read(.env)'], defaultMode: 'auto' }, env: { TOKEN: 'abc123' } },
      local: { permissions: { allow: ['WebFetch'] } },
    },
  }
  expect(kind(s, 'permissions')?.items.map(i => `${i.source}:${i.detail}:${i.name}`)).toEqual([
    'user:deny:Read(.env)', 'user:allow:Bash(ls*)', 'user:mode:defaultMode auto', 'local:allow:WebFetch',
  ])
  expect(kind(s, 'env')?.items[0]?.secret).toBe('abc123')
  expect(mask('abc123')).not.toContain('abc')
})

test('the view filters by text and source class, opens matching groups and splits them by source', () => {
  const s: Snapshot = {
    ...EMPTY,
    breakdown: {
      skills: [
        { name: 'tdd', source: 'userSettings', tokens: 1 },
        { name: 'effect-ts', source: 'projectSettings', tokens: 1 },
        { name: 'iii-node', source: 'userSettings', tokens: 1 },
      ],
      totalSkills: 3, agents: [], memoryFiles: [], mcpTools: [],
    },
  }
  const inv = buildInventory(s, 0)
  const closed = shownGroups(inv, { expanded: [], query: '', source: 'all', reveal: false })
  expect(closed[0]?.isOpen).toBe(false)
  const typed = shownGroups(inv, { expanded: [], query: 'iii', source: 'all', reveal: false })
  expect([typed[0]?.isOpen, typed[0]?.matched, typed[0]?.total]).toEqual([true, 1, 3])
  const project = shownGroups(inv, { expanded: ['skills'], query: '', source: 'project', reveal: false })
  expect(project[0]?.sections.map(x => [x.source, x.items.length])).toEqual([['project', 1]])
})

// ---------------------------------------------------------------- pure: profiles

test('a profile parses strictly and names its own mistakes', () => {
  expect(parseProfile('{"skills":{"deny":["iii-*"]},"plugins":{"a@b":false}}').ok).toBe(true)
  const bad = parseProfile('{"skils":{}}')
  expect(bad.ok ? '' : bad.reason).toContain('unknown key "skils"')
  const both = parseProfile('{"agents":{"allow":[],"deny":[]}}')
  expect(both.ok ? '' : both.reason).toContain('exactly one')
  expect(parseProfile('{"plugins":{"a@b":"no"}}').ok).toBe(false)
})

test('a profile owns the settings keys it names, leaves the rest, and reports each entry that changes', () => {
  const before = JSON.stringify({ disabledMcpjsonServers: ['kb'], enabledPlugins: { 'x@m': true }, permissions: { allow: ['Bash'] } })
  const parsed = parseProfile('{"plugins":{"y@m":false},"mcpjson":{"disable":["kb","db"],"enableAll":false}}')
  if (!parsed.ok) throw new Error(parsed.reason)
  const plan = planSettings(parsed.profile, before)
  if (!plan.ok) throw new Error(plan.reason)
  expect(JSON.parse(plan.after)).toEqual({
    disabledMcpjsonServers: ['kb', 'db'],
    enabledPlugins: { 'y@m': false },
    permissions: { allow: ['Bash'] },
    enableAllProjectMcpServers: false,
  })
  expect(plan.changes.map(c => [c.key, c.entry, c.from, c.to, c.effect])).toEqual([
    ['enabledPlugins', 'x@m', 'true', undefined, '/reload-plugins'],
    ['enabledPlugins', 'y@m', undefined, 'false', '/reload-plugins'],
    ['disabledMcpjsonServers', 'db', undefined, 'listed', 'restart'],
    ['enableAllProjectMcpServers', undefined, undefined, 'false', 'restart'],
  ])
  const nothing = planSettings({ skills: { deny: ['a'] } }, before)
  expect(nothing.ok && JSON.parse(nothing.after)).toEqual(JSON.parse(before))
  expect(planSettings({}, 'not json').ok).toBe(false)
  expect(planSettings({ plugins: {} }, null).ok).toBe(true)
})

test('run-time rules say how much they hide and when, and a dropped rule shows everything again', () => {
  const names = { skills: ['iii-a', 'iii-b', 'tdd'], agents: ['Explore', 'x'], tools: ['Bash', 'mcp__serena__find'] }
  const changes = runtimeChanges({ skills: { deny: ['iii-*'] }, tools: { deny: ['mcp__serena__*'] } }, { agents: { allow: ['Explore'] } }, names)
  expect(changes.map(c => [c.key, c.to, c.effect])).toEqual([
    ['skills', 'deny iii-* (hides 2 of 3)', 'after /clear'],
    ['agents', 'no rule: all shown', 'next turn'],
    ['tools', 'deny mcp__serena__* (hides 1 of 2)', 'next turn'],
  ])
  expect(compileRule({ allow: [] })('x')).toBe(false)
  expect(compileRule(undefined)('x')).toBe(true)
})

test('the skill listing loses exactly the denied items, the rest byte for byte', () => {
  const text = 'The following skills are available for use with the Skill tool:\n\n- tdd: Test first.\n- iii-a: Engine\n  - a bullet: inside\n- zen: Calm.'
  const out = filterSkillListing(text, n => !n.startsWith('iii-'))
  expect(out?.removed).toEqual(['iii-a'])
  expect(out?.text).toBe('The following skills are available for use with the Skill tool:\n\n- tdd: Test first.\n- zen: Calm.')
  expect(filterSkillListing('something else', () => false)).toBeNull()
})

// ---------------------------------------------------------------- through the engine

const ROOT = '/work/repo'
const PLUGIN_ROOT = '/work/plugin'
const PROFILES = `${PLUGIN_ROOT}/profiles`

type World = { files: Map<string, string>; writes: string[] }

/** The engine beneath the plugin: settings, the context breakdown and an in-memory file system. */
function world(on: On, files: Record<string, string> = {}, isHeadless = false): World {
  const w: World = { files: new Map(Object.entries(files)), writes: [] }
  // The plugin reads its profiles from its own folder; the fake file system serves them from PROFILES.
  const at = (path: string) => path.replace(/^.*\/agent-artifacts\/profiles(?=\/|$)/, PROFILES)
  mock.clock(on)
  mock.store(on)
  mock.env(on, { HOME: '/home/me' })
  on('session.root', () => ({ value: ROOT }))
  on('session.surfaces', () => ({ value: isHeadless ? [] : ['terminal'] }))
  on('settings.read', (_$, e) => ({
    value:
      e.source === 'user'
        ? { enabledPlugins: { 'caveman@caveman': true }, env: { API_KEY: 'sk-live-123' }, permissions: { allow: ['Bash(ls*)'] } }
        : e.source === undefined
          ? { enabledPlugins: { 'caveman@caveman': true } }
          : {},
  }))
  on('session.usage', () => ({
    value: {
      context: {
        breakdown: {
          skills: { totalSkills: 2, includedSkills: 2, tokens: 9, skillFrontmatter: [{ name: 'tdd', source: 'userSettings', tokens: 5 }, { name: 'iii-node', source: 'userSettings', tokens: 4 }] },
          agents: [{ agentType: 'caveman:cavecrew-builder', source: 'plugin', tokens: 9 }],
          memoryFiles: [{ path: '/home/me/.claude/CLAUDE.md', type: 'User', tokens: 20 }],
          mcpTools: [{ name: 'mcp__skl__a', serverName: 'skl', tokens: 1, isLoaded: true }],
        },
      },
    } as never,
  }))
  on('command.list', () => ({ value: [{ name: 'artifacts', description: 'inventory', source: 'plugin', plugin: 'agent-artifacts' }] }))
  on('tool.list', () => ({ value: [{ name: 'Bash', description: '', mcp: false }, { name: 'mcp__skl__a', description: '', mcp: true }] }))
  on('ui.open', () => ({ value: { isPlaced: true } as never }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('fs.exists', (_$, e) => ({ value: w.files.has(at(e.path)) || [...w.files.keys()].some(k => k.startsWith(`${at(e.path)}/`)) }))
  on('fs.read', (_$, e) => {
    const text = w.files.get(at(e.path))
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })
  on('fs.write', (_$, e) => {
    w.files.set(e.path, e.text)
    w.writes.push(e.path)
    return { value: undefined }
  })
  on('fs.list', (_$, e) => {
    const dir = at(e.path)
    return {
      value: [...w.files.keys()]
        .filter(k => k.startsWith(`${dir}/`) && !k.slice(dir.length + 1).includes('/'))
        .map(k => ({ name: k.slice(dir.length + 1), kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })),
    }
  })
  return w
}

const pane = (requestId: string, bodyColumns = 90) => ({
  plugin: 'agent-artifacts',
  component: 'Pane' as const,
  requestId,
  props: { title: 'x', isFocused: true, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 200 }, view: {} },
})

test('/artifacts opens a pane on every surface: groups with counts, collapsible, filterable', async ($, on) => {
  world(on, { '/home/me/.claude.json': JSON.stringify({ mcpServers: { skl: { command: 'skl' }, serena: { command: 'uvx' } } }) })
  await $.command.run({ command: 'artifacts', args: '' } as never)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...pane('artifacts'), surface })
    expect(await ui.find({ text: /Skills {2}2 {2}· live/ })).toBeDefined()
    expect(await ui.find({ text: /MCP servers {2}2 {2}· live \+ disk/ })).toBeDefined()
    expect(await ui.find({ text: /iii-node/ })).toBeUndefined()
    await ui.press({ key: 't-skills' })
    expect(await ui.find({ text: /iii-node/ })).toBeDefined()
    await ui.press({ key: 't-env' })
    expect(await ui.find({ text: /sk-live/ })).toBeUndefined()
    expect(await ui.find({ text: /API_KEY/ })).toBeDefined()
    await ui.press({ key: 'reveal' })
    expect(await ui.find({ text: /sk-live-123/ })).toBeDefined()
    await ui.press({ key: 'collapse' })
    await ui.press({ key: 'reveal' })
    await ui.unmount()
  }
  const ui = await $.ui.mount({ ...pane('artifacts', 40), surface: 'terminal' })
  await ui.input({ key: 'query', text: 'serena' })
  expect(await ui.find({ text: /serena/ })).toBeDefined()
  expect(await ui.find({ text: /MCP servers {2}1\/2/ })).toBeDefined()
  await ui.unmount()
  const mobile = await $.ui.mount({ ...pane('artifacts'), surface: 'mobile' })
  expect(await mobile.find({ text: /Subagents/ })).toBeDefined()
  await mobile.unmount()
})

test('a headless /artifacts answers in text, without values', async ($, on) => {
  world(on, {}, true)
  const { text } = await $.command.run({ command: 'artifacts', args: '' } as never)
  expect(text).toContain('Skills (2, live)')
  expect(text).not.toContain('sk-live')
})

const LOCAL = `${ROOT}/.claude/settings.local.json`

const FOCUS = {
  plugins: { 'caveman@caveman': false },
  skills: { deny: ['iii-*'] },
  agents: { deny: ['caveman:*'] },
  tools: { deny: ['mcp__skl__*'] },
}

function profileWorld(on: On, isHeadless = false): World {
  return world(on, {
    [LOCAL]: JSON.stringify({ disabledMcpjsonServers: ['kb'] }),
    [`${PROFILES}/focus.json`]: JSON.stringify(FOCUS),
    [`${PROFILES}/broken.json`]: '{"nope":1}',
  }, isHeadless)
}

test('a profile is previewed as a diff and written only on apply, to the local settings by default', async ($, on) => {
  const w = profileWorld(on)
  await $.command.run({ command: 'agent-profile', args: '' } as never)
  const ui = await $.ui.mount({ ...pane('agent-profile'), surface: 'terminal' })
  expect(await ui.find({ text: /broken: unknown key "nope"/ })).toBeDefined()
  await ui.press({ key: 'p-focus' })
  expect(await ui.find({ text: /enabledPlugins caveman@caveman: \(unset\) → false/ })).toBeDefined()
  expect(await ui.find({ text: /\[\/reload-plugins\]/ })).toBeDefined()
  expect(await ui.find({ text: /skills: \(unset\) → deny iii-\* \(hides 1 of 2\)/ })).toBeDefined()
  expect(await ui.find({ text: /settings\.local\.json/ })).toBeDefined()
  expect(w.writes).toEqual([])
  await ui.press({ key: 'apply' })
  expect(w.writes).toEqual([LOCAL])
  expect(JSON.parse(w.files.get(LOCAL) ?? '{}')).toEqual({ disabledMcpjsonServers: ['kb'], enabledPlugins: { 'caveman@caveman': false } })
  expect(await ui.find({ text: /Takes effect: \/reload-plugins \(enabledPlugins\); after \/clear \(skills\); next turn \(agents, tools\)/ })).toBeDefined()
  expect(await ui.find({ text: /active here focus \(local/ })).toBeDefined()
  await ui.unmount()
})

test('once applied, the profile hides skills, agents and tools from the model', async ($, on) => {
  profileWorld(on)
  on('agent.offer', () => ({ isOffered: true }))
  on('tool.call', () => ({ result: 'ran' }) as never)
  on('prompt.attachment', (_$, e) => ({ text: e.text }))
  await $.command.run({ command: 'agent-profile', args: 'focus' } as never)
  await $.command.run({ command: 'agent-profile', args: 'apply focus local' } as never)
  const provider = { plugin: 'caveman@caveman', tier: 'user' as const }
  expect(await $.agent.offer({ agent: 'caveman:cavecrew-builder', description: '', source: 'plugin', provider })).toEqual({ isOffered: false })
  expect(await $.agent.offer({ agent: 'Explore', description: '', source: 'built-in', provider })).toEqual({ isOffered: true })
  const listing = 'The following skills are available for use with the Skill tool:\n\n- tdd: Tests.\n- iii-node: Node.'
  const shown = await $.prompt.attachment({ type: 'skill_listing', text: listing, origin: { kind: 'engine' } } as never)
  expect(shown.text).toBe('The following skills are available for use with the Skill tool:\n\n- tdd: Tests.')
  const skill = await $.tool.call({ tool: 'Skill', skill: 'iii-node' } as never)
  const denial = (r: unknown) => {
    const x = r as { deny?: string; text?: string; result?: unknown }
    return String(x.deny ?? x.result ?? x.text)
  }
  expect(denial(skill)).toContain('turned off here by the agent profile "focus"')
  expect(denial(await $.tool.call({ tool: 'mcp__skl__a' } as never))).toContain('The tool mcp__skl__a is turned off')
  expect(denial(await $.tool.call({ tool: 'Bash', command: 'ls' } as never))).toBe('ran')
})

test('text-mode apply needs the preview of that very plan, and refuses a file changed since', async ($, on) => {
  const w = profileWorld(on, true)
  expect((await $.command.run({ command: 'agent-profile', args: 'apply' } as never)).text).toContain('preview a profile first')
  const shown = await $.command.run({ command: 'agent-profile', args: 'focus' } as never)
  expect(shown.text).toContain('enabledPlugins caveman@caveman: (unset) → false   [/reload-plugins]')
  expect((await $.command.run({ command: 'agent-profile', args: 'apply focus project' } as never)).text).toContain('Preview it first')
  w.files.set(LOCAL, '{}')
  expect((await $.command.run({ command: 'agent-profile', args: 'apply' } as never)).text).toContain('changed since the preview')
  expect(w.writes).toEqual([])
  expect((await $.command.run({ command: 'agent-profile', args: 'apply' } as never)).text).toContain('Applied "focus"')
  expect(w.writes).toEqual([LOCAL])
})
