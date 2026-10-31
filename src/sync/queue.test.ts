/**
 * Unit tests for the local p-queue / aggregate-error replacements used by the
 * vendored sync engine (src/sync/queue.ts).
 */

import { describe, expect, it } from "vitest";

import { MultiError, TaskQueue } from "./queue";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("TaskQueue", () => {
  it("runs tasks concurrently up to the concurrency limit", async () => {
    const q = new TaskQueue(2);
    let running = 0;
    let peak = 0;
    const tasks = Array.from({ length: 6 }, () =>
      q.add(async () => {
        running += 1;
        peak = Math.max(peak, running);
        await delay(10);
        running -= 1;
        return "ok";
      })
    );
    const results = await Promise.all(tasks);
    expect(results).toEqual(["ok", "ok", "ok", "ok", "ok", "ok"]);
    expect(peak).toBe(2);
  });

  it("resolves results and propagates rejections", async () => {
    const q = new TaskQueue(1);
    await expect(
      q.add(async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    expect(await q.add(async () => 42)).toBe(42);
  });

  it("onIdle resolves when the queue is empty", async () => {
    const q = new TaskQueue(1);
    let finished = false;
    void q.add(async () => {
      await delay(5);
      finished = true;
    });
    await q.onIdle();
    expect(finished).toBe(true);
    await q.onIdle();
  });

  it("pause + clear stops pending tasks; running tasks still finish", async () => {
    const q = new TaskQueue(1);
    let executed = 0;
    const slow = q.add(async () => {
      await delay(20);
      executed += 1;
    });
    for (let i = 0; i < 5; i++) {
      void q.add(async () => {
        executed += 1;
      });
    }
    q.pause();
    q.clear();
    await slow;
    await q.onIdle();
    expect(executed).toBe(1); // only the in-flight task ran
  });
});

describe("MultiError", () => {
  it("joins member error messages", () => {
    const err = new MultiError([
      new Error("first failed"),
      new Error("second failed"),
    ]);
    expect(err.errors).toHaveLength(2);
    expect(err.message).toContain("first failed");
    expect(err.message).toContain("second failed");
  });
});
