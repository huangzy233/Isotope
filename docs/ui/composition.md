# Composition

通用布局组合。数值细节见 [design-system](./design-system.md)。  
Composer / Agent / Viewer 状态机见 [ai-surfaces](./ai-surfaces.md)。

每节含 **Good / Bad** 与原因。

## 1. Visual Hierarchy

一屏一个视觉焦点；其余为 Supporting。

| Good | Bad |
|------|-----|
| Home：Composer 最重，项目列表次之 | 标题、卡片、统计、CTA 同权重抢视线 |
| Workspace：消息流 + Viewer 并重，Trace 最弱 | Trace 大卡片压过对话 |

**为什么：** 无焦点 = Demo；多焦点 = 噪音。

## 2. Vertical / Spacing Rhythm

- 区块间距 16–24
- 页面 padding 24–32
- 禁止默认 `space-y-16` / `py-16` 级空洞

| Good | Bad |
|------|-----|
| Section 紧接主模块，扫读连续 | 首屏只有一句标题，下方大片空白 |

**为什么：** 工具页用密度表达「可工作」；空洞像未完成稿。

## 3. Section 划分

一节一事：一个 Section Title + 通常一句说明 + 一块内容。

| Good | Bad |
|------|-----|
| 「我的项目」下只有列表/空态 | 一节里混列表、统计、广告 CTA |

## 4. Hero（工具页版）

**默认不用 Marketing Hero。**

若必须有顶区：品牌或 Page Title 级一句 + 主任务控件；无图墙、无贴纸、无统计条。

| Good | Bad |
|------|-----|
| Login：标题 + 表单 | 全出血插画 + 浮动徽章 + 双 CTA |

## 5. Sidebar

Isotope 壳层为 **侧栏 + 主区**（非顶栏主导航）。

- 高密度、分组清晰、当前项 `bg-accent` 可辨
- 头约 48px；用户名为 Metadata；退出明确
- 不放营销插画或大品牌块
- 项目上下文以侧栏为准；工作台主区不重复项目顶条

| Good | Bad |
|------|-----|
| 窄侧栏 + 短标签 / 行式项目 | 宽侧栏 + 大图 + 多色分组装饰 |
| 当前项目弱高亮 | 侧栏与主区双顶条重复同一 meta |

## 6. Toolbar / PanelHeader

- 高度约 48px
- 左：标题；右：状态 / 次要操作
- 字号用 Panel Title；状态用 Badge，勿大按钮墙

| Good | Bad |
|------|-----|
| 「对话」+ StatusBadge | 标题旁五个同等主按钮 |

## 7. Panel 组合

优先弱边框分区；靠背景与边框，不靠多层阴影。

| Good | Bad |
|------|-----|
| 左右栏 `border` 分割 | 每块都是重阴影浮动卡片 |

## 8. Card 排列

列表行优先于卡片墙。Card 用于交互容器（表单、Composer 外壳），不是装饰单元。

| Good | Bad |
|------|-----|
| 项目：一行一名 + meta | 每项目一张大图卡片网格 |

## 9. Recent / Project List

- 行式：名称主、时间/id 为 Metadata
- 可点击行有 hover
- 空列表用 EmptyState，不留死白

| Good | Bad |
|------|-----|
| 紧凑列表 + 弱 meta | 大封面卡片 + 彩色标签堆 |

## 10. Empty / Loading / Error

| 模式 | 要求 |
|------|------|
| Empty | 标题 + 一句说明 + 可选主操作（`EmptyState`） |
| Loading | Skeleton 或按钮文案；禁复杂 spinner CSS |
| Error | 明确、靠近出错处；弱 destructive 底；勿全屏血红 |

| Good | Bad |
|------|-----|
| 「还没有项目。在上方描述需求并开始。」 | 空白页无文案 |
| 字段下红字说明 | Toast 闪过后无处可查 |

## 11. Composer 外壳（布局层）

视觉重量：输入本身 > 包装。表面 + 细边框即可。

结构与状态机 → [ai-surfaces](./ai-surfaces.md)。

| Good | Bad |
|------|-----|
| Textarea + 控件行 + 主按钮，紧凑 | 巨大圆角营销卡 + 居中口号压过输入 |

## 12. Good / Bad 速查

| 主题 | Good | Bad |
|------|------|-----|
| 焦点 | 一主一辅 | 无主或多主 |
| 留白 | 紧凑可读 | 首屏空洞 |
| 装饰 | 几乎无 | 渐变 / glow / 贴纸 |
| 列表 | 行式 | 卡片墙 |
| 状态 | 可辨且克制 | 霓虹 / 动画刷屏 |
| 气质 | 像 Cursor / Linear 工具 | 像 Dribbble / Web3 / Landing |
