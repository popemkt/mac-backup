// Pure mapping from Codex app-server notifications to the plugin's voice events. No I/O, so tests run it directly.

/** Codex reports transcript roles as free strings; the UI only distinguishes the person from the concierge. */
export function transcriptRole(role: unknown): "user" | "assistant" {
  return typeof role === "string" && /^(user|input|human)/i.test(role) ? "user" : "assistant";
}

const SECRET_ARG = /((?:token|key|secret|password)[=\s]+)\S+/gi;

/** A short, speakable description of what the backing agent just started, or null when not worth showing. */
export function activityFromItem(item: unknown): string | null {
  if (typeof item !== "object" || item === null) return null;
  const it = item as { type?: string; command?: unknown; tool?: string; server?: string; query?: string };
  switch (it.type) {
    case "commandExecution": {
      const command = Array.isArray(it.command) ? it.command.join(" ") : typeof it.command === "string" ? it.command : "";
      const shown = command.replace(/^(?:\S*\/)?(?:bash|sh|zsh) -l?c\s+/, "").replace(SECRET_ARG, "$1…");
      return shown === "" ? "running a command" : shown.length > 120 ? `${shown.slice(0, 117)}…` : shown;
    }
    case "mcpToolCall":
      return `${it.server ?? "tool"}: ${it.tool ?? "call"}`;
    case "dynamicToolCall":
      return it.tool ?? "tool call";
    case "webSearch":
      return `searching the web${it.query ? `: ${it.query}` : ""}`;
    default:
      return null;
  }
}
