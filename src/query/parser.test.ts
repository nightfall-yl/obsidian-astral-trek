import { describe, expect, it } from "vitest";
import {
  parseQuery,
  QueryParseError,
  type ListQuery,
  type Query,
  type TableQuery,
} from "./parser";

/** 断言为 TABLE 查询并收窄类型，便于访问类型特定字段。 */
function asTable(q: Query): TableQuery {
  expect(q.type).toBe("table");
  return q as TableQuery;
}

/** 断言为 LIST 查询并收窄类型。 */
function asList(q: Query): ListQuery {
  expect(q.type).toBe("list");
  return q as ListQuery;
}

describe("parseQuery", () => {
  it("解析基本 TABLE 与列定义", () => {
    const q = asTable(parseQuery("TABLE file.link, description"));
    expect(q.withoutId).toBe(false);
    expect(q.columns).toEqual([
      { field: "file.link" },
      { field: "description" }
    ]);
    expect(q.from).toBeNull();
    expect(q.where).toBeNull();
    expect(q.sort).toBeNull();
  });

  it("解析 WITHOUT ID", () => {
    const q = asTable(parseQuery("TABLE WITHOUT ID description"));
    expect(q.withoutId).toBe(true);
  });

  it("解析 AS 别名（含引号）", () => {
    const q = asTable(
      parseQuery('TABLE file.link AS "文章", description AS "描述"')
    );
    expect(q.columns).toEqual([
      { field: "file.link", alias: "文章" },
      { field: "description", alias: "描述" }
    ]);
  });

  it("解析 FROM 路径", () => {
    const q = parseQuery('TABLE name\nFROM "01 Note/02_Areas/RNA-seq"');
    expect(q.from).toEqual({
      kind: "folder",
      path: "01 Note/02_Areas/RNA-seq"
    });
  });

  it("解析 FROM #tag", () => {
    expect(parseQuery("TABLE name\nFROM #project/sub").from).toEqual({
      kind: "tag",
      tag: "project/sub"
    });
  });

  it("解析 WHERE != 条件", () => {
    const q = parseQuery(
      'TABLE name\nWHERE file.name != "00.RNA-seq Index"'
    );
    expect(q.where).toEqual({
      field: "file.name",
      op: "!=",
      value: "00.RNA-seq Index"
    });
  });

  it("解析 WHERE = 条件", () => {
    const q = parseQuery('TABLE name\nWHERE file.name = "a"');
    expect(q.where).toEqual({ field: "file.name", op: "=", value: "a" });
  });

  it("解析 SORT ASC / DESC / 默认", () => {
    expect(parseQuery("TABLE name\nSORT name ASC").sort).toEqual({
      field: "name",
      desc: false
    });
    expect(parseQuery("TABLE name\nSORT name DESC").sort).toEqual({
      field: "name",
      desc: true
    });
    expect(parseQuery("TABLE name\nSORT name").sort).toEqual({
      field: "name",
      desc: false
    });
  });

  it("无 WHERE/SORT 时为 null", () => {
    const q = parseQuery("TABLE name");
    expect(q.where).toBeNull();
    expect(q.sort).toBeNull();
    expect(q.limit).toBeNull();
  });

  it("解析 LIMIT 行数", () => {
    expect(parseQuery("TABLE name\nLIMIT 5").limit).toEqual({ count: 5 });
    expect(parseQuery("TABLE name\nLIMIT 0").limit).toEqual({ count: 0 });
  });

  it("LIMIT 非法值抛出 QueryParseError", () => {
    expect(() => parseQuery("TABLE name\nLIMIT abc")).toThrow(QueryParseError);
    expect(() => parseQuery("TABLE name\nLIMIT -1")).toThrow(QueryParseError);
    expect(() => parseQuery("TABLE name\nLIMIT")).toThrow(QueryParseError);
  });

  it("解析用户完整示例", () => {
    const src = `TABLE WITHOUT ID
  file.link AS "文章",
  description AS "描述"
FROM "01 Note/02_Areas/RNA-seq"
WHERE file.name != "00.RNA-seq Index"
SORT file.name ASC
LIMIT 10`;
    const q = asTable(parseQuery(src));
    expect(q.withoutId).toBe(true);
    expect(q.columns).toEqual([
      { field: "file.link", alias: "文章" },
      { field: "description", alias: "描述" }
    ]);
    expect(q.from).toEqual({
      kind: "folder",
      path: "01 Note/02_Areas/RNA-seq"
    });
    expect(q.where).toEqual({
      field: "file.name",
      op: "!=",
      value: "00.RNA-seq Index"
    });
    expect(q.sort).toEqual({ field: "file.name", desc: false });
    expect(q.limit).toEqual({ count: 10 });
  });

  it("解析 LIST（无字段 = 仅文件链接）", () => {
    const q = asList(parseQuery("LIST FROM #project"));
    expect(q.format).toBeNull();
    expect(q.withoutId).toBe(false);
    expect(q.from).toEqual({ kind: "tag", tag: "project" });
    expect(q.where).toBeNull();
    expect(q.sort).toBeNull();
    expect(q.limit).toBeNull();
  });

  it("解析 LIST 字段与 WITHOUT ID", () => {
    const q = asList(parseQuery("LIST file.name\nFROM #project"));
    expect(q.format).toBe("file.name");
    expect(q.withoutId).toBe(false);

    const q2 = asList(parseQuery("LIST WITHOUT ID description"));
    expect(q2.format).toBe("description");
    expect(q2.withoutId).toBe(true);
  });

  it("LIST 字段含空格/AS 抛出 QueryParseError", () => {
    expect(() => parseQuery('LIST file.link AS "标题"')).toThrow(
      QueryParseError
    );
    expect(() => parseQuery("LIST a b")).toThrow(QueryParseError);
  });

  it("WHERE 布尔判断（truthy / !falsy）", () => {
    expect(parseQuery("TABLE name\nWHERE done").where).toEqual({
      field: "done",
      op: "truthy"
    });
    expect(parseQuery("TASK FROM #x\nWHERE !completed").where).toEqual({
      field: "completed",
      op: "falsy"
    });
  });

  it("解析 TASK（无载荷）", () => {
    const q = parseQuery("TASK FROM #project");
    expect(q.type).toBe("task");
    expect(q.from).toEqual({ kind: "tag", tag: "project" });
    expect(q.where).toBeNull();
  });

  it("TASK 带 WITHOUT ID / 字段抛出 QueryParseError", () => {
    expect(() => parseQuery("TASK WITHOUT ID")).toThrow(QueryParseError);
    expect(() => parseQuery("TASK text")).toThrow(QueryParseError);
  });

  it("非法语法抛出 QueryParseError", () => {
    expect(() => parseQuery("")).toThrow(QueryParseError);
    expect(() => parseQuery("TODO name")).toThrow(QueryParseError);
    expect(() => parseQuery("TABLE")).toThrow(QueryParseError);
    expect(() => parseQuery("TABLE name\nWHERE a b")).toThrow(QueryParseError);
    expect(() => parseQuery("TABLE name\nFROM")).toThrow(QueryParseError);
    expect(() => parseQuery("TABLE name\nFROM #")).toThrow(QueryParseError);
  });
});