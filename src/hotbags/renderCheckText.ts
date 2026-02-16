import type { CheckMessage } from "./schema";

export function renderCheckText(check: CheckMessage): string {
  const lines: string[] = [];
  lines.push(check.summary_title);

  for (const line of check.lines) {
    lines.push(`*${line.key}*: ${line.value} (${line.confidence})`);
  }

  lines.push(...check.instructions);
  return lines.join("\n");
}
