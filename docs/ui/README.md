# Isotope UI Design Playbook

AI / 后人改 `apps/web` 前的入口。这是一套 **AI Native** 的界面指导，不是单页 Design Spec。

**气质：** Neutral Tool（Modern SaaS Tool，对齐 Linear / Cursor / Claude / Vercel / Notion 的工具感）  
**组件库：** 锁定 shadcn/ui — 禁止自写 CSS 皮肤  
**主色：** 近黑（非紫）

## 阅读顺序

| 场景 | 必读（按序） | 按需 |
|------|-------------|------|
| 任意 UI 改动 | 本文 → [design-principles](./design-principles.md) → [ai-ui-playbook](./ai-ui-playbook.md) Checklist | — |
| 改颜色 / 字号 / 间距 | + [design-system](./design-system.md) | — |
| 新建 / 大改某页 | + [page-blueprints](./page-blueprints.md)（对应该页） | [composition](./composition.md) |
| 改 Composer / 消息 / Viewer | + [ai-surfaces](./ai-surfaces.md) | [composition](./composition.md) |
| 不确定「像不像产品」 | + [inspirations](./inspirations.md)（规律段） | — |
| 写 Prompt / 审 AI 产出 | [ai-ui-playbook](./ai-ui-playbook.md) 全文 | — |

硬规则：**默认不超过 3 篇进上下文**；禁止一次塞入全部 Playbook。

## 文档职责

| 文档 | 职责 |
|------|------|
| [design-principles](./design-principles.md) | 为什么这样设计（无 Token / 无组件） |
| [design-system](./design-system.md) | 长什么样（Token / shadcn / Tailwind） |
| [page-blueprints](./page-blueprints.md) | 每页怎么搭 |
| [composition](./composition.md) | 通用布局组合 |
| [ai-surfaces](./ai-surfaces.md) | Composer / Agent / Viewer 等 AI 产品面 |
| [ai-ui-playbook](./ai-ui-playbook.md) | AI 生成前后流程与 Checklist |
| [inspirations](./inspirations.md) | 参考产品规律（不抄样式） |

## 我要改 X → 去哪

| 改什么 | 去哪 |
|--------|------|
| 设计 Token / 色 / 字 / 间距 | design-system |
| 首页 / 登录 / 工作台布局 | page-blueprints |
| Hero / Card / Empty / 留白 | composition |
| Composer / 消息 / Tool / Viewer | ai-surfaces |
| AI 输出检查 / Anti-pattern | ai-ui-playbook |
| 产品气质 / 为什么少颜色 | design-principles |
| 「像不像 Linear」 | inspirations |

## 人工维护原则

1. **一事实一处** — Token 只写在 design-system；页面模块只写在 blueprints。
2. **按变更频率改文件** — principles 极少改；system 随 token；blueprints 随信息架构；playbook 随模型翻车模式。
3. **禁止把实现细节写回 principles** — 无 class、无组件名。
4. **新增页面先补 Blueprint**，再写代码。

## 与旧文档关系

- `docs/UI_GUIDE.md` **已废止**（已删除）。
- 历史决策：[`docs/superpowers/specs/2026-07-18-ui-design-system.md`](../superpowers/specs/2026-07-18-ui-design-system.md)（只读归档）。
- 产品行为以 [`docs/PRD.md`](../PRD.md) 为准；包边界见 [`docs/architecture/PROJECT_SKELETON.md`](../architecture/PROJECT_SKELETON.md)。
- docs 总索引：[`docs/README.md`](../README.md)。
