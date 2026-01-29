import type { OperatorCommand } from "./schema";

export function parseOperatorCommand(text: string): OperatorCommand {
  const trimmed = text.trim();
  const upper = trimmed.toUpperCase();

  if (upper === "YES") {
    return { intent: "YES", edits: {} };
  }

  if (upper === "CANCEL") {
    return { intent: "CANCEL", edits: {} };
  }

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return { intent: "UNKNOWN", edits: {} };
  }

  let intent: OperatorCommand["intent"] = "UNKNOWN";
  let editLines = lines;

  if (lines[0].toUpperCase() === "EDIT") {
    intent = "EDIT";
    editLines = lines.slice(1);
  } else if (lines.every((line) => line.includes("="))) {
    intent = "EDIT";
  }

  if (intent !== "EDIT") {
    return { intent: "UNKNOWN", edits: {} };
  }

  const edits: Record<string, string> = {};

  for (const line of editLines) {
    if (!line.includes("=")) {
      throw new Error(`Invalid edit line "${line}"`);
    }

    const [rawKey, ...rest] = line.split("=");
    const key = rawKey.trim();
    const value = rest.join("=").trim();

    if (!key) {
      throw new Error(`Invalid edit key in "${line}"`);
    }

    edits[key] = value;
  }

  return { intent: "EDIT", edits };
}
