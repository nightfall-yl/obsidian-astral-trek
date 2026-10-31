// ================= Astra 全文搜索：内核（纯函数层） =================
// MiniSearch 封装与摘录生成，无 Obsidian 依赖，vitest 直测。
// IO 与事件增量见 search-service.ts（薄层）。
// 权重与查询行为对齐 omnisearch 同名设置（Results weighting / Fuzziness /
// Simpler search / Recency boost / Folders to downrank）。

import MiniSearch from "minisearch";
import { tokenize } from "./tokenizer";

export interface SearchDoc {
  /** 文件路径，作为索引 id */
  id: string;
  /** 显示标题（displayTitle 设置或文件名） */
  title: string;
  /** H1–H3 标题（分级加权，对齐 omnisearch 默认值） */
  h1: string;
  h2: string;
  h3: string;
  /** 正文（已剔除 frontmatter） */
  content: string;
  /** 标签（含 # 前缀原文，分词时剥离标点） */
  tags: string;
  /** 自定义 frontmatter 属性值拼接（weightCustomProperties 生效的载体） */
  props: string;
  path: string;
}

/** 字段权重（对齐 omnisearch 默认值：文件名 10 / 目录 7 / H1–H3 = 6/5/4 / 标签 2） */
export interface SearchWeights {
  title: number;
  path: number;
  h1: number;
  h2: number;
  h3: number;
  tags: number;
  props: number;
}

export interface SearchQueryOptions {
  weights: SearchWeights;
  /** minisearch 模糊度：0 = 精确，0.2 = 适度模糊，0.4 = 充分模糊（Fuzziness 0/1/2） */
  fuzzy: number;
  /** 简单搜索：关闭前缀匹配（对齐 omnisearch「短词不做前缀」的降耗意图） */
  prefix: boolean;
}

/** MiniSearch 索引字段（建索引与 loadJSON 反序列化必须使用同一份，否则缓存失效） */
export const SEARCH_FIELDS = ["title", "h1", "h2", "h3", "tags", "props", "content", "path"];

/** 随结果存储的字段（不参与检索） */
export const SEARCH_STORE_FIELDS = ["title", "path"];

export function createMiniSearch(
  tokenizeFn: (text: string) => string[] = tokenize
): MiniSearch<SearchDoc> {
  return new MiniSearch<SearchDoc>({
    fields: SEARCH_FIELDS,
    storeFields: SEARCH_STORE_FIELDS,
    tokenize: tokenizeFn
  });
}

/* ================= 索引持久化：指纹与对账（纯函数） ================= */

/** 缓存文件格式版本：序列化结构变更时递增，触发全量重建 */
export const INDEX_FORMAT_VERSION = 1;

/** 参与索引内容指纹的设置（与 settings.ts needsRebuild 列表对齐） */
export interface IndexFingerprintInput {
  tokenizeUrls: boolean;
  ignoreDiacritics: boolean;
  indexedFileTypes: string[];
  indexFilesWithoutExtension: boolean;
  unsupportedFilesIndexing: string;
  displayTitle: string;
  hideExcluded: boolean;
}

/**
 * 计算索引指纹：分词/索引范围类设置 + 插件版本 + 格式版本的规范序列化。
 * 指纹变化 → 旧缓存不可复用，需全量重建。
 */
export function computeFingerprint(input: IndexFingerprintInput, pluginVersion: string): string {
  return JSON.stringify({
    format: INDEX_FORMAT_VERSION,
    plugin: pluginVersion,
    tokenizeUrls: input.tokenizeUrls,
    ignoreDiacritics: input.ignoreDiacritics,
    indexedFileTypes: input.indexedFileTypes
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0)
      .sort(),
    indexFilesWithoutExtension: input.indexFilesWithoutExtension,
    unsupportedFilesIndexing: input.unsupportedFilesIndexing,
    displayTitle: input.displayTitle,
    hideExcluded: input.hideExcluded
  });
}

/** 对账输入：vault 当前文件状态（mtime 来自 TFile.stat，纯内存） */
export interface ReconcileFileStat {
  path: string;
  mtime: number;
}

/** 对账计划：需要从索引移除 / 需要重新索引的路径 */
export interface ReconcilePlan {
  toRemove: string[];
  toReindex: string[];
}

/**
 * 比对持久化索引的文档 mtime 表与 vault 当前状态，产出修复计划：
 * - 索引有而 vault 无 → 移除（外部删除）
 * - vault mtime 晚于索引时 mtime → 重索引（Obsidian 关闭期间的外部修改，如同步）
 * - vault 有而索引无 → 重索引（外部新增）
 */
export function planReconcile(
  current: ReconcileFileStat[],
  indexedDocs: Record<string, number>
): ReconcilePlan {
  const currentMtime = new Map<string, number>(current.map((f) => [f.path, f.mtime]));
  const toRemove: string[] = [];
  const toReindex: string[] = [];
  for (const [path, indexedAt] of Object.entries(indexedDocs)) {
    const mtime = currentMtime.get(path);
    if (mtime === undefined) toRemove.push(path);
    else if (mtime > indexedAt) toReindex.push(path);
  }
  for (const f of current) {
    if (indexedDocs[f.path] === undefined) toReindex.push(f.path);
  }
  return { toRemove, toReindex };
}

/** 收窄后的搜索结果（minisearch 的 SearchResult 里 id/doc 为 any，在此统一消除） */
export interface AstraSearchResult {
  id: string;
  score: number;
  /** 命中的文档词元（摘录定位用） */
  terms: string[];
  doc?: Pick<SearchDoc, "title" | "path">;
}

/** 查询后处理参数：降权文件夹 / 隐藏 Obsidian 排除文件 */
export interface SearchPostProcess {
  /** 文件夹前缀列表：命中的文件在结果中降权（但仍被索引） */
  downrankedFolders: string[];
  /** 完全隐藏的路径（Obsidian「排除的文件」，hideExcluded 开启时传入） */
  hiddenPaths: string[];
}

/** 降权文件夹系数 */
const DOWNRANK_FACTOR = 0.3;

const isDownranked = (path: string, folders: string[]): boolean => {
  return folders.some((f) => f.length > 0 && (path === f || path.startsWith(f.endsWith("/") ? f : `${f}/`)));
};

const isHidden = (path: string, hiddenPaths: string[]): boolean => {
  return hiddenPaths.some((f) => f.length > 0 && (path === f || path.startsWith(f.endsWith("/") ? f : `${f}/`)));
};

export function runSearch(
  mini: MiniSearch<SearchDoc>,
  query: string,
  options: SearchQueryOptions,
  post: SearchPostProcess
): AstraSearchResult[] {
  const q = query.trim();
  if (!q) return [];
  return mini
    .search(q, {
      prefix: options.prefix,
      fuzzy: options.fuzzy > 0 ? options.fuzzy : false,
      boost: { ...options.weights }
    })
    .map((r) => {
      // minisearch 不同版本 storeFields 形态不同：新版在 r.doc，旧版平铺在 r 顶层
      const doc = (r.doc ?? r) as Pick<SearchDoc, "title" | "path"> | undefined;
      let score = r.score;
      if (doc && isDownranked(doc.path, post.downrankedFolders)) {
        score *= DOWNRANK_FACTOR;
      }
      return {
        id: String(r.id),
        score,
        terms: r.terms,
        doc
      };
    })
    .filter((r) => !(r.doc && isHidden(r.doc.path, post.hiddenPaths)));
}

/** Fuzziness 设置 → minisearch fuzzy 值（0 精确 / 1 适度 / 2 充分） */
export const fuzzinessValue = (setting: "0" | "1" | "2"): number => {
  switch (setting) {
    case "0":
      return 0;
    case "1":
      return 0.2;
    case "2":
      return 0.4;
  }
};

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
