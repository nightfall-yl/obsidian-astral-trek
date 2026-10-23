import { describe, expect, it } from "vitest";
import { tokenize } from "./tokenizer";

describe("tokenize（Intl.Segmenter 词级切分）", () => {
  it("中文切出词元", () => {
    const tokens = tokenize("今天天气不错");
    expect(tokens).toContain("今天");
    expect(tokens).toContain("天气");
    expect(tokens.length).toBeGreaterThan(0);
  });

  it("英文大小写归一", () => {
    expect(tokenize("Hello World")).toEqual(["hello", "world"]);
  });

  it("中英混排", () => {
    const tokens = tokenize("使用 Obsidian 记笔记");
    expect(tokens).toContain("obsidian");
    expect(tokens).toContain("使用");
    expect(tokens).toContain("记笔记");
  });

  it("标点与空白被过滤", () => {
    const tokens = tokenize("你好，世界！ hello, world!!!");
    expect(tokens).not.toContain("，");
    expect(tokens).not.toContain("！");
    expect(tokens).not.toContain(",");
    expect(tokens).toContain("你好");
    expect(tokens).toContain("世界");
    expect(tokens).toContain("hello");
  });

  it("所有词元均合法（无标点/空白，长度上限 40）", () => {
    const tokens = tokenize("Astra 的全文搜索 full-text search，2026 年！");
    expect(tokens.length).toBeGreaterThan(0);
    for (const t of tokens) {
      expect(t).toMatch(/^[\p{L}\p{N}_]+$/u);
      expect(t.length).toBeLessThanOrEqual(40);
    }
  });
});
