/**
 * Linter 功能的宿主管理器。
 * 设置统一存放在 Section2 的 `static-data.json`（经 StaticStore），与 Dashboard 主数据分离。
 * 负责：独立存取设置、保存时格式化（拦截 `editor:save-file`）、文件夹忽略判定、
 * 以及按用户启用范围执行两个规则（YAML 时间戳 / 不同内容间换行）。
 */
import type { App, Plugin, TFile} from "obsidian";
import { type Editor } from "obsidian";
import { normalizePath } from "obsidian";
import { diffRange } from "./diff-range";
import { DEFAULT_SETTINGS, type LinterSettings } from "./settings";
import { applyTwoSpaces } from "./two-spaces";
import { applyYamlTimestamp, type YamlTimestampRuntime } from "./yaml-timestamp";
import type { StaticStore } from "../static-store";

export class LinterManager {
  settings: LinterSettings = { ...DEFAULT_SETTINGS };

  /** 记录每个文件「本插件写盘后」的内容，用于防重复 lint。 */
  private lastLintedContent = new Map<string, string>();
  /** 防重入：diff 回写编辑器期间阻止 change 事件触发 lint。 */
  private isApplyingLint = false;
  /** 防抖定时器：编辑器内容变更后延迟触发 lint。 */
  private lintTimer: number | null = null;
  /** 被拦截保存命令的原始 checkCallback（卸载时恢复）。 */
  private originalSaveCallback?: (checking: boolean) => boolean | void;

  constructor(
    private readonly app: App,
    private readonly plugin: Plugin,
    private readonly store: StaticStore
  ) {}

  async loadSettings(): Promise<void> {
    this.settings = this.store.settings.linter;
  }

  async saveSettings(): Promise<void> {
    await this.store.save();
  }

  async onload(): Promise<void> {
    try {
      await this.loadSettings();
      this.registerSaveHook();
    } catch {
      // 加载失败保持静默，不影响插件其余功能
    }
  }

  onunload(): void {
    this.lastLintedContent.clear();
    if (this.lintTimer !== null) {
      window.clearTimeout(this.lintTimer);
      this.lintTimer = null;
    }
    // 恢复被拦截的保存命令回调
    if (this.originalSaveCallback) {
      const commands = (
        this.app as unknown as { commands: { commands?: Record<string, unknown> } }
      ).commands;
      const saveCommand = commands?.commands?.["editor:save-file"] as
        | { checkCallback?: (checking: boolean) => boolean | void }
        | undefined;
      if (saveCommand) {
        saveCommand.checkCallback = this.originalSaveCallback;
      }
      this.originalSaveCallback = undefined;
    }
  }

  /** 判断文件是否应被忽略（前缀匹配 foldersToIgnore）。 */
  shouldIgnoreFile(file: TFile | null): boolean {
    if (!file) return true;
    if (file.extension !== "md") return true;
    for (const folder of this.settings.foldersToIgnore) {
      const f = normalizePath(folder);
      if (f !== "/" && file.path.startsWith(`${f}/`)) {
        return true;
      }
    }
    return false;
  }

  /**
   * 对给定文件内容执行启用中的规则。返回规则应用后的新文本。
   * 编辑触发路径（includeYaml=false）不执行 YAML 时间戳：时间戳属于「文件完成态」
   * 维护，在打字间隙刷新既语义错误，又会因非幂等（时间持续前进）造成持续 churn；
   * 仅保存触发（includeYaml=true，此时 file.stat.mtime 已刷新，时间戳的 5s 守卫
   * 能正常通过）时维护时间戳。
   */
  lintText(text: string, file: TFile, includeYaml = true): string {
    let modified = false;
    const twoSpacesEnabled = this.settings.twoSpaces.enabled;
    const yamlEnabled = includeYaml && this.settings.yamlTimestamp.enabled;

    let result = text;

    if (twoSpacesEnabled) {
      const twoSpaced = applyTwoSpaces(result);
      if (twoSpaced !== result) {
        result = twoSpaced;
        modified = true;
      }
    }

    if (yamlEnabled) {
      const runtime: YamlTimestampRuntime = {
        alreadyModified: modified,
        fileCreatedTime: new Date(file.stat.ctime).toISOString(),
        fileModifiedTime: new Date(file.stat.mtime).toISOString(),
        currentTime: window.moment(),
        locale: "en",
        fileName: file.path,
      };
      result = applyYamlTimestamp(result, this.settings.yamlTimestamp, runtime);
    }

    return result;
  }

  // -------------------------------------------------------------------------
  // 保存时格式化：完全复刻原项目 obsidian-linter 的机制。
  // 拦截 `editor:save-file` 命令的 checkCallback：
  //   - checking=true  → 透传原回调（命令可用性判定）
  //   - checking=false → 先执行原回调完成保存，随后 lint（lintOnSave 开启时）
  // 这是 Obsidian 官方、可靠的保存钩子，Cmd+S 本质是该命令。
  // -------------------------------------------------------------------------
  private registerSaveHook(): void {
    const commands = (
      this.app as unknown as { commands: { commands?: Record<string, unknown> } }
    ).commands;
    const saveCommand = commands?.commands?.["editor:save-file"] as
      | { checkCallback?: (checking: boolean) => boolean | void }
      | undefined;
    this.originalSaveCallback = saveCommand?.checkCallback;
    const orig = this.originalSaveCallback;

    if (typeof orig === "function") {
      saveCommand!.checkCallback = (checking: boolean): boolean | void => {
        if (checking) {
          return orig(checking);
        }
        // 先保存，再 lint
        orig(checking);
        if (this.settings.lintOnSave) {
          const file = this.app.workspace.getActiveFile();
          const info = this.app.workspace.activeEditor as
            | { editor: Editor }
            | null;
          const editor = info?.editor ?? null;
          if (file && editor && !this.shouldIgnoreFile(file)) {
            void this.runLinterEditor(editor, file);
          }
        }
      };
    } else {
      // editor:save-file 命令不可用，保存时 lint 关闭
    }

    // 「编辑即触发」模式（lintOnSave=false）：监听内容变更 → 防抖 lint。
    // （lintOnSave=true 时 editor:save-file 拦截已覆盖，此处不重复触发）
    this.plugin.registerEvent(
      this.app.workspace.on("editor-change", (_editor: Editor, info: unknown) => {
        if (this.settings.lintOnSave) return; // 保存模式由命令拦截驱动
        if (this.isApplyingLint) return;

        const file = (info as { file?: TFile }).file ?? null;
        if (!file || this.shouldIgnoreFile(file)) return;

        if (this.lintTimer !== null) {
          window.clearTimeout(this.lintTimer);
        }
        this.lintTimer = window.setTimeout(() => {
          this.lintTimer = null;
          const currentFile = this.app.workspace.getActiveFile();
          if (!currentFile || this.shouldIgnoreFile(currentFile)) return;
          const activeInfo = this.app.workspace.activeEditor as
            | { editor: Editor }
            | null;
          const activeEditor = activeInfo?.editor ?? null;
          if (activeEditor) {
            // 编辑触发路径不维护 YAML 时间戳（见 lintText 注释）
            void this.runLinterEditor(activeEditor, currentFile, false);
          }
        }, 800);
      })
    );
  }

  private async runLinterEditor(
    editor: Editor,
    file: TFile,
    includeYaml = true
  ): Promise<void> {
    const markdown = editor.getValue();
    if (!markdown) return;

    const linted = this.lintText(markdown, file, includeYaml);
    if (linted === markdown) {
      return;
    }

    // 防止替换内容触发 change → 再次进入 lint（死循环）。
    this.isApplyingLint = true;
    try {
      // 只替换新旧文本的差异区间，而不是整文替换：光标/滚动位于公共前后缀内时
      // 由 CodeMirror 原生位置映射保持不动。整文替换会把位于替换区域内的光标
      // 映射回文档顶部（社区反馈：打字时光标反复跳顶）。
      const { from, to, insert } = diffRange(markdown, linted);
      editor.replaceRange(insert, from, to);
      this.lastLintedContent.set(file.path, linted);
    } finally {
      // 下一帧解除，确保 CodeMirror 的 change 事件已派发完毕。
      window.setTimeout(() => {
        this.isApplyingLint = false;
      }, 0);
    }
  }
}