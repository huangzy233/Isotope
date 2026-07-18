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
    return undefined;
  }
  return undefined;
}
