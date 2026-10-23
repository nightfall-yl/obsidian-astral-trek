// ================= Astra 通用查询：TASK 勾选写回核心 =================
// 纯字符串处理，无 Obsidian 依赖，vitest 直测。
// 乐观锁策略：快照行号只是初选定位，行内容（任务文本）才是身份标识；
// 定位失败不猜、不写，交还上层提示刷新。

export type WritebackResult =
  | { ok: true; line: number } // 实际生效的行号
  | { ok: false; reason: "stale" | "ambiguous" }; // 任务已删/文本已变 | 同文本多行歧义

export interface TaskLocation {
  /** 渲染时的行号快照（0 起），仅作初选 */
  line: number;
  /** 任务文本（checkbox 之后的内容），身份标识 */
  text: string;
}

const TASK_RE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)(.)(\]\s*)(.*)$/;

function statusOf(raw: string): string | null {
  return raw.match(TASK_RE)?.[2] ?? null;
}

function textOf(raw: string): string {
  return (raw.match(TASK_RE)?.[4] ?? "").trim();
}

function replaceStatus(raw: string, wanted: string): string {
  return raw.replace(
    TASK_RE,
    (_m, pre: string, _s: string, post: string, text: string) =>
      `${pre}${wanted}${post}${text}`
  );
}

/** 邻域搜索窗口：行号漂移时允许的偏移范围 */
const NEIGHBORHOOD = 5;

/** 在整份文件行中定位任务行并把 checkbox 翻到目标状态；找不到/歧义时原样返回。 */
export function toggleTaskInLines(
  lines: string[],
  loc: TaskLocation,
  targetDone: boolean
): WritebackResult {
  const wanted = targetDone ? "x" : " ";

  // ① 快照行直接命中（文本一致即同一任务，不要求状态一致——可能已被外部改过）
  if (lines[loc.line] !== undefined && textOf(lines[loc.line]!) === loc.text) {
    return apply(lines, loc.line, wanted);
  }

  // ② 行号漂移：±NEIGHBORHOOD 行内按文本定位，必须唯一
  const hits: number[] = [];
  for (
    let i = Math.max(0, loc.line - NEIGHBORHOOD);
    i <= Math.min(lines.length - 1, loc.line + NEIGHBORHOOD);
    i++
  ) {
    if (statusOf(lines[i]!) !== null && textOf(lines[i]!) === loc.text) {
      hits.push(i);
    }
  }
  if (hits.length === 1) {
    return apply(lines, hits[0]!, wanted);
  }
  return { ok: false, reason: hits.length === 0 ? "stale" : "ambiguous" };
}

function apply(lines: string[], line: number, wanted: string): WritebackResult {
  const raw = lines[line]!;
  const current = statusOf(raw);
  if (current === null) {
    return { ok: false, reason: "stale" }; // 行已被改成非任务
  }
  if (current === wanted) {
    return { ok: true, line }; // 幂等：已是目标状态
  }
  lines[line] = replaceStatus(raw, wanted);
  return { ok: true, line };
}
