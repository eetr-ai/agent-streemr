// Copyright 2026 Juan Alberto Lopez Cavallotti
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { io } from "socket.io-client";
import { useAgentStream } from "./useAgentStream";
import { createMockSocket, type MockSocket } from "./testing/mockSocket";

vi.mock("socket.io-client", () => ({
  io: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_OPTIONS = { url: "http://localhost:8080", token: "test-token" };

function renderStream() {
  return renderHook(() => useAgentStream(DEFAULT_OPTIONS));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useAgentStream", () => {
  let mockSocket: MockSocket;

  beforeEach(() => {
    mockSocket = createMockSocket();
    vi.mocked(io).mockReturnValue(mockSocket as any);
  });

  // ---------------------------------------------------------------------------
  // Initial state
  // ---------------------------------------------------------------------------

  it("starts in disconnected state with empty messages", () => {
    const { result } = renderStream();
    expect(result.current.status).toBe("disconnected");
    expect(result.current.messages).toEqual([]);
    expect(result.current.internalThought).toBe("");
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.socket).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // connect()
  // ---------------------------------------------------------------------------

  it("connect() transitions to 'connecting' status", () => {
    const { result } = renderStream();
    act(() => { result.current.connect("thread-1"); });
    expect(result.current.status).toBe("connecting");
  });

  it("connect() calls io() with correct url and auth", () => {
    const { result } = renderStream();
    act(() => { result.current.connect("thread-1"); });
    expect(vi.mocked(io)).toHaveBeenCalledWith(
      "http://localhost:8080",
      expect.objectContaining({
        auth: { token: "test-token", installation_id: "thread-1" },
      })
    );
  });

  it("connect() exposes the socket reference after status update", () => {
    const { result } = renderStream();
    act(() => { result.current.connect("thread-1"); });
    expect(result.current.socket).toBe(mockSocket);
  });

  it("socket is null before connect() is called", () => {
    const { result } = renderStream();
    expect(result.current.socket).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Connection lifecycle events
  // ---------------------------------------------------------------------------

  it("transitions to 'connected' when connect event fires", () => {
    const { result } = renderStream();
    act(() => { result.current.connect("thread-1"); });
    act(() => { mockSocket._trigger("connect"); });
    expect(result.current.status).toBe("connected");
    expect(result.current.error).toBeNull();
  });

  it("transitions to 'error' on connect_error", () => {
    const { result } = renderStream();
    act(() => { result.current.connect("thread-1"); });
    act(() => { mockSocket._trigger("connect_error", new Error("ECONNREFUSED")); });
    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("ECONNREFUSED");
    expect(result.current.isStreaming).toBe(false);
  });

  it("transitions to 'disconnected' on disconnect event", () => {
    const { result } = renderStream();
    act(() => { result.current.connect("thread-1"); });
    act(() => { mockSocket._trigger("connect"); });
    act(() => { mockSocket._trigger("disconnect"); });
    expect(result.current.status).toBe("disconnected");
    expect(result.current.isStreaming).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // agent_response streaming
  // ---------------------------------------------------------------------------

  it("accumulates agent_response chunks into a single assistant message", () => {
    const { result } = renderStream();
    act(() => { result.current.connect("thread-1"); });
    act(() => { mockSocket._trigger("agent_response", { chunk: "Hello", done: false }); });
    act(() => { mockSocket._trigger("agent_response", { chunk: " world", done: false }); });
    act(() => { mockSocket._trigger("agent_response", { chunk: "!", done: true }); });

    expect(result.current.messages).toHaveLength(1);
    const msg = result.current.messages[0];
    expect(msg.role).toBe("assistant");
    expect(msg.content).toBe("Hello world!");
    expect(msg.streaming).toBe(false);
    expect(result.current.isStreaming).toBe(false);
  });

  it("sets streaming: true while chunks are arriving", () => {
    const { result } = renderStream();
    act(() => { result.current.connect("thread-1"); });
    act(() => { mockSocket._trigger("agent_response", { chunk: "Hi", done: false }); });
    expect(result.current.isStreaming).toBe(true);
    expect(result.current.messages[0].streaming).toBe(true);
  });

  it("handles done: true on first emission with no chunk", () => {
    const { result } = renderStream();
    act(() => { result.current.connect("thread-1"); });
    act(() => { mockSocket._trigger("agent_response", { done: true }); });
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].content).toBe("");
    expect(result.current.messages[0].streaming).toBe(false);
  });

  it("starts a new assistant message for consecutive turns", () => {
    const { result } = renderStream();
    act(() => { result.current.connect("thread-1"); });
    // Turn 1
    act(() => { mockSocket._trigger("agent_response", { chunk: "Turn 1", done: true }); });
    // Turn 2
    act(() => { mockSocket._trigger("agent_response", { chunk: "Turn 2", done: true }); });
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0].content).toBe("Turn 1");
    expect(result.current.messages[1].content).toBe("Turn 2");
  });

  // ---------------------------------------------------------------------------
  // internal_token
  // ---------------------------------------------------------------------------

  it("appends internal_token chunks to internalThought", () => {
    const { result } = renderStream();
    act(() => { result.current.connect("thread-1"); });
    act(() => { mockSocket._trigger("internal_token", { token: "think" }); });
    act(() => { mockSocket._trigger("internal_token", { token: "ing..." }); });
    expect(result.current.internalThought).toBe("thinking...");
  });

  // ---------------------------------------------------------------------------
  // sendMessage()
  // ---------------------------------------------------------------------------

  it("sendMessage() pushes an optimistic user message", () => {
    const { result } = renderStream();
    act(() => { result.current.connect("thread-1"); });
    act(() => { mockSocket._trigger("connect"); });
    act(() => { result.current.sendMessage("Hello agent"); });

    expect(result.current.messages).toHaveLength(1);
    const msg = result.current.messages[0];
    expect(msg.role).toBe("user");
    expect(msg.content).toBe("Hello agent");
    expect(msg.streaming).toBe(false);
  });

  it("sendMessage() emits 'message' to the server", () => {
    const { result } = renderStream();
    act(() => { result.current.connect("thread-1"); });
    act(() => { mockSocket._trigger("connect"); });
    act(() => { result.current.sendMessage("Hello agent"); });
    expect(mockSocket.emit).toHaveBeenCalledWith("message", { text: "Hello agent" });
  });

  it("sendMessage() includes topic_name when provided", () => {
    const { result } = renderStream();
    act(() => { result.current.connect("thread-1"); });
    act(() => { mockSocket._trigger("connect"); });
    act(() => { result.current.sendMessage("Hi", "My Chat Topic"); });
    expect(mockSocket.emit).toHaveBeenCalledWith("message", {
      text: "Hi",
      topic_name: "My Chat Topic",
    });
  });

  it("sendMessage() clears internalThought", () => {
    const { result } = renderStream();
    act(() => { result.current.connect("thread-1"); });
    act(() => { mockSocket._trigger("connect"); });
    act(() => { mockSocket._trigger("internal_token", { token: "old thought" }); });
    act(() => { result.current.sendMessage("Next turn"); });
    expect(result.current.internalThought).toBe("");
  });

  it("sendMessage() does nothing when socket is not connected", () => {
    const disconnectedSocket = createMockSocket(false);
    vi.mocked(io).mockReturnValue(disconnectedSocket as any);
    const { result } = renderStream();
    act(() => { result.current.connect("thread-1"); });
    act(() => { result.current.sendMessage("Should not send"); });
    expect(disconnectedSocket.emit).not.toHaveBeenCalled();
    expect(result.current.messages).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // clearContext()
  // ---------------------------------------------------------------------------

  it("clearContext() emits 'clear_context' to the server", () => {
    const { result } = renderStream();
    act(() => { result.current.connect("thread-1"); });
    act(() => { mockSocket._trigger("connect"); });
    act(() => { result.current.clearContext(); });
    expect(mockSocket.emit).toHaveBeenCalledWith("clear_context");
  });

  it("context_cleared event wipes messages and internalThought", () => {
    const { result } = renderStream();
    act(() => { result.current.connect("thread-1"); });
    act(() => { mockSocket._trigger("connect"); });
    act(() => { result.current.sendMessage("Hello"); });
    act(() => { mockSocket._trigger("internal_token", { token: "thinking" }); });
    act(() => { mockSocket._trigger("context_cleared", { message: "Cleared" }); });

    expect(result.current.messages).toEqual([]);
    expect(result.current.internalThought).toBe("");
    expect(result.current.isStreaming).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // error event
  // ---------------------------------------------------------------------------

  it("error event sets error state and stops streaming", () => {
    const { result } = renderStream();
    act(() => { result.current.connect("thread-1"); });
    act(() => { mockSocket._trigger("agent_response", { chunk: "par", done: false }); });
    act(() => { mockSocket._trigger("error", { message: "server blew up" }); });
    expect(result.current.error).toBe("server blew up");
    expect(result.current.isStreaming).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // disconnect()
  // ---------------------------------------------------------------------------

  it("disconnect() resets all state to defaults", () => {
    const { result } = renderStream();
    act(() => { result.current.connect("thread-1"); });
    act(() => { mockSocket._trigger("connect"); });
    act(() => { result.current.sendMessage("Hi"); });
    act(() => { mockSocket._trigger("internal_token", { token: "thought" }); });
    act(() => { result.current.disconnect(); });

    expect(result.current.status).toBe("disconnected");
    expect(result.current.messages).toEqual([]);
    expect(result.current.internalThought).toBe("");
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("disconnect() calls socket.disconnect()", () => {
    const { result } = renderStream();
    act(() => { result.current.connect("thread-1"); });
    act(() => { result.current.disconnect(); });
    expect(mockSocket.disconnect).toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Reconnect
  // ---------------------------------------------------------------------------

  it("reconnect with a new threadId tears down the previous socket first", () => {
    const secondSocket = createMockSocket();
    const { result } = renderStream();

    act(() => { result.current.connect("thread-1"); });
    // Advance to "connected" so the status transition on reconnect ("connecting")
    // is a genuine state change and React re-renders with the new socket ref.
    act(() => { mockSocket._trigger("connect"); });
    vi.mocked(io).mockReturnValue(secondSocket as any);
    act(() => { result.current.connect("thread-2"); });

    expect(mockSocket.removeAllListeners).toHaveBeenCalled();
    expect(mockSocket.disconnect).toHaveBeenCalled();
    expect(result.current.socket).toBe(secondSocket);
  });

  it("reconnect passes the new threadId to auth.installation_id", () => {
    const { result } = renderStream();
    act(() => { result.current.connect("thread-1"); });
    act(() => { result.current.connect("thread-2"); });

    const calls = vi.mocked(io).mock.calls;
    expect(calls[calls.length - 1][1]).toMatchObject({
      auth: { installation_id: "thread-2" },
    });
  });
});
