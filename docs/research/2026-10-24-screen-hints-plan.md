# Screen hints: product and architecture plan (macOS first)

Date: 2026-10-23. Working name **hintd**. It is a placeholder (see owner decisions).
Inputs: `screen-hints-research.md` (its **[bg]** claims are still hypotheses), the bbim core at
`.dotfiles/.claude/worktrees/agent-a6d21bbdef21dbbc4/assets/bb-plugins/bbim/core`, kb `AGENTS.md`,
and the locally installed CuaDriver 0.28.2, OpenClicky (source at `~/openclicky`) and Orca.
Claims I could not verify are marked **[bg]**.

## 0. The recommendation in one paragraph

Build a **Swift menu-bar app** that owns the hot path: hotkey, AX perception, overlay and
executor, all in one signed process. The bbim domain layer (key notation, trie matcher, labels,
dedupe/order, modes, settings decoding) runs inside it **unchanged, through JavaScriptCore**.
There is one implementation and no port. The AI broker and the MCP server are a **separate
TypeScript/Effect v4 process**. Everything speaks one contract: the `Target` stream, version
`screenhints/1`, defined once as Effect Schema. Ship v0 as AX-only hints that need no Screen
Recording grant. Add local OCR in v1 and an opt-in LLM that picks **labels** in v2. Build it
new under MIT. Read Vimac but do not fork it. Borrow MIT pieces from Clicky and OpenClicky.

## 1. Product shape and scope ladder

| Step | In | Out | Success metric |
|---|---|---|---|
| **v0: AX hints** | Hotkey, then labels on every actionable AX element of the frontmost app's windows on all displays, plus open menus, sheets and popovers. Type the label to act: press, focus, or open a menu. Shift on the last letter means right-click. A scroll mode (`j/k/d/u` on the scroll area under the focus). Electron/Chromium support through `AXManualAccessibility`. A typed JSON config. A CLI and a socket API. | OCR, AI, voice, menu-bar/Dock hints (v0.5), a settings UI, other OSes | Hotkey to labels painted: **p50 ≤ 80 ms, p95 ≤ 150 ms** with a warm cache; **≤ 250 ms** for the first walk of an app. Key to overlay update **≤ 8 ms**. Label to action **≤ 30 ms**. **≥ 90 %** of the clickable controls a person would want, measured on a fixed 20-app benchmark (§7) with Figma/canvas apps excluded. Activation success **≥ 97 %**. |
| **v1: vision fallback** | Per-app or low-yield trigger: a ScreenCaptureKit capture of the window, then Apple Vision OCR, then text regions become targets with the same label grammar. Then an icon detector (OmniParser `icon_detect` v3 weights, CoreML) as an out-of-process plugin. AX and vision results are merged by rect overlap. | Agentic flows, cloud calls | AX labels still appear within the v0 budget, and vision labels **stream in at ≤ 300 ms** (OCR) or **≤ 600 ms** (detector) **[bg: Vision ~100–300 ms]**. On canvas-heavy apps (Figma, games, remote desktops), **≥ 70 %** of text-labelled controls are reachable. No regression with Screen Recording denied. |
| **v2: LLM layer** | A command palette and push-to-talk ("click export", "archive the second email"). The model gets the **labelled snapshot** (AX outline as text first, a set-of-marks image only when needed) and answers with a label plus an action, never a pixel. Multi-step tasks loop snapshot → pick → confirm → act. An MCP server so bb/kb/agents can drive it. | Background, no-focus agents (delegate those to CuaDriver), autonomous unattended runs | Single-shot natural-language pick **p50 ≤ 1.5 s** cloud, **≤ 4 s** local VLM. Top-1 label accuracy **≥ 85 %** on a scripted 50-intent set. **100 %** of irreversible actions confirmed. Cloud bytes per command logged and shown. |
| **Beyond** | Windows (UI Automation), Linux (AT-SPI). The contract, domain and broker carry over. Only the perception, overlay and executor adapters are new. | — | The same benchmark harness passes on each OS. |

## 2. Architecture

### Processes

```
 ┌──────────────────────── hintd.app (Swift, one TCC identity) ────────────────────────┐
 │  Input            Session (JSContext: bbim domain)        Overlay                   │
 │  Carbon hotkey ─▶ modes · matcher · labels · dedupe ─────▶ NSPanel per NSScreen      │
 │  CGEventTap*        ▲ Target stream          │ Activate    CALayer labels            │
 │                     │                        ▼                                       │
 │  Perception ports ──┘                   Executor ports                               │
 │   ax (in-proc, per-app queues)           ax-action → cgevent → [cua-driver]          │
 │   ocr (in-proc, Vision)                                                              │
 │   plugin sources ◀──── socket ────┐                                                  │
 │  API server: JSON-RPC over unix socket ~/Library/Application Support/hintd/hintd.sock│
 └───────────────────────────────────┼───────────────────────────────────▲─────────────┘
                                     │                                   │
   detector plugin (CoreML/MLX) ─────┘     hintd-broker (Bun, Effect v4) ┘
                                            LLM providers · STT · policy · MCP server
                                                  ▲          ▲            ▲
                                             `hints` CLI   bb plugin   Claude/Codex/kb
 * the tap is enabled only while a mode owns the keyboard
```

Why the hot path is **one** process: TCC grants (Accessibility, Screen Recording) attach to the
code identity of each executable. Every extra helper is another grant prompt and another
signature to keep stable. A per-key IPC hop also adds jitter for no gain. Isolation goes where
the risk is: ML models, which crash, hog memory and are optional, and the LLM broker, which is
network-bound, written in the owner's language, and restartable.

### The central contract: `screenhints/1`

Its one home is an Effect Schema module in the shared TS package (`@popemkt/hint-core/protocol`).
JSON Schema is emitted from it. The Swift `Codable` types are checked against that emitted schema
by a golden-vector test, so it is a bridge and not a mirror.

```ts
Rect     { x, y, w, h }                // global points, top-left origin (Quartz/AX space), the only space on the wire
Target   { id: string                 // "<source>:<pid>:<stable hash>", stable within an epoch
           source: "ax"|"ocr"|"detector"|"bridge"|<plugin id>
           kind: TargetKind           // bbim's link|button|text|select|toggle|weak, plus menu|tab|scroll
           role?: string              // raw AXRole / detector class
           name?: string              // accessible name or OCR text (untrusted text)
           rect: Rect
           confidence: number         // 1 for AX
           actions: Action[]          // press|focus|showMenu|setValue|scrollTo|rightClick
           app: { pid, bundleId }, window?: number }
Snapshot { epoch, scope, displays[], targets: Target[], reports: { source, ms, count, status }[] }
Command  { epoch, targetId | label, action, origin: "keyboard"|"cli"|"mcp"|"llm" }
Outcome  { ok, via: "ax"|"event"|"cua", verified?: boolean, error? }
```

Labels are **not** part of a Target. The session assigns them, using bbim's
`order`/`generateLabels`, and publishes `label → targetId` per epoch. Every consumer (the overlay,
the CLI, the LLM's set-of-marks) reads that one mapping. This mirrors bbim's frame bridge: sources
answer asynchronously, and their targets join the labelling until the first letter is typed.

**Ports**, each with a shared contract suite in the sense of AGENTS.md "One contract, every
implementation":
- `PerceptionSource.collect(scope, budget, signal) → Stream<Target>`. The suite checks: rects lie
  inside the scope, ids are stable for an unchanged screen, the deadline is honoured,
  cancellation stops work, and secure fields are never given a `name`.
- `Executor.perform(target, action) → Outcome`. The suite checks against a fixture app: every
  advertised action works or fails typed, and nothing acts on a stale epoch.

### Plugin model

Three plugin kinds. The first two are data or a protocol, not new code paths:
1. **App profiles** (typed config data): per `bundleId`, set `AXManualAccessibility`, choose
   `sources: ["ax","ocr"]`, set a minimum AX yield before the fallback, add role ignores and
   label alphabets. One schema, decoded field by field the way bbim decodes `SettingsInput`.
2. **Out-of-process perception or executor plugins**: any executable that speaks
   `screenhints/1` `collect`/`perform` on the socket. The OmniParser detector, a cua-driver
   executor and a browser-extension bridge are all plugins of this one kind.
3. **Broker tools**: TS/Effect modules that add commands or LLM tools in the broker.

### How bb, kb and agents call it

- **Socket (JSON-RPC 2.0)** is the one API: `snapshot`, `find(text)`, `act(label|id, action)`,
  `hints.show(scope)`, `subscribe(events)`.
- **`hints` CLI**: a thin client over the socket. Use `--json` for scripts and kb `code` scripts.
- **MCP server** inside the broker exposes `screen_snapshot` (labels plus an optional set-of-marks
  PNG), `screen_act`, and `screen_find`. bb registers it like `cua-driver mcp`, and Claude/Codex
  get it through `.mcp.json`.
- The bb plugin can also show bbim's in-page hints and hintd's OS hints under one key. bbim stays
  the web-content adapter, and inside bb hintd's bbim-bridge source could ask the page directly.
  That is a later idea, not v0.

## 3. Stack decision

| | Swift native | Rust (objc2) + native/Tauri overlay | Electron/TS |
|---|---|---|---|
| AX, ScreenCaptureKit, Vision, NSPanel, event tap | first-class | possible, verbose unsafe bindings (cua-driver is Rust on objc2) | every piece needs a native addon |
| Latency and footprint | best: ~10 MB, instant overlay | same as Swift | ~150 MB; a transparent window over full-screen Spaces is fragile **[bg]** |
| Reuse of the bbim TS domain | via JavaScriptCore (system framework) | via an embedded JS engine (rquickjs/boa) or a port | direct |
| Cross-OS later | macOS only | best | good |
| Owner's fluency | new | new | native |

**Pick: Swift for the host, the TS domain in JSC, and TS/Effect for the broker.** The hard
part of this product is macOS plumbing, and Swift is the only stack where that plumbing is not
fighting bindings. Cross-OS is a "beyond" step, and it needs new adapters in any stack anyway
(UIA and AT-SPI share nothing with AX). Rust's portability buys little at the hot path.

**What reusing bbim's core costs or buys.** The domain is about 1,000 lines of pure TS. Its only
dependency is `effect` (Schema, Result), and it uses no DOM types. Three options:
- **(a) JSC-embedded, recommended.** Bundle `src/domain` into one JS file and call `feed`,
  `generateLabels`, `dedupe`, `order` and `decodeSettings` from Swift. This buys exactly one
  implementation of the key notation, the matcher (including Caps Lock, Option-key and IME rules
  already debugged in bbim), labels and settings validation, which honours Rule 1's "bridges over
  mirrors". It costs bundling Effect into the bundle (size and init time to measure), a
  Swift↔JS marshalling seam, and Swift producing `KeyEventLike` from a `CGEvent` (key via
  `UCKeyTranslate`, `code` via a keycode table).
- (b) A Swift port plus shared test vectors. It is the fastest at runtime, but it is a mirror
  kept in sync by vectors. Fall back to it only if (a) misses the latency budget.
- (c) A spec only. Rejected, because it drifts.

The prerequisite is a restructure commit in bbim core first: move `classify`/`ElementFacts`
(they are DOM-shaped: tag, href, contentEditable) into the DOM adapter. That leaves `targets.ts`
holding only the source-agnostic `Rect`/`TargetKind`/`dedupe`/`order`. The AX adapter gets its
own `AXRole → TargetKind` classifier. Then extract `src/domain` into `@popemkt/hint-core`, which
bbim and hintd both consume. The bridge protocol stays bbim-specific.

## 4. macOS specifics

**Permissions UX.**
- Onboarding asks for **Accessibility only**. v0 is fully usable with it.
- Screen Recording is requested lazily, the first time OCR is triggered. Denial degrades to
  AX-only with a menu-bar badge.
- Sequoia+ re-prompts monthly for capture (per the research; not re-checked on Tahoe). So the
  app never captures in the background, captures only on a hotkey, and treats a fresh prompt as
  a normal state.
- CuaDriver ships a "direct-capture consent" step for Tahoe, which suggests a new consent
  surface to investigate.
- Distribute with Developer ID, notarized and unsandboxed. **Nix caveat:** TCC keys grants to
  the code signature's designated requirement. An ad-hoc-signed Nix rebuild changes the cdhash
  and silently drops grants. The dotfiles package must sign with a stable identity, which is the
  same reason CuaDriver installs as a fixed `/Applications` bundle.

**Hotkey.**
- Activation uses Carbon `RegisterEventHotKey`, which needs no extra permission.
- Inside a mode, an active `CGEventTap` swallows keys. It is covered by the Accessibility grant
  **[bg]**, and it is enabled only while a mode owns the keyboard: no global keylogging surface,
  no idle cost.
- The rejected alternative makes the overlay a key panel. It needs no tap, but taking key focus
  dismisses popovers and menus in the target app, which are exactly the things people want to
  hint. The prototype verifies this.

**Overlay.**
- One borderless, non-activating `NSPanel` per `NSScreen`, created at launch and kept ordered
  out, so showing it costs no window creation.
- `ignoresMouseEvents`, a level above the status bar, and
  `collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]`
  so it sits over full-screen apps and every Space.
- Rebuild the panels on `didChangeScreenParameters`.
- Labels are `CATextLayer`s in one layer tree, with no Auto Layout.
- One conversion, at the overlay edge only: global top-left AX points to each screen's AppKit
  bottom-left space.

**Electron and Chromium.**
- Set `AXManualAccessibility = true` when the app **activates** (the `NSWorkspace` notification),
  not at hotkey time, because Chromium builds its tree asynchronously. Record it per pid.
- On a cold first walk, show what is there, subscribe to `AXLayoutChanged`, and stream the late
  targets in.
- Never set `AXEnhancedUserInterface` by default. It breaks window managers and animations; make
  it an opt-in profile flag.
- Chromium's accessibility mode costs memory and CPU, so it is a per-app profile default that can
  be turned off.

**Secure input.**
- When `IsSecureEventInputEnabled()` is on, taps (and possibly hotkeys **[bg]**) go blind.
- Detect it and show which process holds it (`ioreg` `kCGSSessionSecureInputPID` **[bg]**) in
  the menu bar. Never try to bypass it.
- AX `AXSecureTextField` targets get no name and no `setValue` from LLM origins.

**Performance tactics.**
- `AXUIElementSetMessagingTimeout` per app (about 50 ms), so a hung app costs one timeout and not
  the whole show.
- `AXUIElementCopyMultipleAttributeValues` to batch role, frame, actions, enabled and name in one
  IPC per element.
- One concurrent queue per (app, window) root, with the frontmost window first. Prune subtrees
  whose frame misses every screen. Cap depth and count.
- A per-pid cache kept warm by `AXObserver`: on app activation and idle, pre-walk. On show, paint
  the cached targets after a cheap rect re-validation, then reconcile.
- Treat notification storms (Chromium) as "dirty" flags, not re-walks.
- Labels are a snapshot. Acting on a target re-checks its rect, as bbim already does.

## 5. AI layer

| Tier | Option | Where | Use |
|---|---|---|---|
| OCR | Apple Vision `VNRecognizeTextRequest` | on-device | the v1 default, with fast or accurate mode chosen per profile |
| Detector | OmniParser `icon_detect` v3 (MIT weights) converted to CoreML | on-device plugin | icons without text. **Avoid the AGPL older detectors and the AGPL `ultralytics` runtime**; run the exported model under CoreML **[bg: export path to verify]** |
| Local VLM | UI-TARS-1.5-7B or a Qwen-VL-class model via MLX | on-device, opt-in | offline natural-language picks. Expect seconds per step **[bg]** |
| Cloud | Claude (plain messages: AX outline text first, set-of-marks PNG second). Claude's computer-use tool only for multi-step tasks, with our labels standing in for coordinates | network, opt-in | the v2 default for natural language |
| STT | on-device first (Apple speech APIs or whisper.cpp **[bg]**), AssemblyAI/cloud opt-in | — | push-to-talk |

**Privacy defaults.**
- Nothing leaves the Mac unless the user invokes the LLM.
- A text outline is preferred over pixels, at about 2–5k tokens vs about 1–1.8k per screenshot
  (research). Text is cheaper to redact and audit.
- A per-app deny list ships pre-filled: password managers, banking, Messages.
- Secure fields are redacted.
- Every cloud call is logged locally with its byte count.
- Keys stay in the broker and come from the Keychain or bb secrets. There is no proxy server,
  unlike Clicky's Worker.

**Cost.** A natural-language pick is about 3–6k input tokens per command on text. Agent steps
add one snapshot per step. Show the running cost in the palette.

**Safety model.**
- The model can only choose **existing labels** from the current epoch. A stale epoch fails.
- Actions carry an `origin`. Keyboard actions are never confirmed. Actions from LLM, MCP or CLI
  pass a policy:
  - Auto-allow: focus, scroll, read.
  - Confirm with an overlay highlight plus Enter: press or type in apps not on the allowlist, and
    any target whose name matches irreversible verbs (send, delete, pay, buy, submit, merge).
  - Deny: secure fields and deny-listed apps.
- Screen text is untrusted data. It is fenced in the prompt, and instructions found on screen
  never widen the policy.
- A global kill hotkey, a step cap, a rate limit, and an append-only audit log, which can be
  mirrored into kb nodes.

## 6. Differentiation; build vs fork

**The gap.** Hint apps (Homerow, Vimac, Shortcat) are AX-only and fail on canvas. The Clicky
family is screenshot plus cloud: it points but rarely acts, and has no hint grammar. Agent stacks
(Anthropic computer use, UI-TARS, Cua) take seconds per step. hintd puts them on one label
grammar over every source: instant AX, a local vision fallback, and an LLM that speaks labels.
On top of that, it is **an API**: agents get a cheap, exact, labelled view of the screen. That is
also the best set-of-marks input for computer-use agents, which is a second market (bb/Orca/
Claude) the hint apps ignore.

**Licenses.**

| Project | License | Verdict |
|---|---|---|
| Vimac | GPL-3.0 | Read it as a reference, copy nothing (unless the owner chooses GPL) |
| Clicky (farzaa) | MIT | Overlay, cursor and multi-monitor patterns can be borrowed with notice |
| OpenClicky | MIT, and bundles a Swift subset of cua-driver under MIT (`THIRD_PARTY_NOTICES.md`) | Same. Its ScreenCaptureKit window capture and pid-directed key delivery are good references |
| cua-driver | core MIT. `cua-som` and `cua-perception` are AGPL, Spaces and the bench are FSL | Use it only as an **out-of-process optional executor plugin** through its CLI/MCP, and never link the AGPL parts. Its `get_window_state` is a useful latency baseline |
| Orca Computer Use | license not verified (a bundled helper inside Orca.app) | A local tool, not a dependency |
| OmniParser | repo CC-BY-4.0, v3 weights MIT, older detectors AGPL | v3 weights only |

**Build new, under MIT** (owner's call; see below). A fork buys little: Vimac's value is its
GPL'd AX walker, and the Clicky family has no AX side at all.

## 7. Risks, open questions, first milestone

**Risks.**
1. The AX latency budget on big trees (Xcode, Slack, Chrome with many tabs). This is the core
   bet, and no numbers are published.
2. JSC plus Effect: bundle init time and per-call marshalling.
3. Event-tap reliability: taps get disabled on timeout, need re-enable logic, and go blind under
   secure input.
4. TCC churn with Nix-built bundles.
5. Chromium `AXManualAccessibility`: delay on a cold tree and its perf cost.
6. Screen Recording prompts on Tahoe.
7. The LLM injection surface.
8. Homerow already "good enough" for the AX part: the product's edge is v1, v2 and the API.

**Open questions are in the hand-off list.**

### Milestone 0 (1–2 days): "AX hints are fast enough, and the bbim domain runs in JSC"

The riskiest assumption is that a fresh AX walk plus labelling plus paint fits about 150 ms p95
on real apps, including Electron, without breaking popovers, while driving the unmodified bbim
domain through JSC.

Build it as a SwiftPM executable menu-bar app, signed with a stable local identity:
1. A Carbon hotkey (⌥⇧Space) starts a parallel AX walk of the frontmost app's windows and any
   open menus or popovers. It uses batched attributes, a 50 ms messaging timeout, and AX
   activation of `AXManualAccessibility`.
2. Targets go to the bbim domain in a `JSContext` (an esbuild bundle of `src/domain`) for
   `dedupe`, `order` and `generateLabels`.
3. Paint on pre-created per-screen `NSPanel`s.
4. A mode-scoped `CGEventTap` feeds strokes through the bbim matcher. A unique match runs
   `AXPress`, with a `CGEvent` click as the fallback.
5. Log every phase to CSV.

| Measure | Pass |
|---|---|
| walk / domain / paint ms, p50 and p95 per app, cold and warm, over 20 runs × 15 apps (Finder, Safari, Chrome, Mail, Notes, System Settings, Xcode, VS Code, Slack, Discord, bb, Obsidian, Preview, Terminal, Figma) | p95 ≤ 150 ms warm on 12 of 15; cold Electron ≤ 400 ms |
| element count and hinted count; manual check of missed controls on 5 apps | ≥ 90 % coverage outside Figma |
| JSC: context init, `generateLabels(2000)`, `feed` per key | init ≤ 50 ms at launch; per key ≤ 1 ms |
| activation success over 100 random picks | ≥ 97 % |
| popover or menu still open after hint activation (Safari bookmarks popover, a Slack menu) | yes |
| same apps through `cua-driver get_window_state` | a baseline for comparison only |

Results go into kb as a `#note` with the CSV. A fail on latency moves the decision to the
cached/observer design before anything else is built. A fail on JSC moves to option (b).
