"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkspaceFileTree } from "@/components/workspace-file-tree";
import {
  buildFileTree,
  defaultExpandedDirs,
  type FileTreeNode,
} from "@/lib/build-file-tree";

function openFileStorageKey(projectId: string) {
  return `isotope.workbench.openFile:${projectId}`;
}

function fileContentUrl(projectId: string, relativePath: string) {
  const encoded = relativePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `/api/projects/${projectId}/files/${encoded}`;
}

export function WorkspaceEditorPane({ projectId }: { projectId: string }) {
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [nodes, setNodes] = useState<FileTreeNode[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);
  const [staleRememberedPath, setStaleRememberedPath] = useState<
    string | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    setListLoading(true);
    setListError(null);
    setFiles([]);
    setNodes([]);
    setExpanded(new Set());
    setSelectedPath(null);
    setContent(null);
    setContentError(null);
    setStaleRememberedPath(null);

    void (async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/files`);
        const data = (await res.json().catch(() => null)) as {
          files?: string[];
          error?: string;
        } | null;
        if (cancelled) return;

        if (!res.ok || !Array.isArray(data?.files)) {
          setListError(
            typeof data?.error === "string" ? data.error : "加载文件列表失败",
          );
          setListLoading(false);
          return;
        }

        const fileList = data.files;
        let remembered: string | null = null;
        try {
          remembered = localStorage.getItem(openFileStorageKey(projectId));
        } catch {
          // ignore storage errors
        }

        const validOpen =
          remembered && fileList.includes(remembered) ? remembered : null;
        if (remembered && !validOpen) {
          try {
            localStorage.removeItem(openFileStorageKey(projectId));
          } catch {
            // ignore storage errors
          }
          setStaleRememberedPath(remembered);
        }

        setFiles(fileList);
        setNodes(buildFileTree(fileList));
        setExpanded(defaultExpandedDirs(fileList, validOpen));
        setSelectedPath(validOpen);
        setListLoading(false);
      } catch {
        if (cancelled) return;
        setListError("加载文件列表失败");
        setListLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    if (!selectedPath) {
      setContent(null);
      setContentError(null);
      setContentLoading(false);
      return;
    }

    let cancelled = false;
    setContentLoading(true);
    setContentError(null);

    void (async () => {
      try {
        const res = await fetch(fileContentUrl(projectId, selectedPath));
        const data = (await res.json().catch(() => null)) as {
          content?: string;
          error?: string;
        } | null;
        if (cancelled) return;

        if (!res.ok || typeof data?.content !== "string") {
          setContent(null);
          setContentError(
            typeof data?.error === "string" ? data.error : "加载文件失败",
          );
          setContentLoading(false);
          return;
        }

        setContent(data.content);
        setContentError(null);
        setContentLoading(false);
      } catch {
        if (cancelled) return;
        setContent(null);
        setContentError("加载文件失败");
        setContentLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId, selectedPath]);

  const onToggleDir = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const onSelectFile = useCallback(
    (path: string) => {
      setStaleRememberedPath(null);
      setSelectedPath(path);
      try {
        localStorage.setItem(openFileStorageKey(projectId), path);
      } catch {
        // ignore storage errors
      }
    },
    [projectId],
  );

  if (listLoading) {
    return (
      <div className="flex min-h-0 flex-1">
        <aside className="w-[240px] shrink-0 space-y-2 overflow-auto border-r border-border p-3">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-1/2" />
          <p className="pt-2 text-sm text-muted-foreground">加载中…</p>
        </aside>
        <div className="flex min-w-0 flex-1 items-center justify-center p-4">
          <Skeleton className="h-40 w-full max-w-md" />
        </div>
      </div>
    );
  }

  if (listError) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        <EmptyState title="无法加载文件列表" description={listError} />
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        <EmptyState
          title="工作区暂无源码文件"
          description="项目创建或生成代码后即可在此查看。"
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="w-[240px] shrink-0 overflow-auto border-r border-border">
        <WorkspaceFileTree
          nodes={nodes}
          selectedPath={selectedPath}
          expanded={expanded}
          onToggleDir={onToggleDir}
          onSelectFile={onSelectFile}
        />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        {contentLoading ? (
          <div className="flex flex-1 flex-col gap-3 p-4">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-40 w-full" />
            <p className="text-sm text-muted-foreground">加载中…</p>
          </div>
        ) : contentError ? (
          <div className="flex flex-1 items-center justify-center p-4">
            <EmptyState title="无法打开文件" description={contentError} />
          </div>
        ) : selectedPath && content !== null ? (
          <>
            <div className="shrink-0 border-b border-border px-3 py-2">
              <p className="truncate font-mono text-xs text-muted-foreground">
                {selectedPath}
              </p>
            </div>
            <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-3 font-mono text-xs text-foreground">
              {content}
            </pre>
          </>
        ) : staleRememberedPath ? (
          <div className="flex flex-1 items-center justify-center p-4">
            <EmptyState
              title="文件不存在或已删除"
              description="该文件已不在工作区中，请从左侧重新选择。"
            />
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center p-4">
            <EmptyState
              title="选择左侧文件以查看"
              description="从左侧文件树打开一个文件。"
            />
          </div>
        )}
      </div>
    </div>
  );
}
