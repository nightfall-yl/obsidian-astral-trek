// ================= Astra 全文搜索：ribbon 弹窗 =================
// 弹窗交互 1:1 复刻 omnisearch（GPL-3）的用户体验，全部代码为本项目原创实现：
// - prompt 样式基因、输入框 + 结果列表 + 摘录高亮 + 键位提示
// - ↑↓ 选择，Enter 当前窗打开，Mod+Enter 新标签，Shift+Enter 新建笔记，
//   Alt+Enter 插入链接，Alt+↑↓ 搜索历史，Mod+G 临时切换摘录
// - 中文 IME 组合期间 Enter 不触发（isComposing 防护）
// 点击/悬停预览复用 Obsidian 全局机制，不经过 MarkdownRenderer（免疫第三方 post-processor）。

import { MarkdownView, Modal, Notice, Platform, TFile, debounce } from "obsidian";
import type AstraDashboardPlugin from "../main";
import type { SearchService } from "./search-service";
import { buildExcerpt, type AstraSearchResult } from "./search-core";
import { t as $t } from "../i18n";

const HISTORY_KEY = "astra-search-history";
const HISTORY_LIMIT = 20;
const RESULT_LIMIT = 50;
const EXCERPT_WINDOW = 120;

export class AstraSearchModal extends Modal {
  private query = "";
  private results: AstraSearchResult[] = [];
  private selected = 0;
  private excerptOverride: boolean | null = null; // Mod+G 临时切换
  private history: string[] = [];
  private historyIndex = -1;
  private composing = false;
  private excerptCache = new Map<string, string | null>();

  private inputEl!: HTMLInputElement;
  private resultsEl!: HTMLElement;

  private runSearchDebounced = debounce(() => this.runSearch(), 200, true);

  constructor(
    private plugin: AstraDashboardPlugin,
    private service: SearchService
  ) {
    super(plugin.app);
    try {
      const stored = this.plugin.app.loadLocalStorage(HISTORY_KEY) as string | null;
      this.history = JSON.parse(stored ?? "[]") as string[];
    } catch {
      this.history = [];
    }
    // 预填：编辑器选中文本
    const selection = plugin.app.workspace
      .getActiveViewOfType(MarkdownView)
      ?.editor.getSelection();
    if (selection) this.query = selection;
  }

  onOpen(): void {
    this.modalEl.replaceChildren();
    this.modalEl.addClass("astra-search-modal", "prompt");
    this.modalEl.removeClass("modal");
    this.modalEl.tabIndex = -1;

    const header = this.modalEl.createDiv("astra-search-input-row");
    this.inputEl = header.createEl("input", {
      cls: "astra-search-input",
      type: "text",
      attr: { spellcheck: false }
    });
    this.inputEl.placeholder = $t("search.placeholder");
    this.inputEl.value = this.query;

    this.resultsEl = this.modalEl.createDiv("astra-search-results");
    this.renderFooter();

    this.inputEl.addEventListener("keydown", (e) => this.onKeyDown(e));
    this.inputEl.addEventListener("input", () => {
      if (this.composing) return;
      this.runSearchDebounced();
    });
    this.inputEl.addEventListener("compositionstart", () => {
      this.composing = true;
    });
    this.inputEl.addEventListener("compositionend", () => {
      this.composing = false;
      this.runSearchDebounced();
    });

    window.setTimeout(() => this.inputEl.focus());

    // 首次打开时触发全量建索引（仅当搜索功能被实际使用）
    void (async () => {
      await this.service.ensureStarted();
      this.runSearch();
    })();
  }

  onClose(): void {
    this.excerptCache.clear();
    this.runSearchDebounced.cancel();
  }

  /* ---- 键盘 ---- */

  private onKeyDown(e: KeyboardEvent): void {
    // IME 组合中放行全部按键（Enter 交给输入法确认候选）
    if (e.isComposing) return;

    const mod = Platform.isMacOS ? e.metaKey : e.ctrlKey;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (e.altKey) this.browseHistory(1);
      else this.moveSelection(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (e.altKey) this.browseHistory(-1);
      else this.moveSelection(-1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const result = this.results[this.selected];
      if (e.altKey && result) {
        this.insertLink(result); // Alt+Enter 插入链接
      } else if (result) {
        this.openResult(result, mod); // Enter 当前窗 / Mod+Enter 新标签
      }
    } else if (e.key === "g" && mod) {
      e.preventDefault(); // Mod+G 临时切换摘录
      this.excerptOverride = !(this.excerptOverride ?? this.plugin.data.settings.search.showExcerpt);
      void this.renderResults();
    } else if (e.key === "Tab") {
      e.preventDefault();
      this.moveSelection(e.shiftKey ? -1 : 1);
    }
  }

  private moveSelection(delta: number): void {
    if (this.results.length === 0) return;
    this.selected = (this.selected + delta + this.results.length) % this.results.length;
    this.updateSelection();
  }

  private updateSelection(): void {
    const rows = this.resultsEl.querySelectorAll(".astra-search-result");
    rows.forEach((row, i) => row.classList.toggle("is-selected", i === this.selected));
    rows[this.selected]?.scrollIntoView({ block: "nearest" });
  }

  /* ---- 搜索与渲染 ---- */

  private runSearch(): void {
    this.query = this.inputEl.value;
    this.historyIndex = -1;
    this.results = this.service.search(this.query).slice(0, RESULT_LIMIT);
    this.selected = 0;
    void this.renderResults();
  }

  private async renderResults(): Promise<void> {
    this.resultsEl.empty();
    if (this.results.length === 0) {
      // 无输入时不渲染任何占位，保持空态紧凑（建索引前后表现一致）
      if (this.query.trim()) {
        this.resultsEl.createDiv("astra-search-empty").setText($t("search.noResults"));
      }
      return;
    }
    for (let i = 0; i < this.results.length; i++) {
      this.buildResultRow(this.results[i]!, i);
    }
  }

  private buildResultRow(result: AstraSearchResult, index: number): void {
    const title = result.doc?.title ?? result.id;
    const row = this.resultsEl.createDiv(
      index === this.selected ? "astra-search-result is-selected" : "astra-search-result"
    );
    row.createDiv("astra-search-result-title").setText(title);
    void this.renderExcerptAsync(row, result);
    row.addEventListener("click", (e) => this.openResult(result, Platform.isMacOS ? e.metaKey : e.ctrlKey));
    row.addEventListener("mouseenter", () => {
      this.selected = index;
      this.updateSelection();
      // Obsidian 原生悬停预览
      this.plugin.app.workspace.trigger("hover-link", {
        targetEl: row,
        source: "astra-search-modal",
        hoverParent: this.modalEl,
        target: { path: result.id, position: undefined }
      });
    });
  }

  /** 摘录按需读取原文渲染；Mod+G 或设置可关 */
  private async renderExcerptAsync(
    row: HTMLElement,
    result: AstraSearchResult
  ): Promise<void> {
    const showExcerpt = this.excerptOverride ?? this.plugin.data.settings.search.showExcerpt;
    if (!showExcerpt || !this.query.trim()) return;
    if (!this.excerptCache.has(result.id)) {
      this.excerptCache.set(result.id, await this.service.readFile(result.id));
    }
    const content = this.excerptCache.get(result.id);
    if (content === null || content === undefined || !row.isConnected) return;

    const excerptRow = row.createDiv("astra-search-result-excerpt");
    const segments = buildExcerpt(content, result.terms, EXCERPT_WINDOW);
    const highlight = this.plugin.data.settings.search.highlight;
    for (const seg of segments) {
      if (seg.mark && highlight) {
        excerptRow.createEl("mark").setText(seg.text);
      } else {
        excerptRow.appendText(seg.text);
      }
    }
    if (this.plugin.data.settings.search.renderLineReturnInExcerpts) {
      excerptRow.addClass("astra-search-excerpt-linewrap");
    }
  }

  /* ---- 动作 ---- */

  private openResult(result: AstraSearchResult, newLeaf: boolean): void {
    const file = this.plugin.app.vault.getAbstractFileByPath(result.id);
    if (!(file instanceof TFile)) return;
    this.pushHistory(this.query);
    void this.plugin.app.workspace.openLinkText(file.path, "", newLeaf);
    if (!newLeaf) this.close();
  }

  /** 在活动编辑器光标处插入 [[路径|标题]] */
  private insertLink(result: AstraSearchResult): void {
    const title = result.doc?.title ?? result.id;
    const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice($t("search.noActiveEditor"));
      return;
    }
    view.editor.replaceSelection(`[[${result.id}|${title}]]`);
    this.close();
  }

  /* ---- 历史 ---- */

  private browseHistory(delta: number): void {
    if (this.history.length === 0) return;
    // 0 = 当前输入；1 = 最近一条…
    let idx = this.historyIndex + delta;
    idx = Math.max(-1, Math.min(this.history.length - 1, idx));
    this.historyIndex = idx;
    this.inputEl.value = idx === -1 ? this.query : this.history[idx] ?? "";
    this.runSearch();
  }

  private pushHistory(query: string): void {
    const q = query.trim();
    if (!q) return;
    this.history = [q, ...this.history.filter((h) => h !== q)].slice(0, HISTORY_LIMIT);
    try {
      this.plugin.app.saveLocalStorage(HISTORY_KEY, JSON.stringify(this.history));
    } catch {
      // 存储满/不可用时静默忽略，搜索功能不受影响
    }
  }

  /* ---- 底部键位提示 ---- */

  private renderFooter(): void {
    const mod = Platform.isMacOS ? "⌘" : "Ctrl+";
    const footer = this.modalEl.createDiv("astra-search-footer");
    footer.createSpan({ text: "↵ " + $t("search.hintOpen") });
    footer.createSpan({ text: `${mod}↵ ` + $t("search.hintNewLeaf") });
    footer.createSpan({ text: "⌥↵ " + $t("search.hintInsert") });
    footer.createSpan({ text: "⌥↑↓ " + $t("search.hintHistory") });
  }
}
