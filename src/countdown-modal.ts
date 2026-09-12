import { t as $t } from "./i18n";
import type { App} from "obsidian";
import { Modal } from "obsidian";
import type AstraDashboardPlugin from "./main";

interface CountdownModalOptions {
  app: App;
  plugin: AstraDashboardPlugin;
  /** 保存成功后由调用方触发局部刷新（避免整板重渲染）。 */
  onApply?: () => void;
}

/** 倒计时设置弹窗（UI 参考 ProjectModal） */
export class CountdownModal extends Modal {
  private opts: CountdownModalOptions;

  constructor(opts: CountdownModalOptions) {
    super(opts.app);
    this.opts = opts;
  }

  onOpen(): void {
    const { contentEl } = this;
    const cfg = this.opts.plugin.data.settings.countdown;

    contentEl.addClass("ad-task-modal");
    contentEl.createEl("h3", { cls: "ad-modal-title", text: $t("auto.204") });

    // 事件名称
    contentEl.createEl("label", { cls: "ad-modal-label", text: $t("auto.205") });
    const nameInput = contentEl.createEl("input", {
      cls: "ad-modal-input",
      attr: { type: "text", placeholder: $t("auto.206") },
    });
    nameInput.value = cfg.eventName || "";

    // 目标日期
    contentEl.createEl("label", { cls: "ad-modal-label", text: $t("auto.207") });
    const dateInput = contentEl.createEl("input", {
      cls: "ad-modal-input",
      attr: { type: "date" },
    });
    // 将 yyyy-mm-dd 转为 date input 值
    if (cfg.targetDate) {
      const parts = cfg.targetDate.split("-");
      if (parts.length === 3) dateInput.value = cfg.targetDate;
    }

    // 进度提示
    contentEl.createEl("p", {
      cls: "ad-modal-hint",
      text: "倒计时卡片将显示「距离 {事件名} 还有 X 天」，并附带年度进度条。",
    });

    // 按钮
    const btns = contentEl.createDiv({ cls: "ad-modal-btns" });
    btns.createEl("button", { cls: "ad-modal-btn", text: $t("dv.cancel") })
      .addEventListener("click", () => this.close());
    btns.createEl("button", { cls: "ad-modal-btn ad-modal-btn--primary", text: $t("dv.save") })
      .addEventListener("click", () => {
        const name = String(nameInput.value || "").trim();
        const date = String(dateInput.value || "").trim();
        if (!name) { nameInput.focus(); return; }
        if (!date) { dateInput.focus(); return; }
        this.opts.plugin.data.settings.countdown = {
          ...this.opts.plugin.data.settings.countdown,
          eventName: name,
          targetDate: date,
        };
        // 仅持久化并局部刷新倒计时卡片，避免 saveSettings() 触发整板重渲染导致 dashboard 移位
        void (async () => {
          await this.opts.plugin.saveData(this.opts.plugin.data);
          this.opts.onApply?.();
          this.close();
        })();
      });

    nameInput.focus();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
