/**
 * 导出功能 —— 复刻自 obsidian-memoria-main/src/export.ts
 *
 * 支持导出当前筛选结果为 md / html / json 三种格式。
 */

import type { App} from "obsidian";
import { Notice, normalizePath } from "obsidian";
import type { Flomo } from "./types";

export type ExportFormat = "md" | "html" | "json";

export interface ExportOptions {
  format: ExportFormat;
  flomos: Flomo[];
  filterDesc: string;
  exportFolder: string;
}

/** 导出并写入 vault，返回新文件的路径 */
export async function exportMemos(
  app: App,
  opts: ExportOptions
): Promise<string> {
  const { format, flomos, filterDesc, exportFolder } = opts;
  if (flomos.length === 0) {
    throw new Error("没有可导出的便签");
  }

  const folder = normalizePath(exportFolder);
  const af = app.vault.getAbstractFileByPath(folder);
  if (!af) {
    await app.vault.createFolder(folder);
  }

  const stamp = formatTimestamp(new Date());
  const rand = Math.random().toString(36).slice(2, 6);
  const filename = `flomo-export-${stamp}-${rand}.${format}`;
  const filePath = `${folder}/${filename}`;

  let content: string;
  switch (format) {
    case "md":
      content = renderMarkdown(flomos, filterDesc);
      break;
    case "html":
      content = renderHtml(flomos, filterDesc);
      break;
    case "json":
      content = renderJson(flomos, filterDesc);
      break;
    default:
      throw new Error("未知导出格式");
  }

  await app.vault.create(filePath, content);
  new Notice(`已导出 ${flomos.length} 条到 ${filePath}`);
  return filePath;
}

function formatTimestamp(d: Date): string {
  const p = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/** md 导出：带 frontmatter + 按日期分组 */
function renderMarkdown(flomos: Flomo[], filterDesc: string): string {
  const now = new Date();
  const fm = [
    "---",
    `exported_by: Flomo`,
    `exported_at: ${now.toISOString()}`,
    `count: ${flomos.length}`,
    `filter: ${escapeYaml(filterDesc)}`,
    "---",
    "",
    `# Flomo 导出 · ${filterDesc}`,
    "",
    `> ${now.toLocaleString()} · ${flomos.length}`,
    "",
  ].join("\n");

  const byDate = new Map<string, Flomo[]>();
  for (const m of flomos) {
    const arr = byDate.get(m.date) ?? [];
    arr.push(m);
    byDate.set(m.date, arr);
  }
  const sortedDates = [...byDate.keys()].sort().reverse();

  const parts: string[] = [fm];
  for (const date of sortedDates) {
    parts.push(`## ${date}`);
    parts.push("");
    const items = byDate.get(date) ?? [];
    items.sort((a, b) => b.time.localeCompare(a.time));
    for (const m of items) {
      parts.push(`- ${m.time}`);
      const indented = m.content
        .split("\n")
        .map((l) => (l === "" ? "" : `  ${l}`))
        .join("\n");
      parts.push(indented);
      parts.push("");
    }
  }
  return parts.join("\n");
}

function escapeYaml(s: string): string {
  return s.replace(/[":]/g, " ").replace(/\s+/g, " ").trim();
}

/** html 导出：自包含单 html，深浅自适应 */
function renderHtml(flomos: Flomo[], filterDesc: string): string {
  const now = new Date();
  const css = `
:root {
  color-scheme: light dark;
  --bg: #fbfaf7;
  --bg-card: #ffffff;
  --fg: #2c2a28;
  --fg-muted: #8a857f;
  --fg-dim: #b5b0a9;
  --accent: #c08a5a;
  --accent-soft: rgba(192, 138, 90, 0.12);
  --border: rgba(0, 0, 0, 0.06);
  --border-strong: rgba(0, 0, 0, 0.12);
  --shadow: 0 1px 3px rgba(0, 0, 0, 0.04), 0 4px 16px rgba(0, 0, 0, 0.03);
  --tag-bg: #f0ebe3;
  --tag-fg: #7a5c3a;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #17171a;
    --bg-card: #1e1e22;
    --fg: #e8e6e1;
    --fg-muted: #9c968e;
    --fg-dim: #5c5852;
    --accent: #d9a579;
    --accent-soft: rgba(217, 165, 121, 0.14);
    --border: rgba(255, 255, 255, 0.06);
    --border-strong: rgba(255, 255, 255, 0.12);
    --shadow: 0 1px 3px rgba(0, 0, 0, 0.2), 0 4px 16px rgba(0, 0, 0, 0.25);
    --tag-bg: rgba(217, 165, 121, 0.12);
    --tag-fg: #d9a579;
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
    "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", sans-serif;
  background: var(--bg);
  color: var(--fg);
  line-height: 1.7;
  -webkit-font-smoothing: antialiased;
}
.container { max-width: 720px; margin: 0 auto; padding: 64px 24px 96px; }
.header { text-align: center; padding-bottom: 40px; margin-bottom: 48px; border-bottom: 1px solid var(--border); position: relative; }
.brand { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 500; color: var(--accent); letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 16px; }
.brand-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); display: inline-block; }
.title { font-size: 34px; font-weight: 300; margin: 0 0 12px; letter-spacing: -0.02em; color: var(--fg); }
.subtitle { font-size: 14px; color: var(--fg-muted); font-weight: 400; }
.stat-strip { display: flex; justify-content: center; gap: 32px; margin-top: 28px; font-size: 13px; }
.stat-item { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.stat-num { font-size: 22px; font-weight: 500; color: var(--fg); }
.stat-label { color: var(--fg-dim); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; }
.day-group { margin-bottom: 40px; }
.day-head { display: flex; align-items: baseline; gap: 12px; font-size: 13px; font-weight: 500; color: var(--fg-muted); padding: 6px 0 18px; border-bottom: 1px dashed var(--border); margin-bottom: 20px; }
.day-head-date { color: var(--fg); font-size: 15px; font-weight: 500; }
.day-head-weekday { color: var(--fg-dim); font-size: 12px; }
.day-head-count { margin-left: auto; color: var(--fg-dim); font-size: 11px; }
.flomo { background: var(--bg-card); border: 1px solid var(--border); border-radius: 10px; padding: 16px 20px; margin-bottom: 12px; box-shadow: var(--shadow); }
.flomo-time { font-size: 11px; color: var(--fg-dim); font-family: "SF Mono", monospace; margin-bottom: 8px; }
.flomo-body { font-size: 15px; color: var(--fg); white-space: pre-wrap; word-break: break-word; }
.flomo-body p { margin: 0.4em 0; }
.flomo-body a { color: var(--accent); text-decoration: none; border-bottom: 1px solid var(--accent-soft); }
.flomo-body code { background: var(--accent-soft); color: var(--accent); padding: 1px 6px; border-radius: 4px; font-size: 0.9em; }
.flomo-body blockquote { margin: 0.5em 0; padding: 0.2em 0.2em 14px; border-left: 3px solid var(--accent-soft); color: var(--fg-muted); font-style: italic; }
.flomo-body pre { background: var(--accent-soft); padding: 12px 14px; border-radius: 8px; overflow-x: auto; margin: 0.6em 0; }
.flomo-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
.tag { display: inline-block; background: var(--tag-bg); color: var(--tag-fg); padding: 2px 10px; border-radius: 999px; font-size: 11px; font-weight: 500; }
.footer { margin-top: 72px; padding-top: 24px; border-top: 1px solid var(--border); text-align: center; color: var(--fg-dim); font-size: 12px; }
@media print { body { background: #fff; color: #000; } .flomo { page-break-inside: avoid; box-shadow: none; } }
@media (max-width: 560px) { .container { padding: 32px 16px 48px; } .title { font-size: 26px; } }
  `.trim();

  const byDate = new Map<string, Flomo[]>();
  for (const m of flomos) {
    const arr = byDate.get(m.date) ?? [];
    arr.push(m);
    byDate.set(m.date, arr);
  }
  const sortedDates = [...byDate.keys()].sort().reverse();

  const dayCount = sortedDates.length;
  const tagSet = new Set<string>();
  for (const m of flomos) for (const t of m.tags) tagSet.add(t);

  const weekdayNamesCN = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const getWeekday = (dateStr: string): string => {
    const d = new Date(dateStr + "T00:00:00");
    return weekdayNamesCN[d.getDay()] ?? "";
  };
  const formatDateFull = (d: Date): string => {
    const pad = (n: number) => n.toString().padStart(2, "0");
    const wd = weekdayNamesCN[d.getDay()];
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${wd} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const parts: string[] = [];
  parts.push("<!DOCTYPE html>");
  parts.push('<html lang="zh-CN">');
  parts.push("<head>");
  parts.push('<meta charset="UTF-8">');
  parts.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
  parts.push(`<title>Flomo · ${escapeHtml(filterDesc)}</title>`);
  parts.push("<style>" + css + "</style>");
  parts.push("</head>");
  parts.push("<body>");
  parts.push('<div class="container">');
  parts.push('<header class="header">');
  parts.push('<div class="brand"><span class="brand-dot"></span>FLOMO</div>');
  parts.push(`<h1 class="title">${escapeHtml(filterDesc)}</h1>`);
  parts.push(`<p class="subtitle">${formatDateFull(now)}</p>`);
  parts.push('<div class="stat-strip">');
  parts.push(`<div class="stat-item"><div class="stat-num">${flomos.length}</div><div class="stat-label">笔记</div></div>`);
  parts.push(`<div class="stat-item"><div class="stat-num">${dayCount}</div><div class="stat-label">天数</div></div>`);
  parts.push(`<div class="stat-item"><div class="stat-num">${tagSet.size}</div><div class="stat-label">标签</div></div>`);
  parts.push("</div>");
  parts.push("</header>");

  for (const date of sortedDates) {
    parts.push('<section class="day-group">');
    parts.push(
      `<div class="day-head"><span class="day-head-date">${date}</span>` +
        `<span class="day-head-weekday">${getWeekday(date)}</span>` +
        `<span class="day-head-count">${(byDate.get(date) ?? []).length} 条</span></div>`
    );
    const items = byDate.get(date) ?? [];
    items.sort((a, b) => a.time.localeCompare(b.time));
    for (const m of items) {
      parts.push('<article class="flomo">');
      parts.push(`<div class="flomo-time">${m.time}</div>`);
      const contentClean = m.content
        .replace(/#[^\s#]+/g, "")
        .replace(/\s+$/gm, "")
        .trim();
      parts.push('<div class="flomo-body">' + renderInlineMd(contentClean) + "</div>");
      if (m.tags.length > 0) {
        const tagsHtml = m.tags
          .map((t) => `<span class="tag">#${escapeHtml(t)}</span>`)
          .join("");
        parts.push('<div class="flomo-tags">' + tagsHtml + "</div>");
      }
      parts.push("</article>");
    }
    parts.push("</section>");
  }

  parts.push('<footer class="footer">');
  parts.push("由 Flomo 导出</footer>");
  parts.push("</div></body></html>");
  return parts.join("\n");
}

function renderInlineMd(text: string): string {
  let html = escapeHtml(text);
  html = html.replace(/`([^`\n]+?)`/g, "<code>$1</code>");
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "<em>$1</em>");
  html = html.replace(/~~(.+?)~~/g, "<del>$1</del>");
  return html.replace(/\n/g, "<br>");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** JSON 导出：结构化数据 */
function renderJson(flomos: Flomo[], filterDesc: string): string {
  const data = {
    exported_by: "Flomo",
    exported_at: new Date().toISOString(),
    filter: filterDesc,
    count: flomos.length,
    flomos: flomos.map((m) => ({
      date: m.date,
      time: m.time,
      content: m.content,
      tags: m.tags,
      file: m.file,
    })),
  };
  return JSON.stringify(data, null, 2);
}
