import type { EditorPosition } from "obsidian";

/**
 * 计算把 oldText 变成 newText 的最小替换区间（最长公共前缀 + 后缀定位）。
 * 用于编辑器内联替换：光标/选区位于公共前后缀内时，CodeMirror 的原生位置
 * 映射会保持其不动，避免整文替换把光标打回文档顶部（社区反馈的跳光标 bug）。
 */
export function diffRange(
  oldText: string,
  newText: string
): { from: EditorPosition; to: EditorPosition; insert: string } {
  const minLen = Math.min(oldText.length, newText.length);

  let start = 0;
  while (start < minLen && oldText[start] === newText[start]) {
    start++;
  }

  let endOld = oldText.length;
  let endNew = newText.length;
  while (
    endOld > start &&
    endNew > start &&
    oldText[endOld - 1] === newText[endNew - 1]
  ) {
    endOld--;
    endNew--;
  }

  return {
    from: offsetToPos(oldText, start),
    to: offsetToPos(oldText, endOld),
    insert: newText.slice(start, endNew),
  };
}

/** 把字符串偏移量换算成 Obsidian 编辑器的 {line, ch} 位置。 */
function offsetToPos(text: string, offset: number): EditorPosition {
  const before = text.slice(0, offset);
  const line = (before.match(/\n/g) ?? []).length;
  const ch = offset - (before.lastIndexOf("\n") + 1);
  return { line, ch };
}
