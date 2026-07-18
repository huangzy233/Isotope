"use client";

import type { JSX } from "react";
import type { TaskStatus } from "@isotope/workspace";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: "待创建",
  assigned: "待执行",
  running: "执行中",
  completed: "已完成",
  failed: "失败",
};

function statusVariant(
  status: TaskStatus,
): "secondary" | "warning" | "success" | "destructive" {
  switch (status) {
    case "running":
      return "warning";
    case "completed":
      return "success";
    case "failed":
      return "destructive";
    default:
      return "secondary";
  }
}

export function TaskCard(props: {
  title: string;
  assignee: string;
  status: TaskStatus;
}): JSX.Element {
  const { title, assignee, status } = props;

  return (
    <div className="mb-2 space-y-2 rounded-md border border-border p-2">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-sm font-medium text-foreground">
          {title}
        </p>
        <Badge variant={statusVariant(status)}>{STATUS_LABEL[status]}</Badge>
      </div>
      <p className="text-xs text-muted-foreground">指派给 {assignee}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => {}}>
          创建任务
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={status === "completed"}
          onClick={() => {}}
        >
          完成任务
        </Button>
      </div>
    </div>
  );
}
