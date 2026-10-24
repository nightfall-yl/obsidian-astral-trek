/**
 * 移植自 obsidian-linter 的 mdast 解析层，用于「不同内容间换行」规则。
 *
 * 保留上游完整的 from-markdown + Obsidian 自定义扩展（footnote / task-list /
 * frontmatter / math）解析，以忠实识别段落、引用、列表项等节点；
 * 仅裁掉本项目用不到的表格识别等函数，并用一个简单的 Map 缓存代替 quick-lru。
 */
import { gfmFootnote } from "micromark-extension-gfm-footnote";
import { gfmTaskListItem } from "micromark-extension-gfm-task-list-item";
import { frontmatter } from "micromark-extension-frontmatter";
import { frontmatterFromMarkdown } from "mdast-util-frontmatter";
import { combineExtensions } from "micromark-util-combine-extensions";
import { math } from "./micromark-math";
import { mathFromMarkdown } from "mdast-util-math";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFootnoteFromMarkdown } from "mdast-util-gfm-footnote";
import { gfmTaskListItemFromMarkdown } from "mdast-util-gfm-task-list-item";
import { visit } from "unist-util-visit";
import type { Position } from "unist";
import type { Root } from "mdast";
import { MDastTypes } from "./ast-types";

const LRU = new Map<string, Root>();
const MAX_CACHE = 200;

function parseTextToAST(text: string): Root {
  const cached = LRU.get(text);
  if (cached) return cached;

  // @ts-ignore fromMarkdown 的 options 重载在个别版本下标注不完整
  const ast = fromMarkdown(text, {
    extensions: [
      combineExtensions([
        gfmFootnote(),
        gfmTaskListItem(),
        frontmatter(["yaml"]),
      ]),
      math(),
    ],
    mdastExtensions: [
      [
        gfmFootnoteFromMarkdown(),
        gfmTaskListItemFromMarkdown,
        frontmatterFromMarkdown(["yaml"]),
      ],
      mathFromMarkdown(),
    ],
  });

  if (LRU.size >= MAX_CACHE) {
    const oldest = LRU.keys().next().value as string;
    if (oldest !== undefined) LRU.delete(oldest);
  }
  LRU.set(text, ast);
  return ast;
}

/**
 * 获取给定节点类型在文本中的位置列表（按 start.offset 降序排列，便于从后往前改写）。
 */
export function getPositions(type: string, text: string): Position[] {
  const ast = parseTextToAST(text);
  const positions: Position[] = [];
  visit(ast, type, (node) => {
    const p = (node as { position?: Position }).position;
    if (p) positions.push(p);
  });

  positions.sort((a, b) => (b.start.offset ?? 0) - (a.start.offset ?? 0));
  return positions;
}

function replaceTextBetweenStartAndEndWithNewValue(
  str: string,
  start: number,
  end: number,
  value: string
): string {
  return str.substring(0, start) + value + str.substring(end);
}

export enum LineBreakIndicators {
  TwoSpaces = "  ",
  LineBreakHtmlNotXml = "<br>",
  LineBreakHtml = "<br/>",
  Backslash = "\\",
}

/** callout 类型标记正则（`> [!note]`）。 */
const calloutTypeRegex = /^ ?\[![^\s]*\]/m;

function lineEndsInLineBreak(
  paragraphLine: string,
  indicator: LineBreakIndicators
): boolean {
  if (
    paragraphLine.endsWith("<br>") &&
    indicator == LineBreakIndicators.LineBreakHtmlNotXml
  ) {
    return true;
  }
  if (
    paragraphLine.endsWith("<br/>") &&
    indicator == LineBreakIndicators.LineBreakHtml
  ) {
    return true;
  }
  if (
    paragraphLine.endsWith("  ") &&
    indicator == LineBreakIndicators.TwoSpaces
  ) {
    return true;
  }
  if (
    !paragraphLine.endsWith("\\\\") &&
    paragraphLine.endsWith("\\") &&
    indicator == LineBreakIndicators.Backslash
  ) {
    return true;
  }
  return false;
}

function addOrReplaceLineEnding(
  paragraphLine: string,
  indicator: LineBreakIndicators
): string {
  paragraphLine = paragraphLine.trimEnd();
  let numCharsToRemove = 0;
  if (paragraphLine.endsWith("<br>")) {
    numCharsToRemove = 4;
  }
  if (paragraphLine.endsWith("<br/>")) {
    numCharsToRemove = 5;
  }
  if (!paragraphLine.endsWith("\\\\") && paragraphLine.endsWith("\\")) {
    numCharsToRemove = 1;
  }
  if (numCharsToRemove) {
    paragraphLine = paragraphLine.substring(
      0,
      paragraphLine.length - numCharsToRemove
    );
  }
  return paragraphLine.trimEnd() + indicator;
}

/**
 * 确保段落、引用和列表项中，每个内容块的结尾（其后紧跟另一行内容时）都以
 * 换行标记（默认为两个空格）结尾。
 */
export function addTwoSpacesAtEndOfLinesFollowedByAnotherLineOfTextContent(
  text: string,
  indicator: LineBreakIndicators
): string {
  const positions: Position[] = getPositions(MDastTypes.Paragraph, text);
  if (positions.length === 0) {
    return text;
  }

  for (const position of positions) {
    const paragraphLines = text
      .substring(position.start.offset ?? 0, position.end.offset ?? 0)
      .split("\n");
    const lastLineIndex = paragraphLines.length - 1;
    if (lastLineIndex < 1) {
      continue; // 只有一行，无需处理
    }

    let startIndex = 0;
    // 若该段首行是 callout 指示，跳过它（只处理其后续内容行）
    if (
      calloutTypeRegex.test(paragraphLines[0] ?? "") &&
      (paragraphLines[1] ?? "").startsWith(">")
    ) {
      startIndex = 1;
      if (lastLineIndex < 2) {
        continue;
      }
    }

    for (let i = startIndex; i < lastLineIndex; i++) {
      const paragraphLine = paragraphLines[i] ?? "";
      if (lineEndsInLineBreak(paragraphLine, indicator)) {
        continue;
      }
      paragraphLines[i] = addOrReplaceLineEnding(paragraphLine, indicator);
    }

    text = replaceTextBetweenStartAndEndWithNewValue(
      text,
      position.start.offset ?? 0,
      position.end.offset ?? 0,
      paragraphLines.join("\n")
    );
  }

  return text;
}