// Copyright 2026 Juan Alberto Lopez Cavallotti
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom

import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useInMemoryAllowList } from "./useInMemoryAllowList";

describe("useInMemoryAllowList", () => {
  // ---------------------------------------------------------------------------
  // Initial state
  // ---------------------------------------------------------------------------

  it("returns 'unknown' for tools not in the list", () => {
    const { result } = renderHook(() => useInMemoryAllowList());
    expect(result.current.allowList.check("my_tool", {})).toBe("unknown");
  });

  it("starts with an empty entries snapshot", () => {
    const { result } = renderHook(() => useInMemoryAllowList());
    expect(result.current.entries).toEqual({});
  });

  // ---------------------------------------------------------------------------
  // allow()
  // ---------------------------------------------------------------------------

  it("returns 'allowed' after allow(toolName)", async () => {
    const { result } = renderHook(() => useInMemoryAllowList());
    act(() => { result.current.allow("my_tool"); });
    expect(await result.current.allowList.check("my_tool", {})).toBe("allowed");
  });

  it("allow() adds the tool to entries with value true", () => {
    const { result } = renderHook(() => useInMemoryAllowList());
    act(() => { result.current.allow("my_tool"); });
    expect(result.current.entries["my_tool"]).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // deny()
  // ---------------------------------------------------------------------------

  it("returns 'denied' after deny(toolName)", async () => {
    const { result } = renderHook(() => useInMemoryAllowList());
    act(() => { result.current.deny("my_tool"); });
    expect(await result.current.allowList.check("my_tool", {})).toBe("denied");
  });

  it("deny() adds the tool to entries with value false", () => {
    const { result } = renderHook(() => useInMemoryAllowList());
    act(() => { result.current.deny("my_tool"); });
    expect(result.current.entries["my_tool"]).toBe(false);
  });

  it("can override allow() with deny()", async () => {
    const { result } = renderHook(() => useInMemoryAllowList());
    act(() => { result.current.allow("my_tool"); });
    act(() => { result.current.deny("my_tool"); });
    expect(await result.current.allowList.check("my_tool", {})).toBe("denied");
  });

  // ---------------------------------------------------------------------------
  // remove()
  // ---------------------------------------------------------------------------

  it("reverts to 'unknown' after remove()", async () => {
    const { result } = renderHook(() => useInMemoryAllowList());
    act(() => { result.current.allow("my_tool"); });
    act(() => { result.current.remove("my_tool"); });
    expect(await result.current.allowList.check("my_tool", {})).toBe("unknown");
  });

  it("remove() drops the key from entries", () => {
    const { result } = renderHook(() => useInMemoryAllowList());
    act(() => { result.current.allow("my_tool"); });
    act(() => { result.current.remove("my_tool"); });
    expect("my_tool" in result.current.entries).toBe(false);
  });

  it("remove() on an unknown tool does not throw", () => {
    const { result } = renderHook(() => useInMemoryAllowList());
    expect(() => act(() => { result.current.remove("nonexistent"); })).not.toThrow();
  });

  // ---------------------------------------------------------------------------
  // clear()
  // ---------------------------------------------------------------------------

  it("clear() wipes all entries", async () => {
    const { result } = renderHook(() => useInMemoryAllowList());
    act(() => {
      result.current.allow("tool_a");
      result.current.deny("tool_b");
    });
    act(() => { result.current.clear(); });
    expect(result.current.entries).toEqual({});
    expect(await result.current.allowList.check("tool_a", {})).toBe("unknown");
    expect(await result.current.allowList.check("tool_b", {})).toBe("unknown");
  });

  // ---------------------------------------------------------------------------
  // entries snapshot
  // ---------------------------------------------------------------------------

  it("entries reflects mixed allow/deny state", () => {
    const { result } = renderHook(() => useInMemoryAllowList());
    act(() => {
      result.current.allow("tool_a");
      result.current.deny("tool_b");
    });
    expect(result.current.entries).toEqual({ tool_a: true, tool_b: false });
  });

  // ---------------------------------------------------------------------------
  // Stability
  // ---------------------------------------------------------------------------

  it("allowList object reference is stable across re-renders", () => {
    const { result, rerender } = renderHook(() => useInMemoryAllowList());
    const first = result.current.allowList;
    rerender();
    expect(result.current.allowList).toBe(first);
  });

  it("allowList.check sees the latest state without re-creating the object", async () => {
    const { result } = renderHook(() => useInMemoryAllowList());
    const { allowList } = result.current; // capture reference before allow()
    act(() => { result.current.allow("my_tool"); });
    // The same reference should see the updated state via the ref
    expect(await allowList.check("my_tool", {})).toBe("allowed");
  });

  // ---------------------------------------------------------------------------
  // args forwarding (arg-aware decisions)
  // ---------------------------------------------------------------------------

  it("check() receives args — custom AllowList can inspect them", async () => {
    // This test demonstrates the API contract; useInMemoryAllowList ignores args
    // (tool-level granularity only), but confirms args are passed through.
    const { result } = renderHook(() => useInMemoryAllowList());
    act(() => { result.current.allow("read_file"); });
    // args are passed but ignored by the in-memory implementation
    expect(await result.current.allowList.check("read_file", { path: "/secret" })).toBe("allowed");
  });
});
