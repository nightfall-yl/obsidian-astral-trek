import { t as $t, getLocaleCode } from "./i18n";
import {
  Menu,
  Notice,
  TFile,
  TFolder,
  setIcon
} from "obsidian";
import type { App, EventRef } from "obsidian";
import type AstraDashboardPlugin from "./main";
import { confirmDialog } from "./confirm-modal";
import { TaskStore } from "./data/taskStore";
import { computeWindow, filterWithOrig } from "./data/virtualList";
import { fmtDate, nowFmt, calcNextRemindDate } from "./data/taskLogic";
import { priorityWeight } from "./data/taskParseCore";
import { STATUS_LIST } from "./data/taskParser";
import type { TaskItem, ProjectInfo, TaskStatus } from "./data/taskParser";
import { writeFrontmatter, yamlScalar } from "./data/frontmatterWriter";
import { TaskEditModal } from "./task-edit-modal";
import { TaskModal, type TaskFormData } from "./task-modal";
import { ProjectModal, type ProjectFormData } from "./project-modal";
import { createTaskFile as createTaskFileShared } from "./data/taskFileCreator";

/** setViewState 传入的 state：用于从首页项目卡片跳转到指定项目甘特。 */
export interface ProjectBoardState {
  selectedProject?: string | null;
}

type GanttZoom = "day" | "week" | "month" | "quarter";

/** 甘特图 SVG 命名空间 */
const SVGNS = "http://www.w3.org/2000/svg";

/**
 * 全部项目面板：从 obsidian-dashboard-main 的 ProjectBoard 迁移而来。
 * 不新开标签页，由宿主容器（Dashboard 视图）内嵌渲染。
 * 含左侧项目侧栏 + 甘特 / 列表 / 日历 / 看板 标签页。
 * 所有 host 回调替换为 astra 内自有实现。
 */
export class ProjectBoardPanel {
  private plugin: AstraDashboardPlugin;
  private taskStore: TaskStore;

  // ---- 视图实例状态（甘特/列表共用） ----
  private currentProjects: ProjectInfo[] = [];
  private currentTasks: TaskItem[] = [];
  private currentView = "gantt";
  private selectedProject: string | null = null;
  private sortCol = "";
  private sortDir: "asc" | "desc" = "asc";
  private taskListFilter = "all";
  private collapsedParents: Set<string> = new Set();
  private highlightedBar: Element | null = null;
  private highlightedRow: HTMLElement | null = null;
  private ganttZoom: GanttZoom = "week";
  private ganttStatusFilter: TaskStatus[] = [];
  private calYear: number;
  private calMonth: number;

  private poMainEl: HTMLElement | null = null;
  private refreshTimer: number | null = null;
  private renderDisposers: Array<() => void> = [];

  constructor(
    private hostEl: HTMLElement,
    plugin: AstraDashboardPlugin
  ) {
    this.plugin = plugin;
    this.taskStore = new TaskStore(
      this.app,
      () => ({
        projectsFolder: this.plugin.data.settings.projectsFolder,
        npdpStages: this.plugin.data.settings.npdpStages
      }),
      (msg) => {
        if (msg) new Notice(msg);
      }
    );
  }

  private get app(): App {
    return this.plugin.app;
  }

  private boardVaultEvents: EventRef[] | null = null;

  /**
   * 打开看板面板并渲染到宿主容器。
   * @param selectedProject 传入则定位到该项目（保留选择）；null 时回到「全部项目」。
   */
  async open(selectedProject: string | null = null): Promise<void> {
    this.applySettings();
    this.selectedProject = selectedProject;
    this.registerBoardVaultEvents();
    await this.renderAll(selectedProject != null);
  }

  /** 释放面板资源并注销本面板注册的 vault 事件。 */
  destroy(): void {
    this.clearRenderResources();
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.boardVaultEvents?.forEach((ref) => this.app.vault.offref(ref));
    this.boardVaultEvents = null;
  }

  /** 仓内文件变化时刷新（复用共享扫描缓存语义，仅注册一次）。 */
  private registerBoardVaultEvents(): void {
    if (this.boardVaultEvents) return;
    const onVaultChange = (f: unknown): void => {
      if (f instanceof TFile) {
        this.taskStore.invalidate();
        this.scheduleRefresh();
      }
    };
    const refs = [
      this.app.vault.on("modify", onVaultChange),
      this.app.vault.on("create", onVaultChange),
      this.app.vault.on("delete", onVaultChange)
    ];
    this.boardVaultEvents = refs;
    for (const ref of refs) {
      this.plugin.registerEvent(ref);
    }
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      void this.renderAll(true);
    }, 300);
  }

  /** 把持久化的甘特设置读到实例状态。 */
  private applySettings(): void {
    const s = this.plugin.data.settings;
    this.currentView = s.currentPoView || "gantt";
    this.ganttZoom = s.poGanttScale || "week";
    this.ganttStatusFilter = (s.poGanttStatusFilter || []) as TaskStatus[];
    if (this.calYear === undefined) {
      const now = new Date();
      this.calYear = now.getFullYear();
      this.calMonth = now.getMonth();
    }
  }

  /** 全量渲染。preserveSelection=true 时保留选中项目；false 时回到「全部项目」。 */
  private async renderAll(preserveSelection: boolean): Promise<void> {
    this.clearRenderResources();
    try {
      const projects = await this.taskStore.scanAllProjects();
      const allTasks = await this.taskStore.scanAllTasks();
      this.hostEl.empty();
      this.hostEl.addClass("po-board-view");
      this.currentProjects = projects;
      this.currentTasks = allTasks;
      this.applyProjectOrder();
      this.applySettings();
      if (!preserveSelection) {
        this.selectedProject = null;
      }
      const container = this.hostEl.createDiv({ cls: "po-container" });
      const sidebar = container.createDiv({ cls: "po-sidebar" });
      this.renderSidebar(sidebar);
      this.poMainEl = container.createDiv({ cls: "po-main" });
      this.renderPanels();
    } catch {
      this.hostEl.empty();
      this.hostEl.addClass("po-board-view");
      this.hostEl.createDiv({ cls: "po-empty", text: $t("dv.empty") });
    }
  }

  /** 重绘主内容区（标签 + 面板）。 */
  private renderPanels(): void {
    if (!this.poMainEl) return;
    this.poMainEl.empty();

    const filteredTasks = this.selectedProject
      ? this.currentTasks.filter((t) => t.projectId === this.selectedProject)
      : this.currentTasks;

    const tabs = this.poMainEl.createDiv({ cls: "po-tabs" });
    const tabDefs = [
      { key: "gantt", label: $t("dv.pb.view.gantt"), icon: "gantt-chart" },
      { key: "list", label: $t("dv.pb.view.list"), icon: "list" },
      { key: "calendar", label: $t("set.remaining.757"), icon: "calendar" },
      { key: "kanban", label: $t("dv.pb.view.kanban"), icon: "layout-dashboard" }
    ] as const;
    const content = this.poMainEl.createDiv({ cls: "po-content" });
    const panels: Record<string, HTMLElement> = {};
    for (const td of tabDefs) {
      const btn = tabs.createEl("button", {
        cls: "po-tab" + (td.key === this.currentView ? " is-active" : "")
      });
      const tabGlyph = btn.createSpan({ cls: "po-tab__icon" });
      setIcon(tabGlyph, td.icon);
      btn.createSpan({ text: td.label });
      btn.dataset.view = td.key;
      panels[td.key] = content.createDiv({
        cls: "po-panel" + (td.key === this.currentView ? " is-active" : ""),
        attr: { "data-view": td.key }
      });
    }

    // 阶段项目顶部槽位（紧凑圆点）
    if (this.selectedProject) {
      const selProj = this.currentProjects.find(
        (p) => p.name === this.selectedProject
      );
      if (selProj && (selProj.type ?? "stage") === "stage") {
        this.renderStagePipeline(tabs);
      }
    }

    // 只渲染当前激活面板，其余标签懒加载
    this.renderPanel(this.currentView, panels[this.currentView]!, filteredTasks);

    this.listen(tabs, "click", (e) => {
      const btn = (e.target as HTMLElement).closest(".po-tab") as HTMLElement;
      if (!btn) return;
      const view = btn.dataset.view;
      if (!view) return;
      tabs.querySelectorAll(".po-tab").forEach((t) => t.removeClass("is-active"));
      btn.addClass("is-active");
      Object.values(panels).forEach((p) => p.classList.remove("is-active"));
      if (panels[view]) panels[view].addClass("is-active");
      this.currentView = view;
      this.plugin.data.settings.currentPoView = view;
      void this.plugin.saveSettings();
      if (panels[view]) this.renderPanel(view, panels[view], filteredTasks);
    });
  }

  /** 按 key 渲染单个面板。 */
  private renderPanel(key: string, panel: HTMLElement, tasks: TaskItem[]): void {
    panel.empty();
    try {
      if (key === "gantt") this.renderGanttPanel(panel, tasks, this.currentProjects);
      else if (key === "list") this.renderTaskTable(panel, "po-tb2", tasks, this.currentProjects);
      else if (key === "calendar") this.renderCalendarPanel(panel, tasks, this.currentProjects);
      else if (key === "kanban") this.renderKanbanPanel(panel, tasks, this.currentProjects);
    } catch {
      panel.createDiv({ cls: "po-empty", text: $t("dv.empty") });
    }
  }

  /** 阶段项目顶部紧凑圆点管道。 */
  private renderStagePipeline(container: HTMLElement): void {
    try {
      const proj = this.currentProjects.find((p) => p.name === this.selectedProject);
      if (!proj || (proj.type ?? "stage") !== "stage") return;
      const stages = this.plugin.data.settings.npdpStages;
      const currentStage = proj.stage ?? 0;

      const bar = container.createDiv({ cls: "ad-proj__stages po-stage-compact" });
      const stageMinW = Math.max(20, Math.min(36, Math.floor(160 / stages.length)));
      const gap = Math.max(1, Math.floor(4 / (stages.length / 4)));
      bar.style.gap = `${gap}px`;
      bar.style.setProperty("--pip-w", stageMinW + "px");
      bar.style.setProperty("--pip-gap", gap + "px");

      stages.forEach((label, i) => {
        // 点击哪个阶段，它及其之前的阶段都算"已完成"（前置圆点高亮）
        const isDone = i <= currentStage;
        const s = bar.createDiv({
          cls: "ad-proj__stage" + (isDone ? " is-done" : "")
        });
        s.style.width = stageMinW + "px";
        s.createSpan({ cls: "ad-pip" });
        s.appendText(label);
        this.listen(s, "click", () => void this.setProjectStage(proj, i));
      });
    } catch {
      /* 忽略 */
    }
  }

  /** 设置项目阶段并持久化。 */
  private async setProjectStage(proj: ProjectInfo, stage: number): Promise<void> {
    proj.stage = stage;
    const folderName = proj.path.split("/").pop() || proj.name;
    const projectFilePath = `${proj.path}/project-${folderName}.md`;
    const file = this.app.vault.getAbstractFileByPath(projectFilePath);
    if (file instanceof TFile) {
      await writeFrontmatter(this.app, file, { "阶段": String(stage) });
    }
    this.renderPanels();
    const sidebar = this.poMainEl?.closest(".po-container")?.querySelector(
      ".po-sidebar"
    ) as HTMLElement | undefined;
    if (sidebar) this.renderSidebar(sidebar);
    new Notice(`✨ ${proj.name} 阶段已更新为 "${this.plugin.data.settings.npdpStages[stage]}"`);
  }

  /** 渲染左侧项目侧栏（含拖拽排序 / 右键菜单）。 */
  private renderSidebar(sidebar: HTMLElement): void {
    sidebar.empty();
    const list = sidebar.createDiv({ cls: "po-sidebar__list" });

    const totalTasks = this.currentProjects.reduce((s, p) => s + p.taskCount, 0);
    const totalActive = this.currentProjects.reduce((s, p) => s + p.activeCount, 0);

    const allItem = list.createDiv({
      cls:
        "po-sidebar__item" + (this.selectedProject === null ? " is-active" : "")
    });
    allItem.createSpan({
      cls: "po-dot",
      attr: { style: "background:var(--astra-accent-blue);color:var(--astra-accent-blue)" }
    });
    allItem.createSpan({ text: $t("dv.pb.actions.allProjects") });
    allItem.createSpan({ cls: "po-count", text: totalActive + "/" + totalTasks });
    this.listen(allItem, "click", () => {
      this.selectedProject = null;
      this.renderSidebar(sidebar);
      this.renderPanels();
    });

    this.currentProjects.forEach((p) => {
      const item = list.createDiv({
        cls:
          "po-sidebar__item" + (this.selectedProject === p.name ? " is-active" : "")
      });
      item.createSpan({
        cls: "po-dot",
        attr: { style: "background:" + p.color + ";color:" + p.color }
      });
      item.createSpan({ text: p.name });
      item.createSpan({ cls: "po-count", text: p.activeCount + "/" + p.taskCount });
      this.listen(item, "click", () => {
        this.selectedProject = p.name;
        this.renderSidebar(sidebar);
        this.renderPanels();
      });
      // 右键菜单
      this.listen(item, "contextmenu", (e) => {
        e.preventDefault();
        const menu = new Menu();
        menu.addItem((menuItem) =>
          menuItem
            .setTitle($t("p4.10000"))
            .setIcon("file-text")
            .onClick(() => this.openProjectNote(p))
        );
        menu.addItem((menuItem) =>
          menuItem
            .setTitle($t("dv.pb.actions.deleteProject"))
            .setIcon("trash")
            .onClick(() => void this.deleteProject(p))
        );
        menu.showAtMouseEvent(e);
      });
      // 拖拽排序项目
      item.draggable = true;
      item.dataset.projIdx = String(this.currentProjects.indexOf(p));
      this.listen(item, "dragstart", (e) => {
        e.dataTransfer?.setData("text/proj-idx", String(this.currentProjects.indexOf(p)));
        item.addClass("po-sidebar__item--dragging");
      });
      this.listen(item, "dragend", () => item.removeClass("po-sidebar__item--dragging"));
      this.listen(item, "dragover", (e) => {
        e.preventDefault();
        item.addClass("po-sidebar__item--drag-over");
      });
      this.listen(item, "dragleave", () => item.removeClass("po-sidebar__item--drag-over"));
      this.listen(item, "drop", (e) => {
        e.preventDefault();
        item.removeClass("po-sidebar__item--drag-over");
        // 跨项目移动：从列表/甘特「任务名称」行拖来的任务
        const taskId = e.dataTransfer?.getData("text/task-id");
        if (taskId) {
          void this.moveTaskToProject(taskId, p.name);
          return;
        }
        const fromIdx = parseInt(e.dataTransfer?.getData("text/proj-idx") || "-1");
        const toIdx = this.currentProjects.indexOf(p);
        if (fromIdx < 0 || fromIdx === toIdx) return;
        const moved = this.currentProjects.splice(fromIdx, 1)[0];
        if (moved) {
          const insertAt = fromIdx < toIdx ? toIdx - 1 : toIdx;
          this.currentProjects.splice(insertAt, 0, moved);
        }
        this.renderSidebar(sidebar);
        this.renderPanels();
        this.plugin.data.settings.poProjectOrder = this.currentProjects.map(
          (pp) => pp.name
        );
        void this.plugin.saveSettings();
      });
    });

    const addBtn = sidebar.createEl("button", {
      cls: "po-add-btn",
      text: $t("dv.pb.actions.newProject")
    });
    this.listen(addBtn, "click", () => this.createProjectFile());
  }

  /** 把某个任务文件移动到目标项目文件夹（跨项目 drag）。 */
  private async moveTaskToProject(
    taskId: string,
    targetProject: string
  ): Promise<void> {
    const rootPath = this.plugin.data.settings.projectsFolder || "Projects";
    const parts = taskId.split("/");
    const curProj = parts.length > 1 ? parts[1] : "";
    if (curProj === targetProject) { new Notice($t("p4.10001")); return; }
    const file = this.app.vault.getAbstractFileByPath(taskId);
    if (!(file instanceof TFile)) { new Notice($t("p4.10002")); return; }
    const fileName = parts[parts.length - 1] || "";
    const newPath = `${rootPath}/${targetProject}/${fileName}`;
    if (this.app.vault.getAbstractFileByPath(newPath)) {
      new Notice(`目标项目已存在同名任务「${fileName}」，未移动`);
      return;
    }
    await this.app.fileManager.renameFile(file, newPath);
    const moved = this.app.vault.getAbstractFileByPath(newPath);
    if (moved instanceof TFile) {
      const content = await this.app.vault.read(moved);
      const fm = parseFrontmatter(content);
      if (typeof fm["项目"] === "string" && fm["项目"] !== targetProject) {
        await writeFrontmatter(this.app, moved, { "项目": targetProject });
      }
    }
    new Notice(`已移动到「${targetProject}」`);
    await this.renderAll(true);
  }

  /** 删除项目（含所有任务文件）。 */
  private async deleteProject(proj: ProjectInfo): Promise<void> {
    const confirmed = await confirmDialog(this.app, {
      title: $t("dv.pb.actions.deleteProject"),
      message: $t("dv.confirm.deleteProject", { name: proj.name }),
      confirmText: $t("set.remaining.758"),
      danger: true
    });
    if (!confirmed) return;
    const folder = this.app.vault.getAbstractFileByPath(proj.path);
    if (folder instanceof TFolder) {
      await this.app.fileManager.trashFile(folder);
      new Notice($t("auto.774", { projName: proj.name }));
      await this.renderAll(true);
    }
  }

  /** 打开项目配置笔记。 */
  private openProjectNote(proj: ProjectInfo): void {
    const folderName = proj.path.split("/").pop() || proj.name;
    const f = this.app.vault.getAbstractFileByPath(
      `${proj.path}/project-${folderName}.md`
    );
    if (f instanceof TFile) {
      void this.app.workspace.openLinkText(f.path, "", true);
    }
  }

  /** 按持久化顺序给 currentProjects 排序（新项目靠后）。 */
  private applyProjectOrder(): void {
    const order = this.plugin.data.settings.poProjectOrder;
    if (!order || order.length === 0) return;
    this.currentProjects.sort((a, b) => {
      const ia = order.indexOf(a.name);
      const ib = order.indexOf(b.name);
      const wa = ia < 0 ? Number.MAX_SAFE_INTEGER : ia;
      const wb = ib < 0 ? Number.MAX_SAFE_INTEGER : ib;
      return wa - wb;
    });
  }

  /* ==================== 甘特图面板 ==================== */

  private renderGanttPanel(
    panel: HTMLElement,
    tasks: TaskItem[],
    projects: ProjectInfo[]
  ): void {
    try {
      this.renderGanttPanelInner(panel, tasks, projects);
    } catch {
      panel.empty();
      panel.createDiv({ cls: "po-empty", text: $t("dv.empty") });
    }
  }

  private renderGanttPanelInner(
    panel: HTMLElement,
    tasks: TaskItem[],
    projects: ProjectInfo[]
  ): void {
    if (this.ganttStatusFilter.length > 0) {
      tasks = tasks.filter((t) => this.ganttStatusFilter.includes(t.status));
    }

    // ---- 时间轴配置 ----
    const granularity: GanttZoom = this.ganttZoom || "week";

    // ---- 工具栏（日/周/月/季度/状态筛选）：始终渲染，保证空态下也能清除筛选 ----
    const zoomBar = panel.createDiv({ cls: "po-gantt__zoom" });
    const zoomLevels: Array<{ key: GanttZoom; label: string }> = [
      { key: "day", label: $t("u.20746") },
      { key: "week", label: $t("dv.pb.kanban.week") },
      { key: "month", label: $t("dv.pb.kanban.month") },
      { key: "quarter", label: $t("dv.pb.kanban.quarter") }
    ];
    zoomLevels.forEach((z) => {
      const btn = zoomBar.createEl("button", {
        cls: "po-gantt__zoom-btn" + (z.key === granularity ? " is-active" : ""),
        text: z.label
      });
      this.listen(btn, "click", () => {
        this.ganttZoom = z.key;
        this.plugin.data.settings.poGanttScale = z.key;
        void this.plugin.saveSettings();
        this.renderPanels();
      });
    });

    zoomBar.createSpan({ cls: "po-gantt__sep" });
    const filterBtn = zoomBar.createEl("button", {
      cls: "po-gantt__zoom-btn" + (this.ganttStatusFilter.length ? " is-active" : "")
    });
    const updateFilterLabel = (): void => {
      filterBtn.textContent = this.ganttStatusFilter.length
        ? $t("auto.775", { n: this.ganttStatusFilter.length })
        : $t("dv.pb.filter.statusFilter");
      filterBtn.toggleClass("is-active", this.ganttStatusFilter.length > 0);
    };
    updateFilterLabel();
    this.listen(filterBtn, "click", (e) => {
      const menu = new Menu();
      const statusLabels: Record<string, string> = {
        待办: $t("u.20747"),
        进行中: $t("dv.biz.projects.onTrack"),
        已阻塞: $t("u.20748"),
        已完成: $t("dv.biz.projects.completed"),
        已取消: $t("u.20749"),
      };
      for (const st of STATUS_LIST) {
        menu.addItem((item) =>
          item
            .setTitle(statusLabels[st] ?? st)
            .setChecked(this.ganttStatusFilter.includes(st))
            .onClick(() => {
              const idx = this.ganttStatusFilter.indexOf(st);
              if (idx >= 0) this.ganttStatusFilter.splice(idx, 1);
              else this.ganttStatusFilter.push(st);
              updateFilterLabel();
              this.plugin.data.settings.poGanttStatusFilter = [
                ...this.ganttStatusFilter
              ];
              void this.plugin.saveSettings();
              this.renderPanels();
            })
        );
      }
      if (this.ganttStatusFilter.length) {
        menu.addSeparator();
        menu.addItem((item) =>
          item
            .setTitle($t("p4.10004"))
            .onClick(() => {
              this.ganttStatusFilter.length = 0;
              updateFilterLabel();
              this.plugin.data.settings.poGanttStatusFilter = [];
              void this.plugin.saveSettings();
              this.renderPanels();
            })
        );
      }
      menu.showAtMouseEvent(e);
    });

    const tasksWithDates = tasks.filter((t) => t.startDate || t.dueDate);
    if (tasks.length === 0) {
      panel.createDiv({ cls: "po-empty", text: $t("dv.emptyTask") });
      return;
    }

    // ---- 构建父子层级树（用全量任务列表，保证缩进正确） ----
    const colorMap: Record<string, string> = {};
    projects.forEach((p) => { colorMap[p.name] = p.color; });

    const taskByName = new Map<string, TaskItem>();
    const taskById = new Map<string, TaskItem>();
    tasks.forEach((t) => {
      taskByName.set(t.content, t);
      taskById.set(t.id, t);
    });

    const childrenOf = new Map<string, TaskItem[]>();
    const rootTasks: TaskItem[] = [];
    tasks.forEach((t) => {
      if (t.parent && (taskByName.has(t.parent) || taskById.has(t.parent))) {
        const parentTask = taskByName.get(t.parent) || taskById.get(t.parent);
        const parentKey = parentTask ? parentTask.content : t.parent;
        const children = childrenOf.get(parentKey) || [];
        children.push(t);
        childrenOf.set(parentKey, children);
      } else {
        rootTasks.push(t);
      }
    });

    // 组根任务：按左侧项目顺序；组内再按手动拖拽顺序 / 时间排序
    const projOrder = projects.map((p) => p.name);
    const byProject: Record<string, TaskItem[]> = {};
    const ungrouped: TaskItem[] = [];
    for (const t of rootTasks) {
      const pi = projOrder.indexOf(t.projectId);
      if (pi >= 0) {
        (byProject[t.projectId] ??= []).push(t);
      } else {
        ungrouped.push(t);
      }
    }
    const timeSort = (a: TaskItem, b: TaskItem): number => {
      const sa = a.startDate || "9999-12-31";
      const sb = b.startDate || "9999-12-31";
      if (sa !== sb) return sa.localeCompare(sb);
      const da = a.dueDate || "";
      const db = b.dueDate || "";
      if (da !== db) return da.localeCompare(db);
      return a.content.localeCompare(b.content);
    };
    const manualOrder = this.plugin.data.settings.poTaskOrder || [];
    const manualIdx = new Map<string, number>();
    manualOrder.forEach((id, i) => manualIdx.set(id, i));
    const groupSort = (a: TaskItem, b: TaskItem): number => {
      const hasA = manualIdx.get(a.id);
      const hasB = manualIdx.get(b.id);
      if (hasA !== undefined && hasB !== undefined && hasA !== hasB) return hasA - hasB;
      if (hasA !== undefined && hasB === undefined) return -1;
      if (hasA === undefined && hasB !== undefined) return 1;
      return timeSort(a, b);
    };
    const groupedRoots: TaskItem[] = [];
    for (const p of projOrder) {
      if (byProject[p]) groupedRoots.push(...byProject[p].slice().sort(groupSort));
    }
    groupedRoots.push(...ungrouped.slice().sort(groupSort));
    rootTasks.length = 0;
    rootTasks.push(...groupedRoots);

    // 展平成有序任务列表 + 层级深度
    const orderedTasks: TaskItem[] = [];
    const taskLevels = new Map<string, number>();
    const flattenWithLevel = (taskList: TaskItem[], level: number): void => {
      const list = level === 0 ? taskList : [...taskList].sort(timeSort);
      for (const t of list) {
        orderedTasks.push(t);
        taskLevels.set(t.id, Math.min(level, 3));
        const kids = childrenOf.get(t.content) || [];
        if (kids.length && !this.collapsedParents.has(t.content)) {
          flattenWithLevel(kids, level + 1);
        }
      }
    };
    flattenWithLevel(rootTasks, 0);

    // ---- 时间轴配置 ----
    const DAY_WIDTH: Record<string, number> = { day: 36, week: 16, month: 7, quarter: 4 };
    const MIN_DAYS: Record<string, number> = { day: 30, week: 90, month: 365, quarter: 365 };
    const dayWidth = DAY_WIDTH[granularity] ?? 16;
    const HEADER_HEIGHT = 56;
    const ROW_HEIGHT = 34;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let minD = new Date("2099-12-31T00:00:00");
    let maxD = new Date("2000-01-01T00:00:00");
    tasksWithDates.forEach((t) => {
      if (t.startDate) {
        const s = new Date(t.startDate + "T00:00:00");
        if (!isNaN(s.getTime()) && s < minD) minD = new Date(s);
      }
      if (t.dueDate) {
        const e = new Date(t.dueDate + "T00:00:00");
        if (!isNaN(e.getTime()) && e > maxD) maxD = new Date(e);
      }
    });
    if (today < minD) minD = new Date(today);
    if (today > maxD) maxD = new Date(today);
    minD.setDate(minD.getDate() - 7);
    maxD.setDate(maxD.getDate() + 14);

    const minDaysForZoom = MIN_DAYS[granularity] ?? 30;
    let spanDays = Math.round((maxD.getTime() - minD.getTime()) / 86400000);
    if (spanDays < minDaysForZoom) {
      const extra = Math.ceil((minDaysForZoom - spanDays) / 2);
      minD.setDate(minD.getDate() - extra);
      maxD.setDate(maxD.getDate() + extra);
    }
    if (granularity !== "day") {
      minD = new Date(minD.getFullYear(), minD.getMonth(), 1);
    }

    const totalDays = Math.round((maxD.getTime() - minD.getTime()) / 86400000);
    const totalWidth = totalDays * dayWidth;

    const dateToX = (d: Date): number => {
      const dd = new Date(d);
      dd.setHours(0, 0, 0, 0);
      return Math.round((dd.getTime() - minD.getTime()) / 86400000) * dayWidth;
    };
    const xToDate = (x: number): Date => {
      const d = new Date(minD);
      d.setDate(d.getDate() + Math.round(x / dayWidth));
      return d;
    };
    const isoWeek = (d: Date): number => {
      const t = new Date(d);
      t.setHours(0, 0, 0, 0);
      t.setDate(t.getDate() + 4 - (t.getDay() || 7));
      const yearStart = new Date(t.getFullYear(), 0, 1);
      return Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    };

    // ---- SVG 辅助 ----
    const svgEl = (tag: string, attrs: Record<string, string | number> = {}): SVGElement => {
      const el = document.createElementNS(SVGNS, tag);
      for (const k in attrs) el.setAttribute(k, String(attrs[k]));
      return el;
    };
    const svgText = (x: number, y: number, text: string, cls: string): SVGTextElement => {
      const t = svgEl("text", { x, y, class: cls }) as SVGTextElement;
      t.textContent = text;
      return t;
    };

    const gantt = panel.createDiv({ cls: "po-gantt" });
    const wrapper = gantt.createDiv({ cls: "po-gantt__wrap" });

    const left = wrapper.createDiv({ cls: "po-gantt__left" });
    const leftHeader = left.createDiv({ cls: "po-gantt__left-hd" });
    leftHeader.style.height = HEADER_HEIGHT + "px";
    leftHeader.createSpan({ text: $t("dv.pb.col.taskName"), cls: "po-gantt__left-hd-label" });
    const leftBody = left.createDiv({ cls: "po-gantt__left-body" });

    const right = wrapper.createDiv({ cls: "po-gantt__right" });

    const headerSticky = right.createDiv({ cls: "po-gantt__hdr-sticky" });
    headerSticky.style.width = totalWidth + "px";
    headerSticky.style.height = HEADER_HEIGHT + "px";
    const headerSvg = svgEl("svg", {
      width: totalWidth,
      height: HEADER_HEIGHT,
      class: "po-gantt__hdr-svg"
    }) as SVGSVGElement;
    headerSticky.appendChild(headerSvg);

    const svgWrap = right.createDiv({ cls: "po-gantt__svgwrap" });
    svgWrap.style.width = totalWidth + "px";
    svgWrap.style.marginTop = "-" + HEADER_HEIGHT + "px";
    const totalRows = orderedTasks.length;
    const svgHeight = HEADER_HEIGHT + (totalRows + 1) * ROW_HEIGHT;
    const svg = svgEl("svg", {
      width: totalWidth,
      height: svgHeight,
      class: "po-gantt__svg"
    }) as SVGSVGElement;
    svgWrap.appendChild(svg);

    // ---- 表头渲染 ----
    const hdrBg = svgEl("rect", { x: 0, y: 0, width: totalWidth, height: HEADER_HEIGHT, class: "po-gantt__hdr-bg" });
    headerSvg.appendChild(hdrBg);

    const renderMonthBands = (y: number, h: number): void => {
      let m = new Date(minD.getFullYear(), minD.getMonth(), 1);
      while (m < maxD) {
        const nm = new Date(m.getFullYear(), m.getMonth() + 1, 1);
        const x1 = Math.max(0, dateToX(m));
        const x2 = Math.min(totalWidth, dateToX(nm));
        headerSvg.appendChild(
          svgEl("rect", {
            x: x1,
            y,
            width: Math.max(0, x2 - x1),
            height: h,
            class: m.getMonth() % 2 === 0 ? "po-gantt__band-even" : "po-gantt__band-odd"
          })
        );
        headerSvg.appendChild(
          svgText(x1 + 6, y + h - 7, new Intl.DateTimeFormat(getLocaleCode(), { month: "short" }).format(m), "po-gantt__hdr-month-top")
        );
        m = nm;
      }
    };
    const renderYearBands = (y: number, h: number): void => {
      let yd = new Date(minD.getFullYear(), 0, 1);
      while (yd < maxD) {
        const ny = new Date(yd.getFullYear() + 1, 0, 1);
        const x1 = Math.max(0, dateToX(yd));
        const x2 = Math.min(totalWidth, dateToX(ny));
        headerSvg.appendChild(
          svgEl("rect", {
            x: x1,
            y,
            width: Math.max(0, x2 - x1),
            height: h,
            class: yd.getFullYear() % 2 === 0 ? "po-gantt__band-even" : "po-gantt__band-odd"
          })
        );
        headerSvg.appendChild(
          svgText(x1 + 6, y + h - 7, String(yd.getFullYear()), "po-gantt__hdr-year")
        );
        yd = ny;
      }
    };

    if (granularity === "day") {
      renderMonthBands(0, 24);
      for (let i = 0; i < totalDays; i++) {
        const d = new Date(minD);
        d.setDate(d.getDate() + i);
        const x = i * dayWidth;
        const isWeekend = d.getDay() === 0 || d.getDay() === 6;
        if (isWeekend) {
          headerSvg.appendChild(
            svgEl("rect", {
              x,
              y: 24,
              width: dayWidth,
              height: HEADER_HEIGHT - 24,
              class: "po-gantt__hdr-weekend"
            })
          );
        }
        if (dayWidth >= 20) {
          headerSvg.appendChild(
            svgText(x + dayWidth / 2, 42, String(d.getDate()), "po-gantt__hdr-day")
          );
        }
      }
    } else if (granularity === "week") {
      renderMonthBands(0, 24);
      const nativeDow = minD.getDay();
      const isoDow = nativeDow === 0 ? 7 : nativeDow;
      const offsetToMonday = isoDow === 1 ? 0 : 8 - isoDow;
      if (offsetToMonday > 0) {
        headerSvg.appendChild(
          svgText(
            (offsetToMonday * dayWidth) / 2,
            44,
            "W" + isoWeek(minD),
            "po-gantt__hdr-week"
          )
        );
      }
      let i = offsetToMonday;
      while (i < totalDays) {
        const d = new Date(minD);
        d.setDate(d.getDate() + i);
        const x = i * dayWidth;
        const daysInWeek = Math.min(7, totalDays - i);
        const w = daysInWeek * dayWidth;
        headerSvg.appendChild(svgText(x + w / 2, 44, "W" + isoWeek(d), "po-gantt__hdr-week"));
        headerSvg.appendChild(
          svgEl("line", { x1: x, y1: 24, x2: x, y2: HEADER_HEIGHT, class: "po-gantt__hdr-tick" })
        );
        i += 7;
      }
    } else if (granularity === "month") {
      renderYearBands(0, 24);
      let m = new Date(minD.getFullYear(), minD.getMonth(), 1);
      while (m < maxD) {
        const nm = new Date(m.getFullYear(), m.getMonth() + 1, 1);
        const x1 = Math.max(0, dateToX(m));
        const x2 = Math.min(totalWidth, dateToX(nm));
        headerSvg.appendChild(
          svgText(x1 + (x2 - x1) / 2, 44, new Intl.DateTimeFormat(getLocaleCode(), { month: "short" }).format(m), "po-gantt__hdr-month")
        );
        headerSvg.appendChild(
          svgEl("line", { x1, y1: 24, x2: x1, y2: HEADER_HEIGHT, class: "po-gantt__hdr-tick" })
        );
        m = nm;
      }
    } else {
      renderYearBands(0, 24);
      let q = new Date(minD.getFullYear(), Math.floor(minD.getMonth() / 3) * 3, 1);
      while (q < maxD) {
        const nq = new Date(q.getFullYear(), q.getMonth() + 3, 1);
        const x1 = Math.max(0, dateToX(q));
        const x2 = Math.min(totalWidth, dateToX(nq));
        const qq = Math.floor(q.getMonth() / 3) + 1;
        headerSvg.appendChild(
          svgText(x1 + (x2 - x1) / 2, 44, "Q" + qq + " " + q.getFullYear(), "po-gantt__hdr-quarter")
        );
        headerSvg.appendChild(
          svgEl("line", { x1, y1: 24, x2: x1, y2: HEADER_HEIGHT, class: "po-gantt__hdr-tick" })
        );
        q = nq;
      }
    }

    // ---- 网格线 + 周末底纹 ----
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(minD);
      d.setDate(d.getDate() + i);
      const x = i * dayWidth;
      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
      const isFirst = d.getDate() === 1;
      const isQuarterStart = isFirst && d.getMonth() % 3 === 0;
      if (isWeekend && granularity === "day") {
        svg.appendChild(
          svgEl("rect", {
            x,
            y: HEADER_HEIGHT,
            width: dayWidth,
            height: svgHeight - HEADER_HEIGHT,
            class: "po-gantt__weekend"
          })
        );
      }
      const drawV =
        granularity === "day" ||
        (granularity === "week" && d.getDay() === 1) ||
        (granularity === "month" && isFirst) ||
        (granularity === "quarter" && isQuarterStart);
      if (drawV) {
        svg.appendChild(
          svgEl("line", { x1: x, y1: HEADER_HEIGHT, x2: x, y2: svgHeight, class: "po-gantt__gridline-v" })
        );
      }
    }
    for (let r = 0; r <= totalRows; r++) {
      const y = HEADER_HEIGHT + r * ROW_HEIGHT;
      svg.appendChild(
        svgEl("line", { x1: 0, y1: y, x2: totalWidth, y2: y, class: "po-gantt__gridline-h" })
      );
    }

    // ---- 今日线 ----
    const todayX = dateToX(today);
    if (todayX >= 0 && todayX <= totalWidth) {
      svg.appendChild(
        svgEl("line", { x1: todayX, y1: HEADER_HEIGHT - 8, x2: todayX, y2: svgHeight, class: "po-gantt__today" })
      );
      headerSvg.appendChild(
        svgEl("polygon", {
          points: `${todayX},${HEADER_HEIGHT - 16} ${todayX + 6},${HEADER_HEIGHT - 8} ${todayX},${HEADER_HEIGHT} ${todayX - 6},${HEADER_HEIGHT - 8}`,
          class: "po-gantt__today-diamond"
        })
      );
    }

    // ---- 工具提示 ----
    const tooltip = panel.createDiv({ cls: "po-gantt__tooltip" });

    // ---- 任务条 + 左侧标签 ----
    const bars: SVGElement[] = [];
    const labelRows: HTMLElement[] = [];
    orderedTasks.forEach((t, idx) => {
      const level = taskLevels.get(t.id) || 0;
      const isParent = childrenOf.has(t.content);
      const color = colorMap[t.projectId] || "#3b82f6";

      const lr = leftBody.createDiv({
        cls: "po-gantt__label-row" + (level > 0 ? " po-gantt__label-row--child" : "")
      });
      lr.style.height = ROW_HEIGHT + "px";
      lr.style.paddingLeft = level * 18 + 8 + "px";
      lr.dataset.taskId = t.id;
      if (isParent) {
        const collapsed = this.collapsedParents.has(t.content);
        const dot = lr.createSpan({
          cls: "po-gantt__label-dot",
          text: collapsed ? "▸" : "▾"
        });
        this.listen(dot, "click", (e) => {
          e.stopPropagation();
          if (collapsed) this.collapsedParents.delete(t.content);
          else this.collapsedParents.add(t.content);
          this.renderPanels();
        });
      }
      lr.createSpan({ cls: "po-gantt__label-title", text: t.content });
      // 任务名后加号：以该任务为父任务，打开新建任务弹窗（等价于「加子任务」）
      const addBtn = lr.createSpan({ cls: "po-gantt__label-add", text: "+" });
      this.listen(addBtn, "click", (e) => {
        e.stopPropagation();
        this.openNewSubtaskModal(t.content, t.projectId);
      });
      this.listen(lr, "click", () => this.openTaskEditModal(t));
      this.listen(lr, "contextmenu", (e) => {
        e.preventDefault();
        const menu = new Menu();
        menu.addItem((item) =>
          item
            .setTitle($t("p4.10005"))
            .setIcon("pencil")
            .onClick(() => this.openTaskEditModal(t))
        );
        menu.addItem((item) =>
          item
            .setTitle($t("dv.deleteTask"))
            .setIcon("trash")
            .onClick(() => void this.deleteTask(t))
        );
        menu.showAtMouseEvent(e);
      });

      // 拖拽重排行
      lr.draggable = true;
      this.listen(lr, "dragstart", (e) => {
        e.dataTransfer?.setData("text/task-id", t.id);
        lr.addClass("po-row--dragging");
      });
      this.listen(lr, "dragend", () => lr.removeClass("po-row--dragging"));
      this.listen(lr, "dragover", (e) => {
        e.preventDefault();
        lr.addClass("po-row--drag-over");
      });
      this.listen(lr, "dragleave", () => lr.removeClass("po-row--drag-over"));
      this.listen(lr, "drop", (e) => {
        e.preventDefault();
        lr.removeClass("po-row--drag-over");
        const draggedId = e.dataTransfer?.getData("text/task-id");
        if (!draggedId || draggedId === t.id) return;
        const rows = Array.from(
          leftBody.querySelectorAll<HTMLElement>(".po-gantt__label-row")
        );
        const ids = rows
          .map((r) => r.dataset.taskId)
          .filter((id): id is string => !!id);
        const from = ids.indexOf(draggedId);
        const to = ids.indexOf(t.id);
        if (from < 0 || to < 0) return;
        ids.splice(from, 1);
        ids.splice(from < to ? to - 1 : to, 0, draggedId);
        this.plugin.data.settings.poTaskOrder = ids;
        void this.plugin.saveSettings();
        this.renderPanels();
      });

      labelRows.push(lr);

      // 甘特条
      if (!t.startDate && !t.dueDate) return;
      const startDate = t.startDate
        ? new Date(t.startDate + "T00:00:00")
        : new Date(t.dueDate! + "T00:00:00");
      const endDate = t.dueDate
        ? new Date(t.dueDate + "T00:00:00")
        : new Date(startDate);
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return;
      const x = dateToX(startDate);
      const xEnd = dateToX(new Date(endDate.getTime() + 86400000));
      const width = Math.max(2, xEnd - x);
      const barY = HEADER_HEIGHT + idx * ROW_HEIGHT + 8;
      const barH = ROW_HEIGHT - 16;
      const barCls =
        "po-gantt__bar" +
        (t.status === "已完成" ? " is-completed" : "") +
        (isParent ? " po-gantt__bar--parent" : "") +
        (level > 0 ? " po-gantt__bar--child" : "");
      const bar = svgEl("rect", {
        x,
        y: barY,
        width,
        height: barH,
        rx: 4,
        class: barCls
      }) as SVGRectElement;
      bar.setAttribute("fill", color);
      bar.dataset.taskId = t.id;
      (bar as SVGElement & { _dragged?: boolean })._dragged = false;
      if (t.startDate && t.dueDate) bar.classList.add("po-gantt__bar--movable");
      bars.push(bar);

      const group = svgEl("g", { class: "po-gantt__bar-group" }) as SVGGElement;
      group.appendChild(bar);

      const HANDLE_W = 8;
      let leftHandle: SVGRectElement | null = null;
      let rightHandle: SVGRectElement | null = null;

      const beginDrag = (
        b: SVGRectElement,
        side: "left" | "right" | "move",
        e: MouseEvent
      ): void => {
        e.preventDefault();
        if (side !== "move") e.stopPropagation();
        const startX = e.clientX;
        const origX = parseFloat(b.getAttribute("x") || "0");
        const origW = parseFloat(b.getAttribute("width") || "0");
        let moved = false;
        b.classList.add("po-gantt__bar--grabbing");
        const syncHandles = (): void => {
          const cx = parseFloat(b.getAttribute("x") || "0");
          const cw = parseFloat(b.getAttribute("width") || "0");
          if (leftHandle) leftHandle.setAttribute("x", String(cx));
          if (rightHandle) rightHandle.setAttribute("x", String(cx + cw - HANDLE_W));
        };
        const onMove = (e2: MouseEvent): void => {
          const dx = e2.clientX - startX;
          if (Math.abs(dx) < 3) return;
          moved = true;
          if (side === "left") {
            const nx = Math.max(0, origX + dx);
            const nw = origW - (nx - origX);
            if (nw >= dayWidth) {
              b.setAttribute("x", String(nx));
              b.setAttribute("width", String(nw));
            }
          } else if (side === "right") {
            b.setAttribute("width", String(Math.max(dayWidth, origW + dx)));
          } else {
            b.setAttribute("x", String(origX + dx));
          }
          syncHandles();
        };
        const onUp = (): void => {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
          b.classList.remove("po-gantt__bar--grabbing");
          if (!moved) return;
          (b as SVGElement & { _dragged?: boolean })._dragged = true;
          tooltip.removeClass("is-visible");
          const nx = parseFloat(b.getAttribute("x") || "0");
          const nw = parseFloat(b.getAttribute("width") || "0");
          const startD = xToDate(nx);
          const endD = xToDate(nx + nw);
          endD.setDate(endD.getDate() - 1);
          void this.updateTaskDates(t, fmtDate(startD), fmtDate(endD));
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      };

      if (width > HANDLE_W * 2) {
        for (const side of ["left", "right"] as const) {
          const hx = side === "left" ? x : x + width - HANDLE_W;
          const handle = svgEl("rect", {
            x: hx,
            y: barY,
            width: HANDLE_W,
            height: barH,
            rx: 3,
            class: "po-gantt__bar-handle"
          }) as SVGRectElement;
          handle.addEventListener("mousedown", (e) => beginDrag(bar, side, e));
          group.appendChild(handle);
          if (side === "left") leftHandle = handle;
          else rightHandle = handle;
        }
      }

      bar.addEventListener("mouseenter", (e: MouseEvent) => {
        const prioLabel = t.priority || "未设置";
        tooltip.empty();
        tooltip.createEl("strong", { text: t.content });
        tooltip.createEl("br");
        tooltip.appendText((t.startDate || "?") + " → " + (t.dueDate || "?"));
        tooltip.createEl("br");
        tooltip.appendText(prioLabel + " · " + t.status);
        tooltip.addClass("is-visible");
        this.positionTooltip(tooltip, e);
      });
      bar.addEventListener("mousemove", (e: MouseEvent) =>
        this.positionTooltip(tooltip, e)
      );
      bar.addEventListener("mouseleave", () => tooltip.removeClass("is-visible"));

      bar.addEventListener("click", () => {
        if ((bar as SVGElement & { _dragged?: boolean })._dragged) {
          (bar as SVGElement & { _dragged?: boolean })._dragged = false;
          return;
        }
        this.openTaskEditModal(t);
        this.clearHighlights(bars, tableResult.rows);
        if (tableResult.rows[idx]) {
          tableResult.rows[idx].addClass("po-row--highlight");
          tableResult.rows[idx].scrollIntoView({ behavior: "smooth", block: "nearest" });
          this.highlightedRow = tableResult.rows[idx];
        }
        bar.classList.add("po-bar--highlight");
        this.highlightedBar = bar;
      });

      bar.addEventListener("mousedown", (e: MouseEvent) => beginDrag(bar, "move", e));

      svg.appendChild(group);
    });

    // ---- 左右滚动同步 ----
    const syncSpacer = (): void => {
      const hBar = right.offsetHeight - right.clientHeight;
      leftBody.style.paddingBottom = hBar + "px";
    };
    this.listen(right, "scroll", () => {
      syncSpacer();
      leftBody.scrollTop = right.scrollTop;
    });
    this.listen(
      left,
      "wheel",
      (e: WheelEvent) => {
        right.scrollTop += e.deltaY;
        right.scrollLeft += e.deltaX;
        e.preventDefault();
      },
      { passive: false }
    );

    // 初始居中到今日
    const scrollToToday = (): void => {
      if (!right.clientWidth) return;
      right.scrollLeft = Math.max(0, todayX - right.clientWidth / 2);
    };
    window.requestAnimationFrame(() => {
      syncSpacer();
      scrollToToday();
    });

    // ---- 拖拽分隔条 + 下方任务表 ----
    const resizeHandle = panel.createDiv({ cls: "po-resize" });
    this.setupResizeHandle(resizeHandle, gantt);

    // 前向引用：下方任务表在上方条形回调中按索引联动高亮
    let tableResult: { tbody: HTMLElement; rows: (HTMLElement | null)[] } = {
      tbody: panel.createDiv(),
      rows: []
    };
    tableResult = this.renderTaskTable(panel, "po-tb1", tasks, projects);

    // 行点击 → 高亮对应甘特条（事件委托）
    this.listen(tableResult.tbody, "click", (e) => {
      const tr = (e.target as HTMLElement).closest("tr") as HTMLElement;
      const idxStr = tr?.dataset.origIndex;
      if (idxStr === undefined) return;
      const idx = Number(idxStr);
      this.clearHighlights(bars, tableResult.rows);
      if (bars[idx]) {
        bars[idx].classList.add("po-bar--highlight");
        this.highlightedBar = bars[idx];
      }
      tr.addClass("po-row--highlight");
      this.highlightedRow = tr;
    });
  }

  /** 更新任务日期（CRLF-safe 统一写入器）。 */
  private async updateTaskDates(
    task: TaskItem,
    newStart: string,
    newEnd: string
  ): Promise<void> {
    if (!task.sourceFile) return;
    const file = this.app.vault.getAbstractFileByPath(task.sourceFile);
    if (!(file instanceof TFile)) return;
    await writeFrontmatter(this.app, file, { "开始日期": newStart, "截止日期": newEnd });
    task.startDate = newStart;
    task.dueDate = newEnd;
  }

  private positionTooltip(tooltip: HTMLElement, e: MouseEvent): void {
    const parent = tooltip.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    tooltip.style.left = e.clientX - rect.left + 12 + "px";
    tooltip.style.top = e.clientY - rect.top - 10 + "px";
  }

  private clearHighlights(bars: Element[], rows: (HTMLElement | null)[]): void {
    if (this.highlightedBar) {
      this.highlightedBar.classList.remove("po-bar--highlight");
      this.highlightedBar = null;
    }
    if (this.highlightedRow) {
      this.highlightedRow.removeClass("po-row--highlight");
      this.highlightedRow = null;
    }
    bars.forEach((b) => b.classList.remove("po-bar--highlight"));
    rows.forEach((r) => r?.removeClass("po-row--highlight"));
  }

  private setupResizeHandle(handle: HTMLElement, gantt: HTMLElement): void {
    this.listen(handle, "mousedown", (e) => {
      e.preventDefault();
      const startY = e.clientY;
      const startH = gantt.offsetHeight;
      const onMove = (ev: MouseEvent): void => {
        const dh = ev.clientY - startY;
        gantt.addClass("po-gantt--resized");
        gantt.style.height = Math.max(100, startH + dh) + "px";
      };
      const onUp = (): void => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }

  /* ==================== 列表面板 ==================== */

  private renderTaskTable(
    panel: HTMLElement,
    tbodyId: string,
    tasks: TaskItem[],
    projects: ProjectInfo[]
  ): { tbody: HTMLElement; rows: (HTMLElement | null)[] } {
    const section = panel.createDiv({ cls: "po-tasklist" });
    const toolbar = section.createDiv({ cls: "po-toolbar" });
    toolbar.createSpan({ cls: "po-toolbar__label", text: $t("dv.pb.filter.label") });
    const filterChips: Array<{ key: string; label: string }> = [
      { key: "all", label: $t("dv.pb.filter.all") },
      { key: "待办", label: $t("u.20747") },
      { key: "进行中", label: $t("dv.biz.projects.onTrack") },
      { key: "已阻塞", label: $t("u.20748") },
      { key: "已完成", label: $t("dv.biz.projects.completed") },
    ];
    filterChips.forEach((f) => {
      const chip = toolbar.createEl("button", {
        cls: "po-chip" + (f.key === this.taskListFilter ? " is-active" : ""),
        text: f.label
      });
      chip.dataset.filter = f.key;
    });

    const wrap = section.createDiv({ cls: "po-table-wrap" });
    const table = wrap.createEl("table", { cls: "po-table" });
    const thead = table.createEl("thead");
    const hr = thead.createEl("tr");
    const colDefs = [
      { key: "", label: "" },
      { key: "name", label: $t("dv.pb.col.taskName") },
      { key: "priority", label: $t("dv.pb.col.priority") },
      { key: "startDate", label: $t("dv.pb.col.start") },
      { key: "dueDate", label: $t("dv.pb.col.due") },
      { key: "status", label: $t("dv.pb.col.status") },
      { key: "project", label: $t("dv.pb.col.project") }
    ];
    const thEls: HTMLElement[] = [];
    colDefs.forEach((col) => {
      const th = hr.createEl("th", { text: col.label });
      th.dataset.sortKey = col.key;
      thEls.push(th);
      if (col.key) {
        th.addClass("po-th--sortable");
        th.createSpan({ cls: "po-sort-arrow" });
      }
    });

    const tbody = table.createEl("tbody");
    tbody.id = tbodyId;

    let sortedTasks = [...tasks];
    const applySort = (): void => {
      if (!this.sortCol) {
        sortedTasks = [...tasks];
        return;
      }
      sortedTasks = [...tasks].sort((a, b) => {
        let va = "";
        let vb = "";
        switch (this.sortCol) {
          case "name": va = a.content; vb = b.content; break;
          case "priority": va = String(priorityWeight(a.priority)); vb = String(priorityWeight(b.priority)); break;
          case "startDate": va = a.startDate || "zzz"; vb = b.startDate || "zzz"; break;
          case "dueDate": va = a.dueDate || "zzz"; vb = b.dueDate || "zzz"; break;
          case "status": va = a.status; vb = b.status; break;
          case "project": va = a.projectId; vb = b.projectId; break;
        }
        const cmp = va.localeCompare(vb, "zh-CN");
        return this.sortDir === "asc" ? cmp : -cmp;
      });
    };
    applySort();

    // 窗口化渲染
    const FILTER_KEYS: Record<string, (st: string) => boolean> = {
      all: () => true,
      待办: (st) => st === "待办",
      进行中: (st) => st === "进行中",
      已阻塞: (st) => st === "已阻塞",
      已完成: (st) => st === "已完成"
    };
    const ROW_HEIGHT_FALLBACK = 33;
    const OVERSCAN = 10;
    let rowHeight = ROW_HEIGHT_FALLBACK;
    let rowHeightMeasured = false;
    let visible = filterWithOrig(
      sortedTasks,
      (t) => FILTER_KEYS[this.taskListFilter]?.(t.status) ?? true
    );
    const rows: (HTMLElement | null)[] = new Array<HTMLElement | null>(
      sortedTasks.length
    ).fill(null);
    let lastRendered: number[] = [];

    const renderWindow = (): void => {
      const win = computeWindow({
        scrollTop: wrap.scrollTop,
        viewportHeight: wrap.clientHeight,
        rowHeight,
        total: visible.items.length,
        overscan: OVERSCAN
      });
      for (const o of lastRendered) rows[o] = null;
      lastRendered = [];
      tbody.empty();
      if (win.end > win.start) {
        const mkSpacer = (h: number): HTMLTableRowElement => {
          const tr = tbody.createEl("tr");
          const td = tr.createEl("td", { cls: "po-spacer-cell" });
          td.colSpan = colDefs.length;
          td.style.height = h + "px";
          return tr;
        };
        mkSpacer(win.start * rowHeight);
        for (let v = win.start; v < win.end; v++) {
          const o = visible.orig[v];
          if (o === undefined) continue;
          const task = visible.items[v];
          if (!task) continue;
          const tr = this.buildPoRow(tbody, task, projects, o);
          rows[o] = tr;
          lastRendered.push(o);
        }
        mkSpacer((visible.items.length - win.end) * rowHeight);
      }
      if (!rowHeightMeasured) {
        const first = tbody.querySelector("tr.po-data-row");
        if (first) {
          const h = (first as HTMLElement).offsetHeight;
          if (h > 0) {
            rowHeight = h;
            rowHeightMeasured = true;
            renderWindow();
          }
        }
      }
    };
    renderWindow();
    window.requestAnimationFrame(() => renderWindow());

    let scrollRaf = 0;
    this.listen(wrap, "scroll", () => {
      if (scrollRaf) return;
      scrollRaf = window.requestAnimationFrame(() => {
        scrollRaf = 0;
        renderWindow();
      });
    });

    this.listen(thead, "click", (e) => {
      const th = (e.target as HTMLElement).closest("th") as HTMLElement;
      if (!th?.dataset.sortKey) return;
      const key = th.dataset.sortKey;
      if (this.sortCol === key) {
        this.sortDir = this.sortDir === "asc" ? "desc" : "asc";
      } else {
        this.sortCol = key;
        this.sortDir = "asc";
      }
      thEls.forEach((h) => {
        const arrow = h.querySelector(".po-sort-arrow");
        if (arrow) arrow.textContent = "";
      });
      const arrow = th.querySelector(".po-sort-arrow");
      if (arrow) arrow.textContent = this.sortDir === "asc" ? " ↑" : " ↓";

      applySort();
      visible = filterWithOrig(
        sortedTasks,
        (t) => FILTER_KEYS[this.taskListFilter]?.(t.status) ?? true
      );
      wrap.scrollTop = 0;
      renderWindow();
    });

    this.listen(toolbar, "click", (e) => {
      const chip = (e.target as HTMLElement).closest(".po-chip") as HTMLElement;
      if (!chip) return;
      toolbar.querySelectorAll(".po-chip").forEach((c) => c.removeClass("is-active"));
      chip.addClass("is-active");
      this.taskListFilter = chip.dataset.filter ?? "all";
      visible = filterWithOrig(
        sortedTasks,
        (t) => FILTER_KEYS[this.taskListFilter]?.(t.status) ?? true
      );
      wrap.scrollTop = 0;
      renderWindow();
    });

    return { tbody, rows };
  }

  /** 构建单行（窗口化渲染按需调用）。origIndex 用于与甘特条联动。 */
  private buildPoRow(
    tbody: HTMLElement,
    t: TaskItem,
    projects: ProjectInfo[],
    origIndex: number
  ): HTMLElement {
    const statusMap: Record<string, string> = {
      待办: "po-todo",
      进行中: "po-progress",
      已阻塞: "po-blocked",
      已完成: "po-done",
      已取消: "po-cancelled"
    };
    const prioMap: Record<string, string> = {
      重要且紧急: "po-p-high",
      重要不紧急: "po-p-med",
      紧急不重要: "po-p-med",
      不重要不紧急: "po-p-low"
    };

    const colorMap: Record<string, string> = {};
    projects.forEach((p) => { colorMap[p.name] = p.color; });

    const tr = tbody.createEl("tr");
    tr.addClass("po-data-row");
    tr.dataset.taskId = t.id;
    tr.dataset.status = t.status;
    tr.dataset.origIndex = String(origIndex);

    const tdCb = tr.createEl("td");
    const cb = tdCb.createSpan({
      cls: "po-check" + (t.status === "已完成" ? " is-done" : "")
    });
    this.listen(cb, "click", (e) => {
      e.stopPropagation();
      void this.toggleTask(t, tr);
    });

    const nameEl = tr.createEl("td", { text: t.content, cls: "po-name-cell" });
    // 行可拖拽到侧栏实现「跨项目移动」
    nameEl.draggable = true;
    this.listen(nameEl, "dragstart", (e) => {
      e.dataTransfer?.setData("text/task-id", t.id);
    });
    this.listen(nameEl, "click", () => {
      this.openTaskEditModal(t);
    });

    const tdPrio = tr.createEl("td");
    if (t.priority) {
      tdPrio.createSpan({
        cls: "po-prio " + (prioMap[t.priority] || ""),
        text: t.priority
      });
    }

    tr.createEl("td", { cls: "po-mono", text: t.startDate || "-" });
    tr.createEl("td", { cls: "po-mono", text: t.dueDate || "-" });

    const tdSt = tr.createEl("td");
    tdSt.createSpan({ cls: "po-status " + (statusMap[t.status] || ""), text: t.status });

    const tdProj = tr.createEl("td");
    const projColor = colorMap[t.projectId] || "#3b82f6";
    tdProj.createSpan({
      cls: "po-mini-dot",
      attr: { style: "background:" + projColor }
    });
    tdProj.appendText(t.projectId);

    this.listen(tr, "contextmenu", (e) => {
      e.preventDefault();
      const menu = new Menu();
      menu.addItem((item) =>
        item
          .setTitle($t("p4.10005"))
          .setIcon("pencil")
          .onClick(() => this.openTaskEditModal(t))
      );
      menu.addItem((item) =>
        item
          .setTitle($t("dv.deleteTask"))
          .setIcon("trash")
          .onClick(() => void this.deleteTask(t))
      );
      menu.addItem((item) =>
        item
          .setTitle($t("p4.10006"))
          .setIcon("file-text")
          .onClick(() => {
            if (t.sourceFile) void this.app.workspace.openLinkText(t.sourceFile, "", true);
          })
      );
      menu.showAtMouseEvent(e);
    });
    return tr;
  }

  /* ==================== 看板视图 ==================== */
  private renderKanbanPanel(
    panel: HTMLElement,
    tasks: TaskItem[],
    projects: ProjectInfo[]
  ): void {
    const board = panel.createDiv({ cls: "po-kanban" });
    const cols = [
      { key: "待办", label: $t("u.20747") },
      { key: "进行中", label: $t("dv.biz.projects.onTrack") },
      { key: "已阻塞", label: $t("u.20748") },
      { key: "已完成", label: $t("dv.biz.projects.completed") },
      { key: "已取消", label: $t("u.20749") }
    ];

    const colorMap: Record<string, string> = {};
    projects.forEach((p) => {
      colorMap[p.name] = p.color;
    });

    const prioList = ["重要且紧急", "重要不紧急", "紧急不重要", "不重要不紧急"];

    cols.forEach((col) => {
      const colEl = board.createDiv({ cls: "po-kanban__col" });
      colEl.dataset.status = col.key;
      const hd = colEl.createDiv({ cls: "po-kanban__hd" });
      hd.createSpan({ text: col.label });
      const ct = tasks.filter((t) => t.status === col.key);
      hd.createSpan({ cls: "po-kanban__count", text: String(ct.length) });

      ct.forEach((t) => {
        const card = colEl.createDiv({ cls: "po-kanban__card" });
        card.draggable = true;
        card.dataset.taskId = t.id;
        card.createDiv({ text: t.content });
        const meta = card.createDiv({ cls: "po-kanban__meta" });
        const dateRange = [t.startDate, t.dueDate].filter(Boolean).join(" → ");
        if (dateRange) meta.createSpan({ text: dateRange });
        const proj = meta.createSpan();
        const projColor = colorMap[t.projectId] || "#3b82f6";
        proj.createSpan({ cls: "po-mini-dot", attr: { style: "background:" + projColor } });
        proj.appendText(t.projectId);

        card.addEventListener("click", () => this.openTaskEditModal(t));

        card.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          const menu = new Menu();
          menu.addItem((item) =>
            item
              .setTitle($t("p4.10007"))
              .setIcon("pencil")
              .onClick(() => this.openTaskEditModal(t))
          );
          menu.addItem((item) =>
            item.setTitle($t("set.remaining.758")).setIcon("trash").onClick(() => void this.deleteTask(t))
          );
          menu.addSeparator();
          prioList.forEach((prio) => {
            menu.addItem((item) =>
              item.setTitle("优先级: " + prio).onClick(() => void this.updateTaskPriority(t, prio))
            );
          });
          menu.showAtMouseEvent(e);
        });

        card.addEventListener("dragstart", (e) => {
          e.dataTransfer?.setData("text/plain", t.id);
          card.addClass("po-kanban__card--dragging");
        });
        card.addEventListener("dragend", () => {
          card.removeClass("po-kanban__card--dragging");
        });
      });

      colEl.addEventListener("dragover", (e) => {
        e.preventDefault();
        colEl.addClass("po-kanban__col--drag-over");
      });
      colEl.addEventListener("dragleave", () => {
        colEl.removeClass("po-kanban__col--drag-over");
      });
      colEl.addEventListener("drop", (e) => {
        e.preventDefault();
        colEl.removeClass("po-kanban__col--drag-over");
        const taskId = e.dataTransfer?.getData("text/plain");
        if (!taskId) return;
        const task = tasks.find((t) => t.id === taskId);
        if (!task || task.status === col.key) return;
        void this.updateTaskStatus(task, col.key as TaskStatus);
      });
    });
  }

  /** 更新任务状态（写回源文件的中文「状态」字段）。 */
  private async updateTaskStatus(task: TaskItem, newStatus: TaskStatus): Promise<void> {
    if (!task.sourceFile) return;
    const file = this.app.vault.getAbstractFileByPath(task.sourceFile);
    if (!(file instanceof TFile)) return;
    await writeFrontmatter(this.app, file, { 状态: newStatus });
    task.status = newStatus;
    new Notice("✨ 任务状态已更新: " + newStatus);
    this.taskStore.invalidate();
    void this.renderAll(true);
  }

  /** 更新任务优先级（写回源文件的「优先级」字段，缺失时插入）。 */
  private async updateTaskPriority(task: TaskItem, newPriority: string): Promise<void> {
    if (!task.sourceFile) return;
    const file = this.app.vault.getAbstractFileByPath(task.sourceFile);
    if (!(file instanceof TFile)) return;
    await writeFrontmatter(this.app, file, { 优先级: newPriority });
    task.priority = newPriority as TaskItem["priority"];
    new Notice("✨ 优先级已更新: " + newPriority);
    this.taskStore.invalidate();
    void this.renderAll(true);
  }

  /* ==================== 日历视图 ==================== */
  private renderCalendarPanel(
    panel: HTMLElement,
    tasks: TaskItem[],
    projects: ProjectInfo[]
  ): void {
    const grid = panel.createDiv({ cls: "po-cal" });

    const colorMap: Record<string, string> = {};
    projects.forEach((p) => {
      colorMap[p.name] = p.color;
    });

    const today = new Date();
    const todayStr = fmtDate(today);

    const renderMonth = () => {
      grid.empty();
      const y = this.calYear,
        m = this.calMonth;
      const dim = new Date(y, m + 1, 0).getDate();
      const fd = new Date(y, m, 1).getDay();
      const adj = fd === 0 ? 6 : fd - 1;

      const header = grid.createDiv({ cls: "po-cal__header" });
      header.createSpan({ cls: "po-cal__title", text: new Intl.DateTimeFormat(getLocaleCode(), { year: "numeric", month: "long" }).format(new Date(y, m, 1)) });
      const nav = header.createDiv({ cls: "po-cal__nav" });
      const prevBtn = nav.createEl("button", { cls: "po-cal__btn", text: "←" });
      const todayBtn = nav.createEl("button", { cls: "po-cal__btn", text: $t("dv.pb.calendar.today") });
      const nextBtn = nav.createEl("button", { cls: "po-cal__btn", text: "→" });

      prevBtn.addEventListener("click", () => {
        this.calMonth--;
        if (this.calMonth < 0) {
          this.calMonth = 11;
          this.calYear--;
        }
        renderMonth();
      });
      nextBtn.addEventListener("click", () => {
        this.calMonth++;
        if (this.calMonth > 11) {
          this.calMonth = 0;
          this.calYear++;
        }
        renderMonth();
      });
      todayBtn.addEventListener("click", () => {
        this.calYear = today.getFullYear();
        this.calMonth = today.getMonth();
        renderMonth();
      });

      const weekdays = grid.createDiv({ cls: "po-cal__weekdays" });
      new Array(7).fill(0).map((_, i) => new Intl.DateTimeFormat(getLocaleCode(), { weekday: "short" }).format(new Date(2020, 0, 5 + i)))
        .forEach((d) => weekdays.createSpan({ text: d }));

      const days = grid.createDiv({ cls: "po-cal__days" });
      for (let i = 0; i < adj; i++) days.createDiv({ cls: "po-cal__day" });
      for (let d = 1; d <= dim; d++) {
        const ds =
          y + "-" + String(m + 1).padStart(2, "0") + "-" + String(d).padStart(2, "0");
        const isToday = ds === todayStr;
        const dayTasks = tasks.filter((t) => {
          const effectiveDate = t.remindDate || t.dueDate;
          return effectiveDate === ds || t.startDate === ds;
        });
        const hasOverdue = dayTasks.some(
          (t) =>
            t.status !== "已完成" &&
            t.status !== "已取消" &&
            t.dueDate &&
            new Date(t.dueDate) < today
        );
        const cls =
          "po-cal__day" +
          (isToday ? " is-today" : "") +
          (dayTasks.length ? (hasOverdue ? " has-overdue has-tasks" : " has-tasks") : "");
        const dayEl = days.createDiv({ cls, attr: { "data-date": ds } });
        dayEl.createSpan({ cls: "po-cal__day-num", text: String(d) });
        const shown = dayTasks.slice(0, 3);
        shown.forEach((t) => {
          const taskEl = dayEl.createDiv({ cls: "po-cal__day-task", text: t.content });
          taskEl.style.color = t.status === "已完成" ? "var(--ad-text-dim)" : "";
        });
        if (dayTasks.length > 3) {
          dayEl.createDiv({ cls: "po-cal__day-more", text: "+" + (dayTasks.length - 3) });
        }
      }

      const preview = grid.createDiv({ cls: "po-cal__preview", text: $t("dv.pb.calendar.hint") });

      grid.addEventListener("click", (e) => {
        const dayEl = (e.target as HTMLElement).closest(".po-cal__day") as HTMLElement;
        if (!dayEl || !dayEl.dataset.date) return;
        const dt = dayEl.dataset.date;
        const dayTasks = tasks.filter((t) => {
          const effectiveDate = t.remindDate || t.dueDate;
          return effectiveDate === dt || t.startDate === dt;
        });
        preview.empty();
        if (dayTasks.length) {
          dayTasks.forEach((t) => {
            const row = preview.createDiv({ cls: "po-cal__task" });
            row.draggable = true;
            row.dataset.taskId = t.id;
            const projColor = colorMap[t.projectId] || "#3b82f6";
            row.createSpan({ cls: "po-mini-dot", attr: { style: "background:" + projColor } });
            const nameSpan = row.createSpan({
              cls: "po-cal__task-name po-clickable",
              text: t.content
            });
            nameSpan.addEventListener("click", (ev) => {
              ev.stopPropagation();
              this.openTaskEditModal(t);
            });
            row.createSpan({
              cls: "po-status " + (t.status === "已完成" ? "po-done" : "po-todo"),
              text: t.status
            });
            row.addEventListener("dragstart", (ev) => {
              ev.dataTransfer?.setData("text/plain", t.id);
            });
          });
        } else {
          preview.createSpan({ text: $t("dv.pb.calendar.empty") });
        }
      });

      grid.addEventListener("dragover", (e) => {
        const dayEl = (e.target as HTMLElement).closest(".po-cal__day") as HTMLElement;
        if (dayEl?.dataset.date) {
          e.preventDefault();
          dayEl.addClass("po-cal__day--drag-over");
        }
      });
      grid.addEventListener("dragleave", (e) => {
        const dayEl = (e.target as HTMLElement).closest(".po-cal__day") as HTMLElement;
        if (dayEl) dayEl.removeClass("po-cal__day--drag-over");
      });
      grid.addEventListener("drop", (e) => {
        e.preventDefault();
        const dayEl = (e.target as HTMLElement).closest(".po-cal__day") as HTMLElement;
        if (!dayEl?.dataset.date) return;
        dayEl.removeClass("po-cal__day--drag-over");
        const taskId = e.dataTransfer?.getData("text/plain");
        if (!taskId) return;
        const task = tasks.find((t) => t.id === taskId);
        if (!task) return;
        const newDate = dayEl.dataset.date;
        void this.updateTaskDate(task, newDate);
      });
    };

    renderMonth();
  }

  /** 更新任务日期（写回源文件；仅改写已存在的字段，不凭空插入）。 */
  private async updateTaskDate(task: TaskItem, newDate: string): Promise<void> {
    if (!task.sourceFile) return;
    const file = this.app.vault.getAbstractFileByPath(task.sourceFile);
    if (!(file instanceof TFile)) return;

    const updates: Record<string, string> = {};
    if (task.dueDate) updates["截止日期"] = newDate;
    if (task.remindDate) updates["提醒日期"] = newDate;
    if (Object.keys(updates).length > 0) {
      await writeFrontmatter(this.app, file, updates);
    }

    task.dueDate = newDate;
    if (task.remindDate) task.remindDate = newDate;
    new Notice($t("p4.10016"));
    this.taskStore.invalidate();
    void this.renderAll(true);
  }

  /* ==================== 任务动作（astra 自有实现） ==================== */

  /** 打开任务详情编辑弹窗（对齐上游 host openTaskEditModal）。 */
  private openTaskEditModal(task: TaskItem): void {
    new TaskEditModal({
      app: this.app,
      task,
      allTasks: this.currentTasks,
      projects: this.currentProjects,
      projectsFolder: this.plugin.data.settings.projectsFolder || "Projects",
      onSave: () => {
        this.taskStore.invalidate();
        void this.renderAll(true);
      },
    }).open();
  }

  /** 以 parentName 为父任务打开新建任务弹窗（任务名 + 号触发，等价于「加子任务」）。 */
  private openNewSubtaskModal(parentName: string, projectName: string): void {
    const allTasks = (tasks: TaskItem[]) =>
      tasks.map((x) => ({ id: x.id, title: x.content, projectId: x.projectId }));
    new TaskModal({
      app: this.app,
      projects: this.currentProjects.map((p) => ({ name: p.name, path: p.path })),
      allTasks: allTasks(this.currentTasks),
      defaultParent: parentName,
      defaultProject: projectName,
      onSave: (data) => void this.createTaskFile(data),
    }).open();
  }

  /** 创建任务文件（委托共享模块，与首页「新建任务」共用同一套 frontmatter 逻辑）。 */
  private async createTaskFile(data: TaskFormData): Promise<void> {
    const projectsFolder = this.plugin.data.settings.projectsFolder || "Projects";
    await createTaskFileShared(this.app, projectsFolder, data);
    this.taskStore.invalidate();
    this.renderPanels();
  }

  /** 切换任务完成状态；重复任务用 calcNextRemindDate 推进提醒日期。 */
  private async toggleTask(task: TaskItem, row: HTMLElement): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(task.sourceFile);
    if (!(file instanceof TFile)) return;
    if (task.type === "重复" && task.status !== "已完成") {
      const nextDate = calcNextRemindDate(task);
      if (nextDate) {
        await this.writeTaskField(task, "提醒日期", nextDate);
        task.remindDate = nextDate;
        const now = nowFmt();
        await this.writeTaskField(task, "完成时间", now);
        task.completeTime = now;
        new Notice("✨ 重复任务，下次提醒: " + nextDate);
        this.taskStore.invalidate();
        void this.renderAll(true);
        return;
      }
    }
    const newStatus: TaskStatus = task.status === "已完成" ? "待办" : "已完成";
    const now = nowFmt();
    await writeFrontmatter(this.app, file, {
      状态: newStatus,
      完成时间: newStatus === "已完成" ? now : null
    });
    task.status = newStatus;
    task.completeTime = newStatus === "已完成" ? now : null;
    row.toggleClass("is-done", newStatus === "已完成");
  }

  private async writeTaskField(
    task: TaskItem,
    fieldKey: string,
    value: string
  ): Promise<void> {
    if (!task.sourceFile) return;
    const file = this.app.vault.getAbstractFileByPath(task.sourceFile);
    if (!(file instanceof TFile)) return;
    await writeFrontmatter(this.app, file, { [fieldKey]: value });
  }

  /** 删除任务源笔记。 */
  private async deleteTask(task: TaskItem): Promise<void> {
    if (!task.sourceFile) return;
    const confirmed = await confirmDialog(this.app, {
      title: $t("dv.deleteTask"),
      message: $t("dv.confirm.deleteTask", { name: task.content }),
      confirmText: $t("set.remaining.758"),
      danger: true
    });
    if (!confirmed) return;
    const file = this.app.vault.getAbstractFileByPath(task.sourceFile);
    if (file instanceof TFile) {
      await this.app.fileManager.trashFile(file);
      new Notice("❌ 任务已删除: " + task.content);
      this.taskStore.invalidate();
      void this.renderAll(true);
    }
  }

  /** 新建项目：复用 ProjectModal（与主页右上角「新建项目」同一套富表单），
   *  创建 {projectsFolder}/{name}/project-{name}.md。 */
  private createProjectFile(): void {
    new ProjectModal({
      app: this.app,
      onSave: (data) => {
        void this.createProjectFolder(data);
      },
    }).open();
  }

  private async createProjectFolder(data: ProjectFormData): Promise<void> {
    const name = data.name;
    const rootPath = this.plugin.data.settings.projectsFolder || "Projects";
    await this.ensureFolder(rootPath);
    const safeName = name.replace(/[*"/<>:|?\\]/g, "-");
    const projectFolderPath = `${rootPath}/${safeName}`;
    await this.ensureFolder(projectFolderPath);
    const now = new Date();
    const createDate =
      now.getFullYear() +
      "-" +
      String(now.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(now.getDate()).padStart(2, "0");
    const typeLabel = data.type === "nostage" ? "非阶段项目" : "阶段项目";
    const projectFilePath = `${projectFolderPath}/project-${safeName}.md`;
    if (!(this.app.vault.getAbstractFileByPath(projectFilePath) instanceof TFile)) {
      const lines = [
        "---",
        `项目名称: ${yamlScalar(name)}`,
        `颜色: ${yamlScalar(data.color)}`,
        `项目类型: ${yamlScalar(typeLabel)}`,
        "tags: [配置]",
        `描述: ${yamlScalar(data.description)}`,
        `开始日期: ${yamlScalar(data.startDate)}`,
        `结束日期: ${yamlScalar(data.endDate)}`,
        `创建时间: ${createDate}`,
        "---",
        "",
        `# ${name}`,
        ""
      ];
      await this.app.vault.create(projectFilePath, lines.join("\n"));
      new Notice(`✨ 项目已创建：${name}`);
    }
    await this.renderAll(true);
  }

  private async ensureFolder(path: string): Promise<void> {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFolder) return;
    const parts = path.split("/").filter(Boolean);
    let cur = "";
    for (const part of parts) {
      cur = cur ? cur + "/" + part : part;
      if (!(this.app.vault.getAbstractFileByPath(cur) instanceof TFolder)) {
        await this.app.vault.createFolder(cur);
      }
    }
  }

  /** astra 事件绑定约定：登记到 renderDisposers，重渲染/卸载时统一清理。 */
  private listen<K extends keyof HTMLElementEventMap>(
    element: HTMLElement,
    eventName: K,
    handler: (event: HTMLElementEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions
  ): void {
    element.addEventListener(eventName, handler, options);
    this.renderDisposers.push(() =>
      element.removeEventListener(eventName, handler, options)
    );
  }

  private clearRenderResources(): void {
    this.renderDisposers.forEach((dispose) => dispose());
    this.renderDisposers = [];
  }
}

/** 解析 frontmatter 辅助（从项目文件读取「项目」字段以同步跨项目移动）。 */
function parseFrontmatter(content: string): Record<string, unknown> {
  // 采用 obsidian 官方 parseYaml，避免行级手工解析的转义/多行坑。
  // 此处仅需读取「项目」字段，逐行扫描即可，保持与 view 内其它写入路径一致。
  const out: Record<string, unknown> = {};
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return out;
  let i = 1;
  for (; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") break;
    const m = /^([^:]+):\s*(.*)$/.exec(lines[i] || "");
    if (m) out[m[1]!.trim()] = (m[2] ?? "").trim();
  }
  return out;
}