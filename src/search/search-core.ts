// ================= Astra 全文搜索：内核（纯函数层） =================
// MiniSearch 封装与摘录生成，无 Obsidian 依赖，vitest 直测。
// IO 与事件增量见 search-service.ts（薄层）。

import MiniSearch from "minisearch";
import { tokenize } from "./tokenizer";

export interface SearchDoc {
  /** 文件路径，作为索引 id */
  id: string;
  /** 文件名（不含扩展名） */
  title: string;
  /** H1–H3 标题（分级加权，对齐 omnisearch 默认值） */
  h1: string;
  h2: string;
  h3: string;
  /** 正文（已剔除 frontmatter） */
  content: string;
  path: string;
}

/** 字段权重：对齐 omnisearch 默认值（文件名 10，H1/H2/H3 = 6/5/4；正文/路径 = 1） */
const SEARCH_OPTIONS = {
  prefix: true,
  fuzzy: 0.2,
  boost: { title: 10, h1: 6, h2: 5, h3: 4 }
};

export function createMiniSearch(): MiniSearch<SearchDoc> {
  return new MiniSearch<SearchDoc>({
    fields: ["title", "h1", "h2", "h3", "content", "path"],
    storeFields: ["title", "path"],
    tokenize
  });
}

/** 收窄后的搜索结果（minisearch 的 SearchResult 里 id/doc 为 any，在此统一消除） */
export interface AstraSearchResult {
  id: string;
  score: number;
  /** 命中的文档词元（摘录定位用） */
  terms: string[];
  doc?: Pick<SearchDoc, "title" | "path">;
}

export function runSearch(
  mini: MiniSearch<SearchDoc>,
  query: string
): AstraSearchResult[] {
  const q = query.trim();
  if (!q) return [];
  return mini.search(q, SEARCH_OPTIONS).map((r) => ({
    id: String(r.id),
    score: r.score,
    terms: r.terms,
    doc: r.doc as Pick<SearchDoc, "title" | "path"> | undefined
  }));
}

/** 单条摘录片段：mark = 是否命中词（渲染为 <mark>） */
export interface ExcerptSegment {
  text: string;
  mark: boolean;
}

/**
 * 生成命中摘录：定位首个命中词，取前后窗口，返回带命中标记的片段序列。
 * 无命中时返回正文开头（不标记）。
 */
export function buildExcerpt(
  content: string,
  terms: string[],
  maxLength = 120
): ExcerptSegment[] {
  const lower = content.toLowerCase();
  let firstPos = -1;
  let hitLen = 0;
  for (const term of terms) {
    const t = term.toLowerCase();
    if (!t) continue;
    const pos = lower.indexOf(t);
    if (pos !== -1 && (firstPos === -1 || pos < firstPos)) {
      firstPos = pos;
      hitLen = t.length;
    }
  }

  let windowStart = 0;
  let windowEnd = Math.min(content.length, maxLength);
  if (firstPos !== -1) {
    // 窗口以命中词为中心，前后各留一半
    const pad = Math.floor((maxLength - hitLen) / 2);
    windowStart = Math.max(0, firstPos - pad);
    windowEnd = Math.min(content.length, windowStart + maxLength);
    windowStart = Math.max(0, windowEnd - maxLength); // 结尾截断时回推起点
  }

  // 在窗口内为所有出现的命中词标记区间
  const marks: Array<[number, number]> = [];
  for (const term of terms) {
    const t = term.toLowerCase();
    if (!t) continue;
    let from = windowStart;
    for (;;) {
      const pos = lower.indexOf(t, from);
      if (pos === -1 || pos >= windowEnd) break;
      marks.push([pos, pos + t.length]);
      from = pos + t.length;
    }
  }
  marks.sort((a, b) => a[0] - b[0]);

  const segments: ExcerptSegment[] = [];
  let cursor = windowStart;
  for (const [start, end] of marks) {
    if (start < cursor) continue; // 与前一个命中重叠
    if (start > cursor) {
      segments.push({ text: content.slice(cursor, start), mark: false });
    }
    segments.push({ text: content.slice(start, end), mark: true });
    cursor = end;
  }
  if (cursor < windowEnd) {
    segments.push({ text: content.slice(cursor, windowEnd), mark: false });
  }
  return segments.filter((s) => s.text.length > 0);
}
