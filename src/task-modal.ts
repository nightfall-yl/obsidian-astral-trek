import type { App} from 'obsidian';
import { Modal } from 'obsidian';
import { t as $t, getLocaleCode } from './i18n';

/* ============================================================
   Task Creation Modal — 1:1 fork of
   obsidian-dashboard-main/src/views/TaskModal.ts
   (UI_TEXT replaced with inline Chinese text)
   ============================================================ */

interface ProjectInfo { name: string; path: string }
interface TaskInfo { id: string; title: string; projectId: string }

export interface TaskFormData {
	title: string;
	project: string;
	parent: string;
	startDate: string;
	endDate: string;
	priority: string;
	status: string;
	type: string;
	// Structured repeat settings (replaces free-text 重复详情)
	repeatFreq: string;            // 'daily' | 'weekly' | 'monthly' | ''
	repeatInterval: number;        // daily: every N days (>=1)
	repeatWorkdaysOnly: boolean;   // daily: workdays only
	repeatWeekdays: number[];      // weekly: 1=Mon .. 7=Sun
	repeatMonthDay: number;        // monthly: day of month 1..31
	noEndDate: boolean;            // recurring: no end bound
	reminders: string[];
	tags: string[];
	notes: string;
}

interface TaskModalOptions {
	app: App;
	projects: ProjectInfo[];
	allTasks?: TaskInfo[];
	defaultProject?: string;
	defaultParent?: string;
	onSave: (data: TaskFormData) => void;
}

const PRIORITIES = [
	{ value: '重要且紧急', label: $t('dv.priority.importantUrgent') },
	{ value: '重要不紧急', label: $t('dv.priority.importantNot') },
	{ value: '紧急不重要', label: $t('dv.priority.urgentNot') },
	{ value: '不重要不紧急', label: $t('dv.priority.neither') },
	{ value: '', label: $t('auto.767') },
];

const STATUSES = [
	{ value: 'todo', label: $t('dv.pb.status.todo') },
	{ value: 'in-progress', label: $t('dv.pb.status.inProgress') },
	{ value: 'blocked', label: $t('dv.pb.status.blocked') },
	{ value: 'done', label: $t('dv.pb.status.done') },
	{ value: 'cancelled', label: $t('dv.pb.status.cancelled') },
];

const TYPES = [
	{ value: 'task', label: $t('dv.t.typeNormal') },
	{ value: 'recurring', label: $t('dv.t.typeRepeat') },
];

// Repeat frequency — "每年" removed per product decision.
const REPEAT_FREQS = [
	{ value: '', label: $t('dv.t.selectFreq') },
	{ value: 'daily', label: $t('dv.t.daily') },
	{ value: 'weekly', label: $t('dv.t.weekly') },
	{ value: 'monthly', label: $t('dv.t.monthly') },
];

// 周一..周日 with internal value 1..7 (1=Mon, 7=Sun)
const WEEKDAYS = [
	{ value: 1, label: $t('dv.t.monday') },
	{ value: 2, label: $t('dv.t.tuesday') },
	{ value: 3, label: $t('dv.t.wednesday') },
	{ value: 4, label: $t('dv.t.thursday') },
	{ value: 5, label: $t('dv.t.friday') },
	{ value: 6, label: $t('dv.t.saturday') },
	{ value: 7, label: $t('dv.t.sunday') },
];

const REMINDER_OPTIONS = [
	'任务当天', '提前 1 天', '提前 3 天', '提前 1 周',
];

const getToday = (): string => {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Convert a YYYY-MM-DD to a weekday number 1..7 (1=Mon, 7=Sun). */
const dateToDow = (s: string): number => {
	const d = s ? new Date(s + 'T00:00:00') : new Date();
	if (isNaN(d.getTime())) return 1;
	return ((d.getDay() + 6) % 7) + 1;
};

export class TaskModal extends Modal {
	private opts: TaskModalOptions;
	private tags: string[];
	private selectedReminders: string[] = [];

	constructor(opts: TaskModalOptions) {
		super(opts.app);
		this.opts = opts;
		this.tags = [$t('dv.t.defaultTag')];
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass('ad-task-modal');
		contentEl.createEl('h3', { cls: 'ad-modal-title', text: $t('dv.t.title') });

		// ---- Title ----
		this.field($t('dv.pb.col.taskName') + ' *', (wrap) => {
			wrap.createEl('input', { cls: 'ad-modal-input ad-input-title', attr: { type: 'text', placeholder: $t('dv.t.inputPlaceholder') } });
		});

		// ---- Project + Parent (side by side) ----
		const row1 = contentEl.createDiv({ cls: 'ad-modal-row' });

		const projCol = row1.createDiv({ cls: 'ad-modal-col' });
		this.label(projCol, $t('dv.pb.col.projectStar'));
		const projSel = projCol.createEl('select', { cls: 'ad-modal-input' });
		for (const p of this.opts.projects) {
			projSel.createEl('option', { text: p.name, attr: { value: p.name } });
		}
		const initialProject = this.opts.defaultProject ?? this.opts.projects[0]?.name;
		if (initialProject) {
			const match = Array.from(projSel.options).find((o) => o.value === initialProject);
			if (match) match.selected = true;
			else projSel.value = initialProject;
		}

		const parentCol = row1.createDiv({ cls: 'ad-modal-col' });
		this.label(parentCol, $t('dv.t.parentLabel'));
		const parentSel = parentCol.createEl('select', { cls: 'ad-modal-input' });
		parentSel.createEl('option', { text: $t('auto.348'), attr: { value: '' } });

		const populateParents = (projectName: string): void => {
			const filtered = (this.opts.allTasks || []).filter((t) => t.projectId === projectName);
			while (parentSel.options.length > 1) parentSel.remove(1);
			for (const t of filtered) {
				parentSel.createEl('option', { text: t.title, attr: { value: t.title } });
			}
		};

		populateParents(projSel.value);
		if (this.opts.defaultParent) parentSel.value = this.opts.defaultParent;

		projSel.addEventListener('change', () => {
			populateParents(projSel.value);
		});

		// ---- Dates (side by side) ----
		const row2 = contentEl.createDiv({ cls: 'ad-modal-row' });

		const startCol = row2.createDiv({ cls: 'ad-modal-col' });
		const startLabel = startCol.createEl('label', { cls: 'ad-modal-label', text: $t('auto.325') });
		const startInput = startCol.createEl('input', { cls: 'ad-modal-input', attr: { type: 'date', lang: getLocaleCode() } });
		startInput.value = getToday();

		const endCol = row2.createDiv({ cls: 'ad-modal-col' });
		const endLabel = endCol.createEl('label', { cls: 'ad-modal-label', text: $t('auto.326') });
		const endInput = endCol.createEl('input', { cls: 'ad-modal-input', attr: { type: 'date', lang: getLocaleCode() } });
		endInput.value = getToday();

		// "No end date" — only relevant for recurring tasks
		const noEndWrap = contentEl.createDiv({ cls: 'ad-modal-row ad-hidden' });
		const noEndCol = noEndWrap.createDiv({ cls: 'ad-modal-col' });
		const noEndLbl = noEndCol.createEl('label', { cls: 'ad-rem-item' });
		const noEndCb = noEndLbl.createEl('input', { attr: { type: 'checkbox' } });
		noEndLbl.createSpan({ text: $t('auto.387') });
		noEndCb.addEventListener('change', () => {
			endInput.disabled = noEndCb.checked;
			if (noEndCb.checked) endInput.value = '';
		});

		// ---- Priority + Status + Type (side by side) ----
		const row3 = contentEl.createDiv({ cls: 'ad-modal-row' });

		const prioCol = row3.createDiv({ cls: 'ad-modal-col' });
		this.label(prioCol, $t('dv.pb.col.priority'));
		const prioSel = prioCol.createEl('select', { cls: 'ad-modal-input' });
		for (const p of PRIORITIES) prioSel.createEl('option', { text: p.label, attr: { value: p.value } });

		const statusCol = row3.createDiv({ cls: 'ad-modal-col' });
		this.label(statusCol, $t('dv.pb.col.status') + ' *');
		const statusSel = statusCol.createEl('select', { cls: 'ad-modal-input' });
		for (const s of STATUSES) statusSel.createEl('option', { text: s.label, attr: { value: s.value } });

		const typeCol = row3.createDiv({ cls: 'ad-modal-col' });
		this.label(typeCol, $t('dv.t.typeLabel'));
		const typeSel = typeCol.createEl('select', { cls: 'ad-modal-input' });
		for (const t of TYPES) typeSel.createEl('option', { text: t.label, attr: { value: t.value } });

		// ---- Repeat (conditional, structured) ----
		const repeatWrap = contentEl.createDiv({ cls: 'ad-modal-row ad-repeat-section ad-hidden' });

		const freqCol = repeatWrap.createDiv({ cls: 'ad-modal-col' });
		this.label(freqCol, $t('p4.10175'));
		const freqSel = freqCol.createEl('select', { cls: 'ad-modal-input' });
		for (const f of REPEAT_FREQS) freqSel.createEl('option', { text: f.label, attr: { value: f.value } });

		// Dynamic options container (re-rendered on frequency change)
		const repeatOptsWrap = contentEl.createDiv({ cls: 'ad-repeat-opts ad-hidden' });

		const renderRepeatOpts = (): void => {
			repeatOptsWrap.empty();
			const f = freqSel.value;
			if (!f) { repeatOptsWrap.addClass('ad-hidden'); return; }
			repeatOptsWrap.removeClass('ad-hidden');

			if (f === 'daily') {
				const row = repeatOptsWrap.createDiv({ cls: 'ad-modal-row' });
				const c1 = row.createDiv({ cls: 'ad-modal-col' });
				this.label(c1, $t('dv.t.everyNDays'));
				c1.createEl('input', { cls: 'ad-modal-input ad-repeat-interval', attr: { type: 'number', min: '1', value: '1' } });
				const c2 = row.createDiv({ cls: 'ad-modal-col' });
				const wdLbl = c2.createEl('label', { cls: 'ad-rem-item' });
				wdLbl.createEl('input', { cls: 'ad-repeat-workdays', attr: { type: 'checkbox' } });
				wdLbl.createSpan({ text: $t('dv.t.workdaysOnly') });
			} else if (f === 'weekly') {
				const row = repeatOptsWrap.createDiv({ cls: 'ad-modal-row' });
				const c = row.createDiv({ cls: 'ad-modal-col' });
				this.label(c, $t('p4.10177'));
				const wdRow = c.createDiv({ cls: 'ad-repeat-weekdays' });
				const startDow = dateToDow(startInput.value);
				for (const wd of WEEKDAYS) {
					const lbl = wdRow.createEl('label', { cls: 'ad-rem-item' });
					const cb = lbl.createEl('input', { cls: 'ad-repeat-weekday', attr: { type: 'checkbox', value: String(wd.value) } });
					if (wd.value === startDow) cb.checked = true;
					lbl.createSpan({ text: wd.label });
				}
			} else if (f === 'monthly') {
				const row = repeatOptsWrap.createDiv({ cls: 'ad-modal-row' });
				const c = row.createDiv({ cls: 'ad-modal-col' });
				this.label(c, $t('dv.t.monthDay'));
				const mdVal = startInput.value ? new Date(startInput.value + 'T00:00:00').getDate() : 1;
				c.createEl('input', { cls: 'ad-modal-input ad-repeat-monthday', attr: { type: 'number', min: '1', max: '31', value: String(mdVal) } });
			}
		};

		freqSel.addEventListener('change', renderRepeatOpts);

		// Type change: show/hide repeat UI, status picker, no-end checkbox, relabel dates
		const applyType = (): void => {
			const isRecurring = typeSel.value === 'recurring';
			repeatWrap.toggleClass('ad-hidden', !isRecurring);
			noEndWrap.toggleClass('ad-hidden', !isRecurring);
			statusCol.toggleClass('ad-hidden', isRecurring); // recurring is always 进行中
			if (isRecurring) {
				startLabel.textContent = $t('dv.t.firstDate');
				endLabel.textContent = $t('dv.t.boundaryDate');
				renderRepeatOpts();
			} else {
				startLabel.textContent = $t('auto.325');
				endLabel.textContent = $t('auto.326');
			}
		};
		typeSel.addEventListener('change', applyType);

		// ---- Reminders ----
		this.label(contentEl, $t('dv.t.remindLabel'));
		const remWrap = contentEl.createDiv({ cls: 'ad-rem-group' });
		for (const opt of REMINDER_OPTIONS) {
			const lbl = remWrap.createEl('label', { cls: 'ad-rem-item' });
			const cb = lbl.createEl('input', { attr: { type: 'checkbox' } });
			cb.addEventListener('change', () => {
				if (cb.checked) this.selectedReminders.push(opt);
				else this.selectedReminders = this.selectedReminders.filter((r) => r !== opt);
			});
			lbl.createSpan({ text: opt });
		}

		// ---- Tags ----
		this.label(contentEl, $t('dv.t.tagsLabel'));
		const tagWrap = contentEl.createDiv({ cls: 'ad-tag-wrap' });
		const tagChips = tagWrap.createDiv({ cls: 'ad-tag-chips' });
		const tagInput = tagWrap.createEl('input', {
			cls: 'ad-modal-input ad-tag-input',
			attr: { type: 'text', placeholder: $t('dv.t.tagPlaceholder') },
		});
		tagInput.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				const val = tagInput.value.trim();
				if (val && !this.tags.includes(val)) {
					this.tags.push(val);
					this.renderTagChip(tagChips, val);
				}
				tagInput.value = '';
			}
		});
		this.tags.forEach((tag) => this.renderTagChip(tagChips, tag));

		// ---- Notes ----
		this.label(contentEl, $t('dv.t.notesLabel'));
		const notesArea = contentEl.createEl('textarea', {
			cls: 'ad-modal-input',
			attr: { rows: '5', placeholder: $t('dv.t.notesPlaceholder') },
		});

		// ---- Buttons ----
		const btns = contentEl.createDiv({ cls: 'ad-modal-btns' });
		btns.createEl('button', { cls: 'ad-modal-btn', text: $t('dv.cancel') })
			.addEventListener('click', () => this.close());
		btns.createEl('button', { cls: 'ad-modal-btn ad-modal-btn--primary', text: $t('auto.395') })
			.addEventListener('click', () => {
				contentEl.querySelectorAll('.ad-input-error').forEach((el) => el.removeClass('ad-input-error'));

				const titleEl = contentEl.querySelector('.ad-input-title') as HTMLInputElement;
				const title = titleEl?.value?.trim();

				const fields: [HTMLElement | null, string][] = [
					[titleEl, title || ''],
					[projSel, projSel.value],
					[startInput, startInput.value],
					[typeSel, typeSel.value],
				];
				// For normal tasks, status is required; for recurring it's fixed to 进行中.
				if (typeSel.value !== 'recurring') fields.push([statusSel, statusSel.value]);

				let firstError: HTMLElement | null = null;
				for (const [el, val] of fields) {
					if (!val && el) {
						el.addClass('ad-input-error');
						if (!firstError) firstError = el;
					}
				}
				if (firstError) { firstError.focus(); return; }

				const isRecurring = typeSel.value === 'recurring';
				const noEnd = isRecurring && noEndCb.checked;
				const intervalEl = repeatOptsWrap.querySelector('.ad-repeat-interval');
				const workdayEl = repeatOptsWrap.querySelector('.ad-repeat-workdays');
				const weekdayEls = repeatOptsWrap.querySelectorAll('.ad-repeat-weekday');
				const monthDayEl = repeatOptsWrap.querySelector('.ad-repeat-monthday');

				const data: TaskFormData = {
					title,
					project: projSel.value,
					parent: parentSel.value,
					startDate: startInput.value || getToday(),
					endDate: noEnd ? '' : (endInput.value || startInput.value || getToday()),
					priority: prioSel.value,
					status: statusSel.value || 'todo',
					type: typeSel.value || 'task',
					repeatFreq: isRecurring ? freqSel.value : '',
					repeatInterval: intervalEl instanceof HTMLInputElement ? (parseInt(intervalEl.value, 10) || 1) : 1,
					repeatWorkdaysOnly: !!(workdayEl instanceof HTMLInputElement && workdayEl.checked),
					repeatWeekdays: Array.from(weekdayEls).filter((cb): cb is HTMLInputElement => cb.instanceOf(HTMLInputElement)).map((cb) => parseInt(cb.value, 10)),
					repeatMonthDay: monthDayEl instanceof HTMLInputElement ? (parseInt(monthDayEl.value, 10) || 1) : 1,
					noEndDate: noEnd,
					reminders: [...this.selectedReminders],
					tags: [...this.tags],
					notes: notesArea.value.trim(),
				};
				this.opts.onSave(data);
				this.close();
			});

		(contentEl.querySelector('.ad-input-title') as HTMLInputElement)?.focus();
	}

	private label(parent: HTMLElement, text: string): void {
		parent.createEl('label', { cls: 'ad-modal-label', text });
	}

	private field(labelText: string, build: (wrap: HTMLElement) => void): void {
		const wrap = this.contentEl.createDiv({ cls: 'ad-modal-field' });
		this.label(wrap, labelText);
		build(wrap);
	}

	private renderTagChip(container: HTMLElement, tag: string): void {
		const chip = container.createSpan({ cls: 'ad-tag-chip' });
		chip.createSpan({ text: tag });
		const x = chip.createSpan({ cls: 'ad-tag-x', text: '\u00D7' });
		x.addEventListener('click', () => {
			this.tags = this.tags.filter((t) => t !== tag);
			chip.remove();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}