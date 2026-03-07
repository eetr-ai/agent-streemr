// Copyright 2026 Juan Alberto Lopez Cavallotti
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import { LocalToolRegistry } from "./registry";

type Ctx = { value?: string; denied?: boolean; notSupported?: boolean; errored?: boolean };

describe("LocalToolRegistry", () => {
  let registry: LocalToolRegistry<Ctx>;
  const TOOL = "my_tool";
  const THREAD = "thread-1";
  const REQID = "req-abc";
  const NOW = 1_000_000;
  const TTL = 5_000;

  beforeEach(() => {
    registry = new LocalToolRegistry<Ctx>();
  });

  // -------------------------------------------------------------------------
  // Processor registration + dispatch
  // -------------------------------------------------------------------------

  it("dispatches onSuccess with responseJson", () => {
    const onSuccess = vi.fn();
    registry.register(TOOL, { onSuccess });

    registry.trackEmit({ threadId: THREAD, request_id: REQID, tool_name: TOOL, nowMs: NOW, ttlMs: TTL });
    const ctx: Ctx = {};
    registry.handleResponse({ ctx, threadId: THREAD, request_id: REQID, tool_name: TOOL, status: "success", responseJson: { x: 1 } });

    expect(onSuccess).toHaveBeenCalledWith(ctx, { x: 1 });
  });

  it("dispatches onDenied", () => {
    const onDenied = vi.fn();
    registry.register(TOOL, { onDenied });

    registry.trackEmit({ threadId: THREAD, request_id: REQID, tool_name: TOOL, nowMs: NOW, ttlMs: TTL });
    const ctx: Ctx = {};
    registry.handleResponse({ ctx, threadId: THREAD, request_id: REQID, tool_name: TOOL, status: "denied" });

    expect(onDenied).toHaveBeenCalledWith(ctx);
  });

  it("dispatches onNotSupported", () => {
    const onNotSupported = vi.fn();
    registry.register(TOOL, { onNotSupported });

    registry.trackEmit({ threadId: THREAD, request_id: REQID, tool_name: TOOL, nowMs: NOW, ttlMs: TTL });
    const ctx: Ctx = {};
    registry.handleResponse({ ctx, threadId: THREAD, request_id: REQID, tool_name: TOOL, status: "not_supported" });

    expect(onNotSupported).toHaveBeenCalledWith(ctx);
  });

  it("dispatches onError with errorMessage", () => {
    const onError = vi.fn();
    registry.register(TOOL, { onError });

    registry.trackEmit({ threadId: THREAD, request_id: REQID, tool_name: TOOL, nowMs: NOW, ttlMs: TTL });
    const ctx: Ctx = {};
    registry.handleResponse({ ctx, threadId: THREAD, request_id: REQID, tool_name: TOOL, status: "error", errorMessage: "boom" });

    expect(onError).toHaveBeenCalledWith(ctx, "boom");
  });

  it("does not throw when no processor is registered", () => {
    registry.trackEmit({ threadId: THREAD, request_id: REQID, tool_name: TOOL, nowMs: NOW, ttlMs: TTL });
    const ctx: Ctx = {};
    expect(() =>
      registry.handleResponse({ ctx, threadId: THREAD, request_id: REQID, tool_name: TOOL, status: "success", responseJson: {} })
    ).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // Awaiting count
  // -------------------------------------------------------------------------

  it("getAwaitingCount returns 0 for unknown thread", () => {
    expect(registry.getAwaitingCount("nope")).toBe(0);
  });

  it("increments after trackEmit and decrements after handleResponse", () => {
    registry.trackEmit({ threadId: THREAD, request_id: "r1", tool_name: TOOL, nowMs: NOW, ttlMs: TTL });
    registry.trackEmit({ threadId: THREAD, request_id: "r2", tool_name: TOOL, nowMs: NOW, ttlMs: TTL });
    expect(registry.getAwaitingCount(THREAD)).toBe(2);

    registry.handleResponse({ ctx: {}, threadId: THREAD, request_id: "r1", tool_name: TOOL, status: "success", responseJson: {} });
    expect(registry.getAwaitingCount(THREAD)).toBe(1);

    registry.handleResponse({ ctx: {}, threadId: THREAD, request_id: "r2", tool_name: TOOL, status: "denied" });
    expect(registry.getAwaitingCount(THREAD)).toBe(0);
  });

  it("handleResponse returns null for unknown request_id", () => {
    const result = registry.handleResponse({ ctx: {}, threadId: THREAD, request_id: "nope", tool_name: TOOL, status: "denied" });
    expect(result).toBeNull();
  });

  // -------------------------------------------------------------------------
  // clearExpired
  // -------------------------------------------------------------------------

  it("clears expired entries and returns counts", () => {
    const expiresSoon = NOW + 100;
    const expiredAt = NOW + 200;
    registry.trackEmit({ threadId: THREAD, request_id: "r1", tool_name: TOOL, nowMs: NOW, ttlMs: 100 }); // expires at NOW+100
    registry.trackEmit({ threadId: THREAD, request_id: "r2", tool_name: TOOL, nowMs: NOW, ttlMs: 10_000 }); // expires later

    expect(registry.getAwaitingCount(THREAD)).toBe(2);

    const result = registry.clearExpired(THREAD, expiredAt);
    expect(result.removedCount).toBe(1);
    expect(result.remainingCount).toBe(1);
    expect(registry.getAwaitingCount(THREAD)).toBe(1);
  });

  it("clearExpired on empty thread returns zeros", () => {
    const result = registry.clearExpired("unknown", NOW);
    expect(result).toEqual({ removedCount: 0, remainingCount: 0 });
  });

  // -------------------------------------------------------------------------
  // Sync mode — awaitResponse happy path
  // -------------------------------------------------------------------------

  it("awaitResponse resolves when handleResponse is called after it", async () => {
    registry.trackEmit({ threadId: THREAD, request_id: REQID, tool_name: TOOL, nowMs: NOW, ttlMs: TTL });

    const promise = registry.awaitResponse({ threadId: THREAD, request_id: REQID, tool_name: TOOL, ttlMs: 1_000 });

    // Simulate response arriving
    registry.handleResponse({ ctx: {}, threadId: THREAD, request_id: REQID, tool_name: TOOL, status: "success", responseJson: { y: 2 } });

    const result = await promise;
    expect(result).toEqual({ status: "success", responseJson: { y: 2 } });
  });

  it("awaitResponse resolves with early result when handleResponse was called first", async () => {
    registry.trackEmit({ threadId: THREAD, request_id: REQID, tool_name: TOOL, nowMs: NOW, ttlMs: TTL });

    // Response arrives BEFORE awaitResponse is called (race condition)
    registry.handleResponse({ ctx: {}, threadId: THREAD, request_id: REQID, tool_name: TOOL, status: "denied" });

    const result = await registry.awaitResponse({ threadId: THREAD, request_id: REQID, tool_name: TOOL, ttlMs: 1_000 });
    expect(result).toEqual({ status: "denied", responseJson: undefined, errorMessage: undefined });
  });

  // -------------------------------------------------------------------------
  // Sync mode — TTL timeout
  // -------------------------------------------------------------------------

  it("awaitResponse resolves with error status on TTL expiry", async () => {
    registry.trackEmit({ threadId: THREAD, request_id: REQID, tool_name: TOOL, nowMs: NOW, ttlMs: 50 });

    const result = await registry.awaitResponse({ threadId: THREAD, request_id: REQID, tool_name: TOOL, ttlMs: 30 });
    expect(result.status).toBe("error");
    expect(result.errorMessage).toBe("timeout");
  });

  // -------------------------------------------------------------------------
  // clearExpired resolves pending sync awaiters
  // -------------------------------------------------------------------------

  it("clearExpired resolves any pending sync awaiters as error", async () => {
    registry.trackEmit({ threadId: THREAD, request_id: REQID, tool_name: TOOL, nowMs: NOW, ttlMs: 100 });
    const promise = registry.awaitResponse({ threadId: THREAD, request_id: REQID, tool_name: TOOL, ttlMs: 60_000 });

    // Sweep at NOW+200 — entry has expired
    registry.clearExpired(THREAD, NOW + 200);

    const result = await promise;
    expect(result.status).toBe("error");
    expect(result.errorMessage).toBe("timeout");
  });

  // -------------------------------------------------------------------------
  // clearThread
  // -------------------------------------------------------------------------

  it("clearThread resolves all pending sync awaiters with 'cleared' error", async () => {
    registry.trackEmit({ threadId: THREAD, request_id: "r1", tool_name: TOOL, nowMs: NOW, ttlMs: TTL });
    registry.trackEmit({ threadId: THREAD, request_id: "r2", tool_name: TOOL, nowMs: NOW, ttlMs: TTL });

    const p1 = registry.awaitResponse({ threadId: THREAD, request_id: "r1", tool_name: TOOL, ttlMs: 60_000 });
    const p2 = registry.awaitResponse({ threadId: THREAD, request_id: "r2", tool_name: TOOL, ttlMs: 60_000 });

    registry.clearThread(THREAD);

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual({ status: "error", errorMessage: "cleared" });
    expect(r2).toEqual({ status: "error", errorMessage: "cleared" });
    expect(registry.getAwaitingCount(THREAD)).toBe(0);
  });

  // -------------------------------------------------------------------------
  // overwrite() processor
  // -------------------------------------------------------------------------

  it("overwriting a processor replaces it", () => {
    const first = vi.fn();
    const second = vi.fn();
    registry.register(TOOL, { onSuccess: first });
    registry.register(TOOL, { onSuccess: second });

    registry.trackEmit({ threadId: THREAD, request_id: REQID, tool_name: TOOL, nowMs: NOW, ttlMs: TTL });
    registry.handleResponse({ ctx: {}, threadId: THREAD, request_id: REQID, tool_name: TOOL, status: "success", responseJson: {} });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalled();
  });
});
