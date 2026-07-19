export function toolSummary(
  name: string,
  argsJson: string,
): string | undefined {
  try {
    const args = JSON.parse(argsJson) as Record<string, unknown>;
    if (name === "list_files") {
      return typeof args.relativeDir === "string" && args.relativeDir.length > 0
        ? args.relativeDir
        : ".";
    }
    if (name === "read_file" || name === "write_file") {
      return typeof args.path === "string" ? args.path : undefined;
    }
  } catch {
    return peekToolSummary(name, argsJson);
  }
  return undefined;
}

/** Best-effort summary from partial tool-call JSON (e.g. path before content). */
export function peekToolSummary(
  name: string,
  argsSoFar: string,
): string | undefined {
  if (name === "read_file" || name === "write_file") {
    return peekJsonStringField(argsSoFar, "path");
  }
  if (name === "list_files") {
    return peekJsonStringField(argsSoFar, "relativeDir") ?? ".";
  }
  return undefined;
}

function peekJsonStringField(
  argsSoFar: string,
  field: string,
): string | undefined {
  const re = new RegExp(`"${field}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`);
  const m = re.exec(argsSoFar);
  if (!m?.[1]) return undefined;
  try {
    return JSON.parse(`"${m[1]}"`) as string;
  } catch {
    return m[1];
  }
}
