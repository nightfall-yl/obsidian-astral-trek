import { Platform } from "obsidian";
import type { App } from "obsidian";
import zh from "./zh";
import en from "./en";

type Dict = Record<string, string>;

const dicts: Record<string, Dict> = { zh, en };
let _cachedLang: string = "";

/** Read Obsidian's global language setting from obsidian.json.
 *  Obsidian does NOT expose app.language — it lives in the global config file.
 *  On mobile (Platform.isDesktop === false) Node.js fs is unavailable; falls back to "en". */
function _detectLanguage(): string {
  if (!Platform.isDesktop) return "en";
  try {
    const fs = require("fs");
    const os = require("os");
    const path = require("path");

    const home = os.homedir();
    const candidates: string[] = [];

    if (process.platform === "darwin") {
      candidates.push(path.join(home, "Library/Application Support/obsidian/obsidian.json"));
    } else if (process.platform === "win32") {
      // Primary: %APPDATA%\obsidian\obsidian.json
      const appdata = process.env.APPDATA;
      if (appdata) candidates.push(path.join(appdata, "obsidian/obsidian.json"));
      // Fallback: home\AppData\Roaming\obsidian\obsidian.json (equivalent to APPDATA)
      candidates.push(path.join(home, "AppData/Roaming/obsidian/obsidian.json"));
      // Portable Obsidian fallback: home\.obsidian\obsidian.json
      candidates.push(path.join(home, ".obsidian/obsidian.json"));
    } else {
      candidates.push(path.join(home, ".config/obsidian/obsidian.json"));
    }

    for (const configPath of candidates) {
      if (fs.existsSync(configPath)) {
        const raw = JSON.parse(fs.readFileSync(configPath, "utf-8")) as {
          language?: unknown;
        };
        const language = typeof raw.language === "string" ? raw.language : "en";
        return language.toLowerCase();
      }
    }
    return "en";
  } catch {
    return "en";
  }
}

/** Synchronous accessor. Returns cached language (set by initI18n) or "en" as fallback. */
function readObsidianLanguage(): string {
  return _cachedLang || "en";
}

export function initI18n(_a: App): void {
  // Always re-read obsidian.json to pick up language changes after plugin reload.
  _cachedLang = _detectLanguage();
}

export function getDictKey(_app?: App | null): keyof typeof dicts {
	const lang = readObsidianLanguage();
	return lang.startsWith("zh") ? "zh" : "en";
}

export function t(key: string, vars?: Record<string, string | number>): string {
  const dictKey = getDictKey();
  const dict = dicts[dictKey] ?? en;
  let result = (dict as Dict)[key] ?? key;
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
