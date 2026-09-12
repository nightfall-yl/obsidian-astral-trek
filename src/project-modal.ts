import type { App} from 'obsidian';
import { Modal } from 'obsidian';
import type { ProjectType} from './data/taskParser';
import { PROJECT_TYPE_LIST } from './data/taskParser';
import { t as $t, getLocaleCode } from './i18n';

export interface ProjectFormData {
	name: string;
	color: string;
	startDate: string;
	endDate: string;
	description: string;
	stage: number;
	type: ProjectType;
}

interface ProjectModalOptions {
	app: App;
	onSave: (data: ProjectFormData) => void;
	editData?: ProjectFormData;
	stages?: string[];
}

const COLORS = [
	'#3b82f6', '#6366f1', '#a855f7', '#ec4899',
	'#ef4444', '#f97316', '#eab308', '#22c55e',
	'#14b8a6', '#06b6d4',
];

const getToday = (): string => {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** 1:1 fork of obsidian-dashboard-main/src/views/ProjectModal.ts */
export class ProjectModal extends Modal {
	private opts: ProjectModalOptions;
	private selectedColor: string = COLORS[0] ?? '#3b82f6';
	private isEdit: boolean;
	private selectedStage: number = 0;
	private selectedType: ProjectType = 'stage';

	constructor(opts: ProjectModalOptions) {
		super(opts.app);
		this.opts = opts;
		this.isEdit = !!opts.editData;
		if (opts.editData) {
			this.selectedColor = opts.editData.color;
			this.selectedStage = opts.editData.stage ?? 0;
			this.selectedType = opts.editData.type ?? 'stage';
		}
	}

	onOpen(): void {
		const { contentEl } = this;
		const ed = this.opts.editData;
		contentEl.addClass('ad-task-modal');
		contentEl.createEl('h3', { cls: 'ad-modal-title', text: this.isEdit ? $t('dv.pm.titleEdit') : $t('dv.pm.titleNew') });

		contentEl.createEl('label', { cls: 'ad-modal-label', text: $t('dv.pb.col.projectStar') });
		const nameInput = contentEl.createEl('input', {
			cls: 'ad-modal-input ad-input-name',
			attr: { type: 'text', placeholder: $t('dv.pm.namePlaceholder') },
		});
		if (ed) {
		nameInput.value = ed.name;
	}

		// Project type selector (阶段项目 / 非阶段项目)
		contentEl.createEl('label', { cls: 'ad-modal-label', text: $t('dv.pm.typeLabel') });
		const typeWrap = contentEl.createDiv({ cls: 'ad-modal-row' });
		const typeSelect = typeWrap.createEl('select', { cls: 'ad-modal-input' });
		for (const opt of PROJECT_TYPE_LIST) {
			typeSelect.createEl('option', { value: opt.value, text: opt.label });
		}
		typeSelect.value = this.selectedType;
		typeSelect.addEventListener('change', () => {
			this.selectedType = (typeSelect.value as ProjectType) || 'stage';
			// Non-stage projects have no stage pipeline → hide the 项目阶段 field
			stageField.style.display = this.selectedType === 'stage' ? '' : 'none';
		});

		contentEl.createEl('label', { cls: 'ad-modal-label', text: $t('dv.pm.colorLabel') });
		const colorWrap = contentEl.createDiv({ cls: 'ad-color-group' });
		for (const c of COLORS) {
			const swatch = colorWrap.createEl('button', {
				cls: 'ad-color-swatch' + (c === this.selectedColor ? ' is-selected' : ''),
				attr: { type: 'button', 'data-color': c },
			});
			swatch.style.background = c;
			swatch.addEventListener('click', () => {
				colorWrap.querySelectorAll('.ad-color-swatch').forEach((s) => s.removeClass('is-selected'));
				swatch.addClass('is-selected');
				this.selectedColor = c;
			});
		}

		const row = contentEl.createDiv({ cls: 'ad-modal-row' });

		const startCol = row.createDiv({ cls: 'ad-modal-col' });
		startCol.createEl('label', { cls: 'ad-modal-label', text: $t('dv.pm.startLabel') });
		const startInput = startCol.createEl('input', { cls: 'ad-modal-input', attr: { type: 'date', lang: getLocaleCode() } });
		startInput.value = ed ? (ed.startDate || getToday()) : getToday();

		const endCol = row.createDiv({ cls: 'ad-modal-col' });
		endCol.createEl('label', { cls: 'ad-modal-label', text: $t('dv.pm.endLabel') });
		const endInput = endCol.createEl('input', { cls: 'ad-modal-input', attr: { type: 'date', lang: getLocaleCode() } });
		if (ed) endInput.value = ed.endDate || '';

		contentEl.createEl('label', { cls: 'ad-modal-label', text: $t('dv.pm.descLabel') });
		const descArea = contentEl.createEl('textarea', {
			cls: 'ad-modal-input',
			attr: { rows: '3', placeholder: $t('dv.pm.descPlaceholder') },
		});
		if (ed) descArea.value = ed.description;

		// Stage dropdown (hidden for 非阶段项目)
		const stages = this.opts.stages || ['Charter', 'PDCP', 'TR', 'ADCP', 'COR'];
		const stageField = contentEl.createDiv({ cls: 'ad-modal-field' });
		stageField.createEl('label', { cls: 'ad-modal-label', text: $t('dv.pm.stageLabel') });
		const stageWrap = stageField.createDiv({ cls: 'ad-modal-row' });
		const stageSelect = stageWrap.createEl('select', { cls: 'ad-modal-input' });
		stages.forEach((label, i) => {
			stageSelect.createEl('option', { value: String(i), text: label });
		});
		// Clamp the stage index into the valid range: if the stage count was
		// reduced (e.g. 5 → 4) a saved project could keep a now-missing stage,
		// which would leave the dropdown blank. Pin it to the last option.
		this.selectedStage = Math.max(0, Math.min(this.selectedStage, stages.length - 1));
		stageSelect.value = String(this.selectedStage);
		stageSelect.addEventListener('change', () => {
			this.selectedStage = parseInt(stageSelect.value) || 0;
		});
		// Initialize visibility based on current type
		stageField.style.display = this.selectedType === 'stage' ? '' : 'none';

		const btns = contentEl.createDiv({ cls: 'ad-modal-btns' });
                btns.createEl('button', { cls: 'ad-modal-btn', text: $t('dv.cancel') })
                        .addEventListener('click', () => this.close());
                btns.createEl('button', { cls: 'ad-modal-btn ad-modal-btn--primary', text: this.isEdit ? $t('dv.save') : $t('auto.330') })
			.addEventListener('click', () => {
				const name = String(nameInput.value || '').trim();
				if (!name) { nameInput.focus(); return; }
				this.opts.onSave({
					name,
					color: this.selectedColor,
					startDate: String(startInput.value || getToday()),
					endDate: String(endInput.value || ''),
					description: String(descArea.value || '').trim(),
					stage: this.selectedStage,
					type: this.selectedType,
				});
				this.close();
			});

		if (!this.isEdit) nameInput.focus();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}