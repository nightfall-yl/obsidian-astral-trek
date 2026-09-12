import { initI18n } from "./i18n";
import type { App, PluginManifest} from "obsidian";
import { Plugin, TFile } from "obsidian";
import {
  AstraDashboardView,
  VIEW_TYPE_ASTRA_DASHBOARD
} from "./dashboard-view";
import {
  DEFAULT_DATA,
  DEFAULT_HEATMAP_SETTINGS,
  DEFAULT_SETTINGS,
  DEFAULT_CURSOR_POSITION_SETTINGS,
  DEFAULT_CALENDAR_SETTINGS,
  type AstraPluginData,
  type AstraSettings,
  type ForceViewModeSettings,
  type StartupMode
} from "./models";
import { AstraSettingTab } from "./settings";
import { StatsService } from "./stats-service";
import { ForceViewModeManager } from "./forceViewMode";
import { CursorPositionManager } from "./cursorPosition";
import { CalendarView } from "./calendar/CalendarView";
import { VIEW_TYPE_CALENDAR } from "./calendar/constants";
import { calendarSettings } from "./calendar/ui/stores";
import { defaultCalendarSettings } from "./calendar/settings";
import { MinimalManager } from "./minimal/manager";
import { LinterManager } from "./linter/manager";
import { StaticStore } from "./static-store";
import type { IWeekStartOption } from "obsidian-calendar-ui";

export default class AstraDashboardPlugin extends Plugin {
  data: AstraPluginData = structuredClone(DEFAULT_DATA);
  stats!: StatsService;
  forceViewModeManager!: ForceViewModeManager;
  cursorPositionManager!: CursorPositionManager;
  minimalManager!: MinimalManager;
  linterManager!: LinterManager;
  /** Section2「Markdown+」三功能（视图模式/Minimal/Linter）的统一设置存储。 */
  section2Store: StaticStore;
  private saveTimer: number | null = null;
  private vaultEventsRegistered = false;

  constructor(app: App, pluginManifest: PluginManifest) {
    super(app, pluginManifest);
    this.section2Store = new StaticStore(this);
  }

  async onload(): Promise<void> {
    await initI18n(this.app);
    await this.loadPluginData();
    this.stats = new StatsService(this.app, this);

    this.registerView(
      VIEW_TYPE_ASTRA_DASHBOARD,
      (leaf) => new AstraDashboardView(leaf, this)
    );

    this.addRibbonIcon("home", "打开 Astra", () => {
      void this.openDashboard("new-tab");
    });

    this.addSettingTab(new AstraSettingTab(this.app, this));

    // Calendar
    this.registerView(VIEW_TYPE_CALENDAR, (leaf) => new CalendarView(leaf));
    this.updateCalendarStore();
    if (this.data.settings.calendar.enabled) {
      this.addRibbonIcon("calendar-days", "打开日历", () => {
        void this.activateCalendarView();
      });
    }

    // Force View Mode（设置存于 Section2 的 static-data.json）
    this.forceViewModeManager = new ForceViewModeManager(this, this.section2Store.settings.forceViewMode);
    this.forceViewModeManager.onload();

    // Cursor Position
    this.cursorPositionManager = new CursorPositionManager(this, this.data.settings.cursorPosition);
    void this.cursorPositionManager.onload();

    // Minimal 主题设置（存于 Section2 的 static-data.json，挂在 Markdown+ Section）
    this.minimalManager = new MinimalManager(this.app, this, this.section2Store);
    await this.minimalManager.onload();

    // Linter 设置（存于 Section2 的 static-data.json，挂在 Markdown+ Section）
    this.linterManager = new LinterManager(this.app, this, this.section2Store);
    try {
      await this.linterManager.onload();
    } catch {
      // LinterManager 初始化失败不影响其余功能
    }

    this.app.workspace.onLayoutReady(() => {
      this.registerVaultEvents();
      if (this.data.settings.openOnStartup) {
        window.setTimeout(() => {
          void this.openDashboard(this.data.settings.startupMode);
        }, 0);
      }
    });
  }

  onunload(): void {
    this.forceViewModeManager?.onunload();
    this.cursorPositionManager?.onunload();
    this.minimalManager?.onunload();
    this.linterManager?.onunload();
    
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
      void this.saveData(this.data);
    }
  }

  async openDashboard(
    mode: StartupMode = this.data.settings.startupMode
  ): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(
      VIEW_TYPE_ASTRA_DASHBOARD
    )[0];
    if (existing) {
      await this.app.workspace.revealLeaf(existing);
      return;
    }

    const leaf =
      mode === "new-tab"
        ? this.app.workspace.getLeaf("tab")
        : this.app.workspace.getLeaf(false);
    await leaf.setViewState({
      type: VIEW_TYPE_ASTRA_DASHBOARD,
      active: true
    });
    await this.app.workspace.revealLeaf(leaf);
  }

  /** 打开首页看板并内嵌跳转到「全部项目」（不新开独立标签页）。 */
  async openProjectBoard(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(
      VIEW_TYPE_ASTRA_DASHBOARD
    );
    const existing = leaves[0];
    if (!existing) {
      const leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({
        type: VIEW_TYPE_ASTRA_DASHBOARD,
        active: true
      });
      await this.app.workspace.revealLeaf(leaf);
      // 等新面板完成 onOpen 的首次渲染后再导航，避免被后续渲染覆盖
      await new Promise((resolve) => window.setTimeout(resolve, 60));
      const view = leaf.view;
      if (view instanceof AstraDashboardView) {
        await view.navigateProjectBoard(null);
      }
      return;
    }
    await this.app.workspace.revealLeaf(existing);
    if (existing.view instanceof AstraDashboardView) {
      await existing.view.navigateProjectBoard(null);
    }
  }

  requestDataSave(): void {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
    }
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.saveData(this.data);
    }, 500);
  }

  async saveSettings(): Promise<void> {
    this.stats.invalidate();
    await this.saveData(this.data);
    this.refreshDashboardViews(true);
    this.forceViewModeManager?.updateSettings(this.section2Store.settings.forceViewMode);
    this.cursorPositionManager?.updateSettings(this.data.settings.cursorPosition);
    this.updateCalendarStore();
  }

  /**
   * 仅持久化当前数据，不刷新任何 dashboard 视图。
   * 用于编辑态内的模块拖拽/删除等即时操作：DOM 顺序已是最终结果，无需整页重建，
   * 避免刷新导致编辑态丢失、用户来不及点击「完成」。
   */
  async saveLayoutSilently(): Promise<void> {
    await this.saveData(this.data);
  }

  async saveDashboardPreferences(): Promise<void> {
    await this.saveData(this.data);
    this.refreshDashboardViews();
  }

  refreshDashboardViews(force = false): void {
    if (force) this.stats.invalidate();
    this.app.workspace
      .getLeavesOfType(VIEW_TYPE_ASTRA_DASHBOARD)
      .forEach((leaf) => {
        if (leaf.view instanceof AstraDashboardView) {
          leaf.view.requestRefresh();
        }
      });
  }

  async activateCalendarView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_CALENDAR);
    if (existing.length > 0) {
      await this.app.workspace.revealLeaf(existing[0]!);
      return;
    }
    const position = this.data.settings.calendar.position || "left";
    const leaf =
      position === "left"
        ? this.app.workspace.getLeftLeaf(false)
        : this.app.workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({
        type: VIEW_TYPE_CALENDAR,
        active: true,
      });
    }
    const calendarLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_CALENDAR)[0];
    if (calendarLeaf) {
      await this.app.workspace.revealLeaf(calendarLeaf);
    }
  }

  private updateCalendarStore(): void {
    const calSettings = this.data.settings.calendar;
    calendarSettings.set({
      ...defaultCalendarSettings,
      wordsPerDot: calSettings.wordsPerDot,
      weekStart: calSettings.weekStart as IWeekStartOption,
      shouldConfirmBeforeCreate: calSettings.shouldConfirmBeforeCreate,
      position: calSettings.position || "left",
      highlightToday: calSettings.highlightToday !== false,
    });
  }

  private async loadPluginData(): Promise<void> {
    const saved = (await this.loadData()) as Partial<AstraPluginData> | null;

    // Migrate heatmap settings from malformed values produced by earlier
    // reconciliation bugs.  Old code could persist quoted empty strings
    // (e.g. `""`, `" "`) into data.json; those silently produce zero
    // contributions when handed to `dv.pages(...)`, so the heatmap grid
    // renders but every cell stays grey.  Normalise them here so upgraded
    // users see colours without having to re-save settings manually.
    const savedHeat = saved?.settings?.heatmap;
    const migratedHeatmap = savedHeat
      ? { ...savedHeat }
      : undefined;
    if (migratedHeatmap) {
      const badEmpty = /^\s*"?\s*"?\s*$/; // matches "", " ", "  ", '""' (serialized quotes), whitespace-only
      if (
        typeof migratedHeatmap.dataSourceValue === "string" &&
        badEmpty.test(migratedHeatmap.dataSourceValue)
      ) {
        migratedHeatmap.dataSourceValue =
          DEFAULT_HEATMAP_SETTINGS.dataSourceValue;
      }
      if (
        typeof migratedHeatmap.dateFieldValue === "string" &&
        badEmpty.test(migratedHeatmap.dateFieldValue)
      ) {
        migratedHeatmap.dateFieldValue =
          DEFAULT_HEATMAP_SETTINGS.dateFieldValue;
      }
      if (
        typeof migratedHeatmap.dateFormat === "string" &&
        badEmpty.test(migratedHeatmap.dateFormat)
      ) {
        migratedHeatmap.dateFormat = DEFAULT_HEATMAP_SETTINGS.dateFormat;
      }
      if (
        typeof migratedHeatmap.countFieldValue === "string" &&
        badEmpty.test(migratedHeatmap.countFieldValue)
      ) {
        migratedHeatmap.countFieldValue =
          DEFAULT_HEATMAP_SETTINGS.countFieldValue;
      }
      if (
        typeof migratedHeatmap.excludeFolders === "string" &&
        badEmpty.test(migratedHeatmap.excludeFolders)
      ) {
        migratedHeatmap.excludeFolders =
          DEFAULT_HEATMAP_SETTINGS.excludeFolders;
      }
    }

    this.data = {
      ...structuredClone(DEFAULT_DATA),
      ...saved,
      settings: {
        ...DEFAULT_SETTINGS,
        ...(saved?.settings ?? {}),
        heatmap: {
          ...DEFAULT_HEATMAP_SETTINGS,
          ...(migratedHeatmap ?? {})
        },
        cursorPosition: {
          ...DEFAULT_CURSOR_POSITION_SETTINGS,
          ...(saved?.settings?.cursorPosition ?? {})
        },
        calendar: {
          ...DEFAULT_CALENDAR_SETTINGS,
          ...(saved?.settings?.calendar ?? {})
        }
      },
      activity: saved?.activity ?? {},
      linkSnapshots: saved?.linkSnapshots ?? {},
      fileWordCounts: saved?.fileWordCounts ?? {},
      trackingStartedAt: saved?.trackingStartedAt ?? null,
      linkTrackingStartedAt: saved?.linkTrackingStartedAt ?? null
    };

    // Section2「Markdown+」设置迁移：forceViewMode 旧版存于主 data.json，
    // 现统一并入 static-data.json（与 Minimal/Linter 一起），并从主数据移除。
    await this.section2Store.load();
    await this.section2Store.migrateFromLegacy();
    const legacyFV = (
      saved?.settings as Partial<AstraSettings> & {
        forceViewMode?: ForceViewModeSettings;
      }
    )?.forceViewMode;
    if (legacyFV) {
      this.section2Store.settings.forceViewMode = {
        ...this.section2Store.settings.forceViewMode, // 保留 store 默认值与已有别名配置
        ...legacyFV,
      };
      await this.section2Store.save();
    }
    // 主数据内的残留 forceViewMode 字段（运行时由展开保留，类型上已移除）显式删除，
    // 避免 saveData 把旧值写回。
    if ("forceViewMode" in (this.data.settings as unknown as Record<string, unknown>)) {
      delete (this.data.settings as unknown as Record<string, unknown>).forceViewMode;
    }

    // 迁移旧「快速捕捉」设置：旧版为 storagePath/namingPattern/templateFile（每日新建），
    // 新版统一追加写入 filePath 指定的单个文件。路径由用户在设置里自行选择，这里只做兼容迁移。
    const qc = this.data.settings.quickCapture as
      | (typeof this.data.settings.quickCapture & {
          storagePath?: string;
          namingPattern?: string;
          templateFile?: string;
        })
      | undefined;
    if (!qc || typeof qc.filePath !== "string" || !qc.filePath.trim()) {
      const dir = (qc?.storagePath ?? "").trim().replace(/\/+$/, "");
      // 只从旧字段继承目录；没有则留空，由用户在设置里自行选择
      this.data.settings.quickCapture = {
        filePath: dir ? `${dir}/快速捕获.md` : ""
      };
    }
  }

  private registerVaultEvents(): void {
    if (this.vaultEventsRegistered) return;
    this.vaultEventsRegistered = true;

    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (!(file instanceof TFile) || file.extension !== "md") return;
        void this.stats.recordFileChange(file).then(() => {
          this.refreshDashboardViews();
        });
      })
    );

    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (!(file instanceof TFile) || file.extension !== "md") return;
        void this.stats.recordFileChange(file, true).then(() => {
          this.refreshDashboardViews();
        });
      })
    );

    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (!(file instanceof TFile) || file.extension !== "md") return;
        this.stats.recordDelete(file);
        this.refreshDashboardViews();
      })
    );

    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (!(file instanceof TFile) || file.extension !== "md") return;
        this.stats.recordRename(file, oldPath);
        this.refreshDashboardViews();
      })
    );

    this.registerEvent(
      this.app.metadataCache.on("resolved", () => {
        this.refreshDashboardViews();
      })
    );
  }
}
