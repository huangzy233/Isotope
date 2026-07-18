"use client";

import { ChevronDown, ChevronRight, FileIcon, FolderIcon } from "lucide-react";
import type { FileTreeNode } from "@/lib/build-file-tree";
import { cn } from "@/lib/utils";

export function WorkspaceFileTree({
  nodes,
  selectedPath,
  expanded,
  onToggleDir,
  onSelectFile,
  depth = 0,
}: {
  nodes: FileTreeNode[];
  selectedPath: string | null;
  expanded: Set<string>;
  onToggleDir: (path: string) => void;
  onSelectFile: (path: string) => void;
  depth?: number;
}) {
  return (
    <ul className="flex flex-col gap-0.5 p-1" role={depth === 0 ? "tree" : "group"}>
      {nodes.map((node) => {
        const isDir = node.kind === "dir";
        const isOpen = isDir && expanded.has(node.path);
        const isSelected = !isDir && selectedPath === node.path;

        return (
          <li key={node.path} role="treeitem">
            <button
              type="button"
              aria-expanded={isDir ? isOpen : undefined}
              className={cn(
                "flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-sm text-foreground",
                "hover:bg-muted/60",
                isSelected && "bg-muted",
              )}
              style={{ paddingLeft: `${0.5 * (depth + 1)}rem` }}
              onClick={() => {
                if (isDir) onToggleDir(node.path);
                else onSelectFile(node.path);
              }}
            >
              {isDir ? (
                isOpen ? (
                  <ChevronDown
                    aria-hidden
                    className="size-3.5 shrink-0 text-muted-foreground"
                  />
                ) : (
                  <ChevronRight
                    aria-hidden
                    className="size-3.5 shrink-0 text-muted-foreground"
                  />
                )
              ) : (
                <span className="size-3.5 shrink-0" aria-hidden />
              )}
              {isDir ? (
                <FolderIcon
                  aria-hidden
                  className="size-3.5 shrink-0 text-muted-foreground"
                />
              ) : (
                <FileIcon
                  aria-hidden
                  className="size-3.5 shrink-0 text-muted-foreground"
                />
              )}
              <span className="min-w-0 truncate">{node.name}</span>
            </button>
            {isDir && isOpen && node.children && node.children.length > 0 ? (
              <WorkspaceFileTree
                nodes={node.children}
                selectedPath={selectedPath}
                expanded={expanded}
                onToggleDir={onToggleDir}
                onSelectFile={onSelectFile}
                depth={depth + 1}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
