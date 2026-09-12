import { t as $t } from "./i18n";
import { Modal, Setting } from "obsidian";
import type { App } from "obsidian";
import type AstraDashboardPlugin from "./main";
import type {
  HeatmapDateFieldType,
  HeatmapSettings
} from "./models";

export class HeatmapSettingsModal extends Modal {
  private readonly settings: HeatmapSettings;

  constructor(
    app: App,
    private readonly plugin: AstraDashboardPlugin
  ) {
    super(app);
    this.settings = { ...plugin.data.settings.heatmap };
  }

  onOpen(): void {
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    this.contentEl.empty();
    this.modalEl.addClass("astra-heatmap-settings-modal");

    // 以下设置为固定默认值，不再提供配置项
    this.settings.startOfWeek = 1; // 每周起始日固定周一
    this.settings.showCellRuleIndicators = true; // 固定显示图例
    this.settings.countFieldType = "DEFAULT"; // 计数字段固定按条目数
    this.settings.countFieldValue = "";
    this.settings.excludeFolders = ""; // 不再排除文件夹

    this.renderBasicSection(this.contentEl);
    this.renderDataSourceSection(this.contentEl);

    const actions = this.contentEl.createDiv("astra-settings-actions");
    const done = actions.createEl("button", {
      cls: "mod-cta",
      text: $t("auto.218"),
      attr: { type: "button" }
    });
    done.addEventListener("click", () => {
      this.plugin.data.settings.heatmap = this.settings;
      void this.plugin.saveDashboardPreferences();
      this.close();
    });
  }

  private renderBasicSection(parent: HTMLElement): void {
    const heading = parent.createEl("h3", { text: $t("auto.312") });
    heading.addClass("astra-heatmap-section-heading");

    new Setting(parent)
      .setName($t("p4.10020"))
      .setDesc($t("p4.10021"))
      .addText((text) =>
        text
          .setValue(this.settings.title)
          .onChange((v) => {
            this.settings.title = v;
          })
      );
  }

  private renderDataSourceSection(parent: HTMLElement): void {
    const heading = parent.createEl("h3", { text: $t("auto.313") });
    heading.addClass("astra-heatmap-section-heading");

    // 数据源类型固定为"文档"（PAGE），数据源值固定为空（全部文件），不再提供配置。
    this.settings.dataSourceType = "PAGE";
    this.settings.dataSourceValue = "";

    new Setting(parent)
      .setName($t("p4.10022"))
      .setDesc($t("p4.10023"))
      .addDropdown((dd) => {
        const options: Array<[HeatmapDateFieldType, string]> = [
          ["FILE_CTIME", "文件创建时间"],
          ["FILE_MTIME", "文件修改时间"],
          ["FILE_NAME", "文件名"],
          ["PAGE_PROPERTY", "文档属性"]
        ];
        options.forEach(([value, label]) => {
          dd.addOption(value, label);
        });
        dd.setValue(this.settings.dateFieldType);
        dd.onChange((v) => {
          this.settings.dateFieldType = v as HeatmapDateFieldType;
          this.render();
        });
      });

    if (this.settings.dateFieldType === "PAGE_PROPERTY") {
      new Setting(parent)
        .setName($t("p4.10028"))
        .setDesc($t("p4.10029"))
        .addText((text) =>
          text
            .setValue(this.settings.dateFieldValue)
            .onChange((v) => {
              this.settings.dateFieldValue = v;
            })
        );

      new Setting(parent)
        .setName($t("p4.10030"))
        .setDesc($t("p4.10031"))
        .addDropdown((dd) => {
          dd.addOption("smart_detect", $t("p4.10032"));
          dd.addOption("manual", $t("u.20750"));
          dd.setValue(this.settings.dateFormat ? "manual" : "smart_detect");
          dd.onChange((v) => {
            this.settings.dateFormat = v === "manual" ? "yyyy-MM-dd" : "";
            this.render();
          });
        });

      if (this.settings.dateFormat) {
        new Setting(parent)
          .setName($t("p4.10033"))
          .setDesc($t("p4.10034"))
          .addText((text) =>
            text
              .setValue(this.settings.dateFormat)
              .onChange((v) => {
                this.settings.dateFormat = v;
              })
          );
      }
    }
  }
}
