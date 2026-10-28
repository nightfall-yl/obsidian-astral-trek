import { describe, expect, it } from "vitest";
import { diffRange } from "./diff-range";

describe("diffRange", () => {
  it("前缀插入（如新增 frontmatter）不动正文区域", () => {
    const r = diffRange("body\n", "---\nkey: v\n\nbody\n");
    expect(r.from).toEqual({ line: 0, ch: 0 });
    expect(r.to).toEqual({ line: 0, ch: 0 });
    expect(r.insert).toBe("---\nkey: v\n\n");
  });

  it("行内多余字符删除只删该片段", () => {
    const r = diffRange("line1\nliine2\nline3\n", "line1\nline2\nline3\n");
    expect(r.from).toEqual({ line: 1, ch: 2 });
    expect(r.to).toEqual({ line: 1, ch: 3 });
    expect(r.insert).toBe("");
  });

  it("纯删除生成空 insert，区间到被删内容末尾", () => {
    const r = diffRange("aaa\nbbb\n", "aaa\n");
    expect(r.insert).toBe("");
    expect(r.to).toEqual({ line: 2, ch: 0 });
  });

  it("整文重写时退化为大区间（防御兜底）", () => {
    const r = diffRange("aaa\nbbb\n", "xxx\nyyy\n");
    expect(r.from).toEqual({ line: 0, ch: 0 });
    expect(r.to).toEqual({ line: 1, ch: 3 });
    expect(r.insert).toBe("xxx\nyyy");
  });
});
