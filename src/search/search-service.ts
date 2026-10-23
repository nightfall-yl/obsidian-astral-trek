// ================= Astra 全文搜索：服务层（IO 与增量薄层） =================
// 内核见 search-core.ts（纯函数）。职责：
// - 全量分批构建索引（避免大 vault 卡顿）
// - metadataCache/vault 事件驱动的单文件增量维护
// 生命周期：仅当搜索功能被启用（ribbon 打开弹窗）时 ensureStarted，常驻至插件卸载。

import { debounce, TFile, type App } from "obsidian";
import type { Debouncer } from "obsidian";
import type AstraDashboardPlugin from "../main";
import {
  createMiniSearch,
  runSearch,
  type AstraSearchResult,
  type SearchDoc
} from "./search-core";

/** 读取 frontmatter 结束偏移（Obsidian 类型里 frontmatter 为 any，收窄后再用） */
function frontmatterEndOffset(cache: {
  frontmatter?: unknown;
} | null): number | undefined {
  const pos = cache?.frontmatter as { position?: { end?: { offset?: number } } } | undefined;
  const offset = pos?.position?.end?.offset;
  return typeof offset === "number" ? offset : undefined;
}

const BUILD_BATCH_SIZE = 20;

export class SearchService {
  private mini: ReturnType<typeof createMiniSearch> | null = null;
  private starting: Promise<void> | null = null;
  private reindexDebouncer: Debouncer<[TFile], void>;

  constructor(
    private app: App,
    private plugin: AstraDashboardPlugin
  ) {
    this.reindexDebouncer = debounce(
      (file: TFile) => void this.indexFile(file),
      500,
      true
    );
  }

  get isReady(): boolean {
    return this.mini !== null;
  }

  /** 幂等启动：全量构建 → 注册增量事件 */
  async ensureStarted(): Promise<void> {
    if (this.mini) return;
    this.starting ??= this.start();
    return this.starting;
  }

  private async start(): Promise<void> {
    this.mini = createMiniSearch();
    await this.buildAll();
    this.registerIncrementalEvents();
  }

  private async buildAll(): Promise<void> {
    const files = this.app.vault.getMarkdownFiles();
    for (let i = 0; i < files.length; i += BUILD_BATCH_SIZE) {
      const batch = files.slice(i, i + BUILD_BATCH_SIZE);
      await Promise.all(batch.map((f) => this.indexFile(f)));
    }
  }

  /** 全量构建期间关闭单文件回写通知，避免每文件触发 Notice 级噪声 */
  private async indexFile(file: TFile): Promise<void> {
    if (!this.mini) return;
    try {
      const cache = this.app.metadataCache.getFileCache(file);
      let content = await this.app.vault.cachedRead(file);
      // 剔除 frontmatter 原文，避免结构化字段混入全文检索
      const fmEnd = frontmatterEndOffset(cache);
      if (typeof fmEnd === "number" && fmEnd >= 0 && fmEnd < content.length) {
        content = content.slice(fmEnd);
      }
      const cacheHeadings = cache?.headings ?? [];
      const h1 = cacheHeadings
        .filter((h) => h.level === 1)
        .map((h) => h.heading)
        .join(" ");
      const h2 = cacheHeadings
        .filter((h) => h.level === 2)
        .map((h) => h.heading)
        .join(" ");
      const h3 = cacheHeadings
        .filter((h) => h.level === 3)
        .map((h) => h.heading)
        .join(" ");
      const doc: SearchDoc = {
        id: file.path,
        title: file.basename,
        h1,
        h2,
        h3,
        content,
        path: file.path
      };
      if (this.mini.has(file.path)) this.mini.discard(file.path);
      this.mini.add(doc);
    } catch {
      // 单文件索引失败：跳过该文件，不影响整体索引
    }
  }

  private registerIncrementalEvents(): void {
    this.plugin.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        if (file instanceof TFile && file.extension === "md") {
          this.reindexDebouncer(file);
        }
      })
    );
    this.plugin.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile && file.extension === "md") {
          this.mini?.discard(file.path);
        }
      })
    );
    this.plugin.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (file instanceof TFile && file.extension === "md") {
          this.mini?.discard(oldPath);
          void this.indexFile(file);
        }
      })
    );
  }

  /** 全库搜索；未就绪或空查询返回空数组 */
  search(query: string): AstraSearchResult[] {
    if (!this.mini) return [];
    return runSearch(this.mini, query);
  }

  /** 读取文档原文（摘录渲染用） */
  async readFile(path: string): Promise<string | null> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return null;
    try {
      const content = await this.app.vault.cachedRead(file);
      const cache = this.app.metadataCache.getFileCache(file);
      const fmEnd = frontmatterEndOffset(cache);
      if (typeof fmEnd === "number" && fmEnd >= 0 && fmEnd < content.length) {
        return content.slice(fmEnd);
      }
      return content;
    } catch {
      return null;
    }
  }
}
