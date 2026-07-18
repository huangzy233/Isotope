import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function WorkbenchShell({ projectId }: { projectId: string }) {
  return (
    <div className="mx-auto flex w-full max-w-page flex-1 flex-col px-6 py-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Project
          </p>
          <h1 className="text-sm font-semibold text-foreground">{projectId}</h1>
        </div>
      </div>

      <div className="grid min-h-[calc(100vh-8.5rem)] flex-1 grid-cols-1 overflow-hidden rounded-lg border border-border bg-card shadow-soft lg:grid-cols-2">
        <section className="flex flex-col border-b border-border lg:border-b-0 lg:border-r">
          <div className="flex h-12 items-center border-b border-border px-4">
            <span className="text-sm font-medium text-foreground">对话</span>
          </div>
          <div className="flex flex-1 flex-col items-center justify-center gap-2 overflow-y-auto px-6 py-10 text-center">
            <p className="text-sm font-medium text-foreground">暂无消息</p>
            <p className="max-w-xs text-sm text-muted-foreground">
              下一步将接入 Agent 对话流。当前为占位界面。
            </p>
          </div>
          <div className="flex items-center gap-2 border-t border-border p-4">
            <Input placeholder="输入消息…" disabled />
            <Button disabled>发送</Button>
          </div>
        </section>

        <section className="flex min-h-64 flex-col">
          <div className="flex h-12 items-center border-b border-border px-4">
            <span className="text-sm font-medium text-foreground">App Viewer</span>
          </div>
          <div className="flex flex-1 flex-col items-center justify-center gap-2 bg-background/60 px-6 py-10 text-center">
            <p className="text-sm font-medium text-foreground">预览区</p>
            <p className="max-w-xs text-sm text-muted-foreground">
              构建产物将在此实时展示
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
