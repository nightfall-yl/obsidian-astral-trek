import { beforeAll, describe, expect, it } from "vitest";
import {
  createMiniSearch,
  runSearch,
  buildExcerpt,
  fuzzinessValue,
  computeFingerprint,
  planReconcile,
  INDEX_FORMAT_VERSION,
  type SearchDoc,
  type SearchPostProcess,
  type SearchQueryOptions
} from "./search-core";

const doc = (
  id: string,
  title: string,
  h1: string,
  h2: string,
  content: string,
  extra?: Partial<SearchDoc>
): SearchDoc => ({
  id,
  title,
  h1,
  h2,
  h3: "",
  content,
  tags: "",
  props: "",
  path: id,
  ...extra
});

const defaultOptions: SearchQueryOptions = {
  weights: { title: 10, path: 7, h1: 6, h2: 5, h3: 4, tags: 2, props: 1 },
  fuzzy: 0.2,
  prefix: true
};

const defaultPost: SearchPostProcess = {
  downrankedFolders: [],
  hiddenPaths: []
};

const search = (
  mini: ReturnType<typeof createMiniSearch>,
  query: string,
  options: Partial<SearchQueryOptions> = {},
  post: Partial<SearchPostProcess> = {}
): ReturnType<typeof runSearch> =>
  runSearch(
    mini,
    query,
    { ...defaultOptions, ...options },
    { ...defaultPost, ...post }
  );

describe("search-core", () => {
  let mini: ReturnType<typeof createMiniSearch>;

  beforeAll(() => {
    mini = createMiniSearch();
    mini.add(doc("a.md", "读书笔记", "阅读", "方法", "这是一篇关于阅读方法的中文笔记，讨论如何做读书笔记。"));
    mini.add(doc("b.md", "Obsidian Guide", "Getting Started", "", "Obsidian is a powerful note taking tool. This guide covers the basics."));
    mini.add(doc("c.md", "项目周报", "本周进展", "", "本周完成了搜索功能的索引构建，性能表现良好。"));
  });

  it("中文 query 命中正文与标题", () => {
    const results = search(mini, "读书");
    expect(results[0]?.id).toBe("a.md");
    const results2 = search(mini, "阅读方法");
    expect(results2[0]?.id).toBe("a.md");
  });

  it("英文 query 大小写不敏感", () => {
    const results = search(mini, "obsidian guide");
    expect(results[0]?.id).toBe("b.md");
  });

  it("标题字段加权：title 命中排前", () => {
    const results = search(mini, "周报");
    expect(results[0]?.id).toBe("c.md");
  });

  it("分级标题权重：H1 命中优于 H2", () => {
    // "阅读" 在 a.md 的 H1；"方法" 在 a.md 的 H2 —— H1 加权更高
    const byH1 = search(mini, "阅读");
    const byH2 = search(mini, "方法");
    expect(byH1[0]?.id).toBe("a.md");
    expect(byH2[0]?.id).toBe("a.md");
    expect(byH1[0]!.score).toBeGreaterThan(byH2[0]!.score);
  });

  it("fuzzy 容错：轻微拼写偏差仍可命中", () => {
    const results = search(mini, "obsidean");
    expect(results[0]?.id).toBe("b.md");
  });

  it("Fuzziness = 0（精确匹配）时拼写偏差不命中", () => {
    const results = search(mini, "obsidean", { fuzzy: fuzzinessValue("0") });
    expect(results.find((r) => r.id === "b.md")).toBeUndefined();
  });

  it("Simpler search（prefix=false）时前缀词不命中", () => {
    // "读" 是 "读书" 的前缀：prefix=true 命中，prefix=false 不命中
    expect(search(mini, "读").map((r) => r.id)).toContain("a.md");
    expect(search(mini, "读", { prefix: false }).map((r) => r.id)).not.toContain("a.md");
  });

  it("标签字段参与检索（tags 权重）", () => {
    const tagMini = createMiniSearch();
    tagMini.add(doc("t1.md", "无题", "", "", "正文与标签无关的内容。", { tags: "#阅读 #方法" }));
    expect(search(tagMini, "阅读").map((r) => r.id)).toContain("t1.md");
  });

  it("降权文件夹：命中分数被压低但仍返回", () => {
    const plain = search(mini, "周报");
    const downranked = search(mini, "周报", {}, { downrankedFolders: ["c.md"] });
    expect(downranked.map((r) => r.id)).toContain("c.md");
    expect(downranked[0]!.score).toBeLessThan(plain[0]!.score);
  });

  it("隐藏路径（hideExcluded）从结果中剔除", () => {
    const results = search(mini, "周报", {}, { hiddenPaths: ["c.md"] });
    expect(results.map((r) => r.id)).not.toContain("c.md");
  });

  it("fuzzinessValue 映射", () => {
    expect(fuzzinessValue("0")).toBe(0);
    expect(fuzzinessValue("1")).toBe(0.2);
    expect(fuzzinessValue("2")).toBe(0.4);
  });

  it("空 query 返回空", () => {
    expect(search(mini, "  ")).toEqual([]);
  });

  it("文档更新后重新可见（discard + add）", () => {
    mini.discard("c.md");
    mini.add(doc("c.md", "项目周报", "本周进展", "", "现在改成了讨论阅读笔记的内容。"));
    const results = search(mini, "索引构建");
    expect(results.find((r) => r.id === "c.md")).toBeUndefined();
    expect(search(mini, "讨论阅读").map((r) => r.id)).toContain("c.md");
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

describe("索引持久化：指纹与对账", () => {
  const baseInput = {
    tokenizeUrls: false,
    ignoreDiacritics: true,
    indexedFileTypes: ["txt", "csv"],
    indexFilesWithoutExtension: false,
    unsupportedFilesIndexing: "default",
    displayTitle: "",
    hideExcluded: false
  };

  it("computeFingerprint：设置等价（顺序/空白/大小写无关）则指纹一致", () => {
    const a = computeFingerprint(baseInput, "1.2.3");
    const b = computeFingerprint(
      { ...baseInput, indexedFileTypes: [" CSV ", "txt"] },
      "1.2.3"
    );
    expect(a).toBe(b);
  });

  it("computeFingerprint：任一影响索引的设置或版本变化都改变指纹", () => {
    const base = computeFingerprint(baseInput, "1.2.3");
    expect(computeFingerprint({ ...baseInput, tokenizeUrls: true }, "1.2.3")).not.toBe(base);
    expect(computeFingerprint({ ...baseInput, ignoreDiacritics: false }, "1.2.3")).not.toBe(base);
    expect(computeFingerprint({ ...baseInput, displayTitle: "#heading" }, "1.2.3")).not.toBe(base);
    expect(computeFingerprint({ ...baseInput, hideExcluded: true }, "1.2.3")).not.toBe(base);
    expect(computeFingerprint({ ...baseInput, unsupportedFilesIndexing: "yes" }, "1.2.3")).not.toBe(base);
    expect(computeFingerprint({ ...baseInput, indexFilesWithoutExtension: true }, "1.2.3")).not.toBe(base);
    expect(computeFingerprint(baseInput, "1.2.4")).not.toBe(base);
    expect(base).toContain(`"format":${INDEX_FORMAT_VERSION}`);
  });

  it("planReconcile：删除 / 修改 / 新增三类差异", () => {
    const plan = planReconcile(
      [
        { path: "a.md", mtime: 100 }, // 索引时 mtime 相同 → 不动
        { path: "b.md", mtime: 300 }, // mtime 变新 → 重索引
        { path: "d.md", mtime: 100 } // 索引中没有 → 重索引（新增）
      ],
      {
        "a.md": 100,
        "b.md": 200,
        "c.md": 100 // vault 中已不存在 → 移除
      }
    );
    expect(plan.toRemove).toEqual(["c.md"]);
    expect(plan.toReindex.sort()).toEqual(["b.md", "d.md"]);
  });

  it("planReconcile：空 vault 全量移除，空索引全量重索引", () => {
    expect(planReconcile([], { "a.md": 1, "b.md": 2 }).toRemove.sort()).toEqual(["a.md", "b.md"]);
    const plan = planReconcile([{ path: "a.md", mtime: 5 }], {});
    expect(plan.toRemove).toEqual([]);
    expect(plan.toReindex).toEqual(["a.md"]);
  });
});
