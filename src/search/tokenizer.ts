// ================= Astra 全文搜索：分词器 =================
// 中文分词基于浏览器原生 Intl.Segmenter（ICU 词典，词级切分），
// 无外部依赖；索引与查询走同一条分词路径。
// 分词行为选项对齐 omnisearch 同名设置（tokenizeUrls / ignoreDiacritics），
// 由调用方按当前设置传入。

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

/** 拉丁变音组合符区间（NFD 分解后残留） */
const LATIN_DIACRITICS_RE = /[\u0300-\u036f]/g;
/** URL 识别（宽松：非空白且含协议或 www 前缀） */
const URL_RE = /\b(?:https?:\/\/|www\.)\S+/g;

/** 单词元 → 产出词元序列 */
function expandToken(token: string, out: string[]): void {
  const t = token.toLowerCase();
  if (t.length === 0 || t.length > 40 || !TOKEN_RE.test(t)) return;
  out.push(t);
}

/** 分词行为选项（对齐 omnisearch 同名设置） */
export interface TokenizeOptions {
  /** URL 整体作为一个词元保留 */
  tokenizeUrls: boolean;
  /** 归一化拉丁变音符号（brûlée → brulee） */
  ignoreDiacritics: boolean;
}

export const DEFAULT_TOKENIZE_OPTIONS: TokenizeOptions = {
  tokenizeUrls: false,
  ignoreDiacritics: true,
};

function stripDiacritics(text: string, options: TokenizeOptions): string {
  let out = text;
  if (options.ignoreDiacritics) {
    out = out.normalize("NFD").replace(LATIN_DIACRITICS_RE, "").normalize("NFC");
  }
  return out;
}

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

/** 全文搜索分词入口（MiniSearch 的 tokenize）：切分 + 归一 + 过滤 + 扩展。 */
export function makeTokenizer(options: TokenizeOptions): (text: string) => string[] {
  return (text: string): string[] => {
    const normalized = stripDiacritics(text, options);
    const out: string[] = [];
    for (const token of segmentTokens(normalized)) {
      expandToken(token, out);
    }
    // URL 成词：整 URL（含路径分隔符）与其内部词都保留
    if (options.tokenizeUrls) {
      for (const match of normalized.matchAll(URL_RE)) {
        const raw = match[0];
        if (!raw) continue;
        // 整词不含 scheme（https:// 之外的 host/path 原样保留）
        const url = raw
          .replace(/^https?:\/\//i, "")
          .toLowerCase()
          .replace(/[^[\p{L}\p{N}_.~/-]/gu, "");
        if (url.length > 0) out.push(url);
        // 域名/路径先打散（ICU 可能把 "www.example.com" 整体词元化，需二次切分）
        for (const token of segmentTokens(raw.replace(/[.:/_~-]+/g, " "))) {
          expandToken(token, out);
        }
      }
    }
    return out;
  };
}

/** 默认分词器（无选项场景：单测/兜底） */
export const tokenize = makeTokenizer(DEFAULT_TOKENIZE_OPTIONS);
