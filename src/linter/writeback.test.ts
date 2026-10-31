/**
 * lint 回写应用层集成测试（runLinterEditor）。
 *
 * 26.2.4 的事故区：lint 内容回写曾经是整文替换，把替换区域内的光标打回文档顶部
 * （社区反馈"编辑时光标反复跳回顶部"）。修复后回写走 diffRange 的最小差异区间，
 * 由 CodeMirror 原生位置映射保持光标/滚动不动。
 *
 * 这组测试用真实 LinterManager + 最小 Editor 替身，锁住两件事：
 * 1. 回写必须是「差异区间 replaceRange」，绝不允许退化为整文替换；
 * 2. 回写三元组 (insert, from, to) 应用后的最终文本与 lint 结果严格一致。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import type { App, Editor, EditorPosition, Plugin, TFile } from "obsidian";
import type { StaticStore } from "../static-store";

// 依赖链上的 yaml-timestamp.ts 在模块加载期读取 window.moment，node 测试环境
// 无 window——先指到 globalThis 再动态加载被测模块（globalThis.moment 为
// undefined 无碍：本测试用 lintSpy 桩掉 lintText，不触达 moment 路径）。
// vitest 按文件隔离模块注册表，此桩不外溢到其他测试文件。
vi.stubGlobal("window", globalThis);
const { LinterManager } = await import("./manager");

/** 把 {line,ch} 位置换算为字符串偏移。 */
function posToOffset(text: string, pos: EditorPosition): number {
  const lines = text.split("\n");
  let offset = 0;
  for (let i = 0; i < pos.line; i++) offset += lines[i]!.length + 1;
  return offset + pos.ch;
}

/** 最小 Editor 替身：记录 replaceRange 调用，并按 CodeMirror 语义应用替换。 */
function makeEditor(initial: string) {
  let text = initial;
  const calls: {
    insert: string;
    from: EditorPosition;
    to: EditorPosition;
  }[] = [];
  const editor = {
    getValue: () => text,
    replaceRange: (
      insert: string,
      from: EditorPosition,
      to: EditorPosition
    ) => {
      calls.push({ insert, from, to });
      const start = posToOffset(text, from);
      const end = posToOffset(text, to);
      text = text.slice(0, start) + insert + text.slice(end);
    },
  } as unknown as Editor;
  return { editor, calls, getText: () => text };
}

function makeFile(path: string): TFile {
  return { path } as unknown as TFile;
}

/** LinterManager 的私有成员访问面（测试专用结构视图）。 */
interface LinterInternals {
  lintText(markdown: string, file: TFile, includeYaml?: boolean): string;
  runLinterEditor(
    editor: Editor,
    file: TFile,
    includeYaml?: boolean
  ): Promise<void>;
  isApplyingLint: boolean;
  lastLintedContent: Map<string, string>;
}

function makeManager(): {
  internals: LinterInternals;
  lintSpy: MockInstance<LinterInternals["lintText"]>;
} {
  const manager = new LinterManager(
    {} as unknown as App,
    {} as unknown as Plugin,
    {} as unknown as StaticStore
  );
  const internals = manager as unknown as LinterInternals;
  const lintSpy = vi.spyOn(internals, "lintText");
  return { internals, lintSpy };
}

describe("runLinterEditor（lint 回写应用层）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("单行变更：只回写差异区间，不整文替换", async () => {
    const source = "a\nb\nc";
    const linted = "a\nB\nc";
    const { editor, calls, getText } = makeEditor(source);
    const { internals, lintSpy } = makeManager();
    lintSpy.mockReturnValue(linted);

    await internals.runLinterEditor(editor, makeFile("a.md"), true);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      insert: "B",
      from: { line: 1, ch: 0 },
      to: { line: 1, ch: 1 },
    });
    // 三元组应用后的最终文本与 lint 结果严格一致
    expect(getText()).toBe(linted);
  });

  it("跨行区间替换：insert 含换行，替换区两端公共部分不动", async () => {
    const source = "a: 1\nkeep";
    const linted = "a: 2\n3\nkeep";
    const { editor, calls, getText } = makeEditor(source);
    const { internals, lintSpy } = makeManager();
    lintSpy.mockReturnValue(linted);

    await internals.runLinterEditor(editor, makeFile("a.md"), true);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      insert: "2\n3",
      from: { line: 0, ch: 3 },
      to: { line: 0, ch: 4 },
    });
    expect(getText()).toBe(linted);
  });

  it("lint 无变化：不触发任何回写", async () => {
    const source = "---\na: 1\n---\nbody";
    const { editor, calls } = makeEditor(source);
    const { internals, lintSpy } = makeManager();
    lintSpy.mockReturnValue(source);

    await internals.runLinterEditor(editor, makeFile("a.md"), true);

    expect(calls).toHaveLength(0);
    expect(internals.lastLintedContent.size).toBe(0);
  });

  it("回写后记录 lastLintedContent（防重复 lint 的依据）", async () => {
    const source = "a\nb\nc";
    const linted = "a\nB\nc";
    const { editor } = makeEditor(source);
    const { internals, lintSpy } = makeManager();
    lintSpy.mockReturnValue(linted);

    await internals.runLinterEditor(editor, makeFile("notes/a.md"), true);

    expect(internals.lastLintedContent.get("notes/a.md")).toBe(linted);
  });

  it("防重入门禁：回写期间 isApplyingLint 为 true，下一帧解除", async () => {
    const { editor } = makeEditor("a\nb");
    const { internals, lintSpy } = makeManager();
    lintSpy.mockReturnValue("a\nb\n");

    await internals.runLinterEditor(editor, makeFile("a.md"), true);
    // 定时器未推进时仍处于门禁中（阻塞 change 事件再入）
    expect(internals.isApplyingLint).toBe(true);

    vi.advanceTimersByTime(1);
    expect(internals.isApplyingLint).toBe(false);
  });
});
