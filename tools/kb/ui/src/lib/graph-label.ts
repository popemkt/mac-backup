export function graphLabelMetrics(radius: number): { maxLen: number; fontSize: number } {
  return {
    maxLen: Math.max(4, Math.floor(radius / 2)),
    fontSize: Math.max(6, Math.min(12, radius * 0.6)),
  };
}

export function formatGraphLabel(label: string, radius: number): string {
  const line = label.split("\n")[0] ?? "";
  const { maxLen } = graphLabelMetrics(radius);
  return line.length > maxLen ? `${line.slice(0, maxLen - 1)}…` : line;
}
