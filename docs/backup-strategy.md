# Backup Strategy

## Principle

This setup should aim for two complementary outcomes:

1. Rebuild the machine from intentional configuration
2. Restore important state that cannot be derived from configuration

Those are different jobs. Nix and Home Manager handle the first well. Backups handle the second.

## The Core Distinction

Backup and reproducibility are not the same thing.

- A backup preserves what exists right now, including drift, stale settings, and accidental state.
- A declarative system preserves what we intended to exist.

Both matter.

If we only back up blindly:
- we keep everything, but we lose clarity about what the machine is supposed to be
- restores can work, but they become archaeology

If we only declare configuration:
- we get a clean rebuild story
- but we lose runtime state, local databases, and app data that matter in practice

The right model is:
- declare what should exist
- back up what became important through use

## What Nix Does Better

Nix, nix-darwin, and Home Manager are best for:
- installed packages
- shell behavior
- system defaults
- known config files
- app selection
- repeatable service configuration

This is valuable because it captures decisions in an intentional, reviewable form.

Benefits:
- easier machine rebuilds
- less configuration drift
- easier code review
- portability across machines
- fewer hidden dependencies on one specific laptop or desktop

## What Backups Do Better

Backups are best for:
- documents and personal files
- application state
- local databases
- logs worth keeping
- agent memory and runtime history
- exported credentials or local secrets that are not managed elsewhere
- expensive-to-recreate data

Benefits:
- protects against mistakes
- preserves stateful apps
- catches things we forgot to model

## Policy For This Repo

Treat this repo as the source of truth for intentional configuration.

That means:
- if something is a preference, setup choice, package list, service definition, or stable config file, prefer modeling it here
- if something is runtime state, user content, or mutable app data, prefer a backup solution outside this repo

## What Belongs Where

### Put In Nix / Home Manager / Dotfiles

Examples:
- package selections
- shell aliases and environment variables
- editor config
- terminal config
- declarative CLI tool lists
- known app config files under `~/.config`
- stable service definitions

Use this repo when the answer to "should this exist on every rebuild?" is yes.

### Put In Mackup

Use Mackup for GUI app settings that are:
- supported by Mackup
- user preferences rather than large mutable state
- better treated as synchronized config than as Nix-managed files

Examples:
- selected GUI application preferences
- editor/app settings that Mackup already knows how to sync

### Put In Regular Backup

Use Time Machine, cloud backup, or another dedicated backup tool for:
- `~/Documents`
- `~/Desktop`
- `~/Downloads` if needed
- `~/Library/Application Support/...` data
- local databases
- caches only if they are expensive enough to justify preserving
- agent state, working memory, indexes, transcripts, and model artifacts

Use backup when the answer to "is this important state produced by usage?" is yes.

## Managed External Data

For large mutable data that should live on the external `Data` volume but still
appear in its original location, use managed symlinks rather than ad hoc moves.

In this repo, the mirrored target tree lives under:

- `/Volumes/Data/workspace/symlinks/User`

The intention is to preserve the original path shape at a glance. For example:

- `~/.ollama` -> `/Volumes/Data/workspace/symlinks/User/.ollama`
- `~/.local/share/uv` -> `/Volumes/Data/workspace/symlinks/User/.local/share/uv`
- `~/Library/Application Support/Claude/vm_bundles` -> `/Volumes/Data/workspace/symlinks/User/Library/Application Support/Claude/vm_bundles`

This is a pragmatic middle ground:

- apps keep seeing the paths they expect
- the external disk carries the bulky state
- the mapping stays legible and can be rebuilt automatically

Prefer this for large, self-contained directories. Avoid using it as a blanket
strategy for all of `~/Library` or the entire home directory.

## App Onboarding Checklist

When adding a new app or agent, classify it using this checklist:

1. What is the install surface?
- package, cask, npm global, service, or manual install

2. Where is the config?
- `~/.config/...`
- dotfile in `~/`
- `~/Library/Preferences/...`
- `~/Library/Application Support/...`

3. Where is the mutable state?
- database
- cache
- logs
- memory store
- downloaded models
- user-created content

4. Is the config stable and intentional?
- if yes, model it declaratively

5. Is the data mutable and valuable?
- if yes, back it up outside the dotfiles repo

## Hermes Example

For an agent like Hermes:
- install method belongs in declarative config if possible
- stable config belongs in the repo if practical
- mutable state belongs in a normal backup system

That means:
- config: likely Nix/Home Manager or an explicitly tracked config file
- runtime memory/state: backup solution, not dotfiles

## Philosophy

The goal is not "copy everything."

The goal is:
- keep the machine understandable
- keep important state recoverable
- minimize drift
- preserve intent

Short version:
- declarative config captures what we want
- backups preserve what we accumulated

Both are necessary for a machine that can be rebuilt cleanly and restored realistically.
