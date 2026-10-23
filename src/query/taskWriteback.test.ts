import { describe, expect, it } from "vitest";
import { toggleTaskInLines, type TaskLocation } from "./taskWriteback";

const loc = (line: number, text: string): TaskLocation => ({ line, text });

describe("toggleTaskInLines", () => {
  it("普通翻转：- [ ] → - [x]，保留缩进/标记/文本", () => {
    const ls = ["- [ ] 买牛奶"];
    expect(toggleTaskInLines(ls, loc(0, "买牛奶"), true)).toEqual({
      ok: true,
      line: 0
    });
    expect(ls[0]).toBe("- [x] 买牛奶");

    expect(toggleTaskInLines(ls, loc(0, "买牛奶"), false)).toEqual({
      ok: true,
      line: 0
    });
    expect(ls[0]).toBe("- [ ] 买牛奶");
  });

  it("有序列表与 * 标记变体，嵌套缩进保留", () => {
    const ls = ["1. [ ] 计划", "* [x] 完成", "  - [ ] 子任务"];
    expect(toggleTaskInLines(ls, loc(0, "计划"), true)).toEqual({
      ok: true,
      line: 0
    });
    expect(ls[0]).toBe("1. [x] 计划");
    expect(toggleTaskInLines(ls, loc(1, "完成"), false)).toEqual({
      ok: true,
      line: 1
    });
    expect(ls[1]).toBe("* [ ] 完成");
    expect(toggleTaskInLines(ls, loc(2, "子任务"), true)).toEqual({
      ok: true,
      line: 2
    });
    expect(ls[2]).toBe("  - [x] 子任务");
  });

  it("已是目标状态：幂等 ok，行内容不变", () => {
    const ls = ["- [x] 已完成"];
    expect(toggleTaskInLines(ls, loc(0, "已完成"), true)).toEqual({
      ok: true,
      line: 0
    });
    expect(ls[0]).toBe("- [x] 已完成");
  });

  it("快照行漂移（上方插入行），±5 行内唯一命中并返回新行号", () => {
    const ls = ["新行1", "新行2", "- [ ] 买牛奶", "- [ ] 其它"];
    // 快照时任务在 line 0，现漂移到 line 2
    expect(toggleTaskInLines(ls, loc(0, "买牛奶"), true)).toEqual({
      ok: true,
      line: 2
    });
    expect(ls[2]).toBe("- [x] 买牛奶");
  });

  it("任务被删除：stale，原文不变", () => {
    const ls = ["- [ ] 其它", "正文行"];
    expect(toggleTaskInLines(ls, loc(1, "买牛奶"), true)).toEqual({
      ok: false,
      reason: "stale"
    });
    expect(ls[1]).toBe("正文行");
  });

  it("快照行被改成非任务行且邻域无命中：stale", () => {
    const ls = ["- [ ] 其它", "这里曾是任务，现在是普通段落"];
    expect(toggleTaskInLines(ls, loc(1, "买牛奶"), true)).toEqual({
      ok: false,
      reason: "stale"
    });
  });

  it("快照行命中优先于邻域重复：直接写快照行", () => {
    // 用户点击的是快照行对应的 checkbox，UI 语义明确，不搜索
    const ls = ["- [ ] 买牛奶", "- [ ] 买牛奶"];
    expect(toggleTaskInLines(ls, loc(0, "买牛奶"), true)).toEqual({
      ok: true,
      line: 0
    });
    expect(ls[0]).toBe("- [x] 买牛奶");
    expect(ls[1]).toBe("- [ ] 买牛奶");
  });

  it("快照行漂移且窗口内同文本两行：ambiguous，原文不变", () => {
    const ls = ["新行", "新行", "- [ ] 买牛奶", "- [ ] 其它", "- [ ] 买牛奶"];
    expect(toggleTaskInLines(ls, loc(0, "买牛奶"), true)).toEqual({
      ok: false,
      reason: "ambiguous"
    });
    expect(ls[2]).toBe("- [ ] 买牛奶");
    expect(ls[4]).toBe("- [ ] 买牛奶");
  });

  it("快照行号越界不抛错，超出 ±5 窗口视为 stale", () => {
    const ls = ["- [ ] 买牛奶"];
    expect(toggleTaskInLines(ls, loc(50, "买牛奶"), true)).toEqual({
      ok: false,
      reason: "stale"
    });
    expect(ls[0]).toBe("- [ ] 买牛奶");
  });

  it("普通列表项与含 [x] 字样的正文行不被误改", () => {
    const ls = ["- 普通列表项", "这是一个 [x] 示例段落", "- [ ] 真任务"];
    // 对普通行发起翻转：文本匹配不上任务行 → stale
    expect(toggleTaskInLines(ls, loc(0, "普通列表项"), true)).toEqual({
      ok: false,
      reason: "stale"
    });
    expect(ls).toEqual(["- 普通列表项", "这是一个 [x] 示例段落", "- [ ] 真任务"]);
    // 真任务不受影响
    expect(toggleTaskInLines(ls, loc(2, "真任务"), true)).toEqual({
      ok: true,
      line: 2
    });
    expect(ls[2]).toBe("- [x] 真任务");
  });

  it("中间态字符（/）视为未完成，可翻转为目标态", () => {
    const ls = ["- [/] 进行中"];
    expect(toggleTaskInLines(ls, loc(0, "进行中"), true)).toEqual({
      ok: true,
      line: 0
    });
    expect(ls[0]).toBe("- [x] 进行中");
  });
});
