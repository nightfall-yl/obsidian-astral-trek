import { t as $t } from "./i18n";
import { AbstractInputSuggest, Modal, setIcon } from "obsidian";
import type { App } from "obsidian";
import type AstraDashboardPlugin from "./main";
import type { QuickLink } from "./models";

interface CommandEntry {
  id: string;
  name: string;
}

/**
 * 「命令」输入框联想（与「快速捕获文件」的 ProjectFileSuggest 同一交互）：
 * 聚焦/输入时在框下弹出命令列表，选中回填命令 ID，无需额外「选择」按钮。
 */
class CommandInputSuggest extends AbstractInputSuggest<CommandEntry> {
  private readonly onApply: (id: string) => void;

  constructor(
    app: App,
    inputEl: HTMLInputElement,
    onApply: (id: string) => void
  ) {
    super(app, inputEl);
    this.onApply = onApply;
  }

  private getCommands(): CommandEntry[] {
    const registry = (this.app as unknown as {
      commands?: { commands?: Record<string, { name?: string }> };
    }).commands?.commands ?? {};
    return Object.entries(registry)
      .map(([id, cmd]) => ({ id, name: cmd?.name ?? id }))
      .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
  }

  getSuggestions(query: string): CommandEntry[] {
    const lower = query.trim().toLowerCase();
    const limit = this.limit || 100;
    const items = this.getCommands();
    if (!lower) return items.slice(0, limit);
    return items
      .filter(
        (c) =>
          c.name.toLowerCase().includes(lower) ||
          c.id.toLowerCase().includes(lower)
      )
      .slice(0, limit);
  }

  renderSuggestion(item: CommandEntry, el: HTMLElement): void {
    el.empty();
    el.createDiv({ text: item.name, cls: "astra-cmd-suggest-name" });
    el.createDiv({ text: item.id, cls: "astra-cmd-suggest-id" });
  }

  selectSuggestion(item: CommandEntry, _evt: MouseEvent | KeyboardEvent): void {
    this.setValue(item.id);
    this.close();
    this.onApply(item.id);
  }
}

export class QuickLinkModal extends Modal {
  private readonly links: QuickLink[];

  constructor(
    app: App,
    private readonly dashboardPlugin: AstraDashboardPlugin
  ) {
    super(app);
    this.links = dashboardPlugin.data.settings.quickLinks.map((link) => ({
      ...link
    }));
  }

  onOpen(): void {
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    this.contentEl.empty();
    this.modalEl.addClass("astra-quick-link-modal");

    const header = this.contentEl.createDiv("astra-link-editor-header");
    header.createEl("h2", { text: $t("auto.331") });
    const intro = header.createEl("p", {
      cls: "setting-item-description"
    });
    intro.appendText(
      "自定义顶部快捷入口。url 指向笔记（笔记名或路径），action 为命令 ID（填写后优先执行命令）。图标填写 "
    );
    intro.createEl("a", {
      text: "Lucide",
      href: "https://lucide.dev/icons/",
      attr: { target: "_blank", rel: "noopener noreferrer" }
    });
    intro.appendText(" 图标名，如 home。");

    const list = this.contentEl.createDiv("astra-link-editor-list");

    if (this.links.length === 0) {
      list.createDiv({
        cls: "astra-link-editor-empty",
        text: $t("auto.332")
      });
    } else {
      this.links.forEach((link, index) => {
        this.renderRow(list, link, index);
      });
    }

    const addBar = this.contentEl.createDiv("astra-link-editor-add");
    const addBtn = addBar.createEl("button", {
      cls: "mod-cta",
      text: $t("auto.333"),
      attr: { type: "button" }
    });
    addBtn.addEventListener("click", () => {
      this.links.push({ label: $t("auto.334"), url: "" });
      this.render();
    });

    const actions = this.contentEl.createDiv("astra-settings-actions");
    const done = actions.createEl("button", {
      cls: "mod-cta",
      text: $t("auto.218"),
      attr: { type: "button" }
    });
    done.addEventListener("click", () => {
      const cleaned = this.links.filter((link) => link.label.trim() !== "");
      this.dashboardPlugin.data.settings.quickLinks = cleaned;
      void this.dashboardPlugin.saveDashboardPreferences();
      this.close();
    });
  }

  private renderRow(
    list: HTMLElement,
    link: QuickLink,
    index: number
  ): void {
    const row = list.createDiv("astra-link-editor-row");

    const head = row.createDiv("astra-link-editor-row-head");
    head.createSpan({
      cls: "astra-link-editor-index",
      text: String(index + 1)
    });

    const controls = head.createSpan("astra-link-editor-controls");
    this.createIconButton(
      controls,
      "arrow-up",
      "上移",
      index === 0,
      () => this.move(index, -1)
    );
    this.createIconButton(
      controls,
      "arrow-down",
      "下移",
      index === this.links.length - 1,
      () => this.move(index, 1)
    );
    this.createIconButton(controls, "trash", "删除", false, () =>
      this.remove(index)
    );

    const fields = row.createDiv("astra-link-editor-fields");
    this.createField(fields, "名称", link.label, (value) => {
      link.label = value;
    });
    this.createField(
      fields,
      "图标（可选）",
      link.icon ?? "",
      (value) => {
        link.icon = value.trim() || undefined;
      }
    );
    this.createField(
      fields,
      "链接（笔记名或路径）",
      link.url ?? "",
      (value) => {
        link.url = value.trim() || undefined;
      }
    );

    const actionField = fields.createDiv("astra-link-editor-field");
    actionField.createSpan({
      cls: "astra-link-editor-label",
      text: $t("auto.336")
    });
    const actionInput = actionField.createEl("input", {
      attr: { type: "text" }
    });
    actionInput.value = link.action ?? "";
    actionInput.addEventListener("change", () => {
      link.action = actionInput.value.trim() || undefined;
    });
    new CommandInputSuggest(this.app, actionInput, (id) => {
      link.action = id;
      actionInput.value = id;
    });
  }

  private createField(
    parent: HTMLElement,
    label: string,
    value: string,
    onChange: (value: string) => void
  ): void {
    const field = parent.createDiv("astra-link-editor-field");
    field.createSpan({ cls: "astra-link-editor-label", text: label });
    const input = field.createEl("input", { attr: { type: "text" } });
    input.value = value;
    input.addEventListener("change", () => onChange(input.value));
  }

  private createIconButton(
    parent: HTMLElement,
    icon: string,
    label: string,
    disabled: boolean,
    action: () => void
  ): void {
    const btn = parent.createEl("button", {
      cls: "astra-link-editor-button",
      attr: {
        type: "button",
        "aria-label": label,
        title: label
      }
    });
    btn.disabled = disabled;
    setIcon(btn, icon);
    btn.addEventListener("click", action);
  }

  private move(index: number, offset: number): void {
    const target = index + offset;
    if (target < 0 || target >= this.links.length) return;
    [this.links[index], this.links[target]] = [
      this.links[target]!,
      this.links[index]!
    ];
    this.render();
  }

  private remove(index: number): void {
    this.links.splice(index, 1);
    this.render();
  }
}

export function quickLinkInitial(label: string): string {
  return Array.from(label.trim())[0]?.toLocaleUpperCase() ?? "L";
}
