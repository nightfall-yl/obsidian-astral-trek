import type { App } from "obsidian";
import { Modal } from "obsidian";
import { t as $t } from "./i18n";

export interface ConfirmOptions {
  title: string;
  message: string;
  /** 确认按钮文案，默认「确定」 */
  confirmText?: string;
  /** 取消按钮文案，默认「取消」 */
  cancelText?: string;
  /** 破坏性操作（删除等）传 true，确认按钮加警告样式 */
  danger?: boolean;
}

/**
 * 以 Obsidian 原生 Modal 弹出确认框，替代浏览器 `window.confirm()`。
 * Obsidian 插件规范不建议使用 confirm/alert 等原生弹窗（会打断输入、无法主题化、
 * 在移动端表现不一致）。
 *
 * Esc 或点击遮罩关闭一律视为「取消」。
 */
export function confirmDialog(
  app: App,
  options: ConfirmOptions
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    new ConfirmModal(app, options, resolve).open();
  });
}

class ConfirmModal extends Modal {
  private result = false;

  constructor(
    app: App,
    private readonly options: ConfirmOptions,
    private readonly resolveResult: (ok: boolean) => void
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("astra-confirm-modal");

    this.titleEl.setText(this.options.title);
    contentEl.createEl("p", { text: this.options.message });

    const row = contentEl.createDiv("astra-confirm-modal__buttons");

    const cancelBtn = row.createEl("button", {
      text: this.options.cancelText ?? $t("dv.cancel")
    });
    cancelBtn.addEventListener("click", () => this.finish(false));

    const confirmBtn = row.createEl("button", {
      text: this.options.confirmText ?? $t("auto.203"),
      cls: this.options.danger ? "mod-cta mod-warning" : "mod-cta"
    });
    confirmBtn.addEventListener("click", () => this.finish(true));
  }

  onClose(): void {
    this.contentEl.empty();
    // 走 Esc/遮罩关闭时 result 仍为 false，等价取消
    this.resolveResult(this.result);
  }

  private finish(ok: boolean): void {
    this.result = ok;
    this.close();
  }
}
