import { t as $t } from "./i18n";
import type { TFile } from "obsidian";

export type StartupMode = "replace-active" | "new-tab";

export interface QuickLink {
  label: string;
  icon?: string;
  url?: string;
  action?: string;
}

export type HeatmapDataSourceType =
  | "PAGE"
  | "ALL_TASK"
  | "TASK_IN_SPECIFIC_PAGE";

export type HeatmapDateFieldType =
  | "FILE_CTIME"
  | "FILE_MTIME"
  | "FILE_NAME"
  | "PAGE_PROPERTY"
  | "TASK_PROPERTY";

export type HeatmapCountFieldType =
  | "DEFAULT"
  | "PAGE_PROPERTY"
  | "TASK_PROPERTY";

export type HeatmapDateRangeType =
  | "LATEST_DAYS"
  | "LATEST_MONTH"
  | "LATEST_YEAR"
  | "FIXED_DATE_RANGE";

export interface HeatmapDateField {
  type: HeatmapDateFieldType;
  value?: string;
  format?: string;
}

export interface HeatmapCountField {
  type: HeatmapCountFieldType;
  value?: string;
}

export interface HeatmapDataSource {
  type: HeatmapDataSourceType;
  value: string;
  dateField: HeatmapDateField;
  countField?: HeatmapCountField;
  excludeFolders?: string[];
}

export interface HeatmapSettings {
  title: string;
  dataSourceType: HeatmapDataSourceType;
  dataSourceValue: string;
  dateFieldType: HeatmapDateFieldType;
  dateFieldValue: string;
  dateFormat: string;
  countFieldType: HeatmapCountFieldType;
  countFieldValue: string;
  excludeFolders: string;
  dateRangeType: HeatmapDateRangeType;
  fromDate: string;
  toDate: string;
  startOfWeek: number;
  showCellRuleIndicators: boolean;
}

export interface ForceViewModeSettings {
  enabled: boolean;
  debounceTimeout: number;
  ignoreOpenFiles: boolean;
  ignoreForceViewAll: boolean;
  folders: { folder: string; viewMode: string }[];
  files: { filePattern: string; viewMode: string }[];
}

export interface CursorPositionSettings {
  enabled: boolean;
  delayAfterFileOpening: number;
  saveTimer: number;
}

export const SAFE_DB_FLUSH_INTERVAL = 5000;

export interface CalendarPluginSettings {
  enabled: boolean;
  wordsPerDot: number;
  weekStart: string;
  shouldConfirmBeforeCreate: boolean;
  position: "left" | "right";
  highlightToday: boolean;
}

export interface QuickCaptureSettings {
  /** 快速捕获的指定写入文件（相对仓库根），所有记录按日期分组合并追加到此文件 */
  filePath: string;
}

export interface DiarySettings {
  storagePath: string;
  namingPattern: string;
  templateFile: string;
}

export interface CountdownSettings {
  /** 事件名称，如「高考」「新年」；文案显示「距离 {eventName} 还有」 */
  eventName: string;
  /** 目标日期，ISO yyyy-mm-dd；非法或留空时回退到「下一年 1 月 1 日」 */
  targetDate: string;
}

export interface DailyPhraseSettings {
  /** 数据源 .md（相对仓库根），按 ## 分条 + en:/zh:/scene: 字段解析每日口语 */
  filePath: string;
}

export interface AstraSettings {
  displayName: string;
  openOnStartup: boolean;
  startupMode: StartupMode;
  shortNoteWordThreshold: number;
  excludedFolders: string[];
  showEstimatedHistory: boolean;
  activityHistoryDays: number;
  quickLinks: QuickLink[];
  heatmap: HeatmapSettings;
  cursorPosition: CursorPositionSettings;
  calendar: CalendarPluginSettings;
  quickCapture: QuickCaptureSettings;
  diary: DiarySettings;
  todoSourceFolder: string;
  projectsFolder: string;
  npdpStages: string[];
  npdpMaxStage: number;
  npdpProgressFilter: number;
  /** 全部项目视图当前激活的标签页（gantt / list） */
  currentPoView: string;
  /** 甘特图时间粒度 */
  poGanttScale: "day" | "week" | "month" | "quarter";
  /** 甘特图状态筛选 */
  poGanttStatusFilter: string[];
  /** 项目侧栏手动排序（drag & drop 持久化） */
  poProjectOrder: string[];
  /** 甘特图任务行手动排序（drag & drop 持久化） */
  poTaskOrder: string[];
  countdown: CountdownSettings;
  dailyPhrase: DailyPhraseSettings;
  /** 主页模块卡片的宽/高格数（拖拽调宽持久化；缺省视为 1×1） */
  moduleSizes: Record<string, { cols: number; rows: number }>;
  /** 主页模块的显示顺序与可见性（拖拽排序/删除/添加持久化；缺失 id 视为隐藏） */
  homeModuleOrder: string[];
  /** 移动端隐藏的模块 id 列表（桌面端不受影响） */
  mobileHiddenModules: string[];
}

export interface ActivityEntry {
  addedWords: number;
  edits: number;
  paths: string[];
}

export interface AstraPluginData {
  settings: AstraSettings;
  activity: Record<string, ActivityEntry>;
  linkSnapshots: Record<string, number>;
  fileWordCounts: Record<string, number>;
  trackingStartedAt: number | null;
  linkTrackingStartedAt: number | null;
}

export interface KnowledgeGraphNode {
  file: TFile;
  degree: number;
}

export interface KnowledgeGraphEdge {
  source: string;
  target: string;
}

export interface KnowledgeGraphSnapshot {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
}

export interface NoteMetric {
  file: TFile;
  words: number;
  backlinks: number;
  outgoingLinks: number;
}

export interface DailyActivity {
  date: string;
  addedWords: number;
  edits: number;
  estimated: boolean;
  files: TFile[];
}

export interface DailyLinkCount {
  date: string;
  count: number;
  estimated: boolean;
}

export interface FolderSummary {
  path: string;
  name: string;
  noteCount: number;
  wordCount: number;
  files: TFile[];
}

export interface DashboardSnapshot {
  generatedAt: number;
  notes: NoteMetric[];
  noteCount: number;
  totalWords: number;
  unlinkedNotes: NoteMetric[];
  shortNotes: NoteMetric[];
  recentNotes: NoteMetric[];
  modifiedToday: number;
  activity: DailyActivity[];
  trend: DailyActivity[];
  linkHistory: DailyLinkCount[];
  folders: FolderSummary[];
  graph: KnowledgeGraphSnapshot;
}

export interface AstraDataStore {
  data: AstraPluginData;
  requestDataSave(): void;
}

export const DEFAULT_HEATMAP_SETTINGS: HeatmapSettings = {
  title: $t("auto.318"),
  dataSourceType: "PAGE",
  dataSourceValue: "",
  dateFieldType: "FILE_MTIME",
  dateFieldValue: "",
  dateFormat: "",
  countFieldType: "DEFAULT",
  countFieldValue: "",
  excludeFolders: "",
  dateRangeType: "LATEST_DAYS",
  fromDate: "",
  toDate: "",
  startOfWeek: 1,
  showCellRuleIndicators: true
};

export const DEFAULT_FORCE_VIEW_MODE_SETTINGS: ForceViewModeSettings = {
  enabled: true,
  debounceTimeout: 300,
  ignoreOpenFiles: false,
  ignoreForceViewAll: false,
  folders: [{ folder: "", viewMode: "" }],
  files: [{ filePattern: "", viewMode: "" }],
};

export const DEFAULT_CURSOR_POSITION_SETTINGS: CursorPositionSettings = {
  enabled: true,
  delayAfterFileOpening: 100,
  saveTimer: SAFE_DB_FLUSH_INTERVAL,
};

export const DEFAULT_CALENDAR_SETTINGS: CalendarPluginSettings = {
  enabled: true,
  wordsPerDot: 250,
  weekStart: "locale",
  shouldConfirmBeforeCreate: true,
  position: "left",
  highlightToday: true,
};

export const DEFAULT_QUICK_CAPTURE_SETTINGS: QuickCaptureSettings = {
  filePath: "",
};

export const DEFAULT_DIARY_SETTINGS: DiarySettings = {
  storagePath: "Daily",
  namingPattern: "YYYY-MM-DD",
  templateFile: "",
};

export const DEFAULT_COUNTDOWN_SETTINGS: CountdownSettings = {
  eventName: "2027",
  targetDate: "2027-01-01",
};

export const DEFAULT_DAILY_PHRASE_SETTINGS: DailyPhraseSettings = {
  filePath: "",
};

export const DEFAULT_SETTINGS: AstraSettings = {
  displayName: "",
  openOnStartup: true,
  startupMode: "replace-active",
  shortNoteWordThreshold: 10,
  excludedFolders: [],
  showEstimatedHistory: true,
  activityHistoryDays: 365,
  quickLinks: [],
  heatmap: DEFAULT_HEATMAP_SETTINGS,
  cursorPosition: DEFAULT_CURSOR_POSITION_SETTINGS,
  calendar: DEFAULT_CALENDAR_SETTINGS,
  quickCapture: DEFAULT_QUICK_CAPTURE_SETTINGS,
  diary: DEFAULT_DIARY_SETTINGS,
  todoSourceFolder: "",
  projectsFolder: "Projects",
  npdpStages: ["Charter", "PDCP", "TR", "ADCP", "COR"],
  npdpMaxStage: 5,
  npdpProgressFilter: 5,
  currentPoView: "gantt",
  poGanttScale: "week",
  poGanttStatusFilter: [],
  poProjectOrder: [],
  poTaskOrder: [],
  countdown: DEFAULT_COUNTDOWN_SETTINGS,
  dailyPhrase: DEFAULT_DAILY_PHRASE_SETTINGS,
  moduleSizes: {},
  homeModuleOrder: ["qc", "dailyPhrase", "todo", "weekly", "projects", "countdown"],
  mobileHiddenModules: ["todo", "weekly", "projects", "countdown"],
};

export const DEFAULT_DATA: AstraPluginData = {
  settings: DEFAULT_SETTINGS,
  activity: {},
  linkSnapshots: {},
  fileWordCounts: {},
  trackingStartedAt: null,
  linkTrackingStartedAt: null
};
