import { describe, expect, it } from "vitest";
import { makeTokenizer, DEFAULT_TOKENIZE_OPTIONS } from "./tokenizer";

describe("tokenizer", () => {
  it("默认行为：中英混合切词 + 小写归一", () => {
    const tokenize = makeTokenizer(DEFAULT_TOKENIZE_OPTIONS);
    expect(tokenize("读书笔记 Reading Notes")).toContain("读书");
    expect(tokenize("读书笔记 Reading Notes")).toContain("reading");
  });

  it("ignoreDiacritics：brûlée → brulee", () => {
    const on = makeTokenizer({ ...DEFAULT_TOKENIZE_OPTIONS, ignoreDiacritics: true });
    const off = makeTokenizer({ ...DEFAULT_TOKENIZE_OPTIONS, ignoreDiacritics: false });
    expect(on("brûlée café")).toContain("brulee");
    expect(on("brûlée café")).not.toContain("brûlée");
    expect(off("brûlée café")).toContain("brûlée");
  });

  it("tokenizeUrls：URL 整体成词且域名内部词可用", () => {
    const on = makeTokenizer({ ...DEFAULT_TOKENIZE_OPTIONS, tokenizeUrls: true });
    const tokens = on("详见 https://www.example.com/docs/page 说明");
    expect(tokens).toContain("www.example.com/docs/page");
    expect(tokens).toContain("example");
  });

  it("标点与空白被过滤", () => {
    const tokenize = makeTokenizer(DEFAULT_TOKENIZE_OPTIONS);
    const tokens = tokenize("你好，world！！  #tag-1 #阅读");
    expect(tokens).not.toContain("，");
    expect(tokens).toContain("tag");
    expect(tokens).toContain("1");
    expect(tokens).toContain("阅读");
  });
});
