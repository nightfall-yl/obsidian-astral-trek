import { t as $t } from "./i18n";
import {
  AbstractInputSuggest,
  Modal,
  PluginSettingTab,
  SettingGroup,
  TFolder,
  TFile,
  normalizePath,
  setIcon,
} from "obsidian";
import type { App, SettingDefinitionItem } from "obsidian";
import type AstraDashboardPlugin from "./main";
import type { StartupMode } from "./models";
import {
  DEFAULT_CALENDAR_SETTINGS,
  DEFAULT_CURSOR_POSITION_SETTINGS,
  DEFAULT_QUICK_CAPTURE_SETTINGS,
  DEFAULT_DIARY_SETTINGS,
  DEFAULT_COUNTDOWN_SETTINGS,
  DEFAULT_DAILY_PHRASE_SETTINGS
} from "./models";
import { lightSchemeOptions, darkSchemeOptions } from "./minimal/schemes";

export class AstraSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly astraPlugin: AstraDashboardPlugin
  ) {
    super(app, astraPlugin);
  }

  display(): void {
    renderSettings(this.containerEl, this.astraPlugin);
  }

  /**
   * 声明式设置 API（Obsidian 1.13+）：
   * 本插件设置页为命令式构建（见下方 renderSettings），返回空数组以保持
   * Obsidian 继续调用 display() 走命令式渲染，避免声明式接管整页设置。
   * 该空实现仅为显式声明“已采纳声明式接口”，供设置搜索/校验器识别。
   */
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [];
  }

  getControlValue(): unknown {
    return undefined;
  }

  setControlValue(_key: string, _value: unknown): void | Promise<void> {}
}

export class AstraSettingsModal extends Modal {
  constructor(
    app: App,
    private readonly astraPlugin: AstraDashboardPlugin
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("astra-settings-modal");
    renderSettings(this.contentEl, this.astraPlugin);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/**
 * 「项目文件夹」输入框的文件夹联想（学习 Obsidian 官方「文件与链接 → 附件文件夹路径」的
 * FolderSuggest：输入时按路径前缀联想库内文件夹，选中后回填相对路径）。
 */
class ProjectFolderSuggest extends AbstractInputSuggest<TFolder> {
  constructor(
    app: App,
    inputEl: HTMLInputElement,
    private readonly onApply: (path: string) => void
  ) {
    super(app, inputEl);
  }

  getSuggestions(query: string): TFolder[] {
    const lower = query.trim().toLowerCase();
    const folders: TFolder[] = [];
    const limit = this.limit || 100;
    for (const file of this.app.vault.getAllLoadedFiles()) {
      if (!(file instanceof TFolder)) continue;
      if (folders.length >= limit) break;
      // 根目录不列为建议
      if (file.path === "/") continue;
      // 空查询列出全部文件夹；否则按「任一段路径包含」联想
      if (!lower || file.path.toLowerCase().includes(lower)) folders.push(file);
    }
    return folders;
  }

  renderSuggestion(folder: TFolder, el: HTMLElement): void {
    el.setText(folder.path);
  }

  selectSuggestion(folder: TFolder, _evt: MouseEvent | KeyboardEvent): void {
    this.setValue(folder.path);
    this.close();
    this.onApply(folder.path);
  }
}

/**
 * 「快速捕获文件」输入框的文件联想（与「项目文件夹」的 FolderSuggest 同一交互，面向库内 md 笔记）。
 */
class ProjectFileSuggest extends AbstractInputSuggest<TFile> {
  constructor(
    app: App,
    inputEl: HTMLInputElement,
    private readonly onApply: (path: string) => void
  ) {
    super(app, inputEl);
  }

  getSuggestions(query: string): TFile[] {
    const lower = query.trim().toLowerCase();
    const files: TFile[] = [];
    const limit = this.limit || 100;
    for (const file of this.app.vault.getAllLoadedFiles()) {
      if (!(file instanceof TFile) || file.extension !== "md") continue;
      if (files.length >= limit) break;
      if (!lower || file.path.toLowerCase().includes(lower)) files.push(file);
    }
    return files;
  }

  renderSuggestion(file: TFile, el: HTMLElement): void {
    el.setText(file.path);
  }

  selectSuggestion(file: TFile, _evt: MouseEvent | KeyboardEvent): void {
    this.setValue(file.path);
    this.close();
    this.onApply(file.path);
  }
}

type SettingsSection = {
  id: string;
  label: string;
  icon: string;
};

function renderSettings(
  container: HTMLElement,
  plugin: AstraDashboardPlugin
): void {
  container.empty();
  container.addClass("astra-settings-root");

  // Defensive: ensure new settings exist (in case data.json predates migration)
  if (!plugin.data.settings.calendar) {
    plugin.data.settings.calendar = { ...DEFAULT_CALENDAR_SETTINGS };
  }
  if (!plugin.data.settings.cursorPosition) {
    plugin.data.settings.cursorPosition = { ...DEFAULT_CURSOR_POSITION_SETTINGS };
  }
  if (!plugin.data.settings.quickCapture) {
    plugin.data.settings.quickCapture = { ...DEFAULT_QUICK_CAPTURE_SETTINGS };
  } else {
    // 迁移旧字段：旧版按「文件夹 + 命名模板」每日新建笔记；新版改为追加写入指定文件
    const qc = plugin.data.settings.quickCapture as typeof plugin.data.settings.quickCapture & {
      storagePath?: string;
      namingPattern?: string;
      templateFile?: string;
    };
    if (typeof qc.filePath !== "string" || !qc.filePath.trim()) {
      const dir = (qc.storagePath ?? "").trim().replace(/\/+$/, "");
      // 只从旧字段继承目录；没有则留空，由用户在设置里自行选择
      qc.filePath = dir ? `${dir}/快速捕获.md` : "";
      delete qc.storagePath;
      delete qc.namingPattern;
      delete qc.templateFile;
    }
  }
  if (!plugin.data.settings.diary) {
    plugin.data.settings.diary = { ...DEFAULT_DIARY_SETTINGS };
  }
  if (!plugin.data.settings.countdown) {
    plugin.data.settings.countdown = { ...DEFAULT_COUNTDOWN_SETTINGS };
  }
  if (!plugin.data.settings.dailyPhrase) {
    plugin.data.settings.dailyPhrase = { ...DEFAULT_DAILY_PHRASE_SETTINGS };
  }
  if (!plugin.data.settings.npdpStages) {
    plugin.data.settings.npdpStages = ["Charter", "PDCP", "TR", "ADCP", "COR"];
  }
  if (typeof plugin.data.settings.projectsFolder !== "string") {
    plugin.data.settings.projectsFolder = "Projects";
  }
  // Defensive: ensure project-board (gantt/list) settings exist for older data.json
  if (typeof plugin.data.settings.currentPoView !== "string") {
    plugin.data.settings.currentPoView = "gantt";
  }
  if (typeof plugin.data.settings.poGanttScale !== "string") {
    plugin.data.settings.poGanttScale = "week";
  }
  if (!Array.isArray(plugin.data.settings.poGanttStatusFilter)) {
    plugin.data.settings.poGanttStatusFilter = [];
  }
  if (!Array.isArray(plugin.data.settings.poProjectOrder)) {
    plugin.data.settings.poProjectOrder = [];
  }
  if (!Array.isArray(plugin.data.settings.poTaskOrder)) {
    plugin.data.settings.poTaskOrder = [];
  }
  if (!Array.isArray(plugin.data.settings.mobileHiddenModules)) {
    plugin.data.settings.mobileHiddenModules = ["todo", "weekly", "projects", "countdown"];
  }
  // 对齐当前默认：本应默认在移动端显示、且用户仍在主页保留的模块，
  // 不应残留在 mobileHiddenModules（旧数据/手动误隐藏会导致移动端整卡消失，如每日口语）。
  // 仅清理「默认可见且仍在 homeModuleOrder」的模块，不动用户真正想隐藏的 todo/progress 等。
  {
    const mobileVisibleByDefault = ["qc", "dailyPhrase", "recent"];
    const order = plugin.data.settings.homeModuleOrder ?? [];
    plugin.data.settings.mobileHiddenModules = plugin.data.settings.mobileHiddenModules.filter(
      (id) => !(mobileVisibleByDefault.includes(id) && order.includes(id))
    );
  }

  const sections: SettingsSection[] = [
    {
      id: "dashboard",
      label: "Astra",
      icon: "layout-dashboard",
    },
    {
      id: "markdown",
      label: "Markdown +",
      icon: "file-text",
    },
  ];

  const navEl = container.createDiv({ cls: "astra-settings-nav" });
  const contentEl = container.createDiv({ cls: "astra-settings-content" });
  const sectionEls = new Map<string, HTMLElement>();
  const navButtons = new Map<string, HTMLButtonElement>();

  const setActiveSection = (sectionId: string) => {
    sectionEls.forEach((sectionEl, id) => {
      sectionEl.toggleClass("is-active", id === sectionId);
    });
    navButtons.forEach((button, id) => {
      button.toggleClass("is-active", id === sectionId);
    });
  };

  sections.forEach((section, index) => {
    const button = navEl.createEl("button", {
      cls: "astra-settings-nav-btn",
      attr: { type: "button" },
    });
    const iconEl = button.createSpan({ cls: "astra-settings-nav-icon" });
    setIcon(iconEl, section.icon);
    button.createSpan({ text: section.label });
    button.addEventListener("click", () => setActiveSection(section.id));
    navButtons.set(section.id, button);

    const sectionEl = contentEl.createDiv({ cls: "astra-settings-section" });
    sectionEls.set(section.id, sectionEl);
    if (index === 0) {
      sectionEl.addClass("is-active");
      button.addClass("is-active");
    }
  });

  // ===================== Dashboard =====================
  const dashboardEl = sectionEls.get("dashboard")!;

  // ── 通用 ──
  const generalGroup = new SettingGroup(dashboardEl).setHeading($t("p4.10064"));

  generalGroup.addSetting((setting) => {
    setting
      .setName($t("p4.10065"))
      .setDesc($t("p4.10066"))
      .addText((text) =>
        text
          .setPlaceholder($t("p4.10067"))
          .setValue(plugin.data.settings.displayName)
          .onChange((value) => {
            void (async () => {
              plugin.data.settings.displayName = value.trim();
              await plugin.saveSettings();
            })();
          })
      );
  });

  generalGroup.addSetting((setting) => {
    setting
      .setName($t("p4.10068"))
      .setDesc($t("p4.10069"))
      .addToggle((toggle) =>
        toggle
          .setValue(plugin.data.settings.openOnStartup)
          .onChange((value) => {
            void (async () => {
              plugin.data.settings.openOnStartup = value;
              await plugin.saveSettings();
            })();
          })
      );
  });

  generalGroup.addSetting((setting) => {
    setting
      .setName($t("p4.10070"))
      .setDesc($t("p4.10071"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("replace-active", $t("p4.10072"))
          .addOption("new-tab", $t("p4.10073"))
          .setValue(plugin.data.settings.startupMode)
          .onChange((value) => {
            void (async () => {
              plugin.data.settings.startupMode = value as StartupMode;
              await plugin.saveSettings();
            })();
          })
      );
  });

  generalGroup.addSetting((setting) => {
    setting
      .setName($t("p4.10074"))
      .setDesc($t("p4.10075"))
      .addSlider((slider) =>
        slider
          .setLimits(0, 100, 5)
          .setValue(plugin.data.settings.shortNoteWordThreshold)
          .onChange((value) => {
            void (async () => {
              plugin.data.settings.shortNoteWordThreshold = value;
              await plugin.saveSettings();
            })();
          })
      );
  });

  generalGroup.addSetting((setting) => {
    setting
      .setName($t("p4.10076"))
      .setDesc($t("p4.10077"))
      .addTextArea((text) => {
        text
          .setPlaceholder($t("p4.10078"))
          .setValue(plugin.data.settings.excludedFolders.join("\n"))
          .onChange((value) => {
            void (async () => {
              plugin.data.settings.excludedFolders = parseExcludedFolders(value);
              await plugin.saveSettings();
            })();
          });
        text.inputEl.rows = 4;
      });
  });

  // ── 主页模块 ──
  const modulesGroup = new SettingGroup(dashboardEl).setHeading($t("p4.10079"));

  modulesGroup.addSetting((setting) => {
    setting
      .setName($t("p4.10080"))
      .setDesc($t("p4.10081"))
      .addText((text) => {
        text
          .setPlaceholder("Projects")
          .setValue(plugin.data.settings.projectsFolder)
          .onChange((value) => {
            void (async () => {
              plugin.data.settings.projectsFolder = value.trim();
              await plugin.saveSettings();
            })();
          });
        // 输入时联想库内文件夹，选中后回填相对路径（学习 Obsidian 官方「附件文件夹路径」交互）
        new ProjectFolderSuggest(plugin.app, text.inputEl, (path) => {
          plugin.data.settings.projectsFolder = path;
          void plugin.saveSettings();
        });
      });
  });

  modulesGroup.addSetting((setting) => {
    setting
      .setName($t("p4.10082"))
      .setDesc($t("p4.10083"))
      .addText((text) =>
        text
          .setPlaceholder($t("p4.10084"))
          .setValue(plugin.data.settings.todoSourceFolder)
          .onChange((value) => {
            void (async () => {
              plugin.data.settings.todoSourceFolder = value.trim();
              await plugin.saveSettings();
            })();
          })
      );
  });

  modulesGroup.addSetting((setting) => {
    setting
      .setName($t("p4.10085"))
      .setDesc($t("p4.10086"))
      .addText((text) =>
        text
          .setPlaceholder("Charter,PDCP,TR,ADCP,COR")
          .setValue(plugin.data.settings.npdpStages.join(","))
          .onChange((value) => {
            void (async () => {
              plugin.data.settings.npdpStages = value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
              await plugin.saveSettings();
            })();
          })
      );
  });

  modulesGroup.addSetting((setting) => {
    setting
      .setName($t("p4.10087"))
      .setDesc($t("p4.10088"))
      .addSlider((slider) =>
        slider
          .setLimits(1, Math.max(1, plugin.data.settings.npdpStages.length), 1)
          .setValue(
            Math.min(plugin.data.settings.npdpProgressFilter, plugin.data.settings.npdpStages.length)
          )
          .onChange((value) => {
            void (async () => {
              plugin.data.settings.npdpProgressFilter = value;
              await plugin.saveSettings();
            })();
          })
      );
  });

  modulesGroup.addSetting((setting) => {
    setting
      .setName($t("p4.10089"))
      .setDesc($t("p4.10090"))
      .addText((text) => {
        text
          .setPlaceholder($t("p4.10091"))
          .setValue(plugin.data.settings.quickCapture.filePath)
          .onChange((value) => {
            void (async () => {
              plugin.data.settings.quickCapture.filePath = value.trim();
              await plugin.saveSettings();
            })();
          });
        // 输入时联想库内 md 笔记，选中后回填路径（与「项目文件夹」的交互一致，替换原「选择」弹窗按钮）
        new ProjectFileSuggest(plugin.app, text.inputEl, (path) => {
          plugin.data.settings.quickCapture.filePath = path;
          void plugin.saveSettings();
        });
      });
  });

  modulesGroup.addSetting((setting) => {
    setting
      .setName($t("p4.10092"))
      .setDesc($t("p4.10093"))
      .addText((text) => {
        text
          .setPlaceholder($t("p4.10094"))
          .setValue(plugin.data.settings.dailyPhrase.filePath)
          .onChange((value) => {
            void (async () => {
              plugin.data.settings.dailyPhrase.filePath = value.trim();
              await plugin.saveSettings();
            })();
          });
        new ProjectFileSuggest(plugin.app, text.inputEl, (path) => {
          plugin.data.settings.dailyPhrase.filePath = path;
          void plugin.saveSettings();
        });
      });
  });

  // ── 移动端模块显隐 ──
  const mobileGroup = new SettingGroup(dashboardEl).setHeading($t("p4.10095"));
  mobileGroup.addSetting((setting) => {
    setting.setDesc($t("p4.10096"));
  });

  const moduleLabels: Record<string, string> = {
    qc: $t("mod.qc"),
    dailyPhrase: $t("mod.dailyPhrase"),
    todo: "TODO",
    weekly: $t("mod.weekly"),
    projects: $t("mod.projects"),
    countdown: $t("mod.countdown"),
    recent: $t("mod.recent")
  };
  for (const id of Object.keys(moduleLabels)) {
    mobileGroup.addSetting((setting) => {
      setting
        .setName(moduleLabels[id]!)
        .addToggle((toggle) => {
          const hidden = plugin.data.settings.mobileHiddenModules;
          toggle.setValue(!hidden.includes(id));
          toggle.onChange((value) => {
            void (async () => {
              const arr = plugin.data.settings.mobileHiddenModules;
              const idx = arr.indexOf(id);
              if (value && idx >= 0) {
                arr.splice(idx, 1);
              } else if (!value && idx < 0) {
                arr.push(id);
              }
              await plugin.saveSettings();
            })();
          });
        });
    });
  }

  // ── 日历 ──
  const calendarGroup = new SettingGroup(dashboardEl).setHeading($t("set.remaining.757"));

  calendarGroup.addSetting((setting) => {
    setting
      .setName($t("p4.10097"))
      .setDesc($t("p4.10098"))
      .addDropdown((dd) => {
        dd.addOption("left", $t("p4.10099"));
        dd.addOption("right", $t("p4.10100"));
        dd.setValue(plugin.data.settings.calendar.position);
        dd.onChange((value) => {
          void (async () => {
            plugin.data.settings.calendar.position = value as "left" | "right";
            await plugin.saveSettings();
          })();
        });
      });
  });

  calendarGroup.addSetting((setting) => {
    setting
      .setName($t("p4.10101"))
      .setDesc($t("p4.10102"))
      .addToggle((toggle) =>
        toggle
          .setValue(plugin.data.settings.calendar.shouldConfirmBeforeCreate)
          .onChange((value) => {
            void (async () => {
              plugin.data.settings.calendar.shouldConfirmBeforeCreate = value;
              await plugin.saveSettings();
            })();
          })
      );
  });

  // ===================== Markdown + =====================
  const markdownEl = sectionEls.get("markdown")!;

  // ── Minimal 主题（移植自 obsidian-minimal-settings，独立 JSON 存储） ──
  renderMinimalSettings(markdownEl, plugin);

  // ── 视图模式（存储于 Section2 的 static-data.json，经 StaticStore） ──
  const store = plugin.section2Store;
  const fv = store.settings.forceViewMode;
  const forceViewGroup = new SettingGroup(markdownEl).setHeading($t("p4.10103"));

  forceViewGroup.addSetting((setting) => {
    setting
      .setName($t("p4.10104"))
      .setDesc($t("p4.10105"))
      .addToggle((toggle) =>
        toggle
          .setValue(fv.enabled)
          .onChange((value) => {
            void (async () => {
              fv.enabled = value;
              await store.save();
            })();
          })
      );
  });

  forceViewGroup.addSetting((setting) => {
    setting
      .setName($t("p4.10106"))
      .setDesc($t("p4.10107"))
      .addToggle((toggle) =>
        toggle
          .setValue(fv.ignoreOpenFiles)
          .onChange((value) => {
            void (async () => {
              fv.ignoreOpenFiles = value;
              await store.save();
            })();
          })
      );
  });

  forceViewGroup.addSetting((setting) => {
    setting
      .setName($t("p4.10108"))
      .setDesc($t("p4.10109"))
      .addToggle((toggle) =>
        toggle
          .setValue(fv.ignoreForceViewAll)
          .onChange((value) => {
            void (async () => {
              fv.ignoreForceViewAll = value;
              await store.save();
            })();
          })
      );
  });

  forceViewGroup.addSetting((setting) => {
    setting
      .setName($t("p4.10110"))
      .setDesc($t("p4.10111"))
      .addToggle((toggle) =>
        toggle
          .setValue(plugin.data.settings.cursorPosition.enabled)
          .onChange((value) => {
            void (async () => {
              plugin.data.settings.cursorPosition.enabled = value;
              await plugin.saveSettings();
            })();
          })
      );
  });

  const forceViewModes = [
    "default",
    "obsidianUIMode: preview",
    "obsidianUIMode: source",
    "obsidianEditingMode: live",
    "obsidianEditingMode: source",
  ];

  // 文件夹规则
  forceViewGroup.addSetting((setting) => {
    setting
      .setName($t("p4.10112"))
      .setDesc($t("p4.10113"))
      .addButton((button) =>
        button
          .setButtonText("+")
          .setCta()
          .setTooltip($t("p4.10114"))
          .onClick(() => {
            void (async () => {
              fv.folders.push({ folder: "", viewMode: "" });
              await store.save();
              renderSettings(container, plugin);
            })();
          })
      );
  });

  fv.folders.forEach((folderMode, index) => {
    forceViewGroup.addSetting((setting) => {
      setting
        .addText((text) => {
          text
            .setPlaceholder($t("p4.10115"))
            .setValue(folderMode.folder)
            .onChange((newFolder) => {
              void (async () => {
                folderMode.folder = newFolder;
                await store.save();
              })();
            });
        })
        .addDropdown((dd) => {
          forceViewModes.forEach((mode) => {
          dd.addOption(mode, mode);
        });
          dd.setValue(folderMode.viewMode || "default").onChange((value) => {
            void (async () => {
              folderMode.viewMode = value;
              await store.save();
            })();
          });
        })
        .addExtraButton((btn) =>
          btn
            .setIcon("cross")
            .setTooltip($t("set.remaining.758"))
            .onClick(() => {
              void (async () => {
                fv.folders.splice(index, 1);
                await store.save();
                renderSettings(container, plugin);
              })();
            })
        );
    });
  });

  // 文件规则
  forceViewGroup.addSetting((setting) => {
    setting
      .setName($t("p4.10116"))
      .setDesc($t("set.fileRules.desc"))
      .addButton((button) =>
        button
          .setButtonText("+")
          .setCta()
          .setTooltip($t("p4.10118"))
          .onClick(() => {
            void (async () => {
              fv.files.push({ filePattern: "", viewMode: "" });
              await store.save();
              renderSettings(container, plugin);
            })();
          })
      );
  });

  fv.files.forEach((fileMode, index) => {
    forceViewGroup.addSetting((setting) => {
      setting
        .addText((text) => {
          text
            .setPlaceholder($t("p4.10260"))
            .setValue(fileMode.filePattern)
            .onChange((value) => {
              void (async () => {
                fileMode.filePattern = value;
                await store.save();
              })();
            });
        })
        .addDropdown((dd) => {
          forceViewModes.forEach((mode) => {
          dd.addOption(mode, mode);
        });
          dd.setValue(fileMode.viewMode || "default").onChange((value) => {
            void (async () => {
              fileMode.viewMode = value;
              await store.save();
            })();
          });
        })
        .addExtraButton((btn) =>
          btn
            .setIcon("cross")
            .setTooltip($t("set.remaining.758"))
            .onClick(() => {
              void (async () => {
                fv.files.splice(index, 1);
                await store.save();
                renderSettings(container, plugin);
              })();
            })
        );
    });
  });

  // ── Linter（移植自 obsidian-linter，独立 JSON 存储） ──
  renderLinterSettings(markdownEl, plugin);

}

function parseExcludedFolders(value: string): string[] {
  return value
    .split(/\r?\n/u)
    .map((path) => normalizePath(path.trim()))
    .filter(Boolean);
}

/* ============================ Minimal 主题 ============================ */

type MinimalStringKey =
  | "lightScheme"
  | "lightStyle"
  | "darkScheme"
  | "darkStyle"
  | "tableWidth"
  | "imgWidth"
  | "iframeWidth"
  | "mapWidth"
  | "chartWidth";
function renderMinimalSettings(
  container: HTMLElement,
  plugin: AstraDashboardPlugin
): void {
  const manager = plugin.minimalManager;
  if (!manager) return;

  const applyFor = (key: MinimalStringKey) => {
    switch (key) {
      case "lightScheme":
        return manager.updateLightScheme();
      case "lightStyle":
        return manager.updateLightStyle();
      case "darkScheme":
        return manager.updateDarkScheme();
      case "darkStyle":
        return manager.updateDarkStyle();
      default:
        return manager.refresh();
    }
  };

  const save = async () => {
    await manager.saveSettings();
  };

  // ── Color scheme ──
  const colorGroup = new SettingGroup(container).setHeading($t("p4.10119"));
  colorGroup.addSetting((setting) => {
    setting
      .setName($t("p4.10120"))
      .setDesc($t("p4.10121"))
      .addDropdown((dd) => {
        lightSchemeOptions.forEach(({ value, label }) => {
          dd.addOption(value, label);
        });
        dd.setValue(manager.settings.lightScheme);
        dd.onChange((value) => {
          void (async () => {
            manager.settings.lightScheme = value;
            await save();
            applyFor("lightScheme");
          })();
        });
      });
  });
  colorGroup.addSetting((setting) => {
    setting
      .setName($t("p4.10122"))
      .setDesc($t("p4.10123"))
      .addDropdown((dd) => {
        darkSchemeOptions.forEach(({ value, label }) => {
          dd.addOption(value, label);
        });
        dd.setValue(manager.settings.darkScheme);
        dd.onChange((value) => {
          void (async () => {
            manager.settings.darkScheme = value;
            await save();
            applyFor("darkScheme");
          })();
        });
      });
  });

  colorGroup.addSetting((setting) => {
    setting
      .setName($t("p4.10124"))
      .setDesc($t("p4.10125"))
      .addToggle((toggle) =>
        toggle
          .setValue(manager.settings.imgGrid)
          .onChange((value) => {
            void (async () => {
              manager.settings.imgGrid = value;
              await save();
              manager.refresh();
            })();
          })
      );
  });
  colorGroup.addSetting((setting) => {
    setting
      .setName($t("p4.10126"))
      .setDesc($t("p4.10127"))
      .addToggle((toggle) =>
        toggle
          .setValue(manager.settings.minimalStatus)
          .onChange((value) => {
            void (async () => {
              manager.settings.minimalStatus = value;
              await save();
              manager.refresh();
            })();
          })
      );
  });
  colorGroup.addSetting((setting) => {
    setting
      .setName($t("p4.10128"))
      .setDesc($t("p4.10129"))
      .addToggle((toggle) =>
        toggle
          .setValue(manager.settings.focusMode)
          .onChange((value) => {
            void (async () => {
              manager.settings.focusMode = value;
              await save();
              manager.refresh();
            })();
          })
      );
  });
}

/* ============================ Linter ============================ */

function renderLinterSettings(
  container: HTMLElement,
  plugin: AstraDashboardPlugin
): void {
  const manager = plugin.linterManager;
  if (!manager) return;

  const save = async () => {
    await manager.saveSettings();
  };

  const linterGroup = new SettingGroup(container).setHeading("Linter Lite");

  linterGroup.addSetting((setting) => {
    setting
      .setName($t("p4.10130"))
      .setDesc(
        (() => {
          const frag = createFragment();
          frag.append($t("set.formatOnSave.p1"));
          const k1 = createEl("code");
          k1.textContent = "Cmd/Ctrl+S";
          frag.append(k1);
          frag.append($t("set.formatOnSave.p2"));
          const k2 = createEl("code");
          k2.textContent = ":w";
          frag.append(k2);
          frag.append($t("set.formatOnSave.p3"));
          return frag;
        })()
      )
      .addToggle((toggle) =>
        toggle
          .setValue(manager.settings.lintOnSave)
          .onChange((value) => {
            void (async () => {
              manager.settings.lintOnSave = value;
              await save();
            })();
          })
      );
  });

  linterGroup.addSetting((setting) => {
    setting
      .setName($t("p4.10133"))
      .setDesc($t("p4.10134"))
      .addTextArea((text) => {
        text
          .setPlaceholder($t("p4.10078"))
          .setValue(manager.settings.foldersToIgnore.join("\n"))
          .onChange((value) => {
            void (async () => {
              manager.settings.foldersToIgnore = value
                .split(/\r?\n/u)
                .map((p) => normalizePath(p.trim()))
                .filter(Boolean);
              await save();
            })();
          });
        text.inputEl.rows = 4;
      });
  });

  linterGroup.addSetting((setting) => {
    setting
      .setName($t("p4.10135"))
      .setDesc($t("p4.10136"))
      .addToggle((toggle) =>
        toggle
          .setValue(manager.settings.yamlTimestamp.enabled)
          .onChange((value) => {
            void (async () => {
              manager.settings.yamlTimestamp.enabled = value;
              await save();
            })();
          })
      );
  });

  linterGroup.addSetting((setting) => {
    setting
      .setName($t("p4.10137"))
      .setDesc($t("p4.10138"))
      .addToggle((toggle) =>
        toggle
          .setValue(manager.settings.yamlTimestamp.dateCreated)
          .onChange((value) => {
            void (async () => {
              manager.settings.yamlTimestamp.dateCreated = value;
              await save();
            })();
          })
      );
  });

  linterGroup.addSetting((setting) => {
    setting
      .setName($t("p4.10139"))
      .setDesc($t("p4.10140"))
      .addText((text) =>
        text
          .setPlaceholder("date created")
          .setValue(manager.settings.yamlTimestamp.dateCreatedKey)
          .onChange((value) => {
            void (async () => {
              manager.settings.yamlTimestamp.dateCreatedKey = value;
              await save();
            })();
          })
      );
  });

  linterGroup.addSetting((setting) => {
    setting
      .setName($t("p4.10141"))
      .setDesc($t("p4.10142"))
      .addDropdown((dd) =>
        dd
          .addOption("file system", $t("p4.10143"))
          .addOption("frontmatter", "YAML frontmatter")
          .setValue(manager.settings.yamlTimestamp.dateCreatedSourceOfTruth)
          .onChange((value) => {
            void (async () => {
              manager.settings.yamlTimestamp.dateCreatedSourceOfTruth = value as
                | "file system"
                | "frontmatter";
              await save();
            })();
          })
      );
  });

  linterGroup.addSetting((setting) => {
    setting
      .setName($t("p4.10144"))
      .setDesc($t("p4.10145"))
      .addToggle((toggle) =>
        toggle
          .setValue(manager.settings.yamlTimestamp.dateModified)
          .onChange((value) => {
            void (async () => {
              manager.settings.yamlTimestamp.dateModified = value;
              await save();
            })();
          })
      );
  });

  linterGroup.addSetting((setting) => {
    setting
      .setName($t("p4.10146"))
      .setDesc($t("p4.10147"))
      .addText((text) =>
        text
          .setPlaceholder("date modified")
          .setValue(manager.settings.yamlTimestamp.dateModifiedKey)
          .onChange((value) => {
            void (async () => {
              manager.settings.yamlTimestamp.dateModifiedKey = value;
              await save();
            })();
          })
      );
  });

  linterGroup.addSetting((setting) => {
    setting
      .setName($t("p4.10148"))
      .setDesc($t("p4.10149"))
      .addDropdown((dd) =>
        dd
          .addOption("file system", $t("p4.10143"))
          .addOption("user or Linter edits", $t("p4.10150"))
          .setValue(manager.settings.yamlTimestamp.dateModifiedSourceOfTruth)
          .onChange((value) => {
            void (async () => {
              manager.settings.yamlTimestamp.dateModifiedSourceOfTruth = value as
                | "file system"
                | "user or Linter edits";
              await save();
            })();
          })
      );
  });

  linterGroup.addSetting((setting) => {
    setting
      .setName($t("p4.10151"))
      .setDesc(
        (() => {
          const frag = createFragment();
          frag.append($t("set.momentFormat.p1"));
          const a = createEl("a");
          a.href =
            "https://momentjscom.readthedocs.io/en/latest/moment/04-displaying/01-format/";
          a.textContent = $t("auto.342");
          a.target = "_blank";
          a.rel = "noopener";
          frag.append(a);
          frag.append($t("set.momentFormat.p2"));
          return frag;
        })()
      )
      .addText((text) =>
        text
          .setPlaceholder("YYYY-MM-DD")
          .setValue(manager.settings.yamlTimestamp.format)
          .onChange((value) => {
            void (async () => {
              manager.settings.yamlTimestamp.format = value;
              await save();
            })();
          })
      );
  });

  linterGroup.addSetting((setting) => {
    setting
      .setName($t("p4.10153"))
      .setDesc($t("p4.10154"))
      .addToggle((toggle) =>
        toggle
          .setValue(manager.settings.yamlTimestamp.convertToUTC)
          .onChange((value) => {
            void (async () => {
              manager.settings.yamlTimestamp.convertToUTC = value;
              await save();
            })();
          })
      );
  });

  linterGroup.addSetting((setting) => {
    setting
      .setName($t("p4.10155"))
      .setDesc($t("p4.10156"))
      .addToggle((toggle) =>
        toggle
          .setValue(manager.settings.twoSpaces.enabled)
          .onChange((value) => {
            void (async () => {
              manager.settings.twoSpaces.enabled = value;
              await save();
            })();
          })
      );
  });
}