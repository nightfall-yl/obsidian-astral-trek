import { beforeAll, describe, expect, it } from "vitest";
import {
  createMiniSearch,
  runSearch,
  buildExcerpt,
  type SearchDoc
} from "./search-core";

const doc = (
  id: string,
  title: string,
  h1: string,
  h2: string,
  content: string
): SearchDoc => ({
  id,
  title,
  h1,
  h2,
  h3: "",
  content,
  path: id
});

describe("search-core", () => {
  let mini: ReturnType<typeof createMiniSearch>;

  beforeAll(() => {
    mini = createMiniSearch();
    mini.add(doc("a.md", "读书笔记", "阅读", "方法", "这是一篇关于阅读方法的中文笔记，讨论如何做读书笔记。"));
    mini.add(doc("b.md", "Obsidian Guide", "Getting Started", "", "Obsidian is a powerful note taking tool. This guide covers the basics."));
    mini.add(doc("c.md", "项目周报", "本周进展", "", "本周完成了搜索功能的索引构建，性能表现良好。"));
  });

  it("中文 query 命中正文与标题", () => {
    const results = runSearch(mini, "读书");
    expect(results[0]?.id).toBe("a.md");
    const results2 = runSearch(mini, "阅读方法");
    expect(results2[0]?.id).toBe("a.md");
  });

  it("英文 query 大小写不敏感", () => {
    const results = runSearch(mini, "obsidian guide");
    expect(results[0]?.id).toBe("b.md");
  });

  it("标题字段加权：title 命中排前", () => {
    const results = runSearch(mini, "周报");
    expect(results[0]?.id).toBe("c.md");
  });

  it("分级标题权重：H1 命中优于 H2", () => {
    // "阅读" 在 a.md 的 H1；"方法" 在 a.md 的 H2 —— H1 加权更高
    const byH1 = runSearch(mini, "阅读");
    const byH2 = runSearch(mini, "方法");
    expect(byH1[0]?.id).toBe("a.md");
    expect(byH2[0]?.id).toBe("a.md");
    expect(byH1[0]!.score).toBeGreaterThan(byH2[0]!.score);
  });

  it("fuzzy 容错：轻微拼写偏差仍可命中", () => {
    const results = runSearch(mini, "obsidean");
    expect(results[0]?.id).toBe("b.md");
  });

  it("空 query 返回空", () => {
    expect(runSearch(mini, "  ")).toEqual([]);
  });

  it("文档更新后重新可见（discard + add）", () => {
    mini.discard("c.md");
    mini.add(doc("c.md", "项目周报", "本周进展", "", "现在改成了讨论阅读笔记的内容。"));
    const results = runSearch(mini, "索引构建");
    expect(results.find((r) => r.id === "c.md")).toBeUndefined();
    expect(runSearch(mini, "讨论阅读").map((r) => r.id)).toContain("c.md");
  });

  describe("buildExcerpt", () => {
    it("以命中词为中心取窗口并标记命中片段", () => {
      const segs = buildExcerpt(
        "前缀填充文字填充文字，中间出现了关键词needle然后还有后续内容，尾部更多文字。",
        ["needle"]
      );
      const marked = segs.filter((s) => s.mark).map((s) => s.text);
      expect(marked).toContain("needle");
      const plain = segs.map((s) => s.text).join("");
      expect(plain).toContain("关键词");
    });

    it("无命中时返回正文开头且无标记", () => {
      const segs = buildExcerpt("abcdefg 这段没有任何命中词", ["xyz"]);
      expect(segs.some((s) => s.mark)).toBe(false);
      expect(segs.map((s) => s.text).join("")).toContain("abcdefg");
    });

    it("大小写不敏感标记", () => {
      const segs = buildExcerpt("Find the NEEDLE here", ["needle"]);
      expect(segs.filter((s) => s.mark).map((s) => s.text)).toContain("NEEDLE");
    });
  });
});
