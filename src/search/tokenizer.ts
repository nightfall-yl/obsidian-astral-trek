// ================= Astra 全文搜索：分词器 =================
// 中文分词基于浏览器原生 Intl.Segmenter（ICU 词典，词级切分），
// 无外部依赖；索引与查询走同一条分词路径。

// tsconfig lib 未含 es2022.intl：以最小结构化类型声明 Intl.Segmenter
interface SegmenterLike {
  segment(input: string): Iterable<{ segment: string; isWordLike?: boolean }>;
}

const SegmenterCtor = (
  Intl as unknown as {
    Segmenter?: new (locale: string, options: { granularity: "word" }) => SegmenterLike;
  }
).Segmenter;

const segmenter = SegmenterCtor ? new SegmenterCtor("zh", { granularity: "word" }) : null;

/** 词元白名单：字母/数字/下划线（含 CJK），过滤标点与空白 */
const TOKEN_RE = /^[\p{L}\p{N}_]+$/u;

/** 词级切分 + isWordLike 过滤 */
function segmentTokens(text: string): string[] {
  if (!segmenter) {
    // 极旧环境最终兜底：按空白切
    return text.split(/\s+/);
  }
  const out: string[] = [];
  for (const seg of segmenter.segment(text)) {
    if (seg.isWordLike) out.push(seg.segment);
  }
  return out;
}

/** 全文搜索分词入口（MiniSearch 的 tokenize）：切分 + 小写归一 + 过滤。 */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const token of segmentTokens(text)) {
    const t = token.toLowerCase();
    if (t.length > 0 && t.length <= 40 && TOKEN_RE.test(t)) {
      out.push(t);
    }
  }
  return out;
}
