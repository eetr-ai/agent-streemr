// Copyright 2026 Juan Alberto Lopez Cavallotti
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { parseLocalToolResponseEnvelope } from "./localTool";

describe("parseLocalToolResponseEnvelope", () => {
  const BASE = { request_id: "req-1", tool_name: "my_tool" };

  // -------------------------------------------------------------------------
  // Invalid inputs
  // -------------------------------------------------------------------------

  it("returns null for null", () => {
    expect(parseLocalToolResponseEnvelope(null)).toBeNull();
  });

  it("returns null for a primitive", () => {
    expect(parseLocalToolResponseEnvelope("string")).toBeNull();
    expect(parseLocalToolResponseEnvelope(42)).toBeNull();
  });

  it("returns null when request_id is missing", () => {
    expect(parseLocalToolResponseEnvelope({ tool_name: "x", response_json: {} })).toBeNull();
  });

  it("returns null when tool_name is missing", () => {
    expect(parseLocalToolResponseEnvelope({ request_id: "r", response_json: {} })).toBeNull();
  });

  it("returns null when request_id is blank", () => {
    expect(parseLocalToolResponseEnvelope({ ...BASE, request_id: "  ", response_json: {} })).toBeNull();
  });

  it("returns null when tool_name is blank", () => {
    expect(parseLocalToolResponseEnvelope({ ...BASE, tool_name: "  ", response_json: {} })).toBeNull();
  });

  it("returns null when no status discriminant is present", () => {
    expect(parseLocalToolResponseEnvelope({ ...BASE })).toBeNull();
  });

  it("returns null when more than one status discriminant is active", () => {
    expect(
      parseLocalToolResponseEnvelope({ ...BASE, response_json: {}, allowed: false })
    ).toBeNull();
    expect(
      parseLocalToolResponseEnvelope({ ...BASE, allowed: false, notSupported: true })
    ).toBeNull();
    expect(
      parseLocalToolResponseEnvelope({ ...BASE, response_json: {}, error: true })
    ).toBeNull();
  });

  it("returns null when response_json is not an object (e.g. a string)", () => {
    expect(parseLocalToolResponseEnvelope({ ...BASE, response_json: "data" })).toBeNull();
  });

  // -------------------------------------------------------------------------
  // success
  // -------------------------------------------------------------------------

  it("parses a success payload", () => {
    const result = parseLocalToolResponseEnvelope({
      ...BASE,
      response_json: { score: 42 },
    });
    expect(result).toEqual({
      requestId: "req-1",
      toolName: "my_tool",
      status: "success",
      responseJson: { score: 42 },
    });
  });

  it("trims whitespace from request_id and tool_name in success", () => {
    const result = parseLocalToolResponseEnvelope({
      request_id: "  req-2  ",
      tool_name: "  my_tool  ",
      response_json: { ok: true },
    });
    expect(result?.requestId).toBe("req-2");
    expect(result?.toolName).toBe("my_tool");
  });

  // -------------------------------------------------------------------------
  // denied
  // -------------------------------------------------------------------------

  it("parses a denied payload", () => {
    const result = parseLocalToolResponseEnvelope({ ...BASE, allowed: false });
    expect(result).toEqual({
      requestId: "req-1",
      toolName: "my_tool",
      status: "denied",
    });
  });

  it("does not treat allowed: true as denied", () => {
    // allowed: true is not one of the four discriminants; treated as zero active modes
    expect(parseLocalToolResponseEnvelope({ ...BASE, allowed: true })).toBeNull();
  });

  // -------------------------------------------------------------------------
  // not_supported
  // -------------------------------------------------------------------------

  it("parses a not_supported payload", () => {
    const result = parseLocalToolResponseEnvelope({ ...BASE, notSupported: true });
    expect(result).toEqual({
      requestId: "req-1",
      toolName: "my_tool",
      status: "not_supported",
    });
  });

  it("does not treat notSupported: false as not_supported", () => {
    expect(parseLocalToolResponseEnvelope({ ...BASE, notSupported: false })).toBeNull();
  });

  // -------------------------------------------------------------------------
  // error
  // -------------------------------------------------------------------------

  it("parses an error payload without errorMessage", () => {
    const result = parseLocalToolResponseEnvelope({ ...BASE, error: true });
    expect(result).toEqual({
      requestId: "req-1",
      toolName: "my_tool",
      status: "error",
    });
    expect(result?.errorMessage).toBeUndefined();
  });

  it("parses an error payload with errorMessage", () => {
    const result = parseLocalToolResponseEnvelope({
      ...BASE,
      error: true,
      errorMessage: "Network timeout",
    });
    expect(result).toEqual({
      requestId: "req-1",
      toolName: "my_tool",
      status: "error",
      errorMessage: "Network timeout",
    });
  });

  it("ignores blank errorMessage in error payload", () => {
    const result = parseLocalToolResponseEnvelope({ ...BASE, error: true, errorMessage: "  " });
    expect(result?.errorMessage).toBeUndefined();
  });

  it("does not treat error: false as an error status", () => {
    expect(parseLocalToolResponseEnvelope({ ...BASE, error: false })).toBeNull();
  });
});
