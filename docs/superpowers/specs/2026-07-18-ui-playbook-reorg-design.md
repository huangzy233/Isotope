# 设计：Isotope UI Design Playbook 文档重组

- 日期：2026-07-18
- 状态：已批准（对话确认：方案 B + 决策 B；Settings Blueprint 延后；新增 docs 索引）
- 范围：重组 UI 指导文档为 AI Native Playbook；不实现 `apps/web` 样式变更

## 1. 目标

将当前「单文件 / 双源镜像」的 UI Guideline，重组为一套 **AI Native UI Design Playbook**，使 Cursor / Claude Code / GPT 能：

- 按任务只打开少量文档
- 稳定生成 Linear / Cursor / Claude / Vercel / Notion 气质的 Modern SaaS Tool UI
- 长期维护时变更落在正确文件，避免双写漂移

### 1.1 非目标

- 本轮不重写视觉 Token 数值（沿用现有 Neutral Tool 约定）
- 本轮不改 `apps/web` 实现
- 本轮不写 Settings 页面 Blueprint（等有产品需求再加）

## 2. 决策摘要

| 决策 | 选择 |
|------|------|
| 组织方案 | **B**：扁平 `docs/ui/` + 独立 `ai-surfaces.md` |
| 旧 `docs/UI_GUIDE.md` | **删除**；全仓引用改为 `docs/ui/README.md` |
| 旧 UI design system spec | **保留只读归档**；顶部标注已被 `docs/ui/*` 取代 |
| Settings Blueprint | **延后**；本轮只覆盖 Login / Home / Workspace / App Header |
| docs 总索引 | **新增** `docs/README.md`（链到 docs 下文档，**排除 specs**） |

## 3. 目标目录

```text
docs/
├── README.md                          # 新增：docs 总索引（不含 specs）
├── PRD.md
├── architecture/
│   └── PROJECT_SKELETON.md
├── ui/                                # 新增：UI Design Playbook
│   ├── README.md                      # 路由图
│   ├── design-principles.md
│   ├── design-system.md
│   ├── page-blueprints.md
│   ├── composition.md
│   ├── ai-surfaces.md
│   ├── ai-ui-playbook.md
│   └── inspirations.md
├── UI_GUIDE.md                        # 删除
└── superpowers/
    ├── specs/
    │   ├── 2026-07-18-ui-design-system.md      # 归档只读
    │   └── 2026-07-18-ui-playbook-reorg-design.md  # 本文
    └── plans/                         # 索引须链接（按日期列表）；specs 不入索引
```

## 4. AI 阅读契约

写入 `docs/ui/README.md`：

| 场景 | 必读（按序） | 按需 |
|------|-------------|------|
| 任意 UI 改动 | `ui/README` → `design-principles` → `ai-ui-playbook`（Checklist） | — |
| 改颜色 / 字号 / 间距 | + `design-system` | — |
| 新建 / 大改某页 | + `page-blueprints`（对应该页） | `composition` |
| 改 Composer / 消息 / Viewer | + `ai-surfaces` | `composition` |
| 不确定「像不像产品」 | + `inspirations`（规律段） | — |
| 写 Prompt / 审 AI 产出 | `ai-ui-playbook` 全文 | — |

硬规则：**默认不超过 3 篇进上下文**；禁止一次塞入全部 Playbook 文件。

## 5. 各文档职责与章节大纲

### 5.1 `docs/README.md`（新增 · docs 总索引）

**职责：** 人类与 AI 进入 `docs/` 的地图。只做链接与一句话说明，不做设计细节。

**包含链接（排除 `docs/superpowers/specs/**`）：**

| 链接 | 说明 |
|------|------|
| `PRD.md` | 产品范围与验收 |
| `architecture/PROJECT_SKELETON.md` | 包边界与目录布局 |
| `ui/README.md` | UI Design Playbook 入口 |
| `superpowers/plans/*` | 实现计划（按日期列表，须全部挂上） |

**明确不链：** `docs/superpowers/specs/**`（设计决策原文由各领域入口或归档说明指向，避免索引膨胀与「双入口」）。

**章节：**

1. Isotope 文档地图（一句话）
2. 产品与架构
3. UI Design Playbook
4. 实现计划（`superpowers/plans/`，逐条链接）
5. 维护说明：新增非-spec 文档须挂到本索引；**任何** `specs/` 下文件永不入本索引

### 5.2 `docs/ui/README.md`

**职责：** Playbook 路由；≤80 行。

**章节：**

1. 这是什么（AI Native Playbook；气质一句话）
2. 阅读顺序（§4 矩阵）
3. 文档职责表
4. 「我要改 X → 去哪」速查
5. 人工维护原则（一事实一处；变更频率分层）
6. 与旧文档关系（`UI_GUIDE` 已废止；旧 spec 只读）

### 5.3 `docs/ui/design-principles.md`

**职责：** 只答 Why。无 Tailwind、无 Token、无组件名。

**章节：**

1. 产品是谁 / 目标用户
2. 目标气质：Neutral Tool
3. 为什么 Neutral Tool
4. 为什么高信息密度（密度 ≠ 拥挤）
5. 为什么少颜色 / 少装饰
6. 为什么不做 Marketing / Landing
7. 为什么参考 Linear 等（取规律不取皮肤）
8. 六条硬原则（哲学表述）
9. 非目标

### 5.4 `docs/ui/design-system.md`

**职责：** 只答「长什么样」。不描述页面模块。

**章节：**

1. 技术硬约束（shadcn 唯一源）
2. Color tokens + 使用规则
3. Typography
4. Spacing
5. Radius / Shadow / Border
6. Motion
7. Icon（新增）
8. Grid / Width presets（Auth / App Content / Workbench；警告：宽度 ≠ 页面蓝图）
9. CSS Variables 维护点
10. shadcn / Tailwind 规范
11. 禁止事项
12. 交互状态基线（Hover / Focus / Disabled / Loading）

### 5.5 `docs/ui/page-blueprints.md`

**职责：** 每页 Blueprint；AI 可机械执行。本轮页面：

- Login `/login`
- Home `/`
- Workspace `/projects/[id]`
- App Header（跨页壳）

**不包含：** Settings（延后）。

**每页固定模板：**

- 页面目标
- 主要任务 / Primary Action
- 信息架构（必须 / 可选模块）
- 推荐布局 + ASCII Wireframe
- 宽度 / 高度 / 内容密度
- 首屏 / 第二屏
- empty / loading / error 要点
- 响应式要点
- 为什么这样布局
- 本页反例

### 5.6 `docs/ui/composition.md`

**职责：** 通用布局组合；Good / Bad + 为什么。

**章节：** Visual Hierarchy；Vertical / Spacing Rhythm；Section；Hero（工具页几乎不用）；Sidebar；Toolbar / PanelHeader；Panel；Card 排列；Project List；Empty / Loading / Error；Composer 外壳（布局层，状态机见 ai-surfaces）；Good/Bad 对照集。

### 5.7 `docs/ui/ai-surfaces.md`

**职责：** AI 产品面专用结构与状态机。

**章节：** Composer；Agent 状态；消息时间线；Tool；Streaming；Trace/Cost；App Viewer；组合件清单；与 Blueprint 的引用关系。

### 5.8 `docs/ui/ai-ui-playbook.md`

**职责：** 给模型的操作系统。

**章节：** 成功标准；生成前 5 问；生成时约束；Prompt 编写规范；生成后 Checklist；结构自检 4 问；Anti-patterns（Demo / Dribbble / Web3 / Landing 等）；禁止清单；最小修复循环。

### 5.9 `docs/ui/inspirations.md`

**职责：** 参考产品规律；无 Token。

**产品：** Claude、Cursor、Linear、Notion、Vercel、Stripe Dashboard。

**每产品分析轴：** 为什么高级；布局；留白；Typography；Sidebar；Toolbar；Density；Hierarchy；Composer（若有）；Workspace（若有）。

**另含：** 跨产品规律；Isotope 取舍（采用 / 不采用）。

## 6. 内容迁移总账

### 6.1 从 `UI_GUIDE.md` / `2026-07-18-ui-design-system.md` 迁移

| 源内容 | 目标 |
|--------|------|
| 气质一句话、组件库锁定、主色一句 | `ui/README` |
| §1–2 原则、非目标、Neutral Tool Why | `design-principles` |
| §3 技术硬约束、§4 Tokens、§5 交互基线 | `design-system` |
| §7 页面、§8 Responsive、§9 IA（拆入各页） | `page-blueprints` |
| Empty/密度/层级的「怎么摆」 | `composition` |
| §6 AI 产品模式、§3.4 组合件 | `ai-surfaces` |
| §11 Checklist、「禁止 Demo 脸」 | `ai-ui-playbook` |
| 参考站名单 | `inspirations`（扩写） |
| 相关文档表（PRD / 架构） | `docs/README` + `ui/README` |

### 6.2 删除

| 项 | 原因 |
|----|------|
| 文件 `docs/UI_GUIDE.md` | 决策 B；单源在 `docs/ui/` |
| 实现优先级 P0/P1 表（不迁入 Playbook） | 已有独立 plan；避免过期范围句 |
| 「本轮不改代码」等历史范围句 | 属于旧交付周期 |
| Settings Blueprint | 本轮明确延后 |
| 双文档重复叙述 | 消灭漂移源 |

### 6.3 新增

| 项 | 原因 |
|----|------|
| `docs/README.md` 总索引 | 用户要求；降低 docs 发现成本 |
| AI 阅读矩阵 | 控制上下文 |
| Blueprint 模板 + ASCII | 可执行契约 |
| Good/Bad 对照 | 纠偏强于形容词 |
| 生成前 5 问 + 结构自检 | 专治空壳页 |
| Anti-pattern 命名库 | review 可点名 |
| Icon 章、inspirations 深分析 | 现缺 |
| `ai-surfaces.md` | 隔离 AI 产品特异性 |

### 6.4 保留（归档）

- `docs/superpowers/specs/2026-07-18-ui-design-system.md`：只读；文首改为指向 `docs/ui/README.md`，标注「历史决策，日常以 Playbook 为准」。

## 7. 引用更新范围

落地时将指向 `docs/UI_GUIDE.md` 的引用改为 `docs/ui/README.md`（已知至少：

- `docs/superpowers/specs/2026-07-18-app-shell-delete-design.md`
- `docs/superpowers/plans/2026-07-18-app-shell-delete.md`
- `docs/superpowers/specs/2026-07-18-workspace-persistence-design.md`
- 以及其它 grep 命中处；CLAUDE.md 若提及一并更新）。

## 8. 为什么这样拆（维护理由）

1. **按决策类型分文件** → AI 单次任务只加载相关约束。
2. **Why / What / Where / How-for-AI 分层** → 变更频率不同，不绑死。
3. **Blueprint 可执行** → 比原则形容词更可验证。
4. **`ai-surfaces` 隔离产品特异性** → 通用 composition 与 Agent UI 解耦。
5. **单源 + 旧 spec 归档** → 消灭 `UI_GUIDE` ↔ spec 双写。
6. **`docs/README` 索引排除 specs** → 日常入口干净；决策原文不抢注意力。

## 9. 成功标准

- [x] `docs/ui/` 八文件齐备且职责无交叉污染（principles 无 class；blueprints 无色值表）
- [x] `docs/README.md` 存在：链到 PRD / architecture / ui / plans；**不**链到 `superpowers/specs/**`
- [x] `docs/UI_GUIDE.md` 已删除；全仓无残留死链
- [x] 旧 UI design system spec 文首标明归档
- [x] page-blueprints **无** Settings 节
- [x] AI 阅读矩阵可被 `ui/README` 单独执行

## 10. 后续

已落地于分支 `docs/ui-playbook-reorg`。日常入口：`docs/ui/README.md`；docs 索引：`docs/README.md`。
