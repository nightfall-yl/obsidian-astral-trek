import { t as $t } from "../i18n";
import type { WorkspaceLeaf} from "obsidian";
import { ItemView, Menu, Notice } from "obsidian";
import type { Moment } from "moment";
import { createDailyNote, getDailyNote } from "obsidian-daily-notes-interface";
import Calendar from "./ui/Calendar.svelte";
import { activeFile, calendarSettings, dailyNotes } from "./ui/stores";
import { VIEW_TYPE_CALENDAR } from "./constants";
import { get } from "svelte/store";
import { ConfirmCreateModal } from "./ConfirmCreateModal";

/**
 * 用被悬停单元格的位置合成一个 mouseover 事件，供 hover 预览浮层定位。
 * 取代已废弃、且在部分场景下为 null 的 `window.event`。
 */
function hoverEventFor(targetEl: unknown): MouseEvent {
  const rect =
    targetEl instanceof HTMLElement ? targetEl.getBoundingClientRect() : null;
  return new MouseEvent("mouseover", {
    bubbles: true,
    clientX: rect ? rect.left + rect.width / 2 : 0,
    clientY: rect ? rect.top + rect.height / 2 : 0
  });
}

export class CalendarView extends ItemView {
  private calendar: Calendar;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_CALENDAR;
  }

  getDisplayText(): string {
    return "日历";
  }

  getIcon(): string {
    return "calendar-days";
  }

  async onOpen() {
    dailyNotes.reindex();

    this.calendar = new Calendar({
      target: this.containerEl.children[1] as HTMLElement,
      props: {
        // 不用 .bind(this)：未开启 strictBindCallApply 时 bind 返回 any，
        // 会触发 no-unsafe-assignment；箭头函数既保类型又保 this。
        onDateClick: (date: string, isMetaPressed: boolean) => {
          void this.onDateClick(date, isMetaPressed);
        },
        onHoverDay: (date: string, isMetaPressed: boolean, targetEl?: unknown) =>
          this.onHoverDay(date, isMetaPressed, targetEl),
        onContextMenuDay: (date: string, event: MouseEvent) =>
          this.onContextMenuDay(date, event),
      },
    });

    // 让日历视图内容区为滚动条预留固定槽位，避免「滚动条出现/消失 → 可用宽度变化 → 重新缩放 → 高度变化」的反馈循环（部分系统滚动条会占用宽度）
    const contentEl = this.containerEl.children[1] as HTMLElement;
    contentEl.addClass("astra-calendar-scroll-gutter");

    this.registerEvent(
      this.app.vault.on("create", () => {
        dailyNotes.reindex();
      })
    );

    this.registerEvent(
      this.app.vault.on("rename", () => {
        dailyNotes.reindex();
      })
    );

    this.registerEvent(
      this.app.vault.on("delete", () => {
        dailyNotes.reindex();
      })
    );

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        activeFile.setFile(this.app.workspace.getActiveFile());
      })
    );

    activeFile.setFile(this.app.workspace.getActiveFile());
  }

  async onClose() {
    if (this.calendar) {
      this.calendar.$destroy();
    }
  }

  private async onDateClick(date: string, isMetaPressed: boolean) {
    const momentDate = window.moment(date);
    const dailyNotesData = get(dailyNotes);
    const file = getDailyNote(momentDate, dailyNotesData);

    if (file) {
      await this.app.workspace.getLeaf(isMetaPressed).openFile(file);
    } else {
      const settings = get(calendarSettings);
      if (settings.shouldConfirmBeforeCreate) {
        await this.tryCreateDailyNote(momentDate, isMetaPressed);
      } else {
        await this.createAndOpenDailyNote(momentDate, isMetaPressed);
      }
    }
  }

  private tryCreateDailyNote(date: Moment, isMetaPressed: boolean): Promise<void> {
    const formattedDate = date.format("YYYY-MM-DD");

    return new Promise<void>((resolve) => {
      new ConfirmCreateModal(
        this.app,
        {
          title: $t("auto.201"),
          message: `文件 ${formattedDate} 不存在。是否要创建它？`,
          confirmText: $t("auto.202"),
          cancelText: $t("dv.cancel"),
        },
        () => {
          void this.createAndOpenDailyNote(date, isMetaPressed).then(() => resolve());
        },
        () => {
          resolve();
        }
      ).open();
    });
  }

  private async createAndOpenDailyNote(date: Moment, isMetaPressed: boolean): Promise<void> {
    try {
      const file = await createDailyNote(date);
      await this.app.workspace.getLeaf(isMetaPressed).openFile(file!);
      dailyNotes.reindex();
    } catch {
      new Notice($t("p4.10035"));
    }
  }

  private onHoverDay(date: string, isMetaPressed: boolean, targetEl?: unknown) {
    if (!isMetaPressed) return;

    const momentDate = window.moment(date);
    const dailyNotesData = get(dailyNotes);
    const file = getDailyNote(momentDate, dailyNotesData);

    if (file) {
      this.app.workspace.trigger("hover-link", {
        event: hoverEventFor(targetEl),
        source: VIEW_TYPE_CALENDAR,
        hoverParent: this.containerEl,
        targetEl: targetEl instanceof HTMLElement ? targetEl : null,
        linktext: file.path,
      });
    }
  }

  private onContextMenuDay(date: string, mouseEvent: MouseEvent) {
    const momentDate = window.moment(date);
    const dailyNotesData = get(dailyNotes);
    const file = getDailyNote(momentDate, dailyNotesData);

    const menu = new Menu();

    if (file) {
      menu.addItem((item) => {
        item.setTitle($t("p4.10036"));
        item.setIcon("arrow-up-right");
        item.onClick(() => {
          void this.app.workspace.getLeaf("tab").openFile(file);
        });
      });

      menu.addItem((item) => {
        item.setTitle($t("p4.10037"));
        item.setIcon("vertical-split");
        item.onClick(() => {
          void this.app.workspace.getLeaf("split").openFile(file);
        });
      });

      menu.addItem((item) => {
        item.setTitle($t("set.remaining.758"));
        item.setIcon("trash");
        item.onClick(() => {
          void (async () => {
            await this.app.fileManager.trashFile(file);
            dailyNotes.reindex();
          })();
        });
      });
    } else {
      menu.addItem((item) => {
        item.setTitle($t("auto.201"));
        item.setIcon("plus");
        item.onClick(() => {
          void this.createAndOpenDailyNote(momentDate, false);
        });
      });
    }

    menu.showAtMouseEvent(mouseEvent);
  }
}
