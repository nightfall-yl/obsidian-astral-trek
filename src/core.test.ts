import { describe, expect, it } from "vitest";
import {
  activityLevel,
  buildCumulativeLinkHistory,
  countWords,
  dayKeysEndingToday,
  formatCompactNumber,
  localDateKey
} from "./core";

describe("countWords", () => {
  it("counts Chinese characters and Latin words", () => {
    expect(countWords("# 标题\n\nHello world，这是测试。")).toBe(8);
  });

  it("ignores frontmatter and fenced code", () => {
    const source = [
      "---",
      "title: hidden metadata",
      "---",
      "可见文本",
      "```ts",
      "const hidden = true;",
      "```"
    ].join("\n");
    expect(countWords(source)).toBe(4);
  });

  it("uses visible wikilink aliases", () => {
    expect(countWords("[[Very long target|显示名]]")).toBe(3);
  });
});

describe("date and presentation helpers", () => {
  it("builds inclusive day ranges ending today", () => {
    expect(dayKeysEndingToday(3, new Date(2026, 6, 31))).toEqual([
      "2026-07-29",
      "2026-07-30",
      "2026-07-31"
    ]);
  });

  it("formats local dates", () => {
    expect(localDateKey(new Date(2026, 0, 2))).toBe("2026-01-02");
  });

  it("maps values to stable activity levels", () => {
    expect(activityLevel(0, 100)).toBe(0);
    expect(activityLevel(8, 100)).toBe(1);
    expect(activityLevel(50, 100)).toBe(4);
    expect(activityLevel(100, 100)).toBe(5);
  });

  it("formats Chinese compact numbers", () => {
    expect(formatCompactNumber(369_155, "zh")).toBe("36.9 万");
    expect(formatCompactNumber(368, "zh")).toBe("368");
  });

  it("combines estimated link history with exact daily snapshots", () => {
    expect(
      buildCumulativeLinkHistory(
        ["2026-07-30", "2026-07-31", "2026-08-01"],
        ["2026-07-29", "2026-07-30", "2026-07-31"],
        { "2026-08-01": 5 },
        new Date(2026, 7, 1).getTime()
      )
    ).toEqual([
      { date: "2026-07-30", count: 2, estimated: true },
      { date: "2026-07-31", count: 3, estimated: true },
      { date: "2026-08-01", count: 5, estimated: false }
    ]);
  });
});
