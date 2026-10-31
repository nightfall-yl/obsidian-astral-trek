import type { Plugin, TAbstractFile, Editor, TFile, WorkspaceLeaf } from "obsidian";
import { MarkdownView } from "obsidian";
import type { CursorPositionSettings } from "./models";

/**
 * `leaf.id` 与 `viewState.state.file` 都不是官方 API。
 * 这里集中声明内部形状并统一转成字符串再拼接，避免在调用点对 unknown 做 `+` 运算。
 */
function leafKey(leaf: WorkspaceLeaf): string {
  const internal = leaf as unknown as {
    id?: string;
    getViewState: () => { state?: { file?: string } };
  };
  const id = internal.id ?? "";
  const file = internal.getViewState().state?.file ?? "";
  return `${id}:${file}`;
}

interface EphemeralState {
  cursor?: {
    from: { ch: number; line: number };
    to: { ch: number; line: number };
  };
  scroll?: number;
}

export class CursorPositionManager {
  private plugin: Plugin;
  private settings: CursorPositionSettings;
  private db: { [file_path: string]: EphemeralState } = {};
  private lastSavedDb: { [file_path: string]: EphemeralState } = {};
  private lastEphemeralState: EphemeralState = {};
  private lastLoadedFileName: string = "";
  private loadedLeafIdList: string[] = [];
  private loadingFile = false;
  private pollTimer: number | null = null;
  private pollIdleTicks = 0;

  constructor(plugin: Plugin, settings: CursorPositionSettings) {
    this.plugin = plugin;
    this.settings = settings;
  }

  updateSettings(settings: CursorPositionSettings) {
    this.settings = settings;
  }

  async onload() {
    if (!this.settings.enabled) return;

    try {
      this.db = await this.readDb();
      this.lastSavedDb = await this.readDb();
    } catch {
      this.db = {};
      this.lastSavedDb = {};
    }

    this.plugin.registerEvent(
      this.plugin.app.workspace.on("file-open", (file) => {
        // 切换文件后立即恢复快采节奏
        this.pollIdleTicks = 0;
        void this.restoreEphemeralState(file || undefined);
      })
    );

    this.plugin.registerEvent(
      this.plugin.app.workspace.on("quit", () => {
        void this.writeDb(this.db);
      })
    );

    this.plugin.registerEvent(
      this.plugin.app.vault.on("rename", (file, oldPath) =>
        this.renameFile(file, oldPath)
      )
    );

    this.plugin.registerEvent(
      this.plugin.app.vault.on("delete", (file) => this.deleteFile(file))
    );

    this.scheduleNextPoll();

    this.plugin.registerInterval(
      window.setInterval(() => {
        void this.writeDb(this.db);
      }, this.settings.saveTimer)
    );

    void this.restoreEphemeralState();
  }

  onunload() {
    if (this.pollTimer !== null) {
      window.clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    void this.writeDb(this.db);
  }

  /**
   * 自调度轮询：状态有变化后保持 100ms 快采，连续静默后回退 1s 慢采。
   * 原实现为固定 100ms 常驻 setInterval（每秒 10 次永不停止）；
   * 滚动/光标位置无官方事件可订阅，故保留轮询但空闲降频——
   * 活跃编辑时采样精度与原版一致，空闲时 CPU/电量占用降约 90%。
   */
  private scheduleNextPoll(
    delayMs = CursorPositionManager.POLL_FAST_MS
  ): void {
    this.pollTimer = window.setTimeout(() => {
      this.pollTimer = null;
      if (this.checkEphemeralStateChanged()) {
        this.pollIdleTicks = 0;
      } else if (this.pollIdleTicks < CursorPositionManager.POLL_IDLE_AFTER_TICKS) {
        this.pollIdleTicks += 1;
      }
      this.scheduleNextPoll(
        this.pollIdleTicks >= CursorPositionManager.POLL_IDLE_AFTER_TICKS
          ? CursorPositionManager.POLL_IDLE_MS
          : CursorPositionManager.POLL_FAST_MS
      );
    }, delayMs);
  }

  private renameFile(file: TAbstractFile, oldPath: string) {
    const newName = file.path;
    const oldName = oldPath;
    this.db[newName] = this.db[oldName]!;
    delete this.db[oldName];
  }

  private deleteFile(file: TAbstractFile) {
    const fileName = file.path;
    delete this.db[fileName];
  }

  private static readonly POLL_FAST_MS = 100;
  private static readonly POLL_IDLE_MS = 1000;
  private static readonly POLL_IDLE_AFTER_TICKS = 10;

  /** @returns 本次采样相对上次是否有变化（驱动快慢轮询回退）。 */
  private checkEphemeralStateChanged(): boolean {
    if (!this.settings.enabled) return false;

    const fileName = this.plugin.app.workspace.getActiveFile()?.path;
    if (!fileName || !this.lastLoadedFileName || fileName != this.lastLoadedFileName || this.loadingFile)
      return false;

    const st = this.getEphemeralState();
    if (!this.lastEphemeralState) this.lastEphemeralState = st;

    if (!isNaN(st.scroll!) && !this.isEphemeralStatesEquals(st, this.lastEphemeralState)) {
      void this.saveEphemeralState(st);
      this.lastEphemeralState = st;
      return true;
    }
    return false;
  }

  private isEphemeralStatesEquals(state1: EphemeralState, state2: EphemeralState): boolean {
    if (state1.cursor && !state2.cursor) return false;
    if (!state1.cursor && state2.cursor) return false;

    if (state1.cursor && state2.cursor) {
      if (state1.cursor.from.ch != state2.cursor.from.ch) return false;
      if (state1.cursor.from.line != state2.cursor.from.line) return false;
      if (state1.cursor.to.ch != state2.cursor.to.ch) return false;
      if (state1.cursor.to.line != state2.cursor.to.line) return false;
    }

    if (state1.scroll && !state2.scroll) return false;
    if (!state1.scroll && state2.scroll) return false;
    if (state1.scroll && state1.scroll != state2.scroll) return false;

    return true;
  }

  private async saveEphemeralState(st: EphemeralState) {
    const fileName = this.plugin.app.workspace.getActiveFile()?.path;
    if (fileName && fileName == this.lastLoadedFileName) {
      this.db[fileName] = st;
    }
  }

  private async restoreEphemeralState(_file?: TFile) {
    if (!this.settings.enabled) return;

    const fileName = this.plugin.app.workspace.getActiveFile()?.path;

    if (fileName && this.loadingFile && this.lastLoadedFileName == fileName) return;

    const activeLeaf = this.plugin.app.workspace.getMostRecentLeaf();
    // @ts-ignore no-official-API
    if (activeLeaf && this.loadedLeafIdList.includes(leafKey(activeLeaf)))
      return;

    this.loadedLeafIdList = [];
    this.plugin.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.getViewState().type === "markdown") {
        this.loadedLeafIdList.push(leafKey(leaf));
      }
    });

    this.loadingFile = true;

    if (this.lastLoadedFileName != fileName) {
      this.lastEphemeralState = {};
      this.lastLoadedFileName = fileName || "";

      let st: EphemeralState | undefined;

      if (fileName) {
        st = this.db[fileName];
        if (st) {
          await this.delay(this.settings.delayAfterFileOpening);

          const containsFlashingSpan = this.plugin.app.workspace.containerEl.querySelector(".is-flashing");
          if (!containsFlashingSpan) {
            await this.delay(10);
            this.setEphemeralState(st);
          }
        }
      }
      this.lastEphemeralState = st || {};
    }

    this.loadingFile = false;
  }

  private get dbFilePath(): string {
    return `${this.plugin.app.vault.configDir}/plugins/${this.plugin.manifest.id}/cursor.json`;
  }

  private async readDb(): Promise<{ [file_path: string]: EphemeralState }> {
    let db: { [file_path: string]: EphemeralState } = {};

    if (await this.plugin.app.vault.adapter.exists(this.dbFilePath)) {
      const data = await this.plugin.app.vault.adapter.read(this.dbFilePath);
      db = JSON.parse(data) as typeof db;
    }

    return db;
  }

  private async writeDb(db: { [file_path: string]: EphemeralState }) {
    if (!this.settings.enabled) return;

    const newParentFolder = this.dbFilePath.substring(0, this.dbFilePath.lastIndexOf("/"));
    if (newParentFolder && !(await this.plugin.app.vault.adapter.exists(newParentFolder))) {
      await this.plugin.app.vault.adapter.mkdir(newParentFolder);
    }

    if (JSON.stringify(this.db) !== JSON.stringify(this.lastSavedDb)) {
      await this.plugin.app.vault.adapter.write(this.dbFilePath, JSON.stringify(db));
      this.lastSavedDb = JSON.parse(JSON.stringify(db)) as typeof this.lastSavedDb;
    }
  }

  private getEphemeralState(): EphemeralState {
    const state: EphemeralState = {};
    state.scroll = Number(
      this.plugin.app.workspace.getActiveViewOfType(MarkdownView)?.currentMode?.getScroll()?.toFixed(4)
    );

    const editor = this.getEditor();
    if (editor) {
      const from = editor.getCursor("anchor");
      const to = editor.getCursor("head");
      if (from && to) {
        state.cursor = {
          from: { ch: from.ch, line: from.line },
          to: { ch: to.ch, line: to.line },
        };
      }
    }

    return state;
  }

  private setEphemeralState(state: EphemeralState) {
    const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);

    if (state.cursor) {
      const editor = this.getEditor();
      if (editor) {
        editor.setSelection(state.cursor.from, state.cursor.to);
      }
    }

    if (view && state.scroll) {
      view.setEphemeralState(state);
    }
  }

  private getEditor(): Editor | undefined {
    return this.plugin.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
  }

  private async delay(ms: number) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }
}
