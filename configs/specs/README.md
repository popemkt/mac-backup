# Specs

This directory is the repo's source of truth for behavior, implementation
mapping, and engineering rules.

## Spec Types

| Path | Purpose |
|---|---|
| `functional/` | User-visible behavior and system capability specs. Describe what the system does without requiring knowledge of the code. |
| `bridging/` | Code-to-behavior specs. Map functional areas to nix modules, scripts, tools, and files. Update when implementation responsibility or file ownership changes. |
| `dotfiles-system.md` | Architecture decisions, layer ownership, key design choices, and known gaps. |
| `code-unit-cohesion.md` | Code-unit cohesion rubric for use with Archon cohesion-review workflow. |

Functional specs change when system behavior changes. Bridging specs change when
implementation moves or a new mechanism takes over a responsibility.
