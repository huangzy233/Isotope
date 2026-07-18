"use client";

import { useState } from "react";

const TOOL_LABEL: Record<string, string> = {
  read_file: "读取文件",
  write_file: "写入文件",
  list_files: "列出文件",
};

function toolTitle(name: string, summary?: string) {
  const label = TOOL_LABEL[name] ?? name;
  return summary ? `${label} ${summary}` : label;
}

export function ToolCallRow({
  name,
  summary,
}: {
  name: string;
  summary?: string;
}) {
  return (
    <p className="truncate py-1 text-xs leading-relaxed text-muted-foreground">
      {toolTitle(name, summary)}
    </p>
  );
}

export function ToolCallGroup({
  tools,
}: {
  tools: Array<{
    id: string;
    name: string;
    summary?: string;
    status: "running" | "done" | "error";
  }>;
}) {
  const [open, setOpen] = useState(true);
  const [first, ...rest] = tools;
  if (!first) return null;

  const toggle = (
    <button
      type="button"
      className="shrink-0 text-xs leading-relaxed text-muted-foreground hover:text-foreground"
      onClick={() => setOpen((v) => !v)}
    >
      {open ? "隐藏" : `展开（${tools.length}）`}
    </button>
  );

  return (
    <div className="rounded-lg border border-border/60 bg-transparent px-2 py-1">
      <div className="flex items-baseline justify-between gap-2">
        <p className="min-w-0 truncate text-xs leading-relaxed text-muted-foreground">
          {open
            ? toolTitle(first.name, first.summary)
            : `${tools.length} 个工具调用`}
        </p>
        {toggle}
      </div>
      {open
        ? rest.map((tool) => (
            <ToolCallRow
              key={tool.id}
              name={tool.name}
              summary={tool.summary}
            />
          ))
        : null}
    </div>
  );
}
