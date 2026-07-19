# Workbench Immersive Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 工作台右侧主区支持沉浸模式：隐藏对话与分栏条，应用查看器与编辑器均可铺满；按钮或 Esc 退出。

**Architecture:** 仅在 `workbench-shell.tsx` 增加会话级 `immersive` 状态；条件隐藏对话 section 与分隔条；顶栏切换进入/退出；`window` 级 `keydown` 监听 Esc。不改 API、领域包、侧栏。

**Tech Stack:** Next.js / React 客户端组件、既有 shadcn `Button` / `Tabs`、lucide-react（`Maximize2` / `Minimize2`）。

**Spec:** `docs/superpowers/specs/2026-07-19-workbench-immersive-viewer-design.md`

## Global Constraints

- 用户可见文案：简体中文（「沉浸」/「退出沉浸」）。
- 不写 localStorage；刷新后非沉浸。
- 不调用 Fullscreen API；不新开标签页。
- 不隐藏 `AppSidebar`；不拆 `ViewerChrome`。
- 沉浸中保留 Tabs + 预览 StatusBadge/刷新；`chatPct` 退出后不变。
- preview 与 editor 共用同一 `immersive`。
- 无 `@testing-library`：以手工验收为主；本计划不新增测试框架。
- **未经用户明确要求不要 git commit 实现代码**（下文 commit 步骤仅在用户要求时执行）。

---

## File Structure

| 路径 | 职责 |
|------|------|
| `apps/web/components/workbench-shell.tsx` | `immersive` state、布局条件渲染、顶栏按钮、Esc 监听 |

无新文件。

---

### Task 1: Immersive layout + toggle + Esc

**Files:**
- Modify: `apps/web/components/workbench-shell.tsx`

**Interfaces:**
- Consumes: 现有 `viewerMode`、`chatPct`、对话 section / separator / 右侧 section 结构
- Produces: `const [immersive, setImmersive] = useState(false)`；沉浸时对话与 separator 不可见

- [ ] **Step 1: 增加图标 import 与 `immersive` 状态**

在现有 lucide import 中加入 `Maximize2`、`Minimize2`：

```tsx
import { CheckCircle2, ChevronUp, Maximize2, Minimize2 } from "lucide-react";
```

在 `viewerMode` state 旁增加：

```tsx
const [immersive, setImmersive] = useState(false);
```

- [ ] **Step 2: Esc 退出**

在组件内（与其他 `useEffect` 并列）增加：

```tsx
useEffect(() => {
  if (!immersive) return;
  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      setImmersive(false);
    }
  }
  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}, [immersive]);
```

- [ ] **Step 3: 条件隐藏对话区与分隔条**

对话 `section`：在现有 `className` 上，当 `immersive` 为 true 时追加 `hidden`（保留挂载以免重挂 Composer 状态意外丢失；若更倾向不渲染，用 `{!immersive && ( <section>...</section> )}` 亦可，优先 `hidden` 以保留消息滚动位置）。

垂直分隔条外层：同样在 `immersive` 时加 `hidden`（或包在 `!immersive &&`）。注意现有已有 `hidden … xl:block`——沉浸时必须始终不可见，例如：

```tsx
className={cn(
  "relative z-10 w-0 shrink-0",
  immersive ? "hidden" : "hidden xl:block",
  // …其余 before/after / dragging 类保持不变
)}
```

- [ ] **Step 4: 顶栏沉浸按钮（preview 与 editor 均显示）**

将右侧顶栏从「仅 preview 显示 StatusBadge/刷新」改为：左侧仍 Tabs；右侧为操作组——预览时保留 StatusBadge + 刷新；**无论何种 `viewerMode`** 都显示沉浸切换按钮：

```tsx
<div className="flex items-center gap-2">
  {viewerMode === "preview" ? (
    <>
      <StatusBadge status={preview?.status ?? "idle"} />
      {preview?.status === "ready" || preview?.status === "building" ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void handleRebuild()}
        >
          刷新
        </Button>
      ) : null}
    </>
  ) : null}
  <Button
    type="button"
    variant="outline"
    size="sm"
    aria-pressed={immersive}
    aria-label={immersive ? "退出沉浸" : "沉浸"}
    onClick={() => setImmersive((v) => !v)}
  >
    {immersive ? (
      <Minimize2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
    ) : (
      <Maximize2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
    )}
    {immersive ? "退出沉浸" : "沉浸"}
  </Button>
</div>
```

删除原先「仅 `viewerMode === "preview"` 才渲染整个右侧操作区」的包裹，避免 editor 下看不到沉浸按钮。

- [ ] **Step 5: 手工验收**

Run（开发服务器若已开则直接浏览器）：打开任意项目工作台。

Expected:
1. 预览 Ready → 点「沉浸」→ 对话与分隔条消失，iframe 变宽；顶栏仍有 Tabs / 状态 / 刷新 /「退出沉浸」。
2. 沉浸中切「编辑器」→ 仍沉浸，编辑器铺满。
3. Esc 或「退出沉浸」→ 双栏恢复，分栏宽度与进入前一致。
4. 非沉浸按 Esc → 无变化。
5. 窄视口（或 DevTools 移动宽度）沉浸仍隐藏对话区。

- [ ] **Step 6: Commit（仅当用户要求时）**

```bash
git add apps/web/components/workbench-shell.tsx
git commit -m "$(cat <<'EOF'
feat(web): add workbench immersive viewer mode

EOF
)"
```

---

## Spec coverage (self-review)

| Spec 要求 | Task |
|-----------|------|
| 藏对话 + 分隔条，主区铺满 | Task 1 Step 3 |
| preview + editor 均可沉浸并切换 | Task 1 Step 4 |
| 保留顶栏 Tabs / 状态 / 刷新 | Task 1 Step 4 |
| 按钮 + Esc 退出 | Task 1 Step 2 + 4 |
| 不持久化 | Task 1 Step 1（仅 useState） |
| 不改侧栏 / Fullscreen / 新标签 | 无对应代码（刻意不做） |
| 窄屏验收 | Task 1 Step 5 |
| `chatPct` 保持 | 不改 `chatPct` 逻辑，仅隐藏 DOM |

无 TBD/占位符；无新类型跨任务不一致。
