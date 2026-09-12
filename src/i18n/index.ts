import { Platform } from "obsidian";
import type { App } from "obsidian";
import zh from "./zh";
import en from "./en";

type Dict = Record<string, string>;

const dicts: Record<string, Dict> = { zh, en };
let _cachedLang: string = "";

/** Async helper: read Obsidian's global language setting from obsidian.json.
 *  Obsidian does NOT expose app.language — it lives in the global config file.
 *  On mobile (Platform.isDesktop === false) Node.js fs is unavailable; falls back to "en". */
async function _detectLanguage(): Promise<string> {
  if (!Platform.isDesktop) return "en";
  try {
    const [fs, os, path] = await Promise.all([
      import("fs"),
      import("os"),
      import("path"),
    ]);
    const home = os.homedir();
    let configPath = "";
    /* eslint-disable no-undef -- Platform.isDesktop ensures Node globals exist */
    if (process.platform === "darwin") {
      configPath = path.join(home, "Library/Application Support/obsidian/obsidian.json");
    } else if (process.platform === "win32") {
      configPath = path.join(process.env.APPDATA || "", "obsidian/obsidian.json");
    } else {
      configPath = path.join(home, ".config/obsidian/obsidian.json");
    }
    /* eslint-enable no-undef -- Node-only globals finished */
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8")) as {
      language?: unknown;
    };
    const language = typeof raw.language === "string" ? raw.language : "en";
    return language.toLowerCase();
  } catch {
    return "en";
  }
}

/** Synchronous accessor. Returns cached language (set by initI18n) or "en" as fallback. */
function readObsidianLanguage(): string {
  return _cachedLang || "en";
}

export async function initI18n(_a: App): Promise<void> {
  if (!_cachedLang) {
    _cachedLang = await _detectLanguage();
  }
}

export function getDictKey(_app?: App | null): keyof typeof dicts {
	const lang = readObsidianLanguage();
	return lang.startsWith("zh") ? "zh" : "en";
}

export function t(key: string, vars?: Record<string, string | number>): string {
  const dictKey = getDictKey();
  const dict = (dicts[dictKey] ?? en) as Dict;
  let result = dict[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      result = result.replaceAll(`{${k}}`, String(v));
    }
  }
  return result;
}

export function getLocaleCode(_app?: App | null): string {
	return getDictKey() === "zh" ? "zh-CN" : "en";
}

export function formatDate(d: Date, opts?: Intl.DateTimeFormatOptions, app?: App | null): string {
	return new Intl.DateTimeFormat(getLocaleCode(app), opts ?? {}).format(d);
}

export function formatDateTime(d: Date, app?: App | null): string {
	const locale = getLocaleCode(app);
	return new Intl.DateTimeFormat(locale, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);
}

export function formatNumber(n: number, app?: App | null): string {
	return new Intl.NumberFormat(getLocaleCode(app)).format(n);
}

export function formatCompact(n: number, app?: App | null): string {
	const locale = getLocaleCode(app);
	if (locale.startsWith("zh")) {
		if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, "") + "万";
		if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "千";
		return String(n);
	}
	if (n >= 1000) {
		const v = n / 1000;
		return (v >= 1000 ? (v / 1000).toFixed(1) + "M" : v.toFixed(1) + "k").replace(/\.0$/, "");
	}
	return String(n);
}

export function formatRelativeWeekday(d: Date, app?: App | null): string {
	const locale = getLocaleCode(app);
	const now = new Date();
	const dDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
	const nDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
	const diff = Math.round((nDay - dDay) / 86400000);
	if (locale === "zh-CN") {
		if (diff === 0) return "今天";
		if (diff === 1) return "昨天";
		if (diff === -1) return "明天";
		return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(d);
	} else {
		if (diff === 0) return "Today";
		if (diff === 1) return "Yesterday";
		if (diff === -1) return "Tomorrow";
		return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(d);
	}
}
