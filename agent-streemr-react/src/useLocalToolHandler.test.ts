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
  args_json: object = { key: "value" }
): LocalToolPayload {
  return { request_id: REQUEST_ID, tool_name: toolName, args_json };
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
});
