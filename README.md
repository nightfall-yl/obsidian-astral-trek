# Astra

> Your personal Obsidian workspace — quick capture, task & project management, writing stats, and calendar, all on one page.

[![Version](https://img.shields.io/badge/version-26.1.5-blue)](https://github.com/nightfall-yl/obsidian-astral-trek) | [![Obsidian](https://img.shields.io/badge/Obsidian-1.11.0%2B-purple)](https://obsidian.md) | [![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

[简体中文](README_zh-CN.md) | English

Astra is an Obsidian plugin that consolidates quick capture, task & project management, writing statistics, and a calendar into a single dashboard. All data is stored locally as plain Markdown files — no external service or account required.

Plugin ID: `astral-trek` (install directory: `.obsidian/plugins/astral-trek/`).

## Features

### Dashboard

A persistent top bar shows: time-of-day greeting (customizable name), `vault · N notes · X words` stats, date/time/lunar date (refreshes every 30s), and home/settings buttons.

- **Quick Links** — Custom shortcuts in the top bar. Each link supports `label` + `icon` (Lucide icon name) + `url` (note path) or `action` (command ID, takes priority). Shows a placeholder when empty.

- **Writing Heatmap** — GitHub-green 52-week heatmap tracking recent writing activity. Four-level green gradient, empty cells for inactive days, today highlighted with edge glow. Click any active cell to view that day's notes.

- **Quick Capture (Flomo)** — Input box + send button, `Cmd/Ctrl + Enter` to submit. Content is appended to a single configured note file.

- **Tasks (Today)** — Daily tasks with overdue items pinned to top and priority sorting. Right-click menu for postpone/complete/skip; recurring tasks do not toggle status but advance their next reminder date.

- **Task Progress (Weekly)** — This week's task list + overdue reminders.

- **Project Stage Pipeline** — Stage columns (names and counts customizable in settings, 4–6 stages). Clicking a project row jumps to the full Project Board with that project selected.

- **Countdown** — Remaining days / weeks / completion percentage of the year (customizable event name and target date).

- **Recent Notes** — Persistent card at the end of the module grid.

Dashboard modules support **drag-to-reorder, drag-to-delete (trash icon in edit bar), card resize, and adding new cards from the "+ Add Card" menu**. Order, visibility, and size are persisted. On mobile, individual modules can be hidden in settings (Quick Links and Heatmap are always visible).

### Quick Capture / All Flomos

- **Waterfall timeline**, grouped by date.

- **Top bar search**: keyword, exclusion terms, `#tags`, `after:/before:/date:` date operators (debounced). Matching keywords highlighted.

- **View density toggle** (compact / relaxed).

- **Left sidebar**: notes / tags / days stats + preset filters (All, Pinned, Favorites, Today, This Week, To-Do, Review, Untagged, Has Images, Has Links) + hierarchical tag tree filter.

- **Pin / Favorite**: implemented via `#pinned` / `#favorite` tags.

- **Edit (incl. date/time modify)**, delete, right-click menu.

- **Export** current filtered results as Markdown / HTML / JSON to an `exports/` subdirectory next to the quick-capture file. Markdown export auto-opens preview.

### Project Board

Left sidebar (drag-to-reorder, right-click delete, click stage to fast-forward), main panel with four tabs:

- **Gantt** — SVG timeline with day/week/month/quarter zoom, today line centered. Drag to change start/end dates, move tasks across projects, filter by status with multi-select. Drag the left/right edges of a time block to adjust duration.

- **List** — Column sorting, status filter, right-click menu, virtualized list scrolling.

- **Calendar** — Month view with task bars inside cells, drag to change due date.

- **Kanban** — To Do / In Progress / Blocked / Done / Cancelled, drag across columns to change status.

### Calendar

Sidebar month view (position configurable in settings, left or right):

- **Word-count dots** — Up to 5 dots per day mapped from daily note word count (`wordsPerDot`, default 250).

- Click a date to open the daily note; creates one with confirmation if it doesn't exist (configurable).

- Date right-click menu: open / delete existing, or create new if absent.

- Today highlighting supported.

## Commands

Astra registers no commands. Open it via the ribbon icon:

- **Open Astra** — Open the Astra dashboard.

- **Open Calendar** — Open the calendar view in the sidebar.

## Settings

Settings are available both as an Obsidian plugin settings tab and via the gear icon in the dashboard header (identical content):

- **General** — Greeting name, open dashboard on startup, startup behavior (replace current tab / new tab), blank/very-short threshold, excluded folders, enable cursor position (remember each file's cursor position and scroll state).

- **Dashboard Modules** — Projects folder, TODO scan folder (empty = entire vault), stage names, stage filter for project progress, quick-capture file (the single note to append into; input with autocomplete, auto-created if missing).

- **Mobile Module Visibility** — Toggle each module (Quick Capture / Tasks / Weekly / Projects / Countdown / Recent Notes) independently on mobile.

- **Calendar** — Sidebar position, confirm before creating daily note.

- **Forced View** — Auto-set view mode (`obsidianUIMode` / `obsidianEditingMode`) per folder/file rule, with options to skip already-open files or files without frontmatter.

## Data Format

No database — everything is Markdown files in your vault, with Chinese frontmatter keys.

- **Quick capture entries** — Single file grouped by date: `## YYYY-MM-DD Day` headings, each followed by `- HH:MM content` list items. Multi-line content joins via indentation. Supports `#tags`, image/link auto-detection.

- **Projects** — A `projects/` folder containing `project-{name}.md` for project metadata.

- **Tasks** — `.md` files inside the projects folder (except `project-*.md`).

- **Daily nodes** — A `## Daily Nodes` list inside task bodies, format: `YYYY-MM-DD ✅/📝/⏭️ note` (✅ done / 📝 note / ⏭️ skipped).

Example task file:

```yaml
---
状态: 待办            # 待办 / 进行中 / 已阻塞 / 已完成 / 已取消
优先级: 重要且紧急     # 重要且紧急 / 重要不紧急 / 紧急不重要 / 不重要不紧急
开始日期: 2026-01-01
截止日期: 2026-01-15
项目: MyProject
tags: ["任务"]
类型: 普通            # 普通 / 重复
# Optional: repeat rule, reminder, note, parent task, completion time, daily nodes
---
```

Project metadata `project-{name}.md`:

```yaml
---
项目名称: MyProject
项目类型: 阶段项目     # 阶段项目 / 非阶段项目
颜色: "#3b82f6"
tags: [配置]
描述: Project description
开始日期: 2026-01-01
结束日期: 2026-06-30
---
```

## Installation

Place the build artifacts (`main.js`, `manifest.json`, `styles.css`, or the copies inside `dist/`) into `<your-vault>/.obsidian/plugins/astral-trek/`, then run **Reload app without saving** from the Obsidian command palette (or restart Obsidian).

## Development

```bash
npm install      # install dependencies
npm run dev      # watch mode, output to repo root main.js / styles.css
npm run build    # type check + production build, sync main.js / manifest.json / styles.css to dist/
```

## License

[MIT](LICENSE)
