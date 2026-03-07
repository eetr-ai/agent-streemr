// Copyright 2026 Juan Alberto Lopez Cavallotti
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from "vitest";
import { ThreadQueue } from "./queue";

describe("ThreadQueue", () => {
  // -------------------------------------------------------------------------
  // Basic sequencing
  // -------------------------------------------------------------------------

  it("runs a single task and resolves", async () => {
    const queue = new ThreadQueue();
    const result: number[] = [];
    await queue.enqueue("t1", async () => { result.push(1); });
    expect(result).toEqual([1]);
  });

  it("runs tasks in the order they were enqueued for the same threadId", async () => {
    const queue = new ThreadQueue();
    const order: number[] = [];

    // Enqueue 3 tasks without awaiting individually; the last promise resolves when all are done
    queue.enqueue("t1", async () => { order.push(1); });
    queue.enqueue("t1", async () => { order.push(2); });
    await queue.enqueue("t1", async () => { order.push(3); });

    expect(order).toEqual([1, 2, 3]);
  });

  it("does NOT serialise tasks across different threadIds (they run concurrently)", async () => {
    const queue = new ThreadQueue();
    const order: string[] = [];

    const delays: Record<string, number> = { A: 20, B: 5 };
    const p1 = queue.enqueue("A", () => new Promise<void>((res) => setTimeout(() => { order.push("A"); res(); }, delays["A"])));
    const p2 = queue.enqueue("B", () => new Promise<void>((res) => setTimeout(() => { order.push("B"); res(); }, delays["B"])));

    await Promise.all([p1, p2]);
    // B finishes before A because it has a shorter delay
    expect(order).toEqual(["B", "A"]);
  });

  it("does not block subsequent tasks when a task throws", async () => {
    const queue = new ThreadQueue();
    const order: number[] = [];

    queue.enqueue("t1", async () => { throw new Error("boom"); });
    await queue.enqueue("t1", async () => { order.push(2); });

    expect(order).toEqual([2]);
  });

  // -------------------------------------------------------------------------
  // has() / clear()
  // -------------------------------------------------------------------------

  it("has() returns true while tasks are pending", async () => {
    const queue = new ThreadQueue();
    let resolveTask!: () => void;
    const taskDone = new Promise<void>((res) => { resolveTask = res; });

    queue.enqueue("t1", () => taskDone);
    expect(queue.has("t1")).toBe(true);
    resolveTask();
    await new Promise<void>((res) => setTimeout(res, 0)); // flush microtasks
    expect(queue.has("t1")).toBe(false);
  });

  it("has() returns false for an unknown threadId", () => {
    expect(new ThreadQueue().has("unknown")).toBe(false);
  });

  it("clear() prevents future enqueued tasks from being tracked but does not abort in-flight tasks", async () => {
    const queue = new ThreadQueue();
    const ran: number[] = [];

    // Enqueue a slow task
    const slow = queue.enqueue("t1", () => new Promise<void>((res) => setTimeout(() => { ran.push(1); res(); }, 30)));
    queue.clear("t1");

    // After clear, a new task for the same thread starts fresh (not chained)
    await queue.enqueue("t1", async () => { ran.push(2); });

    // The slow task is still running in the background; await it
    await slow;

    // Both ran but order is non-deterministic: 2 may finish before 1
    expect(ran).toContain(1);
    expect(ran).toContain(2);
  });

  // -------------------------------------------------------------------------
  // Blank threadId
  // -------------------------------------------------------------------------

  it("rejects an empty threadId", async () => {
    const queue = new ThreadQueue();
    await expect(queue.enqueue("", async () => {})).rejects.toThrow();
  });

  it("rejects a whitespace-only threadId", async () => {
    const queue = new ThreadQueue();
    await expect(queue.enqueue("   ", async () => {})).rejects.toThrow();
  });

  // -------------------------------------------------------------------------
  // Concurrency correctness — slow then fast for the same thread
  // -------------------------------------------------------------------------

  it("always runs tasks in FIFO order regardless of individual durations", async () => {
    const queue = new ThreadQueue();
    const order: number[] = [];

    // Task 1 is slow, task 2 is fast — but must run AFTER task 1
    queue.enqueue("t1", () => new Promise<void>((res) => setTimeout(() => { order.push(1); res(); }, 30)));
    await queue.enqueue("t1", async () => { order.push(2); });

    expect(order).toEqual([1, 2]);
  });
});
