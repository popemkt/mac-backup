# Whole-OS hint mode with an AI layer: research (macOS first)

Date: 2026-10-23. Method: web search and page fetches. Claims marked **[bg]** come from my background knowledge and were not verified this session. Items I could not find are listed as such.

## 1. heyclicky, openclicky, close relatives

**heyclicky** (https://www.heyclicky.com) is a closed-source commercial Mac app by Farza (Farza Majeed). The site calls it "an ai buddy that lives on your mac."
- Trigger: a hotkey, push-to-talk. The page does not name the key. The phrase "heyclicky agent" starts a background agent.
- Perception: it "sees your screen only when you press the hotkey." Screenshots are not stored, but text summaries are kept. The site does not name the model or say where inference runs. A server side is implied (accounts, retained summaries) but not confirmed.
- Output: it answers by voice and draws annotations such as arrows and circles over the screen (third-party directories: https://www.voiceaispace.com/tool/heyclicky, https://www.everydev.ai/tools/hey-clicky). The agent mode targets Gmail, Notion, Sheets, FL Studio and Claude Code. I could not verify how the agent acts on the OS.
- Price: Free (25 talk and 25 agent messages a month), Pro $20/month (150 agent messages), Max $100/month (1,000 agent messages). macOS 14.2 or later, with a Windows waitlist.
- Code: https://github.com/farzaa/clicky-releases only hosts the .dmg.

**farzaa/clicky** (https://github.com/farzaa/clicky) is the open-source ancestor.
- MIT license. About 7.8k stars and 1.6k forks. The author says the existing code stays open but new work is private, so the repo is frozen relative to the product. The latest dated note I saw was 2026-04-27.
- Stack: a Swift menu-bar app on ScreenCaptureKit, plus a Cloudflare Worker that proxies and holds API keys. It uses Claude for the answer, AssemblyAI for streaming speech-to-text and ElevenLabs for speech output.
- Flow: push-to-talk audio goes to AssemblyAI. The transcript and a screenshot go to Claude. Claude embeds point tags that move a cursor overlay to a UI element, across multiple monitors. It points and does not click.
- Perception is pure screenshot plus vision model, with no Accessibility API. It is cloud-based.

**openclicky** (https://github.com/jasonkneen/openclicky) is a separate project by Jason Kneen, built on the Clicky lineage.
- MIT, "Copyright 2026 Jason Kneen", with parts derived from other MIT projects. About 568 stars, 271 commits. Last-commit date not shown.
- Native macOS menu-bar app (Xcode, macOS 14.2 or later, Sparkle updates, ElevenLabs voice). It bundles a "Codex runtime" and also accepts Anthropic keys. Which model is primary is not stated.
- Perception: Screen Recording permission and screenshots. Replies carry `[POINT:x,y:label]` and `[TYPE:x,y:label]` tags. A local bridge at 127.0.0.1:32123 can capture screenshots with display metadata.
- Action: local shell and file work, and GitHub through a Composio MCP. It uses "computer use" only as a last-mile fallback. Voice-agent child sessions run through `sessions_spawn` and `sessions_send`.
- Other forks exist: https://github.com/iFurySt/clicky, https://github.com/R44VC0RP/clicky (not inspected).
- Not related, despite name hits: clacky-ai/openclacky (a Ruby agent) and SpamixOfficial/OpenClick (a Linux autoclicker).

Takeaway: the Clicky family is "screenshot, vision LLM, point or talk." It is not hint mode and not AX-based. Pointing is the product, acting is a thin extra.

## 2. macOS hint and navigation apps

| App | Perception | Cost / code | Known gaps and notes |
|---|---|---|---|
| Homerow (https://www.homerow.app) | Hints, scroll and search modes (Shift+Space, Shift+J, Shift+/). Mechanism undocumented, almost certainly AX. | Paid, one-time (page shows "$4999", presumably $49.99), macOS 13 or later. Closed source. | Lists "most native apps and a growing set of web-based apps." A third-party review says Firefox and Spotify may have issues and are off by default (https://mac.softpedia.com/get/Utilities/Homerow.shtml). Multi-display and Electron behavior not documented. |
| Vimac (https://github.com/dexterleng/vimac) | AX: hints for actionable elements in the frontmost window, plus a scroll mode. | GPL-3.0. About 3.7k stars, 120 open issues. Superseded by Homerow, so effectively unmaintained. | Best open-source reference for AX hinting. GPL means read it but do not copy it into a non-GPL product. |
| Shortcat | Indexes on-screen elements through the Accessibility API, with hint and type-to-search (https://braindetox.kr/en/posts/shortcat_macos_keyboard_control_2026.html). | Free, proprietary, not actively maintained recently per listings. | Same AX limits. |
| Wooshy | Navigates the Dock, menu bar and status bar (alternativeto listing, https://alternativeto.net/software/homerow). | Not verified. | Narrow scope. |
| Superkey | Listed only as a "keyboard enhancement" tool. I could not confirm its navigation features. | Free, proprietary per listing. | Unverified. |
| Scoot | Nothing found. | n/a | I could not find it. |
| Raycast and launchers | **[bg]** They act on commands and app data (extensions, App Intents-style actions), not on arbitrary UI. | n/a | Not hint tools. Relevant only as the "command palette" half of the idea. |

AX-based tools share these failure modes (sourced where noted):
- Chromium and Electron build their AX tree only when an assistive tool is detected. Third-party tools are meant to set `AXManualAccessibility` on the app (https://www.electronjs.org/docs/latest/tutorial/accessibility). `AXEnhancedUserInterface` is the VoiceOver attribute that Chromium also honors. Setting it breaks window managers such as Magnet (https://developer.apple.com/forums/thread/659755).
- **[bg]** Canvas, games, WebGL, remote desktops and custom-drawn UIs expose no useful AX tree. Java Swing and Qt are partial, depending on the accessibility bridge. Large AX trees are slow to walk.
- I found no published latency numbers for any of these apps.

## 3. AI screen-understanding stacks

| Stack | Perception | Acts via | Local? | License / notes |
|---|---|---|---|---|
| Anthropic computer use (https://platform.claude.com/docs/en/docs/agents-and-tools/tool-use/computer-use-tool) | Screenshots plus a `zoom` region action | 17 tools: click, drag, type, key, scroll, and more. Your code executes them. | Cloud model, local executor | Each screenshot costs about 1,000-1,800 tokens. Small targets cause missed clicks. Recommended 1024x768 to 1280x720. Docs warn about prompt injection and advise a VM. |
| OpenAI Operator / CUA | **[bg, not fetched]** Screenshots, with the model returning actions. | **[bg]** | Cloud | Not verified here. |
| Microsoft OmniParser (https://github.com/microsoft/OmniParser) | Screenshot to structured elements: a YOLO region detector plus a Florence icon captioner. Gives a vision model labeled boxes (set-of-marks style). | n/a (parser only) | Runs locally (GPU-friendly) | About 25.5k stars. License mixed: CC-BY-4.0 on the repo, MIT weights for icon_detect_v3, older detectors AGPL. README gives no latency. |
| UI-TARS Desktop (https://github.com/bytedance/UI-TARS-desktop) | Screenshots into the UI-TARS / Seed-1.5-VL models | Local and remote operators | Local model option (UI-TARS-1.5-7B on Hugging Face) | Apache-2.0, about 39k stars. macOS permission handling not covered on the page. |
| cua / Cua Driver (https://github.com/trycua/cua) | Per-window screenshots. An optional `cua-perception` extension parses a window into text and icon regions (https://github.com/trycua/cua/blob/main/libs/cua-driver/README.md). | CLI, MCP and SDK. It claims background input that does not move the pointer or take focus. The mechanism is not documented on the pages I read. | Local | Mostly MIT. `cua-som` and `cua-perception` are AGPL, and Spaces and the Driver Bench are FSL-1.1-MIT. About 30.7k stars. Permissions are tied to the responsible app identity (TCC). |
| Apple platform pieces | Vision OCR (`VNRecognizeTextRequest`), ScreenCaptureKit, `AXUIElement` | **[bg]** | On-device, all three | **[bg, not fetched]** Vision OCR on a screenshot takes roughly 100-300 ms, depending on size and mode. Apple Intelligence and App Intents give no general UI-driving API that I know of. Verify before relying on any of this. |

## 4. macOS platform constraints

- **Permissions:** Accessibility is needed to read AX and to post events. Screen Recording is needed for screenshots. Sequoia re-prompts about monthly ("Allow For One Month") (https://9to5mac.com/2024/08/14/macos-sequoia-screen-recording-prompt-monthly/, https://tidbits.com/2024/08/19/apple-reduces-excessive-sequoia-permission-requests-shifts-to-monthly). Developers report that even ScreenCaptureKit-only apps get the prompt. The reported entitlement workaround was undocumented. These are 2024 sources and I did not re-check Tahoe. Design the AX-only path to work with no Screen Recording grant.
- **Sandbox and App Store:** **[bg]** Cross-app AX control and event taps are incompatible with the App Sandbox, so the practical route is Developer ID plus notarization, distributed outside the App Store.
- **Hotkeys:** **[bg]** Carbon `RegisterEventHotKey` needs no permission but fires only for modifier-plus-key chords. A `CGEventTap` needs Input Monitoring or Accessibility permission, but it can see and swallow every key. A hint mode needs an event tap, or a key window that takes input, so it can consume label keystrokes.
- **Overlays:** **[bg]** Use a borderless `NSPanel` at a high window level with `canJoinAllSpaces` and `fullScreenAuxiliary` collection behavior, one panel per `NSScreen`. Mind Retina scale and the AX top-left versus AppKit bottom-left coordinate flip.
- **Secure input:** **[bg]** While a password field has focus, event taps stop seeing keystrokes. AX values for secure fields are withheld.
- **AX quirks:** see section 2: Chromium and Electron need `AXManualAccessibility`, and Java and Qt are partial. Each tree walk can be slow and needs a timeout.

## 5. Gaps and opportunities

Nothing I found combines fast AX hinting with an AI fallback. Hint tools (Homerow, Vimac, Shortcat) are AX-only and fail on canvas or custom UIs. The Clicky family is vision-only and cloud-bound, points but rarely clicks, and has no hint grammar. Computer-use stacks (Anthropic, UI-TARS, Cua) are agent loops that cost seconds per step and are not interactive.

A hybrid wins as a tiered pipeline:
1. **AX tree** (milliseconds, exact, free). Walk the frontmost window, the menu bar, the Dock and any popups. Set `AXManualAccessibility` for Electron and Chromium apps. This covers most native apps.
2. **Local vision fallback.** If the AX yield is low or the app is flagged canvas-like, take a ScreenCaptureKit shot and run Vision OCR and, optionally, a detector such as OmniParser. These regions become hints with the same labeling.
3. **LLM layer, opt-in.** For natural-language intent ("click the second invoice's download button"), send a set-of-marks image (the numbered hints) or the AX outline. The model picks a label, so the hint engine does the click. This removes the pixel-coordinate errors Anthropic's docs warn about, and it keeps cloud calls rare.
4. **Execution** through AX actions (`AXPress`) first, then synthesized events. For background or no-focus-steal work, delegate to Cua Driver.

Differentiators: one label grammar over AX and vision sources, an offline mode, per-app learned strategies, multi-display support, and a human-confirmation gate for LLM-chosen actions (the injection risk Anthropic flags).

## What carries over from bbim

I did not re-read the bbim code this session. This is based on the brief's description: a key engine, prefix-free labels and a hint state machine in TypeScript.
- All three are source-agnostic. They need only a list of `{id, rect, role, label}` targets, so AX or vision output can feed them unchanged.
- Native pieces to build new: an AX walker, an overlay window, an event tap and an action executor. A Swift helper process talking to the TS core over IPC fits, as does Electron with a native addon. bbim's own bridge-to-core protocol is a template.
- The existing CuaDriver integration (bb plugin) already offers AX-ish window state, background clicks and screenshots on this Mac. It could be the executor for a prototype before writing any Swift. Mind its AGPL parts if it is ever redistributed.
- Cheapest first experiment: a hotkey, then a `cua_get_desktop_state` style walk, then bbim labels rendered in an overlay.

## Sources
- https://www.heyclicky.com
- https://github.com/farzaa/clicky
- https://github.com/jasonkneen/openclicky
- https://www.voiceaispace.com/tool/heyclicky
- https://www.everydev.ai/tools/hey-clicky
- https://www.homerow.app
- https://github.com/dexterleng/vimac
- https://braindetox.kr/en/posts/shortcat_macos_keyboard_control_2026.html
- https://alternativeto.net/software/homerow
- https://mac.softpedia.com/get/Utilities/Homerow.shtml
- https://github.com/microsoft/OmniParser
- https://github.com/bytedance/UI-TARS-desktop
- https://github.com/trycua/cua
- https://github.com/trycua/cua/blob/main/libs/cua-driver/README.md
- https://platform.claude.com/docs/en/docs/agents-and-tools/tool-use/computer-use-tool
- https://www.electronjs.org/docs/latest/tutorial/accessibility
- https://developer.apple.com/forums/thread/659755
- https://9to5mac.com/2024/08/14/macos-sequoia-screen-recording-prompt-monthly/
- https://tidbits.com/2024/08/19/apple-reduces-excessive-sequoia-permission-requests-shifts-to-monthly
