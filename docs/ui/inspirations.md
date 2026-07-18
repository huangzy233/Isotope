# Inspirations

分析参考产品的 **规律**，不是色板或组件抄袭。  
Token 与具体 class 见 [design-system](./design-system.md)。

参考：Claude · Cursor · Linear · Notion · Vercel · Stripe Dashboard。

## 1. Claude

| 轴 | 观察 |
|----|------|
| 为什么高级 | 对话为主；铬边极弱；内容区安静 |
| 布局 | 中栏对话 + 克制侧栏；输入固定在对话语境中 |
| 留白 | 消息间有呼吸，但非整页空洞 |
| Typography | 少层级；正文可读优先 |
| Sidebar | 历史/导航次要，不抢对话 |
| Toolbar | 极少；动作贴近输入 |
| Density | 中高；无营销块 |
| Hierarchy | 用户/助手内容 > 壳 |
| Composer | 底栏输入清晰，主按钮明确 |
| Workspace | 以对话为工作台 |

## 2. Cursor

| 轴 | 观察 |
|----|------|
| 为什么高级 | IDE 工具感；密度高；状态就地可见 |
| 布局 | 多栏工作区；聊天/编辑/预览可并存 |
| 留白 | 紧凑；面板头矮 |
| Typography | `sm` 级为主；代码与 UI 混排仍清晰 |
| Sidebar | 文件/历史高密度 |
| Toolbar | 图标 + 短标签；溢出进菜单 |
| Density | 高 |
| Hierarchy | 当前编辑/对话 > 次要面板 |
| Composer | 输入是一等公民 |
| Workspace | 真正的工具工作台 |

## 3. Linear

| 轴 | 观察 |
|----|------|
| 为什么高级 | 近黑操作、弱边框、列表扫读极快 |
| 布局 | 侧栏导航 + 主列表/详情 |
| 留白 | 克制；行高紧凑仍可读 |
| Typography | 少展示字体；层级靠字重 |
| Sidebar | 窄、分组清楚 |
| Toolbar | 过滤/视图与内容对齐 |
| Density | 高信息密度标杆 |
| Hierarchy | 列表主、元数据弱 |
| Composer | 快捷创建/命令感（非营销输入卡） |
| Workspace | 问题流即工作流 |

## 4. Notion

| 轴 | 观察 |
|----|------|
| 为什么高级 | 内容画布安静；框架让位给块 |
| 布局 | 侧栏 + 宽内容；块编辑 |
| 留白 | 内容区有呼吸，壳很薄 |
| Typography | 正文友好；标题层级明确但不吼 |
| Sidebar | 页面树；可折叠 |
| Toolbar | 随选区出现，不常驻喧闹 |
| Density | 中；偏阅读/写作 |
| Hierarchy | 页面内容 > 壳 |
| Composer | 斜线命令/块插入，非大 Hero |
| Workspace | 文档即工作区 |

## 5. Vercel

| 轴 | 观察 |
|----|------|
| 为什么高级 | 黑白为主；部署/项目状态清晰 |
| 布局 | 顶栏 + 内容；项目列表/详情 |
| 留白 | 仪表区仍偏工具而非营销（Dashboard） |
| Typography | 紧凑；mono 用于技术值 |
| Sidebar | 产品侧栏分组清楚 |
| Toolbar | 项目级动作靠右或就地 |
| Density | 中高 |
| Hierarchy | 状态与项目名优先 |
| Composer | 非核心；表单/搜索克制 |
| Workspace | 项目与部署上下文 |

## 6. Stripe Dashboard

| 轴 | 观察 |
|----|------|
| 为什么高级 | 专业、克制、表格与详情可信 |
| 布局 | 侧栏 + 内容；列表→详情 |
| 留白 | 表格区紧；页边适中 |
| Typography | 数据友好；数字对齐 |
| Sidebar | 稳定信息架构 |
| Toolbar | 过滤/日期等业务控件 |
| Density | 高（财务/运营数据） |
| Hierarchy | 关键数据 > 装饰 |
| Composer | 少；以表单与表为主 |
| Workspace | 运营工作台 |

## 7. 跨产品规律

1. **近黑或高对比主操作**，少用高饱和品牌色铺界面。
2. **弱边框 + 字重** 做层级，多于重阴影。
3. **密度服务于扫读**；空洞只出现在真正的空状态。
4. **元数据降噪**（时间、id、次要指标）。
5. **一屏一主任务**；壳层薄。
6. **输入/主列表是一等公民**，不是装饰卡。
7. **状态就地可辨**，不靠全屏动效。

## 8. Isotope 取舍

| 采用 | 不采用 |
|------|--------|
| Neutral Tool；近黑主操作 | 抄某一家的品牌色 |
| 工作台高密度双栏（偏 Cursor） | Notion 式大留白画布当壳层默认 |
| 列表行式项目（偏 Linear） | 大封面项目卡片墙 |
| Composer 为首页焦点（偏 Cursor/Claude 输入一等） | Marketing Hero + 多 CTA |
| Viewer 独立状态机 | 把预览埋进聊天气泡 |
| Trace/Cost 弱化折叠 | Stripe 级数据仪表进首页首屏 |

**一句话：** 借工具产品的密度与层级纪律；不借皮肤、插画与营销结构。
