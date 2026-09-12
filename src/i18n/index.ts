import fs from "fs";
import os from "os";
import path from "path";
import type { App } from "obsidian";
import zh from "./zh";
import en from "./en";

type Dict = Record<string, string>;

const dicts: Record<string, Dict> = { zh, en };
// _app kept for future use when Obsidian exposes App.language
let _cachedLang: string = "";

/** Read Obsidian's global language setting from obsidian.json.
 *  Obsidian does NOT expose app.language — it lives in the global config file. */
function readObsidianLanguage(): string {
  if (_cachedLang) return _cachedLang;
  try {
    const home = os.homedir();
    let configPath = "";
    if (process.platform === "darwin") {
      configPath = path.join(home, "Library/Application Support/obsidian/obsidian.json");
    } else if (process.platform === "win32") {
      configPath = path.join(process.env.APPDATA || "", "obsidian/obsidian.json");
    } else {
      configPath = path.join(home, ".config/obsidian/obsidian.json");
    }
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8")) as {
      language?: unknown;
    };
    const language = typeof raw.language === "string" ? raw.language : "en";
    _cachedLang = language.toLowerCase();
  } catch {
    _cachedLang = "en";
  }
  return _cachedLang;
}

export function initI18n(_a: App): void {
	_cachedLang = readObsidianLanguage();
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
