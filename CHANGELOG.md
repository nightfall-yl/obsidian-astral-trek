# 更新日志

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

> 说明：本更新日志自 `26.1.1` 起维护。

## [26.1.8] - 2026-09-25

### 依赖收敛与安全

- **esbuild-svelte 0.9.5 → 0.7.4**：0.9.5 要求 svelte ≥4.2.1，和 obsidian-calendar-ui 锁的 svelte@3.x 冲突；0.7.4 peer dep 为 `>=3.43.0 <5`，与 svelte 3.59.2 兼容。消除 GHSA-wv8q-r932-8hc7 ReDoS 警告的触发源
- **纯 type import 依赖归位 devDependencies**：`obsidian-calendar-ui`、`svelte`、`obsidian-daily-notes-interface` 从 dependencies 移到 devDependencies，声明它们仅被 `import type` 使用，不在 Obsidian 用户运行时链路。消除 `npm audit --omit=dev` 剩余漏洞
- 新增 `npm run audit:prod` / `npm run audit:all` 脚本，明确生产/开发期漏洞扫描边界

### CSS 质量

- **移除全部 `!important` 属性声明**（styles.css 从 12 个 → 0 个）
  - `.flomo-submit-btn` 锁定微信风格（空=灰、有输入=蓝、hover 不变）改用提特异性方案：选择器从 `.flomo-submit-btn:hover`（0,1,1）提升到 `body .flomo-input-card .flomo-submit-btn:hover`（0,3,1），空输入灰色规则升至 0,4,1
  - Obsidian 注释中的 `!important` 关键词（L857/L3277）改写措辞，避免 scanner 误报
- **`.ad-modal-btn--primary` 前景色修复**：`color` 从主题相关的 `--ad-on-accent`（亮黑/暗白）改为 Obsidian 原生 `--text-on-accent`（亮暗主题统一白色），`:hover` 中显式再次声明防止原生覆盖。"取消/保存"组保存按钮在亮色主题下 hover 字体不再变黑色

## [26.1.7] - 2026-09-24

### 修复

- **发送按钮微信风格（Flomo / 主页快速捕获）**
  - 输入框空 → 按钮灰胶囊（`background: var(--background-modifier-hover); color: var(--text-faint)`）
  - 有输入 → 实色胶囊（默认 `.flomo-submit-btn` 定义）
  - hover/active/focus 全部锁死不额外变色（防止 Obsidian 原生 `.modal button:hover { background: transparent }` 覆盖）
  - `.flomo-submit-btn:hover` 整条规则被 Obsidian 原生压掉；用祖先类提特异性 + 精确 `!important` 修复
- **保存按钮（`.ad-modal-btn--primary`）hover 高亮消失**
  - 方案：`.ad-modal-btn--primary:hover` 显式声明 `background: var(--ad-accent); border-color: var(--ad-accent); filter: brightness(1.08)`
- **textarea hover 背景变（Obsidian 默认主题特有）** ：使用祖先类提特异性到 0,2,1：`.astra-dashboard .flomo-input:hover` 覆盖主页卡片、`.mod-root .flomo-input:hover` 覆盖弹窗面板
- **Flomo 弹窗面板搜索框双重框**：给 `.flomo-search-wrap input.flomo-search` 加 `border: none; box-shadow: none`，清除 Obsidian 默认主题强加的 inset box-shadow
- **「项目情况」模块改名「项目管理」**：主页卡片标题 `auto.221` 与设置页模块名 `mod.projects` 两处 i18n 键同步更新（zh：项目情况→项目管理；en：Project Status/Projects→Project Management），主页卡片与设置开关联动一致
- **i18n 文案修正**：`dv.header.heatmapSettings`「热图设置」→「设置热图」；`dv.countdown.emptyHint`「点击右上角齿轮添加」→「点击右上角编辑」

### 重构（设计系统）

- **.ad-task-modal 成为弹窗统一Shell**：所有 Modal 类弹窗（快捷链接 / 热力图 / 倒计时 / 项目编辑）共享同一份 CSS 定义（padding 18px、border-radius 16px、三行跨平台滚动条隐藏），避免双源漂移
- **主页设置弹窗（AstraSettingsModal）滚动条彻底隐藏** ：新增 `.astra-settings-modal`（modalEl 唯一类）的 `scrollbar-width:none` + `::-webkit-scrollbar { display:none }` 规则，覆盖真实滚动容器；
- **CSS 特异性收敛**：只有 Obsidian 原生也带 `!important` 或加载顺序在我们之后的场景才用 `!important`（如 `.flomo-submit-btn` 四种状态）
- **Astra 共用方形图标按钮尺寸升级**：容器 26×26px、内部 SVG 14×14px → 17×17px（保留 Astra 自感）；作用范围：主页头图齿轮 / 热图设置 / 快捷链接管理 / TODO 刷新设置等共用 `.astra-icon-btn` 的按钮
- **每日英语卡片按钮组视觉间距**：左右箭头 + 骰子三者之间 `gap` 6px → 14px，改善按钮拥挤感
- **移动端弹窗按钮适配（.ad-modal-btn）** ：移动端按钮圆角对齐 `var(--button-radius)`（Obsidian 移动端触摸胶囊语言），配色仍走 `--ad-s1/--ad-h1` token；布局沿用并排 `row`，不堆叠，保证两胶囊始终同一行

## [26.1.6] - 2026-09-23

### 修复

- **Project 侧栏 active 圆角**：`.po-sidebar__item.is-active` 补显式 `border-radius: var(--ad-r3)`，选中态悬停/不悬停视觉一致
- **项目阶段管道颜色**：连接线和圆点从硬编码 `#40c463` 改为 `var(--proj-color)`，跟随甘特图项目色；`project-board-view.ts` 和 `dashboard-view.ts` 两处渲染器均补 `--proj-color` 容器变量
- **Astra Pill Item token 作用域**：给 `.astra-dashboard` 补全 `--ad-accent/dim/h1/line/text/text-mute/r1/r2/r3`，Dashboard 主视图组件可安全引用
- **--ad-h1/line/text/text-mute 统一 Obsidian 变量**：`.po-board-view, .ad-task-modal` 基础块移除上游 shadcn 硬编码暗色值和亮色块覆盖的 okLch 值，全部改为原生变量

### 重构

- **Project 侧栏 → Flomo 侧栏风格对齐**：默认态改为 Flomo 无边框+r1（`gap 10px` / `padding 7px 12px` / `margin 1px 2px` / `font-size 13px`）；hover/active 沿用 Astra Pill Item（r3 + ad-h1 + accent-dim）；`.po-count` 从胶囊改为纯文字
- **Astra Pill Item 应用于快捷链接胶囊**：`.astra-plugin-shortcut` 对齐 Pill Item border/padding/gap/hover/active；保留 5 色 mark 色块；border-radius 12px
- **嵌入态清除 Project 侧栏强制覆盖**：移除 `.po-board-host.po-board-view .po-sidebar__item:hover/.is-active` 的 `background: transparent` 和硬编码 Obsidian 变量规则

### 新增（设计系统）

- **设计系统代号：Astra Pill Item**。核心 token：`ad-r3`（选中/hover 圆角）、`ad-line`（默认边框）、`ad-h1`（hover 背景）、`ad-accent-dim`（active 背景）、accent 30% mix（active 边框）、accent 色文字

## [26.1.5] - 2026-09-13

### 修复

- **移动端语言探测**：iOS / Android 从硬编码回退英文改为读取 `navigator.language`；`initI18n` 去掉 `_cachedLang` 短路，Reload 时总是重新读取 obsidian.json
- **settings.ts 第 733 行**：强制视图文件匹配 placeholder 补齐 i18n（最后一处设置页遗漏）
- **快捷链接管理弹窗**：段落说明、上移 / 下移 / 删除按钮、名称 / 图标 / 链接字段 label 补齐 i18n
- **热力图设置弹窗**：Date field 下拉 4 个选项（文件创建时间 / 修改时间 / 文件名 / 文档属性）改为引用字典
- **快速捕获弹窗**：工具栏 6 个按钮（插入标签 / 图片 / 列表 / 任务 / 表格）aria-label 补齐 i18n
- **Flomo 便签面板**：预设分组标题 11 处（置顶·共N条 / 收藏·共N条 / 今天·共N条 ...）、日期分组标题（`2026-09-12 周五` / `今天 周五`）、3 个工具栏按钮（切换视图密度 / 导出 / 侧栏）全部 i18n
- **Flomo 导出**：header 移除中文 "共 N 条"，英文环境下仅保留数字
- **Daily Phrase**：上一句 / 下一句 / 换一句按钮补齐 i18n
- **新建任务弹窗**：PRIORITIES / STATUSES / TYPES / REPEAT_FREQS / WEEKDAYS / REMINDER_OPTIONS 全部改为 `t()` 调用；表单标签（任务名称 / 所属项目 / 父任务 / 类型 / 提醒 / 标签 / 备注 / 日期）补齐 i18n；修复替换脚本导致的构造函数损坏（字段声明混入构造函数体、出现重复构造函数）
- **倒计时设置弹窗**：说明段落改为 `dv.countdown.cardHint` 字典模板
- **逾期提醒**：section 标题、逾期角标 tooltip、本周 footer 汇总、逾期 N 天 badge 4 处硬编码补齐 i18n
- **甘特图 / 看板**：状态筛选激活后无匹配时工具栏消失（提前渲染到空态检查之前）；筛选按钮文本 / 菜单状态名补齐 i18n；日历星期表头、甘特月份 band、热力图月份标签改用 `Intl.DateTimeFormat` 动态格式化
- **新建 / 编辑项目弹窗**：标题、表单标签（名称/类型/颜色/日期/描述/阶段）全部补齐 i18n；PROJECT_TYPE_LIST 的阶段项目 / 非阶段项目改为渲染时查字典翻译
- **任务编辑弹窗**：标题、表单字段、优先级、状态、类型、日期标签、每日节点星期表头全部 i18n；日期输入框添加 `lang` 属性以适配不同语言环境的日期选择器
- **确认弹窗**：默认取消 / 确定按钮、删除项目 / 任务正文补齐 i18n；confirm-modal 独立抽出可复用

## [26.1.4] - 2026-09-12

### 修复

- **快速捕获（Flomo）编辑工具栏重排**
  - 桌面端：时间输入框独立成行与取消/发送居右对齐，间距 8px
  - 移动端（<680px）：取消/发送回到工具行，时间输入框占满整行
  - 时间输入框圆角统一 6px
- Linter 组「忽略文件夹」→「忽略文件/文件夹」，说明文案更新

### 新增

- **i18n 国际化：支持中文和英文**
  - 新增 `src/i18n/`（index.ts + zh.ts + en.ts），752 字典 key、283 处 `t()` 调用，覆盖全部用户可见 UI（Dashboard 主视图、设置页、Flomo 面板、项目看板、任务弹窗等）
  - 语言检测：读取 Obsidian 全局配置 `obsidian.json`（macOS → `~/Library/Application Support/`，Windows → 多候选：`%APPDATA%` → `~/AppData/Roaming/` → `~/.obsidian/`，Linux → `~/.config/`），`Platform.isDesktop` 守卫 Node 模块（移动端自动回退英文），Reload 插件时重新读取
  - 日期/数字按语言格式化：英文模式下 42.1 万 → 421K、星期六 → Saturday
  - UI 文本全覆盖：Header stats、问候语/相对时间、项目计数、Flomo 导出模板、任务优先级排序、强制视图 placeholder 等
  - 英文模块标题（Task Progress / Project Status / Daily Phrase）统一标题大小写
  - frontmatter 字段（`状态: 待办` / `优先级: 高`）保持中文不翻译；农历日期双语均显示中文，标签在英文下为 `Lunar`

## [26.1.2] - 2026-09-06

### 修复

- 主页模块拖拽排序时出现向下偏移超过一个模块的高度的错位：根因是 CSS 优先级冲突——`.astra-modules-grid .astra-surface`（`position: relative`，特异性 `0,2,0`）覆盖了 `.astra-card--dragging`（`position: absolute`，特异性 `0,1,0`），导致被拖卡片未能真正脱流，占位符插入后 dense 网格重排又将其挤下一行，叠加相对偏移形成大幅错位。修复：起手时用内联样式 `card.style.position = "absolute"` 强制脱流（内联优先级最高，无法被样式表覆盖）。

## [26.1.1] - 2026-09-04

### 破坏性变更：插件 ID 变更

- 插件 ID `attention` → **`astral-trek`**；视图类型改为 `astra-dashboard-view`。升级后需重新放置插件目录、旧 `data.json` 需手动拷贝到新目录（ID 变更后默认丢失）

### 更名与品牌统一

- 代码品牌词 `attend` → `astra`（类名、常量、CSS 类/变量），`ad-*` 缩写保持不变
- 用户可见名称统一为 **Astra**：`manifest.json` 的 `name`、Ribbon 标签、设置分区标题
- npm 包名、仓库地址、`versions.json` minAppVersion 统一回填为 1.11.0

### 功能

- 快捷链接管理：描述中的「[Lucide](https://lucide.dev/icons/)」改为超链接；「链接」与「命令」同行显示；「命令」改为框内联想输入
- 移除全部 Minimal 主题命令（49 条）及 4 条核心命令，现不注册任何命令；统一通过 Ribbon 图标进入
- 项目默认阶段命名改为英文：`Charter, PDCP, TR, ADCP, COR`
- 移动端便签编辑：日期输入框独占整行，取消/保存按钮换行靠右

### 修复

- DetailModal 关闭位移：覆盖 `animateClose()` 直接 resolve
- `CalendarView` 的 `moment` 未声明、`cursorPosition` 类型运算、统计值兜底 `[object Object]` 等 6 处问题
- 3 处 `confirm()` 替换为 Obsidian 原生确认弹窗（新增 `confirm-modal.ts`）
- 热图方格间距在 multicolumn 标记恢复 `row-gap` / `column-gap`

### 工程

- ESLint 全量问题 189 → 100；移除 `console` 日志 27 处；`!important` 28 → 19
- `AstraSettingTab` 补声明式设置 API 三件套（返回空数组），规避 Obsidian 1.13+ 告警
- `styles.css` 移除 4 处 `:has()` 与 1 处 `display: contents`

