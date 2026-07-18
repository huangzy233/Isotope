export type FileTreeNode = {
  name: string;
  path: string; // dir: "src" / "src/components"；file: full relative path
  kind: "file" | "dir";
  children?: FileTreeNode[];
};

export function buildFileTree(paths: string[]): FileTreeNode[] {
  type Mutable = {
    name: string;
    path: string;
    kind: "file" | "dir";
    children?: Map<string, Mutable>;
  };
  const root = new Map<string, Mutable>();

  for (const filePath of [...paths].sort()) {
    const parts = filePath.split("/").filter(Boolean);
    let level = root;
    let prefix = "";
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i]!;
      prefix = prefix ? `${prefix}/${name}` : name;
      const isFile = i === parts.length - 1;
      let node = level.get(name);
      if (!node) {
        node = {
          name,
          path: prefix,
          kind: isFile ? "file" : "dir",
          children: isFile ? undefined : new Map(),
        };
        level.set(name, node);
      }
      if (!isFile) {
        node.kind = "dir";
        node.children ??= new Map();
        level = node.children;
      }
    }
  }

  const toArray = (map: Map<string, Mutable>): FileTreeNode[] =>
    [...map.values()]
      .sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .map((n) => ({
        name: n.name,
        path: n.path,
        kind: n.kind,
        children: n.children ? toArray(n.children) : undefined,
      }));

  return toArray(root);
}

/** 返回应默认展开的目录 path 集合：根下一层 + openFile 的祖先 */
export function defaultExpandedDirs(
  files: string[],
  openFilePath: string | null,
): Set<string> {
  const expanded = new Set<string>();
  for (const f of files) {
    const i = f.indexOf("/");
    if (i > 0) expanded.add(f.slice(0, i));
  }
  if (openFilePath) {
    const parts = openFilePath.split("/");
    let prefix = "";
    for (let i = 0; i < parts.length - 1; i++) {
      prefix = prefix ? `${prefix}/${parts[i]}` : parts[i]!;
      expanded.add(prefix);
    }
  }
  return expanded;
}
