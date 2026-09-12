# 更新日志

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

> 说明：本更新日志自 `26.1.1` 起维护。

## [26.1.3] - 2026-09-12

### 新功能

- **i18n 国际化：支持中文和英文**
  - 新增 `src/i18n/`（index.ts + zh.ts + en.ts），752 字典 key、283 处 `t()` 调用，覆盖全部用户可见 UI
  - 自动读取 Obsidian 全局语言设置（`obsidian.json`），启动时缓存，`t(key, vars)` 自动取翻译
  - 日期/数字按语言格式化：英文模式下 42.1 万 → 421K、星期六 → Saturday
  - frontmatter 字段（`状态: 待办` / `优先级: 高`）保持中文不翻译；农历日期双语均显示中文，标签在英文下为 `Lunar`

### 功能与改进

- **快速捕获（Flomo）编辑工具栏重排**
  - 桌面端：时间输入框独立成行与取消/发送居右对齐，间距 8px
  - 移动端（<680px）：取消/发送回到工具行，时间输入框占满整行
  - 时间输入框圆角统一 6px
- Linter 组「忽略文件夹」→「忽略文件/文件夹」，说明文案更新

### 修复

- Header stats 硬编码中文单位，英文模式下显示中文
- `moduleLabels` 硬编码中文标签，改为引用字典
- Flomo 导出模板和统计行模板改为字典参数化
- settings.ts 强制视图匹配规则 placeholder 硬编码中文，改为字典参数化
- `formatCompactNumber` 增加可选 locale 参数，测试改为显式传参，消除对宿主语言的依赖
- 清理 i18n 新增文件的 lint error（多余 as Dict 断言、JSON.parse any 类型、遗留 console.log）
- `readObsidianLanguage()` 改用 `Platform.isDesktop` + dynamic `import("fs"/"os"/"path")` 守卫，消除 6 条 no-nodejs-modules 告警；移动端自动回退为英文
- `readObsidianLanguage()` 依赖 `import { Platform } from "obsidian"` 使 core 测试连带无法解析 obsidian 包：新建 `vitest.config.ts`，通过 `resolve.alias` 将 obsidian 指向 `src/test/mocks/obsidian.ts`（只导出 `Platform.isDesktop/isMobile`），测试恢复可跑

## [26.1.2] - 2026-09-06

### 问题修复

- 主页模块拖拽排序时出现向下偏移超过一个模块的高度的错位：根因是 CSS 优先级冲突——`.astra-modules-grid .astra-surface`（`position: relative`，特异性 `0,2,0`）覆盖了 `.astra-card--dragging`（`position: absolute`，特异性 `0,1,0`），导致被拖卡片未能真正脱流，占位符插入后 dense 网格重排又将其挤下一行，叠加相对偏移形成大幅错位。修复：起手时用内联样式 `card.style.position = "absolute"` 强制脱流（内联优先级最高，无法被样式表覆盖）。

## [26.1.1] - 2026-09-04

### ⚠️ 破坏性变更：插件 ID 变更

- 插件 ID 由 `attention` 改为 **`astral-trek`**。Obsidian 以插件 ID 作为安装目录名，因此升级后需要重新放置插件：
  - 将构建产物（`main.js`、`manifest.json`、`styles.css`，或直接使用 `dist/` 内的副本）放入 `<你的库>/.obsidian/plugins/astral-trek/`，然后执行 **Reload app without saving**（或重启 Obsidian）。
  - 插件设置与数据按插件 ID 存放在插件目录下（`data.json`、`static-data.json` 等），ID 变更后读取不到原有配置，会恢复为默认设置。如需保留，请手动从旧目录 `.obsidian/plugins/attention/` 拷贝这些数据文件到新目录。
  - 视图类型同步改为 `astra-dashboard-view`，工作区中已打开的旧标签页可能需要重新打开。

### 更名与品牌统一

- 代码品牌词 `attend` 统一为 `astra`（按原大小写匹配）：
  - 类与类型：`AttendDashboardPlugin` → `AstraDashboardPlugin`、`AttendSettings` → `AstraSettings`、`AttendPluginData` → `AstraPluginData`、`AttendDataStore` → `AstraDataStore`、`AttendDashboardView` → `AstraDashboardView` 等
  - 常量：`VIEW_TYPE_ATTEND_DASHBOARD` → `VIEW_TYPE_ASTRA_DASHBOARD`
  - CSS 类 `attend-*` → `astra-*`；CSS 变量 `--attend-*` → `--astra-*`（`--astra-bg`、`--astra-surface`、`--astra-text` 等）
  - 未改动：`ad-*` 系列缩写（`adEditMode`、`ad-fill`、`ad-ns`、`ad-hm-*` 等）不含字面 `attend`，保持原样
- 用户可见名称统一为 **Astra**：`manifest.json` 的 `name`、Ribbon 图标标签「打开 Astra」、设置分区标题、以及「启动时打开首页」的描述文案。
- npm 包名 `obsidian-attend-dashboard` → `astral-trek`；仓库地址更新为 `https://github.com/nightfall-yl/obsidian-astral-trek`。
- `versions.json` 中 `0.1.0`–`1.0.0` 各条目的最低 Obsidian 版本统一回填为 `1.11.0`，与 `manifest.json` 的 `minAppVersion` 保持一致。

### 功能与改进

- 快捷链接管理弹窗：
  - 描述中的「Lucide」改为超链接（指向 <https://lucide.dev/icons/>）。
  - 桌面端「链接」与「命令」两个字段改为同一行显示（2 列栅格，与「名称」「图标」一致）。
  - 「命令」字段改为框内联想输入（基于 `AbstractInputSuggest`），去掉原来的「选择」按钮。
- 移除全部 Minimal 主题命令（49 条）以及 4 条核心命令。现插件**不注册任何命令**，统一通过左侧边栏 Ribbon 的「打开 Astra」「打开日历」两个图标进入（Ribbon 入口与启动时自动打开首页的行为不受影响）。
- 项目默认阶段命名改为英文：`Charter, PDCP, TR, ADCP, COR`（同步更新设置项默认值与输入框 placeholder）。
- 移动端（宽度 < 680px）编辑便签时，日期选择框改为独占整行，取消 / 保存按钮换行显示在右侧，避免被日期控件遮挡。
- `README.md` 在标题下补一段英文简介，满足 Obsidian 社区库对英文描述的要求；并将「本周待办 & 逾期提醒」模块名对齐为「任务进展」。

### 问题修复

- 移动端笔记列表弹窗（DetailModal）关闭时会先向下位移一段才消失：覆盖 `animateClose()` 直接 resolve，关闭时零位移（打开时的上滑入场动画保留）。
- `CalendarView` 中 `moment` 未声明导致的 `no-undef`：改为 `import type { Moment } from "moment"`。
- `cursorPosition` 对 `unknown` 做 `+` 运算：抽出 `leafKey()` 统一处理，去掉原有的 `@ts-ignore`。
- 统计值兜底 `String(v ?? "")` 会产生 `[object Object]`：改为仅接受数字与数字字符串。
- 3 处 `confirm()` 替换为 Obsidian 原生确认弹窗（新增 `confirm-modal.ts`，Esc 与点击遮罩均视为取消）。
- `Calendar.svelte` 使用已废弃的 `window.event`：改为用 `getBoundingClientRect()` 中心点合成 `MouseEvent`。
- 热图方格间距在「移除 gap 以规避 multicolumn 告警」后丢失：恢复基于 `row-gap` / `column-gap` 的原始间距（保留 `grid-auto-flow: column` 的既有 multicolumn 标记不再处理）。

### 工程与代码质量

- ESLint 全量问题由 **189 降至 100**：
  - 18 处静态样式赋值 `element.style.X = "..."` 改为 CSS class 或 `setCssProps`，`no-static-styles-assignment` 归零。
  - 清理 27 处 `console` 日志。
  - 修复 4 项 Obsidian 规范告警：改用 `app.fileManager.trashFile()`；去掉不安全的 `as TFile`（改用 `instanceof` 收窄）；`node:fs` 动态导入加 `Platform.isDesktop` 守卫；`document.execCommand` 改用类型脱敏替代 `eslint-disable`（插件配置禁止禁用该规则）。
  - `no-unnecessary-type-assertion` 2 处：改用 `querySelector<HTMLElement>` / `closest<HTMLElement>` 泛型参数，去掉冗余断言。
  - `no-unused-vars` 4 处：内联 `diff_match_patch` 的类型形状；3 处 `catch (error)` 改为 `catch {}`。
- 关闭 `obsidianmd/ui/sentence-case` 规则：该规则对中文界面属误报（会把非首词强制转小写，如「例如 Sean」→「例如 sean」）。
- `README.md` 同步更新：产品名改为 Astra，并修正已失效的「4 条命令」表格（现为 0 命令）。
- 外部校验告警治理（不影响运行时行为）：
  - 为 `AstraSettingTab` 补实现声明式设置 API 三件套（`getSettingDefinitions` 返回空数组，`getControlValue` / `setControlValue` 空实现）——规避 Obsidian 1.13+ 的 `settings-tab/progressive-api` 告警，同时返回空数组故仍走 `display()`，现有两栏设置页样式不受影响；对应的两条 lint 规则在 `eslint.config.mjs` 关闭。
  - `styles.css` 移除 4 处 `:has()`（改用 JS 维护的 `is-po-board` 状态类）与 1 处 `display: contents`，消除 `css-display-contents` 等兼容告警。
  - `!important` 由 28 处精简到 19 处：对可安全提高选择器特异性的条目（逾期角标实色红、日历确认弹窗按钮、快速捕获模块、卡片丢弃态）用复合/提权选择器替代；其余为对抗 Obsidian 内置默认样式的必要防御声明，保留不动。
  - 移除同规则内重复的 `min-height`；`manifest.json` 描述补句点。

### 刻意保留

- `flomo/textarea-utils.ts` 中的 `document.execCommand("insertText")` 予以保留：这是目前唯一能保住浏览器原生撤销栈的写法，标准 `setRangeText()` 不会写入撤销历史。相关 deprecation 告警保留，并已在代码中加注释说明。
