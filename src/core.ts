import { getLocaleCode } from "./i18n";
import type { DailyLinkCount } from "./models";

const CJK_PATTERN =
  /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/gu;
const WORD_PATTERN = /[\p{L}\p{N}]+(?:['’_-][\p{L}\p{N}]+)*/gu;

export function stripMarkdownForCounting(markdown: string): string {
  return markdown
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/u, "")
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/~~~[\s\S]*?~~~/gu, " ")
    .replace(/<!--[\s\S]*?-->/gu, " ")
    .replace(/!\[\[([^\]]+)\]\]/gu, "$1")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/gu, "$2")
    .replace(/\[\[([^\]]+)\]\]/gu, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/https?:\/\/\S+/gu, " ")
    .replace(/[`*_>#|~=-]/gu, " ");
}

export function countWords(markdown: string): number {
  const text = stripMarkdownForCounting(markdown);
  const cjkCount = text.match(CJK_PATTERN)?.length ?? 0;
  const withoutCjk = text.replace(CJK_PATTERN, " ");
  const otherWordCount = withoutCjk.match(WORD_PATTERN)?.length ?? 0;
  return cjkCount + otherWordCount;
}

export function localDateKey(value: Date | number): string {
  const date = typeof value === "number" ? new Date(value) : value;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function dayKeysEndingToday(days: number, now = new Date()): string[] {
  const safeDays = Math.max(1, Math.floor(days));
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  cursor.setDate(cursor.getDate() - safeDays + 1);
  const keys: string[] = [];

  for (let index = 0; index < safeDays; index += 1) {
    keys.push(localDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return keys;
}

export function buildCumulativeLinkHistory(
  dates: string[],
  estimatedLinkDates: string[],
  exactSnapshots: Record<string, number>,
  trackingStartedAt: number | null
): DailyLinkCount[] {
  if (dates.length === 0) return [];
  const firstDate = dates[0]!;
  const estimatedByDate = new Map<string, number>();
  let estimatedTotal = 0;
  estimatedLinkDates.forEach((date) => {
    if (date < firstDate) {
      estimatedTotal += 1;
      return;
    }
    estimatedByDate.set(date, (estimatedByDate.get(date) ?? 0) + 1);
  });
  const trackingStart = trackingStartedAt
    ? localDateKey(trackingStartedAt)
    : null;
  let lastExact: number | null = null;

  return dates.map((date) => {
    estimatedTotal += estimatedByDate.get(date) ?? 0;
    const exact = exactSnapshots[date];
    if (exact !== undefined) {
      lastExact = Math.max(0, exact);
      return { date, count: lastExact, estimated: false };
    }
    if (trackingStart && date >= trackingStart && lastExact !== null) {
      return { date, count: lastExact, estimated: true };
    }
    return { date, count: estimatedTotal, estimated: true };
  });
}

export function activityLevel(value: number, max: number): number {
  if (value <= 0 || max <= 0) {
    return 0;
  }
  const ratio = value / max;
  if (ratio <= 0.08) return 1;
  if (ratio <= 0.22) return 2;
  if (ratio <= 0.45) return 3;
  if (ratio <= 0.72) return 4;
  return 5;
}

export function formatCompactNumber(value: number, locale?: string): string {
  const isZh = (locale ?? getLocaleCode()).startsWith("zh");
  if (isZh) {
    if (value >= 100_000_000) {
      return `${trimDecimal(value / 100_000_000)} 亿`;
    }
    if (value >= 10_000) {
      return `${trimDecimal(value / 10_000)} 万`;
    }
    return new Intl.NumberFormat("zh-CN").format(value);
  } else {
    if (value >= 1_000_000) {
      return `${trimDecimal(value / 1_000_000)}M`;
    }
    if (value >= 1_000) {
      return `${trimDecimal(value / 1_000)}K`;
    }
    return new Intl.NumberFormat("en-US").format(value);
  }
}

function trimDecimal(value: number): string {
  return value
    .toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)
    .replace(/\.0+$/u, "")
    .replace(/(\.\d*[1-9])0+$/u, "$1");
}
