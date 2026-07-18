import { Badge } from "@/components/ui/badge";

const STATUS_LABEL: Record<StatusKey, string> = {
  idle: "空闲",
  thinking: "思考中",
  running: "执行中",
  streaming: "输出中",
  done: "完成",
  error: "错误",
  building: "构建中",
  ready: "就绪",
  failed: "失败",
};

type StatusKey =
  | "idle"
  | "thinking"
  | "running"
  | "streaming"
  | "done"
  | "error"
  | "building"
  | "ready"
  | "failed";

const STATUS_VARIANT: Record<
  StatusKey,
  "secondary" | "outline" | "warning" | "success" | "destructive"
> = {
  idle: "secondary",
  thinking: "outline",
  running: "warning",
  streaming: "warning",
  done: "success",
  error: "destructive",
  building: "warning",
  ready: "success",
  failed: "destructive",
};

export function StatusBadge({ status }: { status: StatusKey }) {
  return <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>;
}
