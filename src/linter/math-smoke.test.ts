import { describe, expect, it } from "vitest";
import { fromMarkdown } from "mdast-util-from-markdown";
import { mathFromMarkdown } from "mdast-util-math";
import { math } from "./micromark-math";

describe("vendored micromark-math smoke", () => {
  it("parses inline and block math", () => {
    const tree = fromMarkdown("行内 $a+b$ 公式\n\n$$\nx = y\n$$\n", {
      extensions: [math()],
      mdastExtensions: [mathFromMarkdown()],
    });
    const inline = tree.children.find((n) => n.type === "paragraph");
    const types =
      inline && "children" in inline ? inline.children.map((c) => c.type) : [];
    expect(types).toContain("inlineMath");
    const block = tree.children.find((n) => n.type === "math");
    expect(block && "value" in block && block.value).toBe("x = y");
  });

  it("single $ without closing stays text", () => {
    const tree = fromMarkdown("价格是 $5 元", {
      extensions: [math()],
      mdastExtensions: [mathFromMarkdown()],
    });
    const para = tree.children[0]!;
    expect(para.type).toBe("paragraph");
    const types = "children" in para ? para.children.map((c) => c.type) : [];
    expect(types).not.toContain("inlineMath");
  });
});
