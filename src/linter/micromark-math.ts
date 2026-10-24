/**
 * Vendor of micromark-extension-math@3.1.0 (syntax layer only).
 * Source: https://github.com/micromark/micromark-extension-math
 * License: MIT © Titus Wormer
 *
 * Vendor 原因：上游把 katex 声明为运行时依赖，但其代码实际只使用
 * @types/katex（类型声明），导致 lockfile 携带被安全公告覆盖的 katex 版本
 * （GHSA-238p-pmpm-9mq7）。本项目只使用其 tokenizer（mdast 转换由
 * mdast-util-math 承担），故仅 vendor 语法层，html 渲染层不随行。
 * 上游更新时按 MIT 允许手动同步本文件。
 */

import { factorySpace } from "micromark-factory-space";
import { markdownLineEnding } from "micromark-util-character";
import type {
  Code,
  Construct,
  Effects,
  Extension,
  Resolver,
  State,
  Token,
  TokenizeContext,
} from "micromark-util-types";

/** 本扩展引入的 token 类型，注册进 micromark 的类型映射。 */
declare module "micromark-util-types" {
  interface TokenTypeMap {
    mathFlow: Token;
    mathFlowFence: Token;
    mathFlowFenceSequence: Token;
    mathFlowFenceMeta: Token;
    mathFlowValue: Token;
    mathText: Token;
    mathTextSequence: Token;
    mathTextData: Token;
    mathTextPadding: Token;
  }
}

/** 上游 `Options` 的本项目实际用到的子集。 */
interface MathOptions {
  singleDollarTextMath?: boolean | null;
}

/** Dollar sign. */
const DOLLAR = 36;

/** @returns Extension for `micromark` to enable math syntax. */
export function math(options?: MathOptions | null): Extension {
  return {
    flow: {
      [DOLLAR]: mathFlow,
    },
    text: {
      [DOLLAR]: mathText(options),
    },
  };
}

export const mathFlow: Construct = {
  tokenize: tokenizeMathFenced,
  concrete: true,
  name: "mathFlow",
};

/** Partial construct：数学块的懒续行检查。 */
const nonLazyContinuation: Construct = {
  tokenize: tokenizeNonLazyContinuation,
  partial: true,
};

function tokenizeMathFenced(
  this: TokenizeContext,
  effects: Effects,
  ok: State,
  nok: State
): State {
  // eslint-disable-next-line @typescript-eslint/no-this-alias -- micromark 惯用法
  const self = this;
  const tail = self.events[self.events.length - 1];
  const initialSize =
    tail && tail[1].type === "linePrefix"
      ? tail[2].sliceSerialize(tail[1], true).length
      : 0;
  let sizeOpen = 0;
  return start;

  /** 数学块起点。 */
  function start(code: Code) {
    effects.enter("mathFlow");
    effects.enter("mathFlowFence");
    effects.enter("mathFlowFenceSequence");
    return sequenceOpen(code);
  }

  /** 开启围栏序列中。 */
  function sequenceOpen(code: Code) {
    if (code === DOLLAR) {
      effects.consume(code);
      sizeOpen++;
      return sequenceOpen;
    }
    if (sizeOpen < 2) {
      return nok(code);
    }
    effects.exit("mathFlowFenceSequence");
    return factorySpace(effects, metaBefore, "whitespace")(code);
  }

  /** 开启围栏内、meta 之前。 */
  function metaBefore(code: Code) {
    if (code === null || markdownLineEnding(code)) {
      return metaAfter(code);
    }
    effects.enter("mathFlowFenceMeta");
    effects.enter("chunkString", {
      contentType: "string",
    });
    return meta(code);
  }

  /** meta 中。 */
  function meta(code: Code) {
    if (code === null || markdownLineEnding(code)) {
      effects.exit("chunkString");
      effects.exit("mathFlowFenceMeta");
      return metaAfter(code);
    }
    if (code === DOLLAR) {
      return nok(code);
    }
    effects.consume(code);
    return meta;
  }

  /** meta 之后（行尾/文件尾）。 */
  function metaAfter(code: Code) {
    // Guaranteed to be eol/eof.
    effects.exit("mathFlowFence");
    if (self.interrupt) {
      return ok(code);
    }
    return effects.attempt(nonLazyContinuation, beforeNonLazyContinuation, after)(code);
  }

  /** 数学内容中的非懒续行之后。 */
  function beforeNonLazyContinuation(code: Code) {
    return effects.attempt(
      {
        tokenize: tokenizeClosingFence,
        partial: true,
      },
      after,
      contentStart
    )(code);
  }

  /** 数学内容之前，确定不在闭合围栏前。 */
  function contentStart(code: Code) {
    return (
      initialSize
        ? factorySpace(effects, beforeContentChunk, "linePrefix", initialSize + 1)
        : beforeContentChunk
    )(code);
  }

  /** 可选前缀之后的数学内容之前。 */
  function beforeContentChunk(code: Code): State | undefined {
    if (code === null) {
      return after(code);
    }
    if (markdownLineEnding(code)) {
      return effects.attempt(nonLazyContinuation, beforeNonLazyContinuation, after)(code);
    }
    effects.enter("mathFlowValue");
    return contentChunk(code);
  }

  /** 数学内容中。 */
  function contentChunk(code: Code): State | undefined {
    if (code === null || markdownLineEnding(code)) {
      effects.exit("mathFlowValue");
      return beforeContentChunk(code);
    }
    effects.consume(code);
    return contentChunk;
  }

  /** 数学块结束。 */
  function after(code: Code) {
    effects.exit("mathFlow");
    return ok(code);
  }

  /** 闭合围栏 tokenizer。 */
  function tokenizeClosingFence(effects: Effects, ok: State, nok: State): State {
    let size = 0;
    /** 闭合围栏前、可选空白处。 */
    return factorySpace(
      effects,
      beforeSequenceClose,
      "linePrefix",
      self.parser.constructs.disable.null?.includes("codeIndented") ? undefined : 4
    );

    /** 可选空白之后、序列处。 */
    function beforeSequenceClose(code: Code) {
      effects.enter("mathFlowFence");
      effects.enter("mathFlowFenceSequence");
      return sequenceClose(code);
    }

    /** 闭合序列中。 */
    function sequenceClose(code: Code) {
      if (code === DOLLAR) {
        size++;
        effects.consume(code);
        return sequenceClose;
      }
      if (size < sizeOpen) {
        return nok(code);
      }
      effects.exit("mathFlowFenceSequence");
      return factorySpace(effects, afterSequenceClose, "whitespace")(code);
    }

    /** 闭合序列与可选空白之后。 */
    function afterSequenceClose(code: Code) {
      if (code === null || markdownLineEnding(code)) {
        effects.exit("mathFlowFence");
        return ok(code);
      }
      return nok(code);
    }
  }
}

/** 非懒续行 tokenizer。 */
function tokenizeNonLazyContinuation(
  this: TokenizeContext,
  effects: Effects,
  ok: State,
  nok: State
): State {
  // eslint-disable-next-line @typescript-eslint/no-this-alias -- micromark 惯用法
  const self = this;
  return start;

  function start(code: Code) {
    if (code === null) {
      return ok(code);
    }
    effects.enter("lineEnding");
    effects.consume(code);
    effects.exit("lineEnding");
    return lineStart;
  }

  function lineStart(code: Code) {
    return self.parser.lazy[self.now().line] ? nok(code) : ok(code);
  }
}

/** 行内数学 construct 工厂（`options.singleDollarTextMath` 控制单 `$` 是否生效）。 */
export function mathText(options?: MathOptions | null): Construct {
  const options_ = options || {};
  let single = options_.singleDollarTextMath;
  if (single === null || single === undefined) {
    single = true;
  }
  return {
    tokenize: tokenizeMathText,
    resolve: resolveMathText,
    previous,
    name: "mathText",
  };

  function tokenizeMathText(effects: Effects, ok: State, nok: State): State {
    let sizeOpen = 0;
    let size = 0;
    let token: Token;
    return start;

    /** 行内数学起点。 */
    function start(code: Code) {
      effects.enter("mathText");
      effects.enter("mathTextSequence");
      return sequenceOpen(code);
    }

    /** 开启序列中。 */
    function sequenceOpen(code: Code) {
      if (code === DOLLAR) {
        effects.consume(code);
        sizeOpen++;
        return sequenceOpen;
      }

      // Not enough markers in the sequence.
      if (sizeOpen < 2 && !single) {
        return nok(code);
      }
      effects.exit("mathTextSequence");
      return between(code);
    }

    /** 开闭序列之间。 */
    function between(code: Code): State | undefined {
      if (code === null) {
        return nok(code);
      }
      if (code === DOLLAR) {
        token = effects.enter("mathTextSequence");
        size = 0;
        return sequenceClose(code);
      }

      // Tabs don't work, and virtual spaces don't make sense.
      if (code === 32) {
        effects.enter("space");
        effects.consume(code);
        effects.exit("space");
        return between;
      }
      if (markdownLineEnding(code)) {
        effects.enter("lineEnding");
        effects.consume(code);
        effects.exit("lineEnding");
        return between;
      }

      // Data.
      effects.enter("mathTextData");
      return data(code);
    }

    /** 数据中。 */
    function data(code: Code): State | undefined {
      if (code === null || code === 32 || code === DOLLAR || markdownLineEnding(code)) {
        effects.exit("mathTextData");
        return between(code);
      }
      effects.consume(code);
      return data;
    }

    /** 闭合序列中。 */
    function sequenceClose(code: Code): State | undefined {
      // More.
      if (code === DOLLAR) {
        effects.consume(code);
        size++;
        return sequenceClose;
      }

      // Done!
      if (size === sizeOpen) {
        effects.exit("mathTextSequence");
        effects.exit("mathText");
        return ok(code);
      }

      // More or less accents: mark as data.
      token.type = "mathTextData";
      return data(code);
    }
  }
}

/** 归一化首尾空白为 padding，并合并相邻的空白与数据。 */
const resolveMathText: Resolver = function (events) {
  let tailExitIndex = events.length - 4;
  let headEnterIndex = 3;
  let index: number;
  let enter: number | undefined;

  // If we start and end with an EOL or a space.
  const headToken = events.at(headEnterIndex)?.[1];
  const tailToken = events.at(tailExitIndex)?.[1];
  if (
    headToken &&
    tailToken &&
    (headToken.type === "lineEnding" || headToken.type === "space") &&
    (tailToken.type === "lineEnding" || tailToken.type === "space")
  ) {
    index = headEnterIndex;

    // And we have data.
    while (++index < tailExitIndex) {
      if (events[index]?.[1].type === "mathTextData") {
        // Then we have padding.
        tailToken.type = "mathTextPadding";
        headToken.type = "mathTextPadding";
        headEnterIndex += 2;
        tailExitIndex -= 2;
        break;
      }
    }
  }

  // Merge adjacent spaces and data.
  index = headEnterIndex - 1;
  tailExitIndex++;
  while (++index <= tailExitIndex) {
    if (enter === undefined) {
      const token = events[index]?.[1];
      if (index !== tailExitIndex && token && token.type !== "lineEnding") {
        enter = index;
      }
    } else if (index === tailExitIndex || events[index]![1].type === "lineEnding") {
      const enterToken = events[enter]![1];
      enterToken.type = "mathTextData";
      if (index !== enter + 2) {
        enterToken.end = events[index - 1]![1].end;
        events.splice(enter + 2, index - enter - 2);
        tailExitIndex -= index - enter - 2;
        index = enter + 2;
      }
      enter = undefined;
    }
  }
  return events;
};

/** 前置校验：`$` 前不能紧跟另一个 `$`（转义除外）。 */
function previous(this: TokenizeContext, code: Code): boolean {
  // If there is a previous code, there will always be a tail.
  return code !== DOLLAR || this.events[this.events.length - 1]![1].type === "characterEscape";
}
