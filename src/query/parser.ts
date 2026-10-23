// ================= Astra 通用查询：DQL 子集解析器 =================
// 解析 ```astra 代码块里的查询语法（自研轻量引擎，无 Obsidian 依赖）。
// 结构参照 Dataview 的判别联合设计：查询头（TABLE / LIST / TASK）+ 共享子句
// （FROM / WHERE / SORT / LIMIT），每种查询头附带各自的载荷（TABLE = 列定义）。
// 当前实现 TABLE / LIST；TASK 由后续步骤在此骨架上扩展。
// 支持：TABLE [WITHOUT ID] 字段 [AS "别名"] ... FROM "路径"|#标签
//       [WHERE 条件] [SORT 字段 [ASC|DESC]] [LIMIT N]
//       LIST [WITHOUT ID] [字段] ... —— 渲染语义与 Dataview 一致：
//       无字段 = 文件链接；有字段 = "链接: 值"；WITHOUT ID 字段 = 仅值

export interface ColumnSpec {
  /** 字段名，如 "file.link"、"description" */
  field: string;
  /** AS 后的别名，如 "描述"；无别名时为 undefined */
  alias?: string;
}

export interface WhereClause {
  field: string;
  /** "= value" / "!= value"；或无值布尔判断：truthy（`WHERE 字段`）/ falsy（`WHERE !字段`） */
  op: "=" | "!=" | "truthy" | "falsy";
  /** 已去除首尾引号的字符串值；truthy / falsy 时缺省 */
  value?: string;
}

export interface SortSpec {
  field: string;
  /** true = DESC，false = ASC（默认） */
  desc: boolean;
}

export interface LimitSpec {
  /** 最多返回的行数（非负整数） */
  count: number;
}

/** FROM 源：文件夹路径或标签（不含 # 前缀，匹配含子标签）。 */
export type FromSource =
  | { kind: "folder"; path: string }
  | { kind: "tag"; tag: string };

/** 所有查询类型共享的子句。 */
export interface CommonClauses {
  /** FROM 源；null = 整库 */
  from: FromSource | null;
  where: WhereClause | null;
  sort: SortSpec | null;
  limit: LimitSpec | null;
}

/** TABLE 查询：渲染为 Dataview 风格表格。 */
export interface TableQuery extends CommonClauses {
  type: "table";
  /** 是否带 WITHOUT ID（去掉默认的文件链接列） */
  withoutId: boolean;
  /** 显式声明的列 */
  columns: ColumnSpec[];
}

/** LIST 查询：渲染为 Dataview 风格列表。 */
export interface ListQuery extends CommonClauses {
  type: "list";
  /** 是否带 WITHOUT ID（去掉默认的文件链接前缀） */
  withoutId: boolean;
  /** LIST 后的单一字段；null = 仅文件链接 */
  format: string | null;
}

/** TASK 查询：渲染正文任务项的只读列表。 */
export interface TaskQuery extends CommonClauses {
  type: "task";
}

/** 查询判别联合：按 type 字段分流到对应渲染器。 */
export type Query = TableQuery | ListQuery | TaskQuery;

export class QueryParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueryParseError";
  }
}

/** 去除首尾成对的双引号/单引号。 */
function unquote(s: string): string {
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}

/** 解析单个列定义，如 `file.link AS "文章"` 或 `description`。 */
function parseColumn(spec: string): ColumnSpec {
  const asMatch = spec.match(/^(\S+)\s+AS\s+(.+)$/i);
  if (asMatch) {
    return { field: asMatch[1]!, alias: unquote(asMatch[2]!.trim()) };
  }
  if (!/^\S+$/.test(spec)) {
    throw new QueryParseError("无法解析列定义：" + spec);
  }
  return { field: spec };
}

function parseWhere(text: string): WhereClause {
  const m = text.match(/^(\S+)\s*(!=|=)\s*(.*)$/);
  if (m) {
    return { field: m[1]!, op: m[2]! as "=" | "!=", value: unquote(m[3]!.trim()) };
  }
  // 布尔判断：`WHERE !字段`（falsy）/ `WHERE 字段`（truthy），TASK 查询常用
  const neg = text.match(/^!\s*(\S+)$/);
  if (neg) {
    return { field: neg[1]!, op: "falsy" };
  }
  if (/^\S+$/.test(text)) {
    return { field: text, op: "truthy" };
  }
  throw new QueryParseError("无法解析 WHERE 条件：" + text);
}

function parseSort(text: string): SortSpec {
  const m = text.match(/^(\S+)(?:\s+(ASC|DESC))?$/i);
  if (!m) {
    throw new QueryParseError("无法解析 SORT 子句：" + text);
  }
  return { field: m[1]!, desc: (m[2] || "").toUpperCase() === "DESC" };
}

function parseLimit(text: string): LimitSpec {
  const m = text.match(/^(\d+)$/);
  if (!m) {
    throw new QueryParseError("无法解析 LIMIT 子句：" + (text || "缺少行数"));
  }
  return { count: parseInt(m[1]!, 10) };
}

function parseFromSource(text: string): FromSource {
  if (!text) {
    throw new QueryParseError("FROM 后缺少路径或标签");
  }
  if (text.startsWith("#")) {
    const tag = text.slice(1).trim();
    if (!tag) {
      throw new QueryParseError("FROM 后缺少标签名");
    }
    return { kind: "tag", tag };
  }
  const path = unquote(text);
  if (!path) {
    throw new QueryParseError("FROM 后缺少路径");
  }
  return { kind: "folder", path };
}

/** 把 ```astra 代码块源码解析为结构化查询。 */
export function parseQuery(source: string): Query {
  const raw = source.trim();
  if (!raw) {
    throw new QueryParseError("查询内容为空");
  }

  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // 查询头：TABLE / LIST / TASK
  const headerMatch = lines[0]!.match(/^(TABLE|LIST|TASK)\b/i);
  if (!headerMatch) {
    throw new QueryParseError("查询必须以 TABLE / LIST / TASK 开头");
  }
  const kind = headerMatch[1]!.toLowerCase() as "table" | "list" | "task";

  // 查询头之后的剩余内容（可能紧跟着 WITHOUT ID 与列/字段定义）
  let rest = lines[0]!.slice(headerMatch[0].length).trim();
  let withoutId = false;
  const withoutIdMatch = rest.match(/^WITHOUT\s+ID\b/i);
  if (withoutIdMatch) {
    withoutId = true;
    rest = rest.slice(withoutIdMatch[0].length).trim();
  }

  // 内容行 = 第一行剩余列定义 + 后续所有行（FROM/WHERE/SORT 需行首）
  const contentLines: string[] = [];
  if (rest) {
    contentLines.push(rest);
  }
  for (let i = 1; i < lines.length; i++) {
    contentLines.push(lines[i]!);
  }

  const columnsText: string[] = [];
  let from: string | null = null;
  let where: string | null = null;
  let sort: string | null = null;
  let limit: string | null = null;

  for (const line of contentLines) {
    const fromM = line.match(/^FROM\b\s*(.*)$/i);
    const whereM = line.match(/^WHERE\b\s*(.*)$/i);
    const sortM = line.match(/^SORT\b\s*(.*)$/i);
    const limitM = line.match(/^LIMIT\b\s*(.*)$/i);
    if (fromM) {
      from = fromM[1]!.trim();
      continue;
    }
    if (whereM) {
      where = whereM[1]!.trim();
      continue;
    }
    if (sortM) {
      sort = sortM[1]!.trim();
      continue;
    }
    if (limitM) {
      limit = limitM[1]!.trim();
      continue;
    }
    columnsText.push(line);
  }

  const payloadStr = columnsText.join(" ").trim();

  // 注意用 !== null 判断：子句值为空串（如裸 "LIMIT" 行）时也必须走解析并报错
  const clauses = {
    from: from !== null ? parseFromSource(from) : null,
    where: where !== null ? parseWhere(where) : null,
    sort: sort !== null ? parseSort(sort) : null,
    limit: limit !== null ? parseLimit(limit) : null,
  };

  // LIST 载荷：可选的单个字段名（不支持 AS 别名）
  if (kind === "list") {
    if (payloadStr && !/^\S+$/.test(payloadStr)) {
      throw new QueryParseError("无法解析 LIST 字段：" + payloadStr);
    }
    return { type: "list", withoutId, format: payloadStr || null, ...clauses };
  }

  // TASK 载荷：无字段，也不支持 WITHOUT ID
  if (kind === "task") {
    if (withoutId) {
      throw new QueryParseError("TASK 不支持 WITHOUT ID");
    }
    if (payloadStr) {
      throw new QueryParseError("TASK 后不支持字段定义：" + payloadStr);
    }
    return { type: "task", ...clauses };
  }

  // TABLE 载荷：逗号分隔的列定义
  if (!payloadStr) {
    throw new QueryParseError("TABLE 后缺少列定义");
  }
  const columns: ColumnSpec[] = payloadStr
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(parseColumn);

  if (columns.length === 0) {
    throw new QueryParseError("TABLE 后缺少列定义");
  }

  return { type: "table", withoutId, columns, ...clauses };
}