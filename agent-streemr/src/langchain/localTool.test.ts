// Copyright 2026 Juan Alberto Lopez Cavallotti
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import {
  createLocalTool,
  EMIT_LOCAL_TOOL_KEY,
  SYNC_REGISTRY_KEY,
} from "./localTool";

const schema = z.object({ query: z.string() });
const buildRequest = (args: { query: string }) => ({ q: args.query });

describe("createLocalTool", () => {
  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  function makeConfig(overrides: Record<string, unknown> = {}) {
    return {
      configurable: {
        thread_id: "thread-1",
        ...overrides,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Factory validation
  // -------------------------------------------------------------------------

  it("throws when tool_name is blank", () => {
    expect(() =>
      createLocalTool({ tool_name: "  ", schema, buildRequest, description: "d" })
    ).toThrow();
  });

  it("creates a DynamicStructuredTool with the correct name and description", () => {
    const tool = createLocalTool({ tool_name: "my_tool", schema, buildRequest, description: "My desc" });
    expect(tool.name).toBe("my_tool");
    expect(tool.description).toBe("My desc");
  });

  // -------------------------------------------------------------------------
  // async mode (default)
  // -------------------------------------------------------------------------

  describe("mode: async (default)", () => {
    it("calls emitLocalTool with the correct payload and returns placeholder", async () => {
      const emit = vi.fn().mockReturnValue("req-1");
      const tool = createLocalTool({ tool_name: "my_tool", schema, buildRequest, description: "d" });
      const result = await (tool as any).func({ query: "hello" }, undefined, makeConfig({ [EMIT_LOCAL_TOOL_KEY]: emit }));

      expect(emit).toHaveBeenCalledWith({ tool_name: "my_tool", args_json: { q: "hello" }, toolType: "async" });
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });

    it("returns placeholder without throwing when EMIT_LOCAL_TOOL_KEY is missing", async () => {
      const tool = createLocalTool({ tool_name: "my_tool", schema, buildRequest, description: "d" });
      const result = await (tool as any).func({ query: "hi" }, undefined, makeConfig());
      expect(typeof result).toBe("string");
    });

    it("uses a custom asyncPlaceholder", async () => {
      const emit = vi.fn().mockReturnValue("req-x");
      const tool = createLocalTool({
        tool_name: "my_tool",
        schema,
        buildRequest,
        description: "d",
        asyncPlaceholder: "Custom placeholder",
      });
      const result = await (tool as any).func({ query: "x" }, undefined, makeConfig({ [EMIT_LOCAL_TOOL_KEY]: emit }));
      expect(result).toBe("Custom placeholder");
    });
  });

  // -------------------------------------------------------------------------
  // sync mode
  // -------------------------------------------------------------------------

  describe("mode: sync", () => {
    it("calls emitLocalTool, awaits registry.awaitResponse, and returns JSON-stringified result", async () => {
      const emit = vi.fn().mockReturnValue("req-sync");
      const registry = {
        awaitResponse: vi.fn().mockResolvedValue({ status: "success", responseJson: { score: 99 } }),
      };

      const tool = createLocalTool({ tool_name: "sync_tool", schema, buildRequest, description: "d", mode: "sync", ttlMs: 5_000 });
      const result = await (tool as any).func({ query: "test" }, undefined, makeConfig({
        [EMIT_LOCAL_TOOL_KEY]: emit,
        [SYNC_REGISTRY_KEY]: registry,
      }));

      expect(emit).toHaveBeenCalledWith({ tool_name: "sync_tool", args_json: { q: "test" }, toolType: "sync" });
      expect(registry.awaitResponse).toHaveBeenCalledWith({
        threadId: "thread-1",
        request_id: "req-sync",
        tool_name: "sync_tool",
        ttlMs: 5_000,
      });
      expect(JSON.parse(result)).toEqual({ status: "success", responseJson: { score: 99 } });
    });

    it("returns error JSON when registry is missing", async () => {
      const emit = vi.fn().mockReturnValue("req-x");
      const tool = createLocalTool({ tool_name: "sync_tool", schema, buildRequest, description: "d", mode: "sync" });
      const result = await (tool as any).func({ query: "q" }, undefined, makeConfig({ [EMIT_LOCAL_TOOL_KEY]: emit }));
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe("error");
    });

    it("returns error JSON when thread_id is missing", async () => {
      const emit = vi.fn().mockReturnValue("req-x");
      const registry = { awaitResponse: vi.fn() };
      const tool = createLocalTool({ tool_name: "sync_tool", schema, buildRequest, description: "d", mode: "sync" });
      const result = await (tool as any).func({ query: "q" }, undefined, {
        configurable: { [EMIT_LOCAL_TOOL_KEY]: emit, [SYNC_REGISTRY_KEY]: registry },
      });
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe("error");
      expect(registry.awaitResponse).not.toHaveBeenCalled();
    });

    it("propagates timeout result from registry as JSON", async () => {
      const emit = vi.fn().mockReturnValue("req-t");
      const registry = {
        awaitResponse: vi.fn().mockResolvedValue({ status: "error", errorMessage: "timeout" }),
      };
      const tool = createLocalTool({ tool_name: "sync_tool", schema, buildRequest, description: "d", mode: "sync" });
      const result = await (tool as any).func({ query: "q" }, undefined, makeConfig({
        [EMIT_LOCAL_TOOL_KEY]: emit,
        [SYNC_REGISTRY_KEY]: registry,
      }));
      expect(JSON.parse(result)).toEqual({ status: "error", errorMessage: "timeout" });
    });
  });

  // -------------------------------------------------------------------------
  // fire_and_forget mode
  // -------------------------------------------------------------------------

  describe("mode: fire_and_forget", () => {
    it("calls the unified emitter with toolType fire_and_forget and returns placeholder", async () => {
      const emit = vi.fn().mockReturnValue(null);
      const tool = createLocalTool({ tool_name: "ff_tool", schema, buildRequest, description: "d", mode: "fire_and_forget" });
      const result = await (tool as any).func({ query: "ping" }, undefined, makeConfig({ [EMIT_LOCAL_TOOL_KEY]: emit }));

      expect(emit).toHaveBeenCalledWith({ tool_name: "ff_tool", args_json: { q: "ping" }, toolType: "fire_and_forget" });
      expect(typeof result).toBe("string");
    });

    it("uses a custom fireAndForgetPlaceholder", async () => {
      const emit = vi.fn();
      const tool = createLocalTool({
        tool_name: "ff_tool",
        schema,
        buildRequest,
        description: "d",
        mode: "fire_and_forget",
        fireAndForgetPlaceholder: "Done.",
      });
      const result = await (tool as any).func({ query: "x" }, undefined, makeConfig({ [EMIT_LOCAL_TOOL_KEY]: emit }));
      expect(result).toBe("Done.");
    });

    it("returns placeholder without throwing when EMIT_LOCAL_TOOL_KEY is missing (fire_and_forget)", async () => {
      const tool = createLocalTool({ tool_name: "ff_tool", schema, buildRequest, description: "d", mode: "fire_and_forget" });
      const result = await (tool as any).func({ query: "x" }, undefined, makeConfig());
      expect(typeof result).toBe("string");
    });

    it("passes toolType: tracked for tracked calls and fire_and_forget for ff calls", async () => {
      const emit = vi.fn().mockReturnValue(null);
      const tool = createLocalTool({ tool_name: "ff_tool", schema, buildRequest, description: "d", mode: "fire_and_forget" });
      await (tool as any).func({ query: "x" }, undefined, makeConfig({
        [EMIT_LOCAL_TOOL_KEY]: emit,
      }));
      expect(emit).toHaveBeenCalledWith(expect.objectContaining({ toolType: "fire_and_forget" }));
    });
  });
});
