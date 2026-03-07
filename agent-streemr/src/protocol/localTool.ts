// Copyright 2026 Juan Alberto Lopez Cavallotti
// SPDX-License-Identifier: Apache-2.0

/**
 * @module protocol/localTool
 *
 * Local-tool envelope types, status enum, and strict parser.
 * Zero runtime dependencies — safe to import in client SDKs.
 *
 * Dependency tier: NONE — pure TypeScript + minimal runtime validation.
 */

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * All possible outcomes of a `local_tool_response` received from the client.
 *
 * - `success`       — client executed the tool and returned `response_json`.
 * - `denied`        — user explicitly refused (`allowed: false`).
 * - `not_supported` — client does not implement this tool (`notSupported: true`).
 * - `error`         — client encountered an error (`error: true`, optional `errorMessage`).
 */
export type LocalToolResponseStatus = "success" | "denied" | "not_supported" | "error";

// ---------------------------------------------------------------------------
// Wire-format envelope (matches what the client sends over the socket)
// ---------------------------------------------------------------------------

/**
 * Raw `local_tool_response` payload as sent by the client over the socket.
 * Exactly one of the four discriminant fields must be present; the server
 * validates this strictly with `parseLocalToolResponseEnvelope`.
 */
export type LocalToolResponseEnvelope<TResponse = object> = {
  request_id: string;
  tool_name: string;
} & (
  | { response_json: TResponse; allowed?: never; notSupported?: never; error?: never; errorMessage?: never }
  | { response_json?: never; allowed: false; notSupported?: never; error?: never; errorMessage?: never }
  | { response_json?: never; allowed?: never; notSupported: true; error?: never; errorMessage?: never }
  | { response_json?: never; allowed?: never; notSupported?: never; error: true; errorMessage?: string }
);

// ---------------------------------------------------------------------------
// Parsed (normalised) form
// ---------------------------------------------------------------------------

/**
 * Normalised representation of a validated `local_tool_response` envelope.
 * Produced by `parseLocalToolResponseEnvelope`.
 */
export type ParsedLocalToolResponseEnvelope<TResponse = object> = {
  requestId: string;
  toolName: string;
  status: LocalToolResponseStatus;
  /** Present only when `status === "success"`. */
  responseJson?: TResponse;
  /** Present only when `status === "error"`. */
  errorMessage?: string;
};

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

function trimString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function isObjectLike(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

/**
 * Strictly validates and normalises a raw `local_tool_response` socket payload.
 *
 * Validation rules:
 * - Must be an object with non-empty string `request_id` and `tool_name`.
 * - Exactly **one** of the four status discriminants must be active:
 *   1. `response_json` is a non-null object  → `"success"`
 *   2. `allowed === false`                   → `"denied"`
 *   3. `notSupported === true`               → `"not_supported"`
 *   4. `error === true`                      → `"error"` (with optional `errorMessage`)
 *
 * Returns `null` if validation fails (caller should silently ignore the message).
 *
 * @example
 * ```ts
 * const parsed = parseLocalToolResponseEnvelope(socketPayload);
 * if (!parsed) return; // invalid — drop
 * switch (parsed.status) {
 *   case "success":      handleSuccess(parsed.responseJson); break;
 *   case "denied":       handleDenied(); break;
 *   case "not_supported": handleNotSupported(); break;
 *   case "error":        handleError(parsed.errorMessage); break;
 * }
 * ```
 */
export function parseLocalToolResponseEnvelope(
  payload: unknown
): ParsedLocalToolResponseEnvelope | null {
  if (!isObjectLike(payload)) return null;

  const raw = payload as {
    request_id?: unknown;
    tool_name?: unknown;
    response_json?: unknown;
    allowed?: unknown;
    notSupported?: unknown;
    error?: unknown;
    errorMessage?: unknown;
  };

  const requestId = trimString(raw.request_id);
  const toolName = trimString(raw.tool_name);
  if (!requestId || !toolName) return null;

  const hasResponseObject = isObjectLike(raw.response_json);
  const isDenied = raw.allowed === false;
  const isNotSupported = raw.notSupported === true;
  const isError = raw.error === true;

  const activeModes = [hasResponseObject, isDenied, isNotSupported, isError].filter(Boolean).length;
  if (activeModes !== 1) return null;

  if (hasResponseObject) {
    return { requestId, toolName, status: "success", responseJson: raw.response_json as object };
  }
  if (isDenied) {
    return { requestId, toolName, status: "denied" };
  }
  if (isNotSupported) {
    return { requestId, toolName, status: "not_supported" };
  }
  // isError === true
  const errorMessage =
    typeof raw.errorMessage === "string" && raw.errorMessage.trim()
      ? raw.errorMessage.trim()
      : undefined;
  return { requestId, toolName, status: "error", errorMessage };
}
