// ================= 全部便签面板 =================
// 纯容器渲染面板：从 obsidian-memoria-main/src/view.ts 1:1 fork 的核心主视图。
// 不新开标签页，由 Dashboard 视图内嵌渲染，覆盖：瀑布流时间线、按天分组、
// 搜索（#标签/关键词）、置顶/收藏、长按/双击编辑、卡片右键菜单。

import { t as $t } from "../i18n";
import {
  Component,
  MarkdownRenderer,
  Menu,
  Notice,
  Platform,
  TFile,
  normalizePath,
  setIcon,
} from "obsidian";
import type { App, EventRef } from "obsidian";
import type AstraDashboardPlugin from "../main";
import { FlomoStore } from "./store";
import type {
  Flomo} from "./types";
import {
  RESERVED_TAGS,
} from "./types";
import type {
  SearchQuery} from "./search";
import {
  parseSearchQuery,
  matchesQuery,
  EMPTY_QUERY
} from "./search";
import { fmtDate as fmtDateLocale } from "./parser";
const fmtDateLocal = fmtDateLocale;
import type { ExportFormat } from "./export";
import { exportMemos } from "./export";
import { replaceTextareaRange } from "./textarea-utils";

/** 面板打开时的初始分页条数 */
const INITIAL_PAGE = 50;

/** 标签树节点（层级标签 A/B/C） */
interface TagNode {
  name: string;
  full: string;
  count: number;
  self: number;
  children: Map<string, TagNode>;
}

export class FlomoBoardPanel {
  private store: FlomoStore;
  private childComponent = new Component();

  private filter: {
    keyword: string;
    tag: string | null;
    year: string | null;
    date: string | null;
    preset:
      | "all"
      | "today"
      | "week"
      | "on-this-day"
      | "no-tag"
      | "with-image"
      | "with-link"
      | "pinned"
      | "starred"
      | "todo";
    /** 回顾视图专用：随机种子（用于"换一批"） */
    randomSeed: number;
    /** 回顾视图专用：年份筛选 */
    otdYearFilter: string | null;
    /** 回顾视图专用：标签筛选 */
    otdTagFilter: string | null;
    /** 回顾视图专用：类型筛选（all/pinned/starred/todo/image/link） */
    otdTypeFilter: "all" | "pinned" | "starred" | "todo" | "image" | "link";
  } = {
    keyword: "",
    tag: null,
    year: null,
    date: null,
    preset: "all",
    randomSeed: 0,
    otdYearFilter: null,
    otdTagFilter: null,
    otdTypeFilter: "all",
  };

  private pageLimit = INITIAL_PAGE;
  private currentQuery: SearchQuery = EMPTY_QUERY;

  private rootEl: HTMLElement | null = null;
  private listEl: HTMLElement | null = null;
  private inputEl: HTMLTextAreaElement | null = null;
  private inputCardEl: HTMLElement | null = null;
  private editDateTimeEl: HTMLInputElement | null = null;
  private searchEl: HTMLInputElement | null = null;
  private disposeStore: (() => void) | null = null;
  private vaultEvents: EventRef[] | null = null;
  private searchTimer: number | null = null;
  /** 当前正在编辑的 flomo（编辑模式复用输入卡）；null 表示新建模式 */
  private editingMemo: Flomo | null = null;
  /** 视图密度："cozy"（宽松，默认）/ "compact"（紧凑） */
  private density: "cozy" | "compact" = "cozy";
  /** 侧栏是否折叠（桌面端） */
  private sidebarCollapsed = false;
  /** 标签树是否展开（默认展开） */
  private tagsExpanded = true;
  /** 图片选择器 input 元素引用（iOS 兼容） */
  private imagePickerEl: HTMLInputElement | null = null;
  /** 快速捕获/便签共用的单个写入文件（与 store 同一来源，用于计算导出与附件目录） */
  private outFilePath = "";

  constructor(
    private hostEl: HTMLElement,
    private plugin: AstraDashboardPlugin,
    filePath: string
  ) {
    this.outFilePath = filePath;
    this.store = new FlomoStore(this.app, { filePath });
  }

  private get app(): App {
    return this.plugin.app;
  }

  async open(): Promise<void> {
    this.hostEl.empty();
    const root = this.hostEl.createDiv("flomo-root flomo-container");
    this.rootEl = root;

    // 移动端（屏幕宽 ≤ 680px 或 Obsidian 标有 is-mobile）默认折叠侧栏，避免占满窄屏
    const isMobile =
      document.body.hasClass("is-mobile") ||
      (typeof window !== "undefined" && window.innerWidth <= 680);
    if (isMobile) {
      this.sidebarCollapsed = true;
      root.addClass("flomo-sidebar-collapsed");
    }

    const shell = root.createDiv("flomo-shell");

    this.buildSidebar(shell);

    const main = shell.createDiv("flomo-main");
    this.buildTopbar(main);
    this.buildInputCard(main);
    this.listEl = main.createDiv("flomo-list");

    this.registerVaultEvents();
    this.disposeStore = this.store.onChange(() => this.renderList());
    await this.store.reloadAll();
  }

  destroy(): void {
    if (this.searchTimer !== null) {
      window.clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
    this.disposeStore?.();
    this.disposeStore = null;
    this.vaultEvents?.forEach((ref) => this.app.vault.offref(ref));
    this.vaultEvents = null;
    this.childComponent.unload();
  }

  /** 文件变化时增量刷新（复用 FlomoStore 的 running/pending 合并语义） */
  private registerVaultEvents(): void {
    if (this.vaultEvents) return;
    this.vaultEvents = [
      this.app.vault.on("modify", (f) => {
        if (f instanceof TFile) void this.store.reloadFile(f);
      }),
      this.app.vault.on("create", (f) => {
        if (f instanceof TFile) void this.store.reloadFile(f);
      }),
      this.app.vault.on("delete", (f) => {
        this.store.removeFile(f.path);
      }),
    ];
  }

  /* ---- 顶部栏 ---- */
  private buildTopbar(main: HTMLElement): void {
    const topBar = main.createDiv("flomo-topbar");
    // 顶部栏：搜索 + 工具
    const searchWrap = topBar.createDiv("flomo-search-wrap");
    const searchIcon = searchWrap.createDiv("flomo-search-icon");
    setIcon(searchIcon, "search");
    this.searchEl = searchWrap.createEl("input", {
      cls: "flomo-search",
      attr: {
        placeholder: $t("auto.237"),
        type: "text",
      },
    });
    const root = this.rootEl!;
    const doSearch = () => {
      this.filter.keyword = this.searchEl?.value.trim() ?? "";
      this.filter.tag = null;
      this.pageLimit = INITIAL_PAGE;
      this.renderList();
    };
    this.searchEl.addEventListener("input", () => {
      if (root.hasClass("flomo-search-immediate")) {
        doSearch();
        return;
      }
      if (this.searchTimer !== null) window.clearTimeout(this.searchTimer);
      this.searchTimer = window.setTimeout(doSearch, 180);
    });

    // 顶部右侧工具区（对齐原项目的 topbar-tools）：
    //   右一：切换侧栏（panel-left-close / panel-left-open）—— 最右
    //   右四：导出当前筛选结果（download → md/html/json 菜单）—— 中间
    //   右五：切换视图密度（rows-3 / list）—— 最左
    //   DOM 顺序按"视觉从左到右"排列：密度 → 导出 → 侧栏
    const tools = topBar.createDiv("flomo-topbar-tools");

    // —— 密度切换按钮（最左）——
    const densityBtn = tools.createEl("button", {
      cls: "astra-icon-btn clickable-icon",
      attr: { "aria-label": "切换视图密度" },
    });
    const updateDensityIcon = () => {
      densityBtn.empty();
      setIcon(densityBtn, this.density === "compact" ? "list" : "rows-3");
    };
    updateDensityIcon();
    densityBtn.addEventListener("click", () => {
      this.density = this.density === "compact" ? "cozy" : "compact";
      updateDensityIcon();
      this.renderList();
    });

    // —— 导出按钮（中间）——
    const exportBtn = tools.createEl("button", {
      cls: "astra-icon-btn clickable-icon",
      attr: { "aria-label": "导出当前筛选结果" },
    });
    setIcon(exportBtn, "download");
    exportBtn.addEventListener("click", (evt) => {
      const menu = new Menu();
      menu.addItem((item) =>
        item
          .setTitle($t("dv.exportMd"))
          .setIcon("file-text")
          .onClick(() => void this.doExport("md"))
      );
      menu.addItem((item) =>
        item
          .setTitle($t("dv.exportHtml"))
          .setIcon("globe")
          .onClick(() => void this.doExport("html"))
      );
      menu.addItem((item) =>
        item
          .setTitle($t("dv.exportJson"))
          .setIcon("braces")
          .onClick(() => void this.doExport("json"))
      );
      menu.showAtMouseEvent(evt);
    });

    // —— 侧栏切换按钮（最右）——
    const toggleBtn = tools.createEl("button", {
      cls: "astra-icon-btn clickable-icon",
      attr: { "aria-label": "切换侧栏" },
    });
    const updateToggleIcon = () => {
      toggleBtn.empty();
      setIcon(
        toggleBtn,
        this.sidebarCollapsed ? "panel-left-open" : "panel-left-close"
      );
    };
    updateToggleIcon();
    toggleBtn.addEventListener("click", () => {
      this.toggleSidebar();
      updateToggleIcon();
    });
  }

  /** 切换侧栏显示/隐藏 */
  private toggleSidebar(): void {
    const root = this.rootEl;
    if (!root) return;
    // 移动端（宽 < 680px）禁用侧栏切换，侧栏始终不展示
    if (
      document.body.hasClass("is-mobile") ||
      (typeof window !== "undefined" && window.innerWidth < 680)
    ) {
      return;
    }
    this.sidebarCollapsed = !this.sidebarCollapsed;
    if (this.sidebarCollapsed) {
      root.addClass("flomo-sidebar-collapsed");
    } else {
      root.removeClass("flomo-sidebar-collapsed");
    }
  }

  /** 导出当前筛选结果 */
  private async doExport(format: ExportFormat): Promise<void> {
    try {
      const flomos = this.getFilteredFlomos();
      if (flomos.length === 0) {
        new Notice($t("p4.10040"));
        return;
      }
      const desc = this.describeCurrentFilter();
      // 导出到快速捕获文件同级目录下的 exports/ 子目录
      const filePath = this.outFilePath;
      const lastSlash = filePath.lastIndexOf("/");
      const folder =
        lastSlash > 0 ? `${filePath.slice(0, lastSlash)}/exports` : "exports";
      const path = await exportMemos(this.app, {
        format,
        flomos,
        filterDesc: desc,
        exportFolder: folder,
      });
      // md 格式直接打开预览
      if (format === "md") {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
          await this.app.workspace.getLeaf("tab").openFile(file);
        }
      }
    } catch (err) {
      new Notice(`导出失败: ${(err as Error).message}`);
    }
  }

  /** 用人类可读的方式描述当前筛选状态 */
  private describeCurrentFilter(): string {
    const parts: string[] = [];
    if (this.filter.keyword) parts.push(`关键词: ${this.filter.keyword}`);
    const presetLabels: Record<string, string> = {
      all: $t("auto.242"),
      pinned: $t("auto.243"),
      starred: $t("auto.244"),
      today: $t("dv.pb.calendar.today"),
      week: $t("auto.245"),
      todo: $t("qc.preset.todo"),
      "on-this-day": $t("auto.251"),
      "no-tag": $t("qc.preset.noTag"),
      "with-image": $t("qc.preset.withImage"),
      "with-link": $t("qc.preset.withLink"),
    };
    if (this.filter.preset !== "all")
      parts.push(presetLabels[this.filter.preset] ?? this.filter.preset);
    if (this.filter.year) parts.push($t("qc.filter.year", { y: this.filter.year }));
    if (this.filter.tag) parts.push(`#${this.filter.tag}`);
    return parts.length === 0 ? $t("auto.246") : parts.join(" · ");
  }

  /* ---- 左侧栏（复刻 obsidian-memoria-main/src/view.ts 的真实筛选功能） ----
   *  顶部统计 + 视图预设 + 检索式预设 + 年份筛选 + 标签树筛选
   */
  private buildSidebar(shell: HTMLElement): void {
    const sidebar = shell.createDiv("flomo-sidebar");
    const all = this.store.getAll();
    const todayStr = fmtDateLocal(new Date());

    // —— 顶部统计
    const stats = sidebar.createDiv("flomo-stats");
    const tagSet = new Set<string>();
    const daySet = new Set<string>();
    for (const m of all) {
      daySet.add(m.date);
      for (const t of m.tags) tagSet.add(t);
    }
    this.addStat(stats, String(all.length), $t("qc.stats.notes"));
    this.addStat(stats, String(tagSet.size), $t("qc.stats.tags"));
    this.addStat(stats, String(daySet.size), $t("qc.stats.days"));

    const pinnedCount = all.filter((m) => m.isPinned).length;
    const starredCount = all.filter((m) => m.isStarred).length;
    const todayCount = all.filter((m) => m.date === todayStr).length;
    const weekCount = this.flomosThisWeek(all);
    const todoCount = all.filter((m) => /\[ \]/.test(m.content)).length;
    const onThisDayCount = all.filter(
      (m) =>
        m.date.slice(5) === todayStr.slice(5) && m.date !== todayStr
    ).length;
    const noTagCount = all.filter((m) => m.tags.length === 0).length;
    const imageCount = all.filter((m) => m.hasImage).length;
    const linkCount = all.filter((m) => m.hasLink).length;

    // —— 视图分组（预设筛选）
    const viewSec = sidebar.createDiv("flomo-sidebar-section");
    viewSec.setText($t("p4.10043"));
    const presets: Array<{
      key: (typeof this.filter)["preset"];
      icon: string;
      text: string;
      count: number;
    }> = [
      { key: "all", icon: "layout-grid", text: $t("auto.242"), count: all.length },
      { key: "pinned", icon: "pin", text: $t("auto.243"), count: pinnedCount },
      { key: "starred", icon: "star", text: $t("auto.244"), count: starredCount },
      { key: "today", icon: "calendar", text: $t("dv.pb.calendar.today"), count: todayCount },
      { key: "week", icon: "calendar-days", text: $t("auto.245"), count: weekCount },
      { key: "todo", icon: "check-square", text: $t("qc.preset.todo"), count: todoCount },
      {
        key: "on-this-day",
        icon: "rotate-ccw",
        text: $t("auto.251"),
        count: onThisDayCount,
      },
    ];
    for (const p of presets) {
      this.renderNavItem(
        sidebar,
        p.key as Parameters<typeof this.renderNavItem>[1],
        p.icon,
        p.text,
        p.count
      );
    }

    // —— 检索式
    const searchSec = sidebar.createDiv("flomo-sidebar-section");
    searchSec.setText($t("p4.10044"));
    this.renderNavItem(sidebar, "no-tag", "tag", $t("qc.preset.noTag"), noTagCount);
    this.renderNavItem(sidebar, "with-image", "image", $t("qc.preset.withImage"), imageCount);
    this.renderNavItem(sidebar, "with-link", "link-2", $t("qc.preset.withLink"), linkCount);

    // —— 年份
    const yearCount = new Map<string, number>();
    for (const m of all) {
      const y = m.date.slice(0, 4);
      yearCount.set(y, (yearCount.get(y) ?? 0) + 1);
    }
    if (yearCount.size > 0) {
      const yearSec = sidebar.createDiv("flomo-sidebar-section");
      yearSec.setText($t("auto.279"));
      const years = [...yearCount.entries()].sort((a, b) =>
        a[0] < b[0] ? 1 : -1
      );
      for (const [y, c] of years) {
        const isActive = this.filter.year === y;
        const el = sidebar.createDiv({
          cls: "flomo-nav-item" + (isActive ? " active" : ""),
        });
        const ic = el.createDiv("flomo-nav-icon");
        setIcon(ic, "calendar");
        el.createSpan({ cls: "flomo-nav-text", text: y });
        el.createSpan({ cls: "flomo-nav-count", text: String(c) });
        el.addEventListener("click", () => {
          this.filter.year = this.filter.year === y ? null : y;
          this.filter.preset = "all";
          this.filter.tag = null;
          this.filter.date = null;
          this.pageLimit = INITIAL_PAGE;
          this.renderList();
        });
      }
    }

    // —— 标签树（可折叠）
    if (tagSet.size > 0) {
      const nonReservedTags = new Map<string, number>();
      for (const t of tagSet) {
        nonReservedTags.set(
          t,
          all.filter((m) => m.tags.includes(t)).length
        );
      }
      const sectionHead = sidebar.createDiv(
        "flomo-sidebar-section flomo-section-collapsible"
      );
      sectionHead.createSpan({
        cls: "flomo-section-arrow",
        text: this.tagsExpanded ? "▾" : "▸",
      });
      sectionHead.createSpan({ text: ` 标签 (${tagSet.size})` });
      sectionHead.addEventListener("click", () => {
        this.tagsExpanded = !this.tagsExpanded;
        this.renderList();
      });
      if (this.tagsExpanded) {
        const tree = this.buildTagTree(nonReservedTags);
        this.renderTagTree(sidebar, tree, 0);
      }
    }
  }

  /** 渲染一条预设导航项（复刻 obsidian-memoria-main/src/view.ts 的 renderNavItem） */
  private renderNavItem(
    parent: HTMLElement,
    key: (typeof this.filter)["preset"],
    icon: string,
    text: string,
    count: number
  ): void {
    const isActive =
      this.filter.preset === key &&
      !this.filter.tag &&
      !this.filter.year &&
      !this.filter.date;
    const el = parent.createDiv({
      cls: "flomo-nav-item" + (isActive ? " active" : ""),
    });
    const ic = el.createDiv("flomo-nav-icon");
    setIcon(ic, icon);
    el.createSpan({ cls: "flomo-nav-text", text });
    el.createSpan({ cls: "flomo-nav-count", text: String(count) });
    el.addEventListener("click", () => {
      this.filter.preset = key;
      this.filter.tag = null;
      this.filter.year = null;
      this.filter.date = null;
      this.pageLimit = INITIAL_PAGE;
      this.renderList();
    });
  }

  /** 构建标签树（支持 A/B/C 层级结构） */
  private buildTagTree(counts: Map<string, number>): TagNode {
    const root: TagNode = {
      name: "",
      full: "",
      count: 0,
      self: 0,
      children: new Map(),
    };
    for (const [tag, c] of counts) {
      const parts = tag.split("/");
      let node = root;
      let acc = "";
      for (const p of parts) {
        acc = acc ? `${acc}/${p}` : p;
        if (!node.children.has(p)) {
          node.children.set(p, {
            name: p,
            full: acc,
            count: 0,
            self: 0,
            children: new Map(),
          });
        }
        node = node.children.get(p)!;
      }
      node.self += c;
    }
    this.sumTag(root);
    return root;
  }

  private sumTag(node: TagNode): number {
    let total = node.self;
    for (const c of node.children.values()) total += this.sumTag(c);
    node.count = total;
    return total;
  }

  /** 递归渲染标签树 */
  private renderTagTree(
    parent: HTMLElement,
    node: TagNode,
    depth: number
  ): void {
    const children = [...node.children.values()].sort(
      (a, b) => b.count - a.count
    );
    for (const c of children) {
      const wrap = parent.createDiv({ cls: "flomo-tag-node" });
      const el = wrap.createDiv({
        cls:
          "flomo-nav-item flomo-tag-item" +
          (this.filter.tag === c.full ? " active" : ""),
      });
      el.style.paddingLeft = `${12 + depth * 14}px`;
      const ic = el.createDiv("flomo-nav-icon");
      ic.setText("#");
      el.createSpan({ cls: "flomo-nav-text", text: c.name });
      el.createSpan({ cls: "flomo-nav-count", text: String(c.count) });
      el.addEventListener("click", () => {
        this.filter.tag = this.filter.tag === c.full ? null : c.full;
        this.filter.preset = "all";
        this.filter.year = null;
        this.filter.date = null;
        this.pageLimit = INITIAL_PAGE;
        this.renderList();
      });
      if (c.children.size > 0) this.renderTagTree(wrap, c, depth + 1);
    }
  }

  /** 删除旧左栏并重建新左栏（保持 [sidebar, main] 顺序）。用于数据变更后刷新数字。 */
  private refreshSidebar(root: HTMLElement): void {
    const shell = root.querySelector<HTMLElement>(":scope > .flomo-shell");
    if (!shell) return;
    const mainEl = shell.querySelector<HTMLElement>(":scope > .flomo-main");
    if (!mainEl) return;
    const oldSidebar = shell.querySelector<HTMLElement>(
      ":scope > .flomo-sidebar"
    );
    if (oldSidebar) oldSidebar.remove();
    // buildSidebar 内部是 shell.createDiv(...)，会 append 到 shell 末尾
    this.buildSidebar(shell);
    const newSidebar = shell.querySelector<HTMLElement>(
      ":scope > .flomo-sidebar"
    );
    if (newSidebar && shell.firstChild !== newSidebar) {
      shell.insertBefore(newSidebar, mainEl);
    }
  }

  private addStat(parent: HTMLElement, num: string, label: string): void {
    const wrap = parent.createDiv("flomo-stat");
    wrap.createDiv({ cls: "flomo-stat-num", text: num });
    wrap.createDiv({ cls: "flomo-stat-label", text: label });
  }

  /**
   * 本周（本周一 00:00 起）的笔记数。
   * 必须与主列表 preset==="week" 的过滤条件保持同一定义：原实现用「滚动 7 天窗口」，
   * 会把上周的笔记算进本周，导致侧栏显示 1 而列表显示「本周还没有笔记」。
   */
  private flomosThisWeek(arr: Flomo[]): number {
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    monday.setHours(0, 0, 0, 0);
    return arr.filter((m) => m.datetime >= monday).length;
  }

  /* ---- 输入卡片：新增便签（Placeholder 「此刻，你在想什么？」+ 5 个工具图标 + 发送） ---- */
  private buildInputCard(main: HTMLElement): void {
    const card = main.createDiv("flomo-input-card");
    this.inputCardEl = card;
    const area = card.createEl("textarea", {
      cls: "flomo-input",
      attr: {
        rows: "1",
        placeholder: $t("auto.252"),
      },
    });
    this.inputEl = area;

    const toolbar = card.createDiv("flomo-input-toolbar");
    const tools = toolbar.createDiv("flomo-input-tools");

    // —— 左一：插入标签 # ——
    const addTagBtn = tools.createEl("button", {
      cls: "flomo-tool-btn clickable-icon",
      attr: { type: "button", "aria-label": "插入标签" },
    });
    setIcon(addTagBtn, "hash");
    addTagBtn.addEventListener("click", () => this.insertAtCursor("#"));

    // —— 左二：插入图片 ——
    const addImageBtn = tools.createEl("button", {
      cls: "flomo-tool-btn clickable-icon",
      attr: { type: "button", "aria-label": "插入图片" },
    });
    setIcon(addImageBtn, "image");
    addImageBtn.addEventListener("click", () => this.pickImageFromDisk());

    // —— 左三：无序列表 ——
    const ulBtn = tools.createEl("button", {
      cls: "flomo-tool-btn clickable-icon",
      attr: { type: "button", "aria-label": "无序列表" },
    });
    setIcon(ulBtn, "list");
    ulBtn.addEventListener("click", () => this.insertListAtCursor("- "));

    // —— 左四：有序列表 ——
    const olBtn = tools.createEl("button", {
      cls: "flomo-tool-btn clickable-icon",
      attr: { type: "button", "aria-label": "有序列表" },
    });
    setIcon(olBtn, "list-ordered");
    olBtn.addEventListener("click", () => this.insertOrderedListAtCursor());

    // —— 左五：任务列表 ——
    const taskBtn = tools.createEl("button", {
      cls: "flomo-tool-btn clickable-icon",
      attr: { type: "button", "aria-label": "任务列表" },
    });
    setIcon(taskBtn, "square-check");
    taskBtn.addEventListener("click", () => this.insertListAtCursor("- [ ] "));

    // —— 左六：表格 ——
    const addTableBtn = tools.createEl("button", {
      cls: "flomo-tool-btn clickable-icon",
      attr: { type: "button", "aria-label": "插入表格" },
    });
    setIcon(addTableBtn, "table");
    addTableBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.showTablePicker(addTableBtn);
    });

    // 编辑模式：日期时间选择器 + 取消 + 发送（默认隐藏）
    // 日期时间作为 toolbar 直接子项独立成行；×/发送 留在编辑按钮组
    const dateInput = toolbar.createEl("input", {
      cls: "flomo-edit-datetime flomo-hidden",
      attr: {
        type: "datetime-local",
        step: "60",
        ariaLabel: "编辑日期时间",
      },
    });
    this.editDateTimeEl = dateInput;

    // 编辑模式的取消按钮
    const editWrap = toolbar.createDiv(
      "flomo-edit-wrap flomo-hidden"
    );
    const cancel = editWrap.createEl("button", {
      cls: "flomo-edit-cancel-btn",
      attr: { type: "button", title: $t("auto.254") },
    });
    setIcon(cancel, "x");

    const editSubmit = editWrap.createEl("button", {
      cls: "flomo-submit-btn",
      attr: { type: "button", "aria-label": "保存" },
    });
    setIcon(editSubmit, "send");

    const submit = toolbar.createEl("button", {
      cls: "flomo-submit-btn",
      attr: { type: "button", "aria-label": "发送" },
    });
    setIcon(submit, "send");

    area.addEventListener("input", () => {
      if (area.value.trim()) card.addClass("has-content");
      else card.removeClass("has-content");
      this.autoGrow(area);
    });
    area.addEventListener("focus", () => card.addClass("is-focused"));
    area.addEventListener("blur", () => {
      card.removeClass("is-focused");
      this.autoGrow(area);
    });
    card.addEventListener("click", (e) => {
      if (e.target === card) area.focus();
    });

    submit.setAttr("data-qc-empty", "1");
    submit.addEventListener("click", () => void this.submitInput());
    editSubmit.addEventListener("click", () => void this.submitInput());

    cancel.addEventListener("click", () => this.exitEditMode());

    area.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void this.submitInput();
      }
    });
    area.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.editingMemo) {
        e.preventDefault();
        this.exitEditMode();
      }
    });
  }

  /** 进入编辑模式：把 flomo 内容填入主区输入框，复用输入卡（对齐原项目） */
  private enterEditMode(flomo: Flomo): void {
    this.editingMemo = flomo;
    const area = this.inputEl;
    const card = this.inputCardEl;
    const dateInput = this.editDateTimeEl;
    if (area) {
      area.value = flomo.content;
      this.autoGrow(area);
      area.focus();
      const len = area.value.length;
      area.setSelectionRange(len, len);
      card?.addClass("has-content");
    }
    card?.addClass("is-editing");
    // 显示编辑工具栏（datetime + 取消 + 保存），隐藏默认发送按钮
    const editWrap = card?.querySelector<HTMLElement>(".flomo-edit-wrap");
    editWrap?.removeClass("flomo-hidden");
    dateInput?.removeClass("flomo-hidden");
    const defaultSubmit = card?.querySelector<HTMLElement>(
      ".flomo-input-toolbar > .flomo-submit-btn"
    );
    defaultSubmit?.addClass("flomo-hidden");
    if (dateInput) {
      dateInput.value = `${flomo.date}T${flomo.time}`;
    }
    this.renderList();
  }

  /** 退出编辑模式，恢复新建输入状态 */
  private exitEditMode(): void {
    this.editingMemo = null;
    const area = this.inputEl;
    const card = this.inputCardEl;
    const dateInput = this.editDateTimeEl;
    card?.removeClass("is-editing");
    const editWrap = card?.querySelector<HTMLElement>(".flomo-edit-wrap");
    editWrap?.addClass("flomo-hidden");
    dateInput?.addClass("flomo-hidden");
    const defaultSubmit = card?.querySelector<HTMLElement>(
      ".flomo-input-toolbar > .flomo-submit-btn"
    );
    defaultSubmit?.removeClass("flomo-hidden");
    if (dateInput) dateInput.value = "";
    if (area) {
      area.value = "";
      area.setAttr("placeholder", "此刻，你在想什么？");
      card?.removeClass("has-content");
      this.autoGrow(area);
    }
    this.renderList();
  }

  private autoGrow(area: HTMLTextAreaElement): void {
    area.addClass("flomo-no-transition");
    if (!area.value.trim()) {
      // 空内容：重置 inline height，让 CSS min-height（收起态 40px / 展开态 96px）生效
      area.style.removeProperty("height");
    } else {
      area.setCssProps({ height: "auto" });
      area.style.height = area.scrollHeight + "px";
    }
    window.requestAnimationFrame(() => area.removeClass("flomo-no-transition"));
  }

  private async submitInput(): Promise<void> {
    const content = this.inputEl?.value.trim();
    if (!content || !this.inputEl) return;
    try {
      if (this.editingMemo) {
        const dtStr = this.editDateTimeEl?.value ?? "";
        const origStr = `${this.editingMemo.date}T${this.editingMemo.time}`;
        const timeChanged = !!dtStr && dtStr !== origStr;
        if (timeChanged) {
          const newDate = new Date(dtStr);
          if (isNaN(newDate.getTime())) {
            new Notice($t("p4.10045"));
            return;
          }
          await this.store.editFlomoDateTime(
            this.editingMemo,
            newDate,
            content
          );
          this.exitEditMode();
          new Notice($t("dv.flomo.updated"));
        } else {
          await this.store.editFlomo(this.editingMemo, content);
          this.exitEditMode();
          new Notice($t("dv.quickCapture.saved"));
        }
      } else {
        await this.store.addMemo(content);
        this.inputEl.value = "";
        this.autoGrow(this.inputEl);
        this.inputCardEl?.removeClass("has-content");
        new Notice($t("p4.10046"));
      }
    } catch {
      new Notice($t("p4.10047"));
    }
  }

  /* ---- 过滤 ---- */
  private getFilteredFlomos(): Flomo[] {
    const all = this.store.getAll();
    const query = parseSearchQuery(this.filter.keyword);
    this.currentQuery = query;

    const todayStr = fmtDateLocal(new Date());
    let result = all.filter((flomo) => {
      // 年份筛选
      if (this.filter.year && !flomo.date.startsWith(this.filter.year))
        return false;
      // 日期筛选
      if (this.filter.date && flomo.date !== this.filter.date) return false;
      // 标签筛选（支持前缀匹配 A/B 命中 A/B/C）
      if (this.filter.tag) {
        const hit = flomo.tags.some(
          (mt) =>
            mt === this.filter.tag || mt.startsWith(this.filter.tag + "/")
        );
        if (!hit) return false;
      }
      // 关键词搜索
      if (!matchesQuery(flomo.content, flomo.tags, flomo.date, query))
        return false;
      return true;
    });

    // 预设视图筛选
    if (this.filter.preset === "today") {
      result = result.filter((m) => m.date === todayStr);
    } else if (this.filter.preset === "week") {
      const now2 = new Date();
      const monday = new Date(now2);
      const dow = (now2.getDay() + 6) % 7;
      monday.setDate(now2.getDate() - dow);
      monday.setHours(0, 0, 0, 0);
      result = result.filter((m) => m.datetime >= monday);
    } else if (this.filter.preset === "on-this-day") {
      const mo = String(new Date().getMonth() + 1).padStart(2, "0");
      const day = String(new Date().getDate()).padStart(2, "0");
      const mmdd = `${mo}-${day}`;
      // 如果有 randomSeed（"随机 5 条"模式），从全库随机选取，不受"今天"日期限制
      if (this.filter.randomSeed > 0 && this.filter.keyword === "" &&
          !this.filter.otdYearFilter && !this.filter.otdTagFilter && this.filter.otdTypeFilter === "all") {
        // 全库随机，不做日期筛选
      } else {
        result = result.filter(
          (m) => m.date.slice(5) === mmdd && m.date !== todayStr
        );
      }
      // 回顾视图专用筛选
      if (this.filter.otdYearFilter) {
        result = result.filter((m) => m.date.startsWith(this.filter.otdYearFilter!));
      }
      if (this.filter.otdTagFilter) {
        result = result.filter((m) =>
          m.tags.some((mt) => mt === this.filter.otdTagFilter || mt.startsWith(this.filter.otdTagFilter! + "/"))
        );
      }
      if (this.filter.otdTypeFilter !== "all") {
        result = result.filter((m) => {
          switch (this.filter.otdTypeFilter) {
            case "pinned": return m.isPinned;
            case "starred": return m.isStarred;
            case "todo": return /\[ \]/.test(m.content);
            case "image": return m.hasImage;
            case "link": return m.hasLink;
            default: return true;
          }
        });
      }
      // 随机排序（换一批）
      if (this.filter.randomSeed > 0) {
        result = this.shuffleArray(result, this.filter.randomSeed);
      }
    } else if (this.filter.preset === "no-tag") {
      result = result.filter((m) => m.tags.length === 0);
    } else if (this.filter.preset === "with-image") {
      result = result.filter((m) => m.hasImage);
    } else if (this.filter.preset === "with-link") {
      result = result.filter((m) => m.hasLink);
    } else if (this.filter.preset === "pinned") {
      result = result.filter((m) => m.isPinned);
    } else if (this.filter.preset === "starred") {
      result = result.filter((m) => m.isStarred);
    } else if (this.filter.preset === "todo") {
      result = result.filter((m) => /\[ \]/.test(m.content));
    }

    return result;
  }

  /* ---- 列表渲染：置顶组 + 按天分组 ---- */
  /** 复刻原项目：根据当前预设视图在列表顶部渲染分组标题（如"📌 置顶 · 共 3 条"） */
  private renderPresetGroupHeader(list: HTMLElement, count: number): void {
    const preset = this.filter.preset;
    const head = list.createDiv("flomo-day-head flomo-preset-head");

    switch (preset) {
      case "pinned": {
        const ic = head.createSpan("flomo-pin-head-icon");
        setIcon(ic, "pin");
        head.createSpan({ text: `置顶 · 共 ${count} 条` });
        break;
      }
      case "starred": {
        const ic = head.createSpan("flomo-preset-head-icon");
        setIcon(ic, "star");
        head.createSpan({ text: `收藏 · 共 ${count} 条` });
        break;
      }
      case "today": {
        const ic = head.createSpan("flomo-preset-head-icon");
        setIcon(ic, "calendar");
        head.createSpan({ text: `今天 · 共 ${count} 条` });
        break;
      }
      case "week": {
        const ic = head.createSpan("flomo-preset-head-icon");
        setIcon(ic, "calendar-days");
        head.createSpan({ text: `本周 · 共 ${count} 条` });
        break;
      }
      case "todo": {
        const ic = head.createSpan("flomo-preset-head-icon");
        setIcon(ic, "check-square");
        head.createSpan({ text: `待办 · 共 ${count} 条` });
        break;
      }
      case "on-this-day": {
        const ic = head.createSpan("flomo-preset-head-icon");
        setIcon(ic, "clock");
        head.createSpan({ text: `往年的今天 · 共 ${count} 条` });
        // 右侧显示筛选池统计
        const poolCount = this.getOtdPoolCount();
        const right = head.createSpan("flomo-preset-head-right");
        right.createSpan({ text: `筛选池 ${poolCount} 条` });
        break;
      }
      case "no-tag": {
        const ic = head.createSpan("flomo-preset-head-icon");
        setIcon(ic, "tag");
        head.createSpan({ text: `无标签 · 共 ${count} 条` });
        break;
      }
      case "with-image": {
        const ic = head.createSpan("flomo-preset-head-icon");
        setIcon(ic, "image");
        head.createSpan({ text: `有图片 · 共 ${count} 条` });
        break;
      }
      case "with-link": {
        const ic = head.createSpan("flomo-preset-head-icon");
        setIcon(ic, "link-2");
        head.createSpan({ text: `有链接 · 共 ${count} 条` });
        break;
      }
      default:
        // "全部笔记" 及带标签/年份筛选时，显示统计信息
        head.createSpan({ cls: "flomo-preset-head-count", text: `共 ${count} 条` });
    }
  }

  /** 复刻原项目：根据当前预设视图渲染差异化空状态 */
  private renderPresetEmpty(list: HTMLElement): void {
    const preset = this.filter.preset;
    const empty = list.createDiv("flomo-empty");

    switch (preset) {
      case "todo":
        empty.createDiv({ cls: "flomo-empty-emoji", text: "🎉" });
        empty.createDiv({
          cls: "flomo-empty-text",
          text: $t("auto.258"),
        });
        empty.createDiv({
          cls: "flomo-empty-sub",
          text: $t("auto.259"),
        });
        break;
      case "pinned":
        empty.createDiv({ cls: "flomo-empty-emoji", text: "📌" });
        empty.createDiv({
          cls: "flomo-empty-text",
          text: $t("auto.260"),
        });
        empty.createDiv({
          cls: "flomo-empty-sub",
          text: $t("auto.261"),
        });
        break;
      case "starred":
        empty.createDiv({ cls: "flomo-empty-emoji", text: "⭐" });
        empty.createDiv({
          cls: "flomo-empty-text",
          text: $t("auto.262"),
        });
        empty.createDiv({
          cls: "flomo-empty-sub",
          text: $t("auto.263"),
        });
        break;
      case "today":
        empty.createDiv({ cls: "flomo-empty-emoji", text: "☀️" });
        empty.createDiv({
          cls: "flomo-empty-text",
          text: $t("auto.264"),
        });
        empty.createDiv({
          cls: "flomo-empty-sub",
          text: $t("auto.265"),
        });
        break;
      case "week":
        empty.createDiv({ cls: "flomo-empty-emoji", text: "📅" });
        empty.createDiv({
          cls: "flomo-empty-text",
          text: $t("auto.266"),
        });
        empty.createDiv({
          cls: "flomo-empty-sub",
          text: $t("auto.267"),
        });
        break;
      case "on-this-day": {
        empty.createDiv({ cls: "flomo-empty-emoji", text: "🕰️" });
        empty.createDiv({
          cls: "flomo-empty-text",
          text: $t("auto.268"),
        });
        empty.createDiv({
          cls: "flomo-empty-sub",
          text: $t("auto.269"),
        });
        const randomBtn = empty.createEl("button", {
          cls: "flomo-empty-action-btn",
          text: $t("u.20745"),
        });
        setIcon(randomBtn, "shuffle");
        randomBtn.addEventListener("click", () => {
          this.filter.randomSeed = Date.now();
          this.renderRandomMemos(5);
        });
        break;
      }
      case "no-tag":
        empty.createDiv({ cls: "flomo-empty-emoji", text: "🏷️" });
        empty.createDiv({
          cls: "flomo-empty-text",
          text: $t("auto.271"),
        });
        empty.createDiv({
          cls: "flomo-empty-sub",
          text: $t("auto.272"),
        });
        break;
      case "with-image":
        empty.createDiv({ cls: "flomo-empty-emoji", text: "🖼️" });
        empty.createDiv({
          cls: "flomo-empty-text",
          text: $t("auto.273"),
        });
        empty.createDiv({
          cls: "flomo-empty-sub",
          text: $t("auto.274"),
        });
        break;
      case "with-link":
        empty.createDiv({ cls: "flomo-empty-emoji", text: "🔗" });
        empty.createDiv({
          cls: "flomo-empty-text",
          text: $t("auto.275"),
        });
        empty.createDiv({
          cls: "flomo-empty-sub",
          text: $t("auto.276"),
        });
        break;
      default:
        empty.createDiv({ cls: "flomo-empty-emoji", text: "📭" });
        empty.createDiv({
          cls: "flomo-empty-text",
          text: $t("auto.277"),
        });
        empty.createDiv({
          cls: "flomo-empty-sub",
          text: $t("auto.278"),
        });
        break;
    }
  }

  /* ---- 回顾（on-this-day）视图专用 ---- */

  /** 构建回顾视图的筛选栏：年份/标签/类型下拉框 + 搜索框 + 操作按钮 */
  private buildOtdFilterBar(list: HTMLElement): void {
    const bar = list.createDiv("flomo-otd-filter-bar");

    // —— 左侧筛选控件 ——
    const filters = bar.createDiv("flomo-otd-filters");

    // 年份下拉框
    const years = this.getOtdAvailableYears();
    if (years.length > 0) {
      const yearWrap = filters.createDiv("flomo-otd-filter-item");
      yearWrap.createSpan({ cls: "flomo-otd-filter-label", text: $t("auto.279") });
      const yearSel = yearWrap.createEl("select", {
        cls: "flomo-otd-select",
      });
      yearSel.createEl("option", { text: $t("auto.280"), value: "" });
      for (const y of years) {
        yearSel.createEl("option", {
          text: y,
          value: y,
          attr: this.filter.otdYearFilter === y ? { selected: "true" } : {},
        });
      }
      yearSel.addEventListener("change", () => {
        this.filter.otdYearFilter = yearSel.value || null;
        this.renderList();
      });
    }

    // 标签下拉框
    const tags = this.getOtdAvailableTags();
    if (tags.length > 0) {
      const tagWrap = filters.createDiv("flomo-otd-filter-item");
      tagWrap.createSpan({ cls: "flomo-otd-filter-label", text: $t("auto.281") });
      const tagSel = tagWrap.createEl("select", {
        cls: "flomo-otd-select",
      });
      tagSel.createEl("option", { text: $t("auto.282"), value: "" });
      for (const t of tags) {
        tagSel.createEl("option", {
          text: `#${t}`,
          value: t,
          attr: this.filter.otdTagFilter === t ? { selected: "true" } : {},
        });
      }
      tagSel.addEventListener("change", () => {
        this.filter.otdTagFilter = tagSel.value || null;
        this.renderList();
      });
    }

    // 类型下拉框
    const typeWrap = filters.createDiv("flomo-otd-filter-item");
    typeWrap.createSpan({ cls: "flomo-otd-filter-label", text: $t("auto.770") });
    const typeSel = typeWrap.createEl("select", {
      cls: "flomo-otd-select",
    });
    const typeOptions: Array<{ value: string; text: string }> = [
      { value: "all", text: $t("auto.283") },
      { value: "pinned", text: $t("auto.243") },
      { value: "starred", text: $t("auto.244") },
      { value: "todo", text: $t("qc.preset.todo") },
      { value: "image", text: $t("auto.286") },
      { value: "link", text: $t("auto.287") },
    ];
    for (const opt of typeOptions) {
      typeSel.createEl("option", {
        text: opt.text,
        value: opt.value,
        attr: this.filter.otdTypeFilter === opt.value ? { selected: "true" } : {},
      });
    }
    typeSel.addEventListener("change", () => {
      this.filter.otdTypeFilter = typeSel.value as typeof this.filter.otdTypeFilter;
      this.renderList();
    });

    // 搜索框
    const searchWrap = filters.createDiv("flomo-otd-search");
    const searchIcon = searchWrap.createDiv("flomo-search-icon");
    setIcon(searchIcon, "search");
    const searchInput = searchWrap.createEl("input", {
      cls: "flomo-otd-search-input",
      attr: {
        placeholder: $t("auto.288"),
        type: "text",
        value: this.filter.keyword,
      },
    });
    const doOtdSearch = () => {
      this.filter.keyword = searchInput.value.trim();
      this.pageLimit = INITIAL_PAGE;
      this.renderList();
    };
    searchInput.addEventListener("input", () => {
      if (this.searchTimer !== null) window.clearTimeout(this.searchTimer);
      this.searchTimer = window.setTimeout(doOtdSearch, 180);
    });

    // —— 右侧操作按钮 ——
    const actions = bar.createDiv("flomo-otd-actions");

    // 换一批
    const shuffleBtn = actions.createEl("button", {
      cls: "flomo-otd-action-btn",
      attr: { type: "button", title: $t("auto.235") },
    });
    setIcon(shuffleBtn, "shuffle");
    shuffleBtn.createSpan({ text: $t("u.20733") });
    shuffleBtn.addEventListener("click", () => this.handleOtdShuffle());

    // 重置
    const resetBtn = actions.createEl("button", {
      cls: "flomo-otd-action-btn",
      attr: { type: "button", title: $t("auto.291") },
    });
    setIcon(resetBtn, "rotate-cw");
    resetBtn.createSpan({ text: $t("u.20734") });
    resetBtn.addEventListener("click", () => this.handleOtdReset());

    // 回到往年今天
    const backBtn = actions.createEl("button", {
      cls: "flomo-otd-action-btn",
      attr: { type: "button", title: $t("auto.293") },
    });
    setIcon(backBtn, "clock");
    backBtn.createSpan({ text: $t("u.20735") });
    backBtn.addEventListener("click", () => this.handleOtdBackToToday());
  }

  /** 获取回顾视图可用的年份列表 */
  private getOtdAvailableYears(): string[] {
    const all = this.store.getAll();
    const mo = String(new Date().getMonth() + 1).padStart(2, "0");
    const day = String(new Date().getDate()).padStart(2, "0");
    const mmdd = `${mo}-${day}`;
    const years = new Set<string>();
    for (const m of all) {
      if (m.date.slice(5) === mmdd && m.date.slice(0, 4) !== new Date().getFullYear().toString()) {
        years.add(m.date.slice(0, 4));
      }
    }
    return [...years].sort((a, b) => (a < b ? 1 : -1));
  }

  /** 获取回顾视图可用的标签列表 */
  private getOtdAvailableTags(): string[] {
    const all = this.store.getAll();
    const mo = String(new Date().getMonth() + 1).padStart(2, "0");
    const day = String(new Date().getDate()).padStart(2, "0");
    const mmdd = `${mo}-${day}`;
    const tagSet = new Set<string>();
    for (const m of all) {
      if (m.date.slice(5) === mmdd && m.date.slice(0, 4) !== new Date().getFullYear().toString()) {
        for (const t of m.tags) tagSet.add(t);
      }
    }
    return [...tagSet].sort();
  }

  /** 计算筛选池大小（基础回顾筛选结果数，不含随机排序） */
  private getOtdPoolCount(): number {
    const all = this.store.getAll();
    const todayStr = fmtDateLocal(new Date());
    const mo = String(new Date().getMonth() + 1).padStart(2, "0");
    const day = String(new Date().getDate()).padStart(2, "0");
    const mmdd = `${mo}-${day}`;
    let pool = all.filter(
      (m) => m.date.slice(5) === mmdd && m.date !== todayStr
    );
    if (this.filter.otdYearFilter) {
      pool = pool.filter((m) => m.date.startsWith(this.filter.otdYearFilter!));
    }
    if (this.filter.otdTagFilter) {
      pool = pool.filter((m) =>
        m.tags.some((mt) => mt === this.filter.otdTagFilter || mt.startsWith(this.filter.otdTagFilter! + "/"))
      );
    }
    if (this.filter.otdTypeFilter !== "all") {
      pool = pool.filter((m) => {
        switch (this.filter.otdTypeFilter) {
          case "pinned": return m.isPinned;
          case "starred": return m.isStarred;
          case "todo": return /\[ \]/.test(m.content);
          case "image": return m.hasImage;
          case "link": return m.hasLink;
          default: return true;
        }
      });
    }
    if (this.filter.keyword) {
      const query = parseSearchQuery(this.filter.keyword);
      pool = pool.filter((m) => matchesQuery(m.content, m.tags, m.date, query));
    }
    return pool.length;
  }

  /** Fisher-Yates 洗牌算法（带种子，保证可复现） */
  private shuffleArray<T>(arr: T[], seed: number): T[] {
    const result = [...arr];
    let s = seed;
    const random = () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [result[i], result[j]] = [result[j]!, result[i]!];
    }
    return result;
  }

  /** "换一批"：重新生成随机种子，在回顾视图中切换"今天"日期模式与随机模式 */
  private handleOtdShuffle(): void {
    // 如果当前不在随机模式，且有回顾筛选条件，清除筛选后进入随机模式
    if (this.filter.randomSeed === 0) {
      this.filter.otdYearFilter = null;
      this.filter.otdTagFilter = null;
      this.filter.otdTypeFilter = "all";
      this.filter.keyword = "";
      if (this.searchEl) this.searchEl.value = "";
    }
    this.filter.randomSeed = Date.now();
    this.renderList();
  }

  /** "重置"：清除所有回顾视图的筛选条件 */
  private handleOtdReset(): void {
    this.filter.otdYearFilter = null;
    this.filter.otdTagFilter = null;
    this.filter.otdTypeFilter = "all";
    this.filter.keyword = "";
    this.filter.randomSeed = 0;
    if (this.searchEl) this.searchEl.value = "";
    this.pageLimit = INITIAL_PAGE;
    this.renderList();
  }

  /** "回到往年今天"：重置筛选但保留在回顾视图 */
  private handleOtdBackToToday(): void {
    this.filter.otdYearFilter = null;
    this.filter.otdTagFilter = null;
    this.filter.otdTypeFilter = "all";
    this.filter.keyword = "";
    this.filter.randomSeed = 0;
    if (this.searchEl) this.searchEl.value = "";
    this.pageLimit = INITIAL_PAGE;
    this.renderList();
  }

  /** 渲染随机 N 条笔记（用于空状态时的"随机 5 条"按钮） */
  private renderRandomMemos(count: number): void {
    // 不直接操作 DOM，改为设置 filter 状态让 renderList 走正常流程
    // 使用 randomSeed > 0 + keyword 为空 来标记"随机模式"
    this.filter.randomSeed = Date.now();
    this.filter.keyword = "";
    if (this.searchEl) this.searchEl.value = "";
    this.pageLimit = count;
    this.renderList();
  }

  private renderList(): void {
    const list = this.listEl;
    const root = this.rootEl;
    if (!list || !root) return;

    // 数据刷新时顺带重建左栏（统计/热力图/视图计数等），让数字与热力图同步最新数据。
    this.refreshSidebar(root);

    list.empty();
    this.childComponent.unload();
    this.childComponent = new Component();

    // 根据密度添加 class
    if (this.density === "compact") {
      list.addClass("is-compact");
    } else {
      list.removeClass("is-compact");
    }

    const flomos = this.getFilteredFlomos();

    // —— 回顾视图：先渲染筛选栏，再渲染分组标题
    if (this.filter.preset === "on-this-day") {
      this.buildOtdFilterBar(list);
    }

    // —— 顶部分组标题（根据当前预设视图动态显示，复刻原项目 UI）
    // 随机模式下，分组标题显示"随机挑选的 N 条"
    if (this.filter.preset === "on-this-day" && this.filter.randomSeed > 0) {
      const randomHead = list.createDiv("flomo-day-head");
      const ic = randomHead.createSpan("flomo-preset-head-icon");
      setIcon(ic, "shuffle");
      randomHead.createSpan({
        text: `随机挑选的 ${flomos.length} 条旧笔记`,
      });
    } else {
      this.renderPresetGroupHeader(list, flomos.length);
    }

    if (flomos.length === 0) {
      this.renderPresetEmpty(list);
      return;
    }

    const visible = flomos.slice(0, this.pageLimit);
    const normalMemos = visible;

    const groups = new Map<string, Flomo[]>();
    for (const m of normalMemos) {
      const arr = groups.get(m.date) ?? [];
      arr.push(m);
      groups.set(m.date, arr);
    }

    const todayStr = fmtDateLocale(new Date());
    const yd = new Date();
    yd.setDate(yd.getDate() - 1);
    const yesterdayStr = fmtDateLocale(yd);

    for (const [date, arr] of groups) {
      const group = list.createDiv("flomo-day-group");
      group.dataset.date = date;
      const head = group.createDiv("flomo-day-head");
      const d = new Date(date + "T00:00:00");
      const wd = "日一二三四五六"[d.getDay()];
      let label = `${date} 周${wd}`;
      if (date === todayStr) label = `今天 周${wd}`;
      else if (date === yesterdayStr) label = `昨天 周${wd}`;
      head.setText(label);
      for (const m of arr) this.renderFlomoCard(group, m);
    }

    if (this.pageLimit < flomos.length) {
      list.createDiv({
        cls: "flomo-load-more",
        text: `还有 ${flomos.length - this.pageLimit} 条 · 向下滚动加载`,
      });
    }

    this.bindListScroll(root);
  }

  private bindListScroll(root: HTMLElement): void {
    const list = this.listEl;
    if (!list) return;
    if (root.dataset.memSpeedBound === "1") return;
    root.dataset.memSpeedBound = "1";
    list.addEventListener("scroll", () => {
      if (list.scrollTop + list.clientHeight >= list.scrollHeight - 200) {
        const all = this.getFilteredFlomos();
        if (this.pageLimit < all.length) {
          const prev = this.pageLimit;
          this.pageLimit += INITIAL_PAGE;
          this.appendMoreFlomos(all.slice(prev, this.pageLimit));
        }
      }
    });
  }

  private appendMoreFlomos(slice: Flomo[]): void {
    const list = this.listEl;
    if (!list) return;
    const normal = slice.filter((m) => !m.isPinned);
    if (normal.length === 0) {
      this.renderList();
      return;
    }
    // 移除旧的 load-more 与 empty
    list.querySelector(".flomo-load-more")?.remove();
    list.querySelector(".flomo-empty")?.remove();

    const groups = new Map<string, Flomo[]>();
    for (const m of normal) {
      const arr = groups.get(m.date) ?? [];
      arr.push(m);
      groups.set(m.date, arr);
    }

    const allGroups = list.querySelectorAll<HTMLElement>(
      ".flomo-day-group:not(.flomo-pin-group)"
    );
    const lastGroup = allGroups.length ? allGroups[allGroups.length - 1] : null;
    const lastDate = lastGroup?.dataset.date ?? null;

    let first = true;
    for (const [date, arr] of groups) {
      if (first && lastGroup && date === lastDate) {
        for (const m of arr) this.renderFlomoCard(lastGroup, m);
      } else {
        const group = list.createDiv("flomo-day-group");
        group.dataset.date = date;
        const head = group.createDiv("flomo-day-head");
        const d = new Date(date + "T00:00:00");
        const wd = "日一二三四五六"[d.getDay()];
        head.setText(`${date} 周${wd}`);
        for (const m of arr) this.renderFlomoCard(group, m);
      }
      first = false;
    }

    const all = this.getFilteredFlomos();
    if (this.pageLimit < all.length) {
      list.createDiv({
        cls: "flomo-load-more",
        text: `还有 ${all.length - this.pageLimit} 条 · 向下滚动加载`,
      });
    }
  }

  /* ---- 卡片渲染 ---- */
  private renderFlomoCard(parent: HTMLElement, flomo: Flomo): void {
    const card = parent.createDiv(
      "flomo-card" +
        (flomo.isPinned ? " is-pinned" : "") +
        (flomo.isStarred ? " is-starred" : "") +
        (this.editingMemo === flomo ? " is-editing" : "")
    );

    // 双击进入编辑
    card.addEventListener("dblclick", (e) => {
      const t = e.target as HTMLElement;
      if (t.closest("a")) return;
      this.enterEditMode(flomo);
    });

    // 长按进入编辑（移动端）
    if (Platform.isMobile) {
      let pm: number | null = null;
      let sx = 0;
      let sy = 0;
      const cancel = () => {
        if (pm !== null) {
          window.clearTimeout(pm);
          pm = null;
        }
      };
      card.addEventListener("pointerdown", (e) => {
        const t = e.target as HTMLElement;
        if (t.closest("a") || t.closest("button")) return;
        const start = e;
        sx = start.clientX;
        sy = start.clientY;
        pm = window.setTimeout(() => {
          pm = null;
          this.enterEditMode(flomo);
        }, 500);
      });
      card.addEventListener("pointermove", (e) => {
        if (pm === null) return;
        const p = e;
        if (Math.abs(p.clientX - sx) > 6 || Math.abs(p.clientY - sy) > 6) cancel();
      });
      card.addEventListener("pointerup", cancel);
      card.addEventListener("pointercancel", cancel);
      card.addEventListener("pointerleave", cancel);
    }

    // 卡片头部：置顶/收藏标记 + 时间 + 右上角操作
    const head = card.createDiv("flomo-card-head");
    const timeWrap = head.createDiv("flomo-card-time-wrap");
    if (flomo.isPinned) {
      const pinIcon = timeWrap.createSpan("flomo-card-pin");
      setIcon(pinIcon, "pin");
    }
    if (flomo.isStarred) {
      const starIcon = timeWrap.createSpan("flomo-card-star");
      setIcon(starIcon, "star");
    }
    timeWrap.createSpan({ cls: "flomo-card-time", text: `${flomo.date} ${flomo.time}` });

    const actions = head.createDiv("flomo-card-actions");
    const menuBtn = actions.createEl("button", {
      cls: "astra-icon-btn",
      attr: { type: "button", "aria-label": "更多" },
    });
    setIcon(menuBtn, "more-horizontal");
    menuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.showFlomoMenu(e, flomo);
    });

    // 正文：剥离标签后渲染 markdown，标签以胶囊显示
    const { text, tags } = this.stripTags(flomo.content);

    if (text.trim()) {
      const body = card.createDiv("flomo-card-body");
      const normalizedMd = normalizeForRender(text);
      void MarkdownRenderer.render(
        this.app,
        normalizedMd,
        body,
        flomo.file,
        this.childComponent
      )
        .catch(() => {
          body.setText(text);
        });
      // 搜索高亮
      if (this.currentQuery.includeTerms.length > 0) {
        this.highlightTerms(body, this.currentQuery.includeTerms);
      }
    }

    const visibleTags = tags.filter((t) => !RESERVED_TAGS.has(t));
    if (visibleTags.length) {
      const tagRow = card.createDiv("flomo-card-tags");
      for (const t of visibleTags) {
        const pill = tagRow.createSpan({ cls: "flomo-tag-pill", text: `#${t}` });
        pill.addEventListener("click", () => {
          this.filter.tag = t;
          this.filter.keyword = "";
          if (this.searchEl) this.searchEl.value = "";
          this.pageLimit = INITIAL_PAGE;
          this.renderList();
        });
      }
    }
  }

  private stripTags(content: string): { text: string; tags: string[] } {
    const tags: string[] = [];
    const text = content.replace(
      /[ \t]*#([A-Za-z0-9_\u4e00-\u9fff][A-Za-z0-9_\u4e00-\u9fff/]*)/g,
      (_m, g1: string) => {
        if (!tags.includes(g1)) tags.push(g1);
        return "";
      }
    );
    return {
      text: text
        .split("\n")
        .map((l) => l.replace(/\s+$/, ""))
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim(),
      tags,
    };
  }

  private highlightTerms(el: HTMLElement, includeTerms: string[]): void {
    const walker = document.createTreeWalker(
      el,
      NodeFilter.SHOW_TEXT,
      { acceptNode: (n) => (n.nodeValue && n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) }
    );
    const nodes: Text[] = [];
    let n: Node | null;
    while ((n = walker.nextNode())) nodes.push(n as Text);
    for (const node of nodes) {
      const hits: { start: number; end: number }[] = [];
      const lower = node.textContent.toLowerCase();
      for (const term of includeTerms) {
        const tl = term.toLowerCase();
        let idx = lower.indexOf(tl);
        while (idx !== -1) {
          hits.push({ start: idx, end: idx + term.length });
          idx = lower.indexOf(tl, idx + 1);
        }
      }
      if (!hits.length) continue;
      hits.sort((a, b) => a.start - b.start || b.end - a.end);
      const merged: { start: number; end: number }[] = [];
      for (const h of hits) {
        const last = merged[merged.length - 1];
        if (last && h.start <= last.end) {
          if (h.end > last.end) last.end = h.end;
        } else {
          merged.push({ ...h });
        }
      }
      const frag = createFragment();
      let cursor = 0;
      for (const h of merged) {
        if (h.start > cursor) frag.append(node.textContent.slice(cursor, h.start));
        const mark = el.createSpan("flomo-search-hit");
        mark.setText(node.textContent.slice(h.start, h.end));
        frag.append(mark);
        cursor = h.end;
      }
      if (cursor < node.textContent.length) frag.append(node.textContent.slice(cursor));
      node.replaceWith(frag);
    }
  }

  /* ---- 右键/更多菜单 ---- */
  private showFlomoMenu(evt: MouseEvent, flomo: Flomo): void {
    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle(flomo.isPinned ? "取消置顶" : "置顶")
        .setIcon(flomo.isPinned ? "pin-off" : "pin")
        .onClick(async () => {
          await this.store.togglePinned(flomo);
          new Notice(flomo.isPinned ? "已取消置顶" : "已置顶");
        })
    );
    menu.addItem((item) =>
      item
        .setTitle(flomo.isStarred ? "取消收藏" : "收藏")
        .setIcon(flomo.isStarred ? "star-off" : "star")
        .onClick(async () => {
          await this.store.toggleStarred(flomo);
          new Notice(flomo.isStarred ? "已取消收藏" : "已收藏");
        })
    );
    menu.addSeparator();
    menu.addItem((item) =>
      item.setTitle($t("p4.10007")).setIcon("pencil").onClick(() => this.enterEditMode(flomo))
    );
    menu.addItem((item) =>
      item
        .setTitle($t("p4.10048"))
        .setIcon("file-text")
        .onClick(() => void this.app.workspace.openLinkText(flomo.file, flomo.file, true))
    );
    menu.addItem((item) =>
      item
        .setTitle($t("p4.10049"))
        .setIcon("copy")
        .onClick(async () => {
          await navigator.clipboard.writeText(flomo.content);
          new Notice($t("dv.flomo.copied"));
        })
    );
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle($t("set.remaining.758"))
        .setIcon("trash")
        .onClick(() => void this.confirmDelete(flomo))
    );
    menu.showAtMouseEvent(evt);
  }

  private async confirmDelete(flomo: Flomo): Promise<void> {
    const body = this.rootEl?.doc?.body ?? document.body;
    const backdrop = body.createDiv("flomo-modal-backdrop");
    const box = backdrop.createDiv("flomo-modal flomo-confirm");
    box.createDiv({ cls: "flomo-modal-title", text: $t("auto.305") });
    const btns = box.createDiv("flomo-modal-btns");
    const cancel = btns.createEl("button", { text: $t("dv.cancel") });
    const ok = btns.createEl("button", {
      text: $t("set.remaining.758"),
      cls: "mod-warning",
    });
    const closeModal = (): void => backdrop.remove();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeModal();
      }
    };
    window.addEventListener("keydown", onKey, true);
    cancel.addEventListener("click", () => {
      window.removeEventListener("keydown", onKey, true);
      closeModal();
    });
    ok.addEventListener("click", () => {
      window.removeEventListener("keydown", onKey, true);
      closeModal();
      void this.store
        .deleteFlomo(flomo)
        .then(() => new Notice($t("dv.flomo.deleted")))
        .catch(() => {
          new Notice($t("p4.10050"));
        });
    });
    // 点击蒙版外层关闭
    backdrop.addEventListener("pointerdown", (e) => {
      if (e.target === backdrop) {
        window.removeEventListener("keydown", onKey, true);
        closeModal();
      }
    });
  }

  /* ========== 输入框工具栏工具方法（复刻 obsidian-memoria-main/src/view.ts） ========== */

  /** 在光标处插入文本（保留选区 / 保留 undo stack） */
  private insertAtCursor(text: string): void {
    const el = this.inputEl;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    if (start !== end) {
      // 有选区：把选中文本保留下来（插在 text 后面），不丢失用户内容
      const selected = el.value.slice(start, end);
      replaceTextareaRange(el, start, end, text + selected);
    } else {
      replaceTextareaRange(el, start, end, text);
    }
    el.focus();
    this.autoGrow(el);
  }

  /** 在光标处插入列表前缀（支持选区多行包装） */
  private insertListAtCursor(prefix: string): void {
    const el = this.inputEl;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    if (start !== end) {
      // 有选区：把选中文本按行拆开，每行加前缀
      const selected = el.value.slice(start, end);
      const lines = selected.split("\n");
      const wrapped = lines.map((ln) => `${prefix}${ln}`).join("\n");
      const before = el.value.slice(0, start);
      const atLineStart = start === 0 || before.endsWith("\n");
      const finalText = atLineStart ? wrapped : `\n${wrapped}`;
      replaceTextareaRange(el, start, end, finalText);
      el.focus();
      this.autoGrow(el);
      return;
    }
    // 无选区：在当前行首插入
    const before = el.value.slice(0, start);
    const atLineStart = start === 0 || before.endsWith("\n");
    this.insertAtCursor(atLineStart ? prefix : `\n${prefix}`);
  }

  /** 插入有序列表（自动计算序号 + 支持选区多行） */
  private insertOrderedListAtCursor(): void {
    const el = this.inputEl;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    if (start !== end) {
      // 有选区：每行加递增序号
      const selected = el.value.slice(start, end);
      const lines = selected.split("\n");
      const wrapped = lines.map((ln, i) => `${i + 1}. ${ln}`).join("\n");
      const before = el.value.slice(0, start);
      const atLineStart = start === 0 || before.endsWith("\n");
      const finalText = atLineStart ? wrapped : `\n${wrapped}`;
      replaceTextareaRange(el, start, end, finalText);
      el.focus();
      this.autoGrow(el);
      return;
    }
    // 无选区：向上扫描连续有序列表，自动 +1
    const before = el.value.slice(0, start);
    const atLineStart = start === 0 || before.endsWith("\n");
    const trimmedBefore = atLineStart
      ? before.replace(/\n$/, "")
      : before;
    const lines = trimmedBefore.split("\n");
    const olRe = /^(\d+)\.\s/;
    let nextNum = 1;
    for (let i = lines.length - 1; i >= 0; i--) {
      const ln = lines[i]!;
      if (ln.trim() === "") break;
      const m = ln.match(olRe);
      if (m) {
        nextNum = parseInt(m[1]!, 10) + 1;
        break;
      }
      break;
    }
    const prefix = `${nextNum}. `;
    this.insertAtCursor(atLineStart ? prefix : `\n${prefix}`);
  }

  /** 表格选择器（6×6 网格 picker，hover 预览 + click 插入） */
  private showTablePicker(anchor: HTMLElement): void {
    // 若已有弹层则关闭
    const existing = document.querySelector(".flomo-table-picker");
    if (existing) {
      existing.remove();
      return;
    }

    const MAX = Platform.isMobile ? 5 : 6;
    const pop = document.body.createDiv({
      cls: "flomo-table-picker" + (Platform.isMobile ? " is-mobile" : ""),
    });

    const label = pop.createDiv({
      cls: "flomo-table-picker-label",
      text: Platform.isMobile ? "点击格子直接插入" : "0 × 0",
    });

    const grid = pop.createDiv({ cls: "flomo-table-picker-grid" });
    const cells: HTMLElement[][] = [];
    for (let r = 0; r < MAX; r++) {
      cells[r] = [];
      for (let c = 0; c < MAX; c++) {
        const cell = grid.createDiv({ cls: "flomo-table-picker-cell" });
        cell.dataset.row = String(r);
        cell.dataset.col = String(c);
        if (Platform.isMobile) {
          cell.createSpan({
            cls: "flomo-table-picker-cell-text",
            text: `${r + 1}×${c + 1}`,
          });
        }
        cells[r]![c] = cell;
      }
    }

    let selR = 0;
    let selC = 0;
    const updateHighlight = (r: number, c: number) => {
      selR = r;
      selC = c;
      for (let i = 0; i < MAX; i++) {
        for (let j = 0; j < MAX; j++) {
          cells[i]![j]!.toggleClass("is-active", i <= r && j <= c);
        }
      }
      label.setText(`${r + 1} × ${c + 1}`);
    };

    if (!Platform.isMobile) {
      grid.addEventListener("mouseover", (e) => {
        const t = e.target as HTMLElement;
        if (!t.hasClass("flomo-table-picker-cell")) return;
        const r = parseInt(t.dataset.row ?? "0", 10);
        const c = parseInt(t.dataset.col ?? "0", 10);
        updateHighlight(r, c);
      });
      grid.addEventListener("click", (e) => {
        const t = e.target as HTMLElement;
        if (!t.hasClass("flomo-table-picker-cell")) return;
        this.insertTable(selR + 1, selC + 1);
        pop.remove();
      });
    } else {
      grid.addEventListener("click", (e) => {
        let t = e.target as HTMLElement;
        if (!t.hasClass("flomo-table-picker-cell")) {
          t = t.closest(".flomo-table-picker-cell") as HTMLElement;
        }
        if (!t) return;
        const r = parseInt(t.dataset.row ?? "0", 10);
        const c = parseInt(t.dataset.col ?? "0", 10);
        this.insertTable(r + 1, c + 1);
        pop.remove();
      });
    }

    // 定位到按钮下方
    const rect = anchor.getBoundingClientRect();
    pop.style.top = `${rect.bottom + window.scrollY + 6}px`;
    pop.style.left = `${rect.left + window.scrollX}px`;
    document.body.appendChild(pop);

    // 点击外部关闭
    window.setTimeout(() => {
      const onDocClick = (ev: MouseEvent) => {
        if (!pop.contains(ev.target as Node)) {
          pop.remove();
          document.removeEventListener("click", onDocClick, true);
        }
      };
      document.addEventListener("click", onDocClick, true);
    }, 0);
  }

  /** 在光标位置插入一个 rows × cols 的空 md 表格模板 */
  private insertTable(rows: number, cols: number): void {
    const header = "| " + Array(cols).fill("  ").join(" | ") + " |";
    const sep = "| " + Array(cols).fill("--").join(" | ") + " |";
    const body = Array(Math.max(0, rows - 1))
      .fill(null)
      .map(() => "| " + Array(cols).fill("  ").join(" | ") + " |");
    const lines = [header, sep, ...body];

    const el = this.inputEl;
    if (!el) return;
    let prefix = "";
    let suffix = "\n";
    const val = el.value;
    const start = el.selectionStart ?? val.length;
    const beforeChar = val.slice(0, start);
    if (beforeChar.length > 0 && !beforeChar.endsWith("\n\n")) {
      prefix = beforeChar.endsWith("\n") ? "\n" : "\n\n";
    }
    const afterChar = val.slice(start);
    if (afterChar && !afterChar.startsWith("\n")) {
      suffix = "\n\n";
    }
    this.insertAtCursor(prefix + lines.join("\n") + suffix);
  }

  /** 用浏览器 file picker 选图片 */
  private pickImageFromDisk(): void {
    this.disposeImagePicker();

    const inp = createEl("input");
    inp.type = "file";
    inp.accept = "image/*";
    inp.multiple = true;
    inp.tabIndex = -1;
    inp.className = "flomo-image-picker";
    inp.setAttribute("aria-hidden", "true");

    inp.addEventListener("change", () => {
      const files = Array.from(inp.files ?? []);
      this.disposeImagePicker(inp);
      void this.importSelectedImages(files).catch(() => {
        new Notice($t("p4.10051"));
      });
    }, { once: true });
    inp.addEventListener("cancel", () => {
      this.disposeImagePicker(inp);
    }, { once: true });

    document.body.appendChild(inp);
    this.imagePickerEl = inp;
    inp.value = "";
    inp.click();
  }

  private disposeImagePicker(inp: HTMLInputElement | null = this.imagePickerEl): void {
    if (!inp) return;
    if (this.imagePickerEl === inp) this.imagePickerEl = null;
    inp.remove();
  }

  private async importSelectedImages(files: File[]): Promise<void> {
    for (const file of files) {
      await this.handleImageFile(file);
    }
  }

  /** 把一张图片保存到附件目录，并把 wikilink 引用插入输入框 */
  private async handleImageFile(file: File): Promise<void> {
    try {
      const ext = (file.name.split(".").pop() || "png").toLowerCase();
      const buf = await file.arrayBuffer();
      const path = await this.saveImageAttachment(buf, ext);
      const fileName = path.split("/").pop() ?? path;
      const ref = `![[${fileName}]]`;
      if (this.inputEl?.value && !/\n$/.test(this.inputEl.value)) {
        this.insertAtCursor("\n" + ref + "\n");
      } else {
        this.insertAtCursor(ref + "\n");
      }
      new Notice(`图片已保存: ${fileName}`);
    } catch (e) {
      new Notice(`图片保存失败: ${(e as Error).message}`);
    }
  }

  /** 保存二进制图片到附件目录（附件目录默认与快速捕获文件同目录下的 attachments/） */
  private async saveImageAttachment(
    bytes: ArrayBuffer,
    extension: string
  ): Promise<string> {
    // 附件目录：快速捕获文件同级目录下的 attachments/
    const filePath = this.outFilePath;
    const lastSlash = filePath.lastIndexOf("/");
    const baseDir = lastSlash > 0 ? filePath.slice(0, lastSlash) : "";
    const folder = normalizePath(
      baseDir ? `${baseDir}/attachments` : "attachments"
    );

    // 确保目录存在
    const exists = this.app.vault.getAbstractFileByPath(folder);
    if (!exists) {
      await this.app.vault.createFolder(folder);
    }

    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, "0");
    const stamp =
      now.getFullYear().toString() +
      pad(now.getMonth() + 1) +
      pad(now.getDate()) +
      "-" +
      pad(now.getHours()) +
      pad(now.getMinutes()) +
      pad(now.getSeconds());
    const rand = Math.random().toString(36).slice(2, 6);
    const ext = (extension || "png").replace(/^\./, "").toLowerCase();
    const path = `${folder}/flomo-${stamp}-${rand}.${ext}`;
    await this.app.vault.createBinary(path, bytes);
    return path;
  }
}

/** 为 MarkdownRenderer 预处理块级语法（标题/表格/代码块/分隔线/callout）前后补空行 */
function normalizeForRender(raw: string): string {
  const lines = raw.split("\n");
  const out: string[] = [];
  let inFence = false;

  const isTableLine = (s: string) => /^\s*\|.*\|\s*$/.test(s);
  const isHeading = (s: string) => /^#{1,6}\s/.test(s);
  const isHr = (s: string) => /^\s*(?:---|\*\*\*|___)\s*$/.test(s);
  const isCallout = (s: string) => /^\s*>/.test(s);
  const isFence = (s: string) => /^\s*(?:```|~~~)/.test(s);

  const lastNonEmpty = (): string => {
    for (let i = out.length - 1; i >= 0; i--) {
      if (out[i]!.trim() !== "") return out[i]!;
    }
    return "";
  };
  const pushBlank = (): void => {
    if (out.length > 0 && out[out.length - 1]!.trim() !== "") out.push("");
  };

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]!;
    const prev = i > 0 ? lines[i - 1]! : "";
    const next = i < lines.length - 1 ? lines[i + 1]! : "";

    if (isFence(ln) && !inFence) {
      pushBlank();
      out.push(ln);
      inFence = true;
      continue;
    }
    if (inFence) {
      out.push(ln);
      if (isFence(ln)) {
        inFence = false;
        if (next.trim() !== "") out.push("");
      }
      continue;
    }
    if (isHeading(ln)) {
      pushBlank();
      out.push(ln);
      if (next.trim() !== "") out.push("");
      continue;
    }
    if (isHr(ln) && prev.trim() !== "" && !isHeading(lastNonEmpty())) {
      pushBlank();
      out.push(ln);
      if (next.trim() !== "") out.push("");
      continue;
    }
    if (isTableLine(ln) && prev.trim() !== "" && !isTableLine(prev)) {
      pushBlank();
      out.push(ln);
      continue;
    }
    if (isTableLine(ln)) {
      out.push(ln);
      if (next.trim() !== "" && !isTableLine(next)) out.push("");
      continue;
    }
    if (isCallout(ln) && prev.trim() !== "" && !isCallout(prev)) {
      pushBlank();
      out.push(ln);
      continue;
    }
    out.push(ln);
  }
  return out.join("\n");
}