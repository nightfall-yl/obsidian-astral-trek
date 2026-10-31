// ================= Astra 全文搜索：服务层（IO 与增量薄层） =================
// 内核见 search-core.ts（纯函数）。职责：
// - 全量分批构建索引（避免大 vault 卡顿）
// - metadataCache/vault 事件驱动的单文件增量维护
// - 索引范围与文档组装：扩展名白名单 / 无扩展名 / 不受支持文件（对齐 omnisearch）
// 生命周期：仅当搜索功能被启用（ribbon 打开弹窗）时 ensureStarted，常驻至插件卸载。
// 索引持久化：MiniSearch 索引序列化写入插件目录 search-index.json（含设置指纹与
// 每文档 mtime 表）；下次启动指纹匹配则 loadJSONAsync 秒级恢复，后台按 mtime 对账
// 修复 Obsidian 关闭期间的外部改动（删除/修改/新增）；卸载时 flush 立即写盘。
// 分词/权重类设置变更经 rebuild() 重建索引（对齐 omnisearch「清缓存+重启」的意图，
// 但无需重启）。

import MiniSearch from "minisearch";
import { getAllTags, debounce, normalizePath, TFile, type App } from "obsidian";
import type { Debouncer } from "obsidian";
import type AstraDashboardPlugin from "../main";
import type { SearchSettings } from "../models";
import {
  createMiniSearch,
  runSearch,
  fuzzinessValue,
  INDEX_FORMAT_VERSION,
  computeFingerprint,
  planReconcile,
  SEARCH_FIELDS,
  SEARCH_STORE_FIELDS,
  type AstraSearchResult,
  type SearchDoc,
  type SearchQueryOptions,
  type SearchPostProcess
} from "./search-core";
import { makeTokenizer } from "./tokenizer";

/** 读取 frontmatter 结束偏移（Obsidian 类型里 frontmatter 为 any，收窄后再用） */
function frontmatterEndOffset(cache: {
  frontmatter?: unknown;
} | null): number | undefined {
  const pos = cache?.frontmatter as { position?: { end?: { offset?: number } } } | undefined;
  const offset = pos?.position?.end?.offset;
  return typeof offset === "number" ? offset : undefined;
}

/** 读取非公开 vault 配置（对齐 omnisearch：userIgnoreFilters / showUnsupportedFiles） */
function vaultConfig(app: App, key: string): unknown {
  const cfg = app.vault as unknown as {
    getConfig?: (k: string) => unknown;
  };
  try {
    return cfg.getConfig?.(key);
  } catch {
    return undefined;
  }
}

const BUILD_BATCH_SIZE = 20;

/** 持久化缓存文件名（位于插件目录下） */
const INDEX_FILE_NAME = "search-index.json";
/** 增量更新后的写盘防抖间隔（首次触发后必写一次，连续编辑不会无限推迟） */
const INDEX_SAVE_DEBOUNCE_MS = 5000;

/** 持久化索引文件结构（search-index.json） */
interface PersistedIndex {
  format: number;
  fingerprint: string;
  savedAt: number;
  /** path → 索引时 mtime（对账用） */
  docs: Record<string, number>;
  /** MiniSearch.toJSON() 的序列化结果 */
  mini: unknown;
}

export class SearchService {
  private mini: ReturnType<typeof createMiniSearch> | null = null;
  private starting: Promise<void> | null = null;
  private reindexDebouncer: Debouncer<[TFile], void>;
  private saveDebouncer: Debouncer<[], void>;
  /** 磁盘写入串行链：防并发交错，后一次保存覆盖前一次 */
  private saving: Promise<void> = Promise.resolve();
  private eventsRegistered = false;
  /** path → 索引时的 mtime（持久化对账依据，随索引增删同步维护） */
  private docsMtime = new Map<string, number>();

  constructor(
    private app: App,
    private plugin: AstraDashboardPlugin
  ) {
    this.reindexDebouncer = debounce(
      (file: TFile) => void this.reindexFile(file),
      500,
      true
    );
    this.saveDebouncer = debounce(() => void this.saveIndex(), INDEX_SAVE_DEBOUNCE_MS);
  }

  get isReady(): boolean {
    return this.mini !== null;
  }

  private get settings(): SearchSettings {
    return this.plugin.data.settings.search;
  }

  /** 幂等启动：全量构建 → 注册增量事件 */
  async ensureStarted(): Promise<void> {
    if (this.mini) return;
    this.starting ??= this.start();
    return this.starting;
  }

  private async start(): Promise<void> {
    const restored = await this.tryRestoreIndex();
    if (!restored) {
      this.mini = createMiniSearch(this.makeTokenizer());
      this.docsMtime.clear();
      await this.buildAll();
    }
    this.registerIncrementalEvents();
    if (restored) {
      // 缓存命中：后台对账修复 Obsidian 关闭期间的外部改动（删除/修改/新增）
      void this.reconcileWithVault();
    } else {
      this.scheduleSave();
    }
  }

  private makeTokenizer(): (text: string) => string[] {
    return makeTokenizer({
      tokenizeUrls: this.settings.tokenizeUrls,
      ignoreDiacritics: this.settings.ignoreDiacritics
    });
  }

  /** 分词/权重/范围类设置变更后调用：全量重建索引 */
  async rebuild(): Promise<void> {
    this.mini = null;
    this.starting = null;
    this.reindexDebouncer.cancel();
    this.saveDebouncer.cancel();
    await this.ensureStarted();
  }

  /** 待索引文件全集：md 之外按 indexedFileTypes / 无扩展名 / unsupported 策略扩展 */
  private filesToIndex(): TFile[] {
    const s = this.settings;
    const extraTypes = new Set(
      s.indexedFileTypes.map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0)
    );
    const detectAll =
      s.unsupportedFilesIndexing === "default"
        ? vaultConfig(this.app, "showUnsupportedFiles") === true
        : s.unsupportedFilesIndexing === "yes";

    return this.app.vault.getFiles().filter((f) => {
      if (f.extension === "md") return true;
      const ext = f.extension.toLowerCase();
      if (extraTypes.has(ext)) return true; // 纯文本扩展名白名单
      if (s.indexFilesWithoutExtension && f.extension === "") return true;
      return detectAll; // 其余「不受支持」文件仅索引文件名
    });
  }

  /** Obsidian「排除的文件」过滤串（非公开 API，拿不到则视为空） */
  private excludedFilters(): string[] {
    const raw = vaultConfig(this.app, "userIgnoreFilters");
    return Array.isArray(raw) ? (raw as string[]) : [];
  }

  private async buildAll(): Promise<void> {
    const files = this.filesToIndex();
    for (let i = 0; i < files.length; i += BUILD_BATCH_SIZE) {
      const batch = files.slice(i, i + BUILD_BATCH_SIZE);
      await Promise.all(batch.map((f) => this.indexFile(f)));
    }
  }

  /* ================= 索引持久化 ================= */

  /** 缓存文件路径（vault 相对路径）；manifest.dir 缺失时放弃持久化 */
  private indexFilePath(): string | null {
    const dir = this.plugin.manifest.dir;
    if (!dir) return null;
    return normalizePath(`${dir}/${INDEX_FILE_NAME}`);
  }

  /** 索引内容指纹：分词/索引范围设置 + 插件版本 + 格式版本 */
  private fingerprint(): string {
    const s = this.settings;
    return computeFingerprint(
      {
        tokenizeUrls: s.tokenizeUrls,
        ignoreDiacritics: s.ignoreDiacritics,
        indexedFileTypes: s.indexedFileTypes,
        indexFilesWithoutExtension: s.indexFilesWithoutExtension,
        unsupportedFilesIndexing: s.unsupportedFilesIndexing,
        displayTitle: s.displayTitle,
        hideExcluded: s.hideExcluded
      },
      this.plugin.manifest.version
    );
  }

  /** 从磁盘加载缓存索引；任何异常/指纹不符均返回 false 走全量重建 */
  private async tryRestoreIndex(): Promise<boolean> {
    this.docsMtime.clear();
    const path = this.indexFilePath();
    if (!path) return false;
    try {
      const adapter = this.app.vault.adapter;
      if (!(await adapter.exists(path))) return false;
      const parsed = JSON.parse(await adapter.read(path)) as Partial<PersistedIndex> | null;
      if (
        !parsed ||
        parsed.format !== INDEX_FORMAT_VERSION ||
        typeof parsed.fingerprint !== "string" ||
        parsed.fingerprint !== this.fingerprint() ||
        !parsed.docs ||
        typeof parsed.mini !== "object" ||
        parsed.mini === null
      ) {
        return false;
      }
      for (const [p, m] of Object.entries(parsed.docs)) {
        if (typeof m === "number") this.docsMtime.set(p, m);
      }
      this.mini = await MiniSearch.loadJSONAsync<SearchDoc>(JSON.stringify(parsed.mini), {
        fields: SEARCH_FIELDS,
        storeFields: SEARCH_STORE_FIELDS,
        tokenize: this.makeTokenizer()
      });
      return true;
    } catch {
      // 缓存损坏 / 版本不符：丢弃缓存，降级为全量重建
      this.mini = null;
      this.docsMtime.clear();
      return false;
    }
  }

  /** 缓存命中后的对账：mtime/path 差异修复（纯内存判断 + 少量重索引） */
  private async reconcileWithVault(): Promise<void> {
    const mini = this.mini;
    if (!mini) return;
    const files = this.filesToIndex();
    const plan = planReconcile(
      files.map((f) => ({ path: f.path, mtime: f.stat.mtime })),
      Object.fromEntries(this.docsMtime)
    );
    let touched = false;
    for (const path of plan.toRemove) {
      mini.discard(path);
      this.docsMtime.delete(path);
      touched = true;
    }
    if (plan.toReindex.length > 0) {
      const targets = new Set(plan.toReindex);
      for (const f of files) {
        if (targets.has(f.path)) {
          await this.indexFile(f);
          touched = true;
        }
      }
    }
    if (touched) this.scheduleSave();
  }

  /** 调度一次防抖写盘 */
  private scheduleSave(): void {
    this.saveDebouncer();
  }

  /** 序列化当前索引并写盘；写入串行化，失败静默（内存索引不受影响） */
  private async saveIndex(): Promise<void> {
    const path = this.indexFilePath();
    if (!path) return;
    this.saving = this.saving.then(async () => {
      const mini = this.mini;
      if (!mini) return;
      const payload: PersistedIndex = {
        format: INDEX_FORMAT_VERSION,
        fingerprint: this.fingerprint(),
        savedAt: Date.now(),
        docs: Object.fromEntries(this.docsMtime),
        mini: mini.toJSON()
      };
      try {
        await this.app.vault.adapter.write(path, JSON.stringify(payload));
      } catch {
        // 只读 vault / 磁盘满等：持久化失败降级为纯内存索引
      }
    });
    await this.saving;
  }

  /** 插件卸载时立即写盘（取消防抖） */
  async flush(): Promise<void> {
    this.saveDebouncer.cancel();
    if (!this.mini) return;
    await this.saveIndex();
  }

  /** 增量事件入口：单文件重索引后调度写盘 */
  private async reindexFile(file: TFile): Promise<void> {
    await this.indexFile(file);
    this.scheduleSave();
  }

  /** 全量构建期间关闭单文件回写通知，避免每文件触发 Notice 级噪声 */
  private async indexFile(file: TFile): Promise<void> {
    if (!this.mini) return;
    const s = this.settings;
    // hideExcluded：完全隐藏 Obsidian「排除的文件」（关闭时仅降权，见 runSearch 后处理）
    const excluded = this.excludedFilters();
    if (s.hideExcluded && excluded.length > 0) {
      const path = file.path;
      if (excluded.some((f) => f.length > 0 && (path === f || path.startsWith(`${f}/`)))) {
        this.mini.discard(file.path);
        this.docsMtime.delete(file.path);
        return;
      }
    }
    try {
      const cache = this.app.metadataCache.getFileCache(file);
      const isMd = file.extension === "md";
      // 纯文本读取：md 与扩展名白名单内文件读内容，其余仅索引文件名
      let content = "";
      if (isMd || s.indexedFileTypes.includes(file.extension.toLowerCase()) || file.extension === "") {
        content = await this.app.vault.cachedRead(file);
        if (isMd) {
          // 剔除 frontmatter 原文，避免结构化字段混入全文检索
          const fmEnd = frontmatterEndOffset(cache);
          if (typeof fmEnd === "number" && fmEnd >= 0 && fmEnd < content.length) {
            content = content.slice(fmEnd);
          }
        }
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

      // Tags (default: 2)：getAllTags 含 # 前缀
      const tags = isMd && cache ? (getAllTags(cache) ?? []).join(" ") : "";

      // Header properties fields：自定义属性值拼接进 props 字段
      const fmRaw: unknown = cache?.frontmatter;
      const fm = (fmRaw !== null && typeof fmRaw === "object" ? fmRaw : {}) as Record<
        string,
        unknown
      >;
      const props = (s.weightCustomProperties ?? [])
        .map((p) => {
          const v = fm?.[p.name];
          return typeof v === "string" || typeof v === "number" ? String(v) : "";
        })
        .filter((v) => v.length > 0)
        .join(" ");

      // Set frontmatter property key as title（"#heading" = 首个标题）
      let title = file.basename;
      if (s.displayTitle === "#heading") {
        title = h1.length > 0 ? h1 : file.basename;
      } else if (s.displayTitle.length > 0) {
        const v = fm?.[s.displayTitle];
        if (typeof v === "string" && v.length > 0) title = v;
        else if (typeof v === "number") title = String(v);
      }

      const doc: SearchDoc = {
        id: file.path,
        title,
        h1,
        h2,
        h3,
        content,
        tags,
        props,
        path: file.path
      };
      if (this.mini.has(file.path)) this.mini.discard(file.path);
      this.mini.add(doc);
      this.docsMtime.set(file.path, file.stat.mtime);
    } catch {
      // 单文件索引失败：跳过该文件，不影响整体索引
    }
  }

  private registerIncrementalEvents(): void {
    if (this.eventsRegistered) return; // rebuild 复用同一批监听，避免重复注册
    this.eventsRegistered = true;
    this.plugin.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        if (file instanceof TFile && this.filesToIndex().includes(file)) {
          this.reindexDebouncer(file);
        }
      })
    );
    this.plugin.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile) {
          this.mini?.discard(file.path);
          this.docsMtime.delete(file.path);
          this.scheduleSave();
        }
      })
    );
    this.plugin.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (file instanceof TFile) {
          this.mini?.discard(oldPath);
          this.docsMtime.delete(oldPath);
          if (this.filesToIndex().includes(file)) {
            void this.reindexFile(file);
          } else {
            this.scheduleSave();
          }
        }
      })
    );
  }

  /** 组装查询选项与后处理参数（settings → core 的映射层） */
  private queryOptions(): {
    options: SearchQueryOptions;
    post: SearchPostProcess;
  } {
    const s = this.settings;
    const excluded = this.excludedFilters();
    // hideExcluded=false 时排除文件在结果中降权（对齐 omnisearch 默认行为）
    const downranked = [
      ...s.downrankedFoldersFilters.map((f) => f.trim()).filter((f) => f.length > 0),
      ...(s.hideExcluded ? [] : excluded)
    ];
    return {
      options: {
        weights: {
          title: s.weightBasename,
          path: s.weightDirectory,
          h1: s.weightH1,
          h2: s.weightH2,
          h3: s.weightH3,
          tags: s.weightUnmarkedTags,
          // 多个自定义属性共用 props 字段，取平均权重（简化实现）
          props:
            s.weightCustomProperties.length > 0
              ? s.weightCustomProperties.reduce((acc, p) => acc + p.weight, 0) /
                s.weightCustomProperties.length
              : 1
        },
        fuzzy: fuzzinessValue(s.fuzziness),
        prefix: !s.simpleSearch
      },
      post: {
        downrankedFolders: downranked,
        hiddenPaths: []
      }
    };
  }

  /** 全库搜索；未就绪或空查询返回空数组 */
  search(query: string): AstraSearchResult[] {
    if (!this.mini) return [];
    const { options, post } = this.queryOptions();
    return runSearch(this.mini, query, options, post);
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
