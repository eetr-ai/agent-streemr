// Copyright 2026 Juan Alberto Lopez Cavallotti
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLocalToolHandler, useLocalToolFallback } from "./useLocalToolHandler";
import { createMockSocket } from "./testing/mockSocket";
import type { LocalToolPayload } from "@eetr/agent-streemr";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TOOL = "my_tool";
const REQUEST_ID = "req-abc";

function makePayload(
  toolName = TOOL,
  args_json: object = { key: "value" },
  overrides: Partial<LocalToolPayload> = {}
): LocalToolPayload {
  return { request_id: REQUEST_ID, tool_name: toolName, args_json, tool_type: "async", ...overrides };
}

// ---------------------------------------------------------------------------
// useLocalToolHandler
// ---------------------------------------------------------------------------

describe("useLocalToolHandler", () => {
  let socket: ReturnType<typeof createMockSocket>;

  beforeEach(() => {
    socket = createMockSocket();
  });

  it("calls handler and emits response_json when tool_name matches", async () => {
    const handler = vi.fn().mockResolvedValue({ response_json: { ok: true } });
    renderHook(() => useLocalToolHandler(socket as any, TOOL, handler));

    await act(async () => {
      socket._trigger("local_tool", makePayload());
    });

    expect(handler).toHaveBeenCalledWith({ key: "value" });
    expect(socket.emit).toHaveBeenCalledWith("local_tool_response", {
      request_id: REQUEST_ID,
      tool_name: TOOL,
      response_json: { ok: true },
    });
  });

  it("does not call handler when tool_name does not match", async () => {
    const handler = vi.fn();
    renderHook(() => useLocalToolHandler(socket as any, TOOL, handler));

    await act(async () => {
      socket._trigger("local_tool", makePayload("other_tool"));
    });

    expect(handler).not.toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // AllowList gate
  // ---------------------------------------------------------------------------

  it("emits { allowed: false } when allowList returns 'denied'", async () => {
    const allowList = { check: vi.fn().mockResolvedValue("denied") };
    const handler = vi.fn();
    renderHook(() =>
      useLocalToolHandler(socket as any, TOOL, handler, { allowList })
    );

    await act(async () => {
      socket._trigger("local_tool", makePayload());
    });

    expect(handler).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith("local_tool_response", {
      request_id: REQUEST_ID,
      tool_name: TOOL,
      allowed: false,
    });
  });

  it("emits { allowed: false } when allowList returns 'unknown'", async () => {
    const allowList = { check: vi.fn().mockResolvedValue("unknown") };
    const handler = vi.fn();
    renderHook(() =>
      useLocalToolHandler(socket as any, TOOL, handler, { allowList })
    );

    await act(async () => {
      socket._trigger("local_tool", makePayload());
    });

    expect(handler).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith("local_tool_response",
      expect.objectContaining({ allowed: false })
    );
  });

  it("calls handler when allowList returns 'allowed'", async () => {
    const allowList = { check: vi.fn().mockResolvedValue("allowed") };
    const handler = vi.fn().mockResolvedValue({ response_json: { result: 42 } });
    renderHook(() =>
      useLocalToolHandler(socket as any, TOOL, handler, { allowList })
    );

    await act(async () => {
      socket._trigger("local_tool", makePayload());
    });

    expect(handler).toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith("local_tool_response",
      expect.objectContaining({ response_json: { result: 42 } })
    );
  });

  it("passes args to allowList.check()", async () => {
    const allowList = { check: vi.fn().mockResolvedValue("allowed") };
    const handler = vi.fn().mockResolvedValue({ response_json: {} });
    renderHook(() =>
      useLocalToolHandler(socket as any, TOOL, handler, { allowList })
    );

    await act(async () => {
      socket._trigger("local_tool", makePayload(TOOL, { path: "/etc/secret" }));
    });

    expect(allowList.check).toHaveBeenCalledWith(TOOL, { path: "/etc/secret" });
  });

  it("runs allowList.check for fire_and_forget; when denied, handler is not called and no response is emitted", async () => {
    const allowList = { check: vi.fn().mockResolvedValue("denied") };
    const handler = vi.fn().mockResolvedValue({ response_json: {} });
    renderHook(() =>
      useLocalToolHandler(socket as any, TOOL, handler, { allowList })
    );

    await act(async () => {
      socket._trigger("local_tool", makePayload(TOOL, {}, { tool_type: "fire_and_forget" }));
    });

    expect(allowList.check).toHaveBeenCalledWith(TOOL, {});
    expect(handler).not.toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it("runs allowList.check for fire_and_forget; when allowed, handler is called and no response is emitted", async () => {
    const allowList = { check: vi.fn().mockResolvedValue("allowed") };
    const handler = vi.fn().mockResolvedValue({ response_json: { done: true } });
    renderHook(() =>
      useLocalToolHandler(socket as any, TOOL, handler, { allowList })
    );

    await act(async () => {
      socket._trigger("local_tool", makePayload(TOOL, { x: 1 }, { tool_type: "fire_and_forget" }));
    });

    expect(allowList.check).toHaveBeenCalledWith(TOOL, { x: 1 });
    expect(handler).toHaveBeenCalledWith({ x: 1 });
    expect(socket.emit).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Handler results
  // ---------------------------------------------------------------------------

  it("emits { allowed: false } when handler returns { allowed: false }", async () => {
    const handler = vi.fn().mockResolvedValue({ allowed: false as const });
    renderHook(() => useLocalToolHandler(socket as any, TOOL, handler));

    await act(async () => {
      socket._trigger("local_tool", makePayload());
    });

    expect(socket.emit).toHaveBeenCalledWith("local_tool_response",
      expect.objectContaining({ allowed: false })
    );
  });

  it("emits { notSupported: true } when handler returns { notSupported: true }", async () => {
    const handler = vi.fn().mockResolvedValue({ notSupported: true as const });
    renderHook(() => useLocalToolHandler(socket as any, TOOL, handler));

    await act(async () => {
      socket._trigger("local_tool", makePayload());
    });

    expect(socket.emit).toHaveBeenCalledWith("local_tool_response",
      expect.objectContaining({ notSupported: true })
    );
  });

  // ---------------------------------------------------------------------------
  // Error handling
  // ---------------------------------------------------------------------------

  it("emits { error: true, errorMessage } when handler throws an Error", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("handler boom"));
    renderHook(() => useLocalToolHandler(socket as any, TOOL, handler));

    await act(async () => {
      socket._trigger("local_tool", makePayload());
    });

    expect(socket.emit).toHaveBeenCalledWith("local_tool_response", {
      request_id: REQUEST_ID,
      tool_name: TOOL,
      error: true,
      errorMessage: "handler boom",
    });
  });

  it("emits { error: true } when handler throws a non-Error", async () => {
    const handler = vi.fn().mockRejectedValue("string error");
    renderHook(() => useLocalToolHandler(socket as any, TOOL, handler));

    await act(async () => {
      socket._trigger("local_tool", makePayload());
    });

    expect(socket.emit).toHaveBeenCalledWith("local_tool_response",
      expect.objectContaining({ error: true, errorMessage: "string error" })
    );
  });

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  it("removes the listener on unmount", () => {
    const { unmount } = renderHook(() =>
      useLocalToolHandler(socket as any, TOOL, vi.fn())
    );
    unmount();
    expect(socket.off).toHaveBeenCalledWith("local_tool", expect.any(Function));
  });

  it("does not throw when socket is null", () => {
    expect(() =>
      renderHook(() => useLocalToolHandler(null, TOOL, vi.fn()))
    ).not.toThrow();
  });

  it("re-registers listener when socket changes", async () => {
    const handler = vi.fn().mockResolvedValue({ response_json: {} });
    const { rerender } = renderHook(
      ({ sock }) => useLocalToolHandler(sock as any, TOOL, handler),
      { initialProps: { sock: socket } }
    );

    const socket2 = createMockSocket();
    rerender({ sock: socket2 });

    // Old socket should have been unregistered
    expect(socket.off).toHaveBeenCalled();
    // New socket triggers the handler
    await act(async () => {
      socket2._trigger("local_tool", makePayload());
    });
    expect(handler).toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Resiliency: fire-and-forget
  // ---------------------------------------------------------------------------

  it("invokes handler but does NOT emit response for fire_and_forget", async () => {
    const handler = vi.fn().mockResolvedValue({ response_json: { side: "effect" } });
    renderHook(() => useLocalToolHandler(socket as any, TOOL, handler));

    await act(async () => {
      socket._trigger("local_tool", makePayload(TOOL, {}, { tool_type: "fire_and_forget" }));
    });

    expect(handler).toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it("silently swallows handler error for fire_and_forget", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("boom"));
    renderHook(() => useLocalToolHandler(socket as any, TOOL, handler));

    await expect(
      act(async () => {
        socket._trigger("local_tool", makePayload(TOOL, {}, { tool_type: "fire_and_forget" }));
      })
    ).resolves.not.toThrow();
    expect(socket.emit).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Resiliency: expiry gate
  // ---------------------------------------------------------------------------

  it("skips handler and emit when expires_at is already past", async () => {
    const handler = vi.fn();
    renderHook(() => useLocalToolHandler(socket as any, TOOL, handler));

    await act(async () => {
      socket._trigger(
        "local_tool",
        makePayload(TOOL, {}, { tool_type: "async", expires_at: Date.now() - 1 })
      );
    });

    expect(handler).not.toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it("processes normally when expires_at is in the future", async () => {
    const handler = vi.fn().mockResolvedValue({ response_json: { ok: true } });
    renderHook(() => useLocalToolHandler(socket as any, TOOL, handler));

    await act(async () => {
      socket._trigger(
        "local_tool",
        makePayload(TOOL, {}, { tool_type: "async", expires_at: Date.now() + 30_000 })
      );
    });

    expect(handler).toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith(
      "local_tool_response",
      expect.objectContaining({ response_json: { ok: true } })
    );
  });

  // ---------------------------------------------------------------------------
  // Resiliency: ack-based retry
  // ---------------------------------------------------------------------------

  it("cancels retry timer when local_tool_response_ack arrives", async () => {
    vi.useFakeTimers();
    const handler = vi.fn().mockResolvedValue({ response_json: { ok: true } });
    renderHook(() => useLocalToolHandler(socket as any, TOOL, handler));

    const expiresAt = Date.now() + 10_000;
    await act(async () => {
      socket._trigger("local_tool", makePayload(TOOL, {}, { tool_type: "async", expires_at: expiresAt }));
    });

    // Ack arrives — retry should be cancelled
    act(() => {
      socket._trigger("local_tool_response_ack", { request_id: REQUEST_ID, tool_name: TOOL });
    });

    // Advance timers past the retry window
    act(() => { vi.advanceTimersByTime(10_000); });

    // emit should have been called exactly once (the original response, not a retry)
    expect(socket.emit).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it("re-emits response once when no ack arrives before retry window", async () => {
    vi.useFakeTimers();
    const handler = vi.fn().mockResolvedValue({ response_json: { retried: true } });
    renderHook(() => useLocalToolHandler(socket as any, TOOL, handler));

    const expiresAt = Date.now() + 10_000; // 10s TTL → retry at 9s
    await act(async () => {
      socket._trigger("local_tool", makePayload(TOOL, {}, { tool_type: "async", expires_at: expiresAt }));
    });

    // No ack — advance past the retry point
    act(() => { vi.advanceTimersByTime(9_500); });

    // Should have emitted the response twice (original + retry)
    expect(socket.emit).toHaveBeenCalledTimes(2);
    expect(socket.emit).toHaveBeenNthCalledWith(
      2,
      "local_tool_response",
      expect.objectContaining({ response_json: { retried: true } })
    );

    vi.useRealTimers();
  });

  it("does not retry when retryOnNoAck is false", async () => {
    vi.useFakeTimers();
    const handler = vi.fn().mockResolvedValue({ response_json: { ok: true } });
    renderHook(() =>
      useLocalToolHandler(socket as any, TOOL, handler, { retryOnNoAck: false })
    );

    const expiresAt = Date.now() + 10_000;
    await act(async () => {
      socket._trigger("local_tool", makePayload(TOOL, {}, { tool_type: "async", expires_at: expiresAt }));
    });

    act(() => { vi.advanceTimersByTime(10_000); });

    expect(socket.emit).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// useLocalToolFallback
// ---------------------------------------------------------------------------

describe("useLocalToolFallback", () => {
  let socket: ReturnType<typeof createMockSocket>;

  beforeEach(() => {
    socket = createMockSocket();
  });

  it("emits { notSupported: true } for any local_tool event", async () => {
    renderHook(() => useLocalToolFallback(socket as any));

    await act(async () => {
      socket._trigger("local_tool", makePayload("unknown_tool"));
    });

    expect(socket.emit).toHaveBeenCalledWith("local_tool_response", {
      request_id: REQUEST_ID,
      tool_name: "unknown_tool",
      notSupported: true,
    });
  });

  it("handles multiple different tools", async () => {
    renderHook(() => useLocalToolFallback(socket as any));

    await act(async () => {
      socket._trigger("local_tool", makePayload("tool_a"));
      socket._trigger("local_tool", makePayload("tool_b"));
    });

    expect(socket.emit).toHaveBeenCalledTimes(2);
  });

  it("removes listener on unmount", () => {
    const { unmount } = renderHook(() => useLocalToolFallback(socket as any));
    unmount();
    expect(socket.off).toHaveBeenCalledWith("local_tool", expect.any(Function));
  });

  it("does not throw when socket is null", () => {
    expect(() =>
      renderHook(() => useLocalToolFallback(null))
    ).not.toThrow();
  });

  it("does not emit for fire_and_forget tools", async () => {
    renderHook(() => useLocalToolFallback(socket as any));

    await act(async () => {
      socket._trigger("local_tool", makePayload("notify_tool", {}, { tool_type: "fire_and_forget" }));
    });

    expect(socket.emit).not.toHaveBeenCalled();
  });
});
