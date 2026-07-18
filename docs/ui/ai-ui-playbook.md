# AI UI Playbook

给 **AI** 的操作系统，不是给设计师的说明书。  
改 UI 前先读 [README](./README.md) 阅读矩阵；生成后跑本文 Checklist。

## 1. 角色与成功标准

你输出的界面必须像 **可上线的商业工具产品**，气质接近 Cursor / Linear / Claude / Vercel / Notion 的 **工具感**。

失败标准：看起来像 Demo、作业、Dribbble 概念稿、Web3 落地页、营销站。

## 2. 生成前强制思考（5 问）

动笔 / 改 JSX 前必须写清（可在思考中完成）：

1. **页面目标** — 用户来此要完成什么？
2. **主要任务** — 主流程一步是什么？
3. **Primary Action** — 主按钮或主控件是什么？
4. **Visual Focus** — 首屏视觉中心是什么？
5. **Supporting Content** — 至少还有哪个支持模块？（禁止「只有一句标题」）

然后打开对应 [page-blueprints](./page-blueprints.md)。无 Blueprint 的新页：先补 Blueprint，再实现。

## 3. 生成时约束

- 只用 `components/ui`（shadcn）+ 已有组合件 + 语义 token class
- 浅色 Neutral Tool；主色近黑
- 禁止自写 CSS 皮肤、硬编码色、紫粉渐变、glow、主按钮 `rounded-full`
- AI 产品面结构对齐 [ai-surfaces](./ai-surfaces.md)

## 4. Prompt 编写规范

给人 / 给模型的 UI 任务应包含：

- 目标路由或页面名
- 「遵循 `docs/ui/`；先读 blueprints / surfaces」
- Primary Action 与必须模块
- 明确禁止：Demo / Landing / 渐变 / 自写皮肤

避免无约束词：「做漂亮一点」「科技感」「高端大气」。

## 5. 生成后 Checklist

### 视觉

- [ ] 像真实商业工具，而非 Demo 占位
- [ ] Neutral Tool：无紫粉渐变、无 glow、无糖果大圆角
- [ ] 字号层级清晰（Page / Section / Body / Meta）
- [ ] 边框弱、主色近黑、语义色克制

### 交互

- [ ] 可点击元素有 hover / focus
- [ ] 有 loading（提交中 / Skeleton）
- [ ] 有 empty / error，文案可执行

### 代码

- [ ] 只用 shadcn `components/ui` + 组合件
- [ ] 无 inline style、无硬编码色值、无新建皮肤 CSS
- [ ] 颜色 / 间距走 design token

### AI 产品

- [ ] Composer 结构统一（三层）
- [ ] Agent / Tool / Streaming / Viewer 状态可辨
- [ ] Trace / Cost 弱化且可折叠
- [ ] 无复杂炫技动画

## 6. 结构自检（4 问）

全部为「是」才可结束；否则进入 §9 修复循环：

1. 是否有明确视觉中心？
2. 是否至少两个内容模块（主 + 支持）？
3. 是否不存在大片无意义留白？
4. 是否像 Cursor / Linear 类工具，而不像 Landing？

## 7. Anti-patterns（点名库）

| 名称 | 特征 | 处理 |
|------|------|------|
| Demo 风 | 占位文案、空洞、无状态 | 补模块 + Blueprint |
| Dribbble 风 | 重阴影、大圆角、装饰大于任务 | 降装饰、加密度 |
| Web3 风 | 霓虹、渐变字、玻璃拟态炫技 | 回 Neutral Tool |
| Landing 风 | Hero 口号、eyebrow、统计条、多 CTA | 改工具页结构 |
| Dashboard 堆砌 | 首屏卡片墙 / 指标条 | 回到一屏一主任务 |
| 紫粉皮肤 | indigo/purple primary、glow | 近黑 primary |

## 8. 禁止清单（现象）

- 紫粉渐变、glow、粒子、emoji 墙
- 主按钮全圆角糖果态
- 彩色聊天气泡墙
- Trace/Cost 进首页首屏
- 每个 Tool 闪亮刷屏
- 自造 CSS 皮肤替代 token

## 9. 最小修复循环

结构自检失败时，**按序**改，勿整页推翻：

1. **加模块** — 确保主任务 + 至少一个 Supporting
2. **收留白** — 把间距收到 design-system 刻度
3. **降装饰** — 去渐变 / glow / 重阴影 / 多余徽章
4. **对齐 Blueprint** — 对照 ASCII 与必须模块再改一版
5. 再跑 §5 + §6

若仍不像工具产品：读 [inspirations](./inspirations.md) 规律段，只借规律不借皮肤。
