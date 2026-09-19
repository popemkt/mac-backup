#!/usr/bin/env bash
# scripts/sync-agent-plugins.sh
# Syncs repo-tracked plugins (assets/plugins/*) into local AI agent environments:
# Oh My Pi (omp), Claude Code, Codex, Cursor, and the shared ~/.agents registry.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGINS_DIR="${REPO_ROOT}/assets/plugins"

if [ ! -d "${PLUGINS_DIR}" ]; then
  echo "No plugins directory found at ${PLUGINS_DIR}"
  exit 0
fi

mkdir -p "${HOME}/.agents/skills" \
         "${HOME}/.claude/skills" \
         "${HOME}/.codex/skills" \
         "${HOME}/.cursor/skills-cursor"

for plugin in "${PLUGINS_DIR}"/*; do
  [ -d "${plugin}" ] || continue
  plugin_name="$(basename "${plugin}")"
  echo "==> Processing plugin: ${plugin_name}"

  # 1. Validate manifests if tools are available
  if command -v claude >/dev/null 2>&1 && [ -f "${plugin}/.claude-plugin/plugin.json" ]; then
    claude plugin validate "${plugin}" >/dev/null 2>&1 || true
  fi

  # 2. Link into Oh My Pi (omp)
  if command -v omp >/dev/null 2>&1 && [ -f "${plugin}/package.json" ]; then
    echo "    Linking into Oh My Pi (omp)..."
    omp plugin link "${plugin}" >/dev/null 2>&1 || true
  fi

  # 3. Symlink skills across agent registries
  if [ -d "${plugin}/skills" ]; then
    for skill_dir in "${plugin}/skills"/*; do
      [ -d "${skill_dir}" ] || continue
      skill_name="$(basename "${skill_dir}")"
      echo "    Symlinking skill: ${skill_name}"

      # Central ~/.agents registry
      ln -sfn "${skill_dir}" "${HOME}/.agents/skills/${skill_name}"

      # Claude Code
      ln -sfn "${HOME}/.agents/skills/${skill_name}" "${HOME}/.claude/skills/${skill_name}"

      # Codex
      ln -sfn "${HOME}/.agents/skills/${skill_name}" "${HOME}/.codex/skills/${skill_name}"

      # Cursor
      ln -sfn "${HOME}/.agents/skills/${skill_name}" "${HOME}/.cursor/skills-cursor/${skill_name}"
    done
  fi
done

echo "==> Done. Plugins and skills are synchronized across all local agents."
