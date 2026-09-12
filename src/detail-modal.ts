import { t as $t } from "./i18n";
import { Modal, setIcon } from "obsidian";
import type { App, TFile } from "obsidian";

export interface DetailItem {
  file: TFile;
  title?: string;
  subtitle?: string;
  badge?: string;
}

export class DetailModal extends Modal {
  private filteredItems: DetailItem[];

  constructor(
    app: App,
    private readonly heading: string,
    private readonly description: string,
    private readonly items: DetailItem[],
    private readonly showSearch: boolean = true
  ) {
    super(app);
    this.filteredItems = items;
  }

  onOpen(): void {
    this.modalEl.addClass("astra-detail-modal");
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  // 手机端 Obsidian 在 Modal.close() 中会无条件执行 animateClose()：
  // 把弹窗整体 translateY(整高) 下滑一整屏再移除（rd.isPhone ? animateClose() : 直接移除），
  // 对于本居中小弹窗就表现为「关闭时先往下移动一段距离才消失」。
  // 这里让关闭动画立即完成、不做任何位移，从而去掉这段下滑；打开时的上滑入场仍保留。
  animateClose(): Promise<void> {
    return Promise.resolve();
  }

  private render(): void {
    this.contentEl.empty();
    const header = this.contentEl.createDiv("astra-modal-header");
    header.createEl("h2", { text: this.heading });
    header.createEl("p", { text: this.description });

    const summary = this.contentEl.createDiv("astra-modal-summary");
    summary.setText($t("dv.flomo.totalCount", { n: this.items.length }));
    const list = this.contentEl.createDiv("astra-modal-list");

    if (this.showSearch) {
      const searchWrap = this.contentEl.createDiv("astra-modal-search");
      const searchIcon = searchWrap.createSpan("astra-modal-search-icon");
      setIcon(searchIcon, "search");
      const search = searchWrap.createEl("input", {
        attr: {
          type: "search",
          placeholder: `搜索 ${this.items.length} 条结果`,
          "aria-label": "搜索结果"
        }
      });
      search.addEventListener("input", () => {
        const query = search.value.trim().toLocaleLowerCase();
        this.filteredItems = query
          ? this.items.filter((item) =>
              [item.title ?? item.file.basename, item.file.path, item.subtitle]
                .filter(Boolean)
                .some((value) => value?.toLocaleLowerCase().includes(query))
            )
          : this.items;
        this.renderList(list);
      });
      window.setTimeout(() => search.focus(), 0);
    } else {
      // 无搜索框时收走焦点，避免首条笔记 row 自动获得焦点环
      this.contentEl.setAttribute("tabindex", "-1");
      this.contentEl.focus();
    }

    this.renderList(list);
  }

  private renderList(list: HTMLElement): void {
    list.empty();
    if (this.filteredItems.length === 0) {
      const empty = list.createDiv("astra-modal-empty");
      const icon = empty.createSpan();
      setIcon(icon, "search-x");
      empty.createEl("p", { text: $t("auto.234") });
      return;
    }

    this.filteredItems.forEach((item) => {
      const row = list.createEl("button", {
        cls: "astra-modal-row",
        attr: { type: "button" }
      });
      const icon = row.createSpan("astra-modal-row-icon");
      setIcon(icon, "file-text");
      const copy = row.createSpan("astra-modal-row-copy");
      copy.createSpan({
        cls: "astra-modal-row-title",
        text: item.title ?? item.file.basename
      });
      copy.createSpan({
        cls: "astra-modal-row-path",
        text: item.subtitle ?? item.file.path
      });
      if (item.badge) {
        row.createSpan({ cls: "astra-modal-row-badge", text: item.badge });
      }
      const arrow = row.createSpan("astra-modal-row-arrow");
      setIcon(arrow, "chevron-right");
      row.addEventListener("click", () => {
        void this.app.workspace.getLeaf(false).openFile(item.file);
        this.close();
      });
    });
  }
}
