# Local Voice Tools

Last verified: 2026-07-20

## Decision

Use [OmniVoice Studio](https://github.com/debpalash/OmniVoice-Studio) when one open-source application must cover both local Parakeet dictation and a broad voice-production stack. Keep FluidVoice when its macOS-specific Command Mode, selected-text Write Mode, per-app prompts, or notch-native overlay matter. No fully open-source application currently reproduces every Voicebox and FluidVoice feature in one package.

FluidVoice itself remains declared because it is the strongest native macOS dictation experience of the evaluated tools. Its core application is GPL-3.0, but the optional Fluid Intelligence enhancement runtime is privately maintained and therefore does not satisfy a strict all-features-open-source requirement.

## Managed installation

- Homebrew cask: `fluidvoice`
- Declaration: `modules/darwin/system/homebrew.nix`
- Installed app observed during research: `/Applications/FluidVoice.app`
- Observed version: 1.6.4, build 15
- Homebrew had not adopted the existing application when checked. Before the next rebuild, migrate the existing copy to Homebrew ownership if activation reports that `FluidVoice.app` already exists.

The installed bundle contains Parakeet-specific resources, including `parakeet_custom_vocabulary.default.json`; Parakeet is an implemented path rather than a documentation-only claim.

## Candidate comparison

| Capability | OmniVoice Studio | Voicebox | FluidVoice |
|---|---|---|---|
| Open-source application | AGPL-3.0; bundled default TTS package Apache-2.0 | MIT | GPL-3.0 core; Fluid Intelligence private |
| Parakeet | Shipped: sherpa-onnx v2/v3; NeMo; MLX backend is newer/unreleased work as of verification | Not shipped on `main`; closed, unmerged PR #766 | Shipped: v2/v3/Flash |
| Live global dictation | Yes: streaming partials, hold/toggle, direct typing, paste fallback | Global capture, but streaming transcription remains roadmap work | Yes; strongest native macOS workflow |
| Local transcript refinement | Local LLM option through Ollama/LM Studio | Bundled local LLM refinement/personas | Fluid Intelligence is local but private; cloud providers optional |
| Voice cloning and multi-engine TTS | Yes; 14 documented TTS engines | Yes; 7 documented TTS engines | No |
| Stories and long-form speech | Stories, audiobook editor, chunked TTS | Stories and chunked TTS | No |
| Video dubbing and diarization | Yes | No | No |
| Effects | DSP and effect presets; not exact Voicebox chain-editor parity | Strong reusable effects-chain editor | No |
| API and agents | REST, OpenAI-compatible audio API, MCP, remote backend | REST, MCP, remote inference | No |
| macOS command automation | No | No | Command Mode |
| Rewrite selected text in arbitrary apps | No equivalent workflow | Persona rewriting inside Voicebox, not FluidVoice-style inline rewriting | Write Mode |
| Per-app dictation prompts | No | No | Yes |

## Voicebox Parakeet audit

Repository: [jamiepine/voicebox](https://github.com/jamiepine/voicebox)

The current source contains `Parakeet` only in roadmap, planning, and project-status material. [PR #766](https://github.com/jamiepine/voicebox/pull/766) added Parakeet v2/v3 across model identifiers, backend loaders, API routes, model management, and the UI, but the PR was closed without merging. Do not assume Voicebox supports Parakeet because that implementation exists in a historical PR.

Carrying PR #766 in a private fork would add maintenance around a cross-cutting Transformers upgrade and still would not provide FluidVoice's Command Mode, selected-text rewriting, per-app profiles, or native live-overlay experience.

## OmniVoice Studio assessment

Repository: [debpalash/OmniVoice-Studio](https://github.com/debpalash/OmniVoice-Studio)

Latest stable checked: [v0.3.22](https://github.com/debpalash/OmniVoice-Studio/releases/tag/v0.3.22). The project labels itself active beta.

Why it is the closest consolidation target:

- Parakeet v2/v3 dictation shipped in v0.3.8 through sherpa-onnx, including live partials.
- Global customizable hold/toggle hotkey, direct typing, clipboard fallback, and local LLM cleanup.
- Voice cloning, voice design, takes/history/favorites, pronunciation dictionary, Stories, audiobooks, and unlimited chunked TTS.
- Multiple ASR and TTS engines, plus video dubbing, speaker diarization, vocal isolation, watermarking, and batch workflows.
- REST, OpenAI-compatible speech/transcription endpoints, MCP tools, and remote-backend support.
- Cross-platform Tauri desktop application.

Important release distinction on Apple Silicon:

- The stable release already has cross-platform sherpa-onnx Parakeet and a NeMo CPU path.
- The native `parakeet-mlx` backend was listed under `Unreleased` when checked. Do not treat that newer MLX path as part of v0.3.22.

Remaining gaps preventing strict parity with Voicebox plus FluidVoice:

1. No FluidVoice Command Mode for launching apps, Shortcuts, or system actions.
2. No FluidVoice-style selected-text Write/Rewrite Mode.
3. No per-application dictation prompt profiles.
4. No equivalent notch-native/menu-bar-focused dictation UX.
5. Manual pronunciation/glossary controls rather than FluidVoice's adaptive vocabulary workflow.
6. Effects support does not reproduce Voicebox's full editable, reusable, real-time chain workflow.
7. Its engine roster is broader but not identical to Voicebox's LuxTTS, Chatterbox, TADA, Qwen, and Kokoro combination.

## Other evaluated categories

VoiceInk, OpenWhispr, and similar projects are credible open-source dictation applications, but they do not include the TTS, cloning, Stories, effects, MCP, and production breadth needed for consolidation. Standalone TTS projects such as Kokoro, Chatterbox, F5-TTS, and Qwen3-TTS are engines rather than complete replacements.

## Revalidation checklist

Before replacing FluidVoice or Voicebox with OmniVoice Studio:

1. Check the latest OmniVoice release notes for `parakeet-mlx` promotion from Unreleased.
2. Verify the selected TTS/ASR model licenses, not only the application's AGPL license.
3. Test Parakeet latency and paste behavior on the current Mac.
4. Test the required Voicebox workflows: cloning, long-form generation, effects, Stories, REST, and MCP.
5. Decide whether Command Mode, selected-text rewriting, and per-app profiles are still required; if so, keep FluidVoice alongside OmniVoice.

## Primary sources

- [Voicebox repository](https://github.com/jamiepine/voicebox)
- [Voicebox Parakeet PR #766](https://github.com/jamiepine/voicebox/pull/766)
- [FluidVoice repository](https://github.com/altic-dev/FluidVoice)
- [OmniVoice Studio repository](https://github.com/debpalash/OmniVoice-Studio)
- [OmniVoice Studio v0.3.22](https://github.com/debpalash/OmniVoice-Studio/releases/tag/v0.3.22)
