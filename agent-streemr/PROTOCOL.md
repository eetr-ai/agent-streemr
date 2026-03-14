# agent-streemr Protocol Specification

> **Protocol version: 1.0**
> Implemented in `PROTOCOL_VERSION = { major: 1, minor: 0 }` (server) and `CLIENT_PROTOCOL_VERSION = { major: 1, minor: 0 }` (React client).

## Overview

agent-streemr is a Socket.io-based protocol for streaming AI agent responses to browser clients. It covers the full lifecycle of an agent conversation: connection handshaking, sending user messages, streaming LLM output, and delegating tool execution to the client ("local tools").

The protocol is defined as zero-dependency TypeScript types in `src/protocol/events.ts` and `src/protocol/stream.ts`. These types are the canonical source of truth and are safe to import in both client and server code.

---

## Design Principles

### Thread-scoped state

Every socket connection carries a `threadId` derived from the authentication result. All events are scoped to that thread. Multiple sockets may share the same `threadId` (e.g. a user with two tabs open) — they join the same Socket.io room and receive broadcasts like `context_cleared` together.

### Per-thread serialised queue

The server processes at most one agent run at a time per thread (`ThreadQueue`). If a second `message` arrives while a run is active it is queued and executed in order. This prevents interleaved LLM calls for the same conversation history.

### Versioned handshake

Neither side assumes protocol compatibility. The client sends `client_hello` immediately after connecting; the server replies `welcome` (compatible) or `version_not_supported` and disconnects. Compatibility rules:

- **Compatible:** `client.major === server.major && client.minor <= server.minor`
- **Incompatible:** any other combination

Minor-version bumps are backwards-compatible by convention; clients are allowed to lag behind servers. Major-version bumps are breaking changes requiring coordinated upgrades.

### Local tools: client-side execution delegation

The server can ask the client to execute tools on its behalf (e.g. reading a local file, showing a permission prompt, fetching browser state). This is the "local tool" mechanism. Three execution modes exist to cover every use case without blocking the LLM unnecessarily.

### Ack-based reliability

For `sync` and `async` local tool requests the server tracks in-flight requests by `request_id` with a configurable TTL (default 30 s). The server sends `local_tool_response_ack` when it receives and processes the client's reply. The React client uses this to cancel retry timers it set up defensively.

### Multi-step attachment upload

Attachments are uploaded via a correlated multi-step sequence rather than as a single monolithic payload. This design enables:

- **Per-attachment size validation** — the server validates each `attachment.body` independently against `max_message_size_bytes`, giving precise error feedback.
- **Resumable uploads** — each attachment carries a `correlation_id` and a 0-based `seq`. The server deduplicates by `(correlation_id, seq)` and re-acks duplicates, making retry safe.
- **Implicit cancellation** — if the user changes their mind, sending a `message` without the `attachment_correlation_id` (or with a different one) silently flushes staged attachments. No explicit cancel event is needed.
- **Clean public API** — client SDKs (React, Swift) expose a simple `sendMessage(text, attachments?)` that orchestrates the wire protocol internally.

---

## Connection lifecycle

```
Client                          Server
  |                               |
  |------ TCP / WS handshake ---->|  (Socket.io auth: { token, installation_id })
  |                               |  authenticate() → { threadId, ... }
  |                               |  socket.join(threadId)
  |                               |
  |------ client_hello ---------->|  { version, agentId?, inactivity_timeout_ms? }
  |<----- welcome ----------------| compatible → { server_version, capabilities }
  |   OR  version_not_supported --|  incompatible → disconnect
  |                               |
  |  ... conversation turns ...   |
  |                               |
  |--- start_attachments -------->|  { correlation_id, count }
  |--- attachment (seq 0) ------->|  { correlation_id, seq, type, body, name? }
  |<-- attachment_ack (seq 0) ----|  { correlation_id, seq }
  |--- attachment (seq 1) ------->|
  |<-- attachment_ack (seq 1) ----|
  |--- message ------------------>|  { text, context?, attachment_correlation_id }
  |                               |  attachments consumed with this message
  |                               |
  |------ clear_context -------->|
  |<----- context_cleared --------|  broadcast to entire threadId room
  |                               |
  |  ... inactivity period ...    |
  |                               |
  |<----- inactive_close ---------|  { reason } — server about to disconnect
  |       (disconnect)            |  server closes socket
```

> **Note on attachment ordering:** The client may fire all N `attachment` events without waiting for acks. The diagram above shows interleaved acks for clarity, but in practice the client sends all attachments immediately and tracks acks asynchronously.

Authentication is handled in a Socket.io `io.use` middleware. If `authenticate()` returns `null` the socket is rejected before any events are processed.

---

## Event Reference

### Client → Server

#### `client_hello`

**When to use:** Emit immediately after the `connect` event fires. Must be the first event the client emits — no other events should be sent before `welcome` is received.

**Payload:** `ClientHelloPayload`

```ts
{
  version: { major: number; minor: number };
  agentId?: string;               // Optional. Selects which agent handles this session.
  inactivity_timeout_ms?: number;  // Optional. Client's preferred inactivity timeout.
}
```

**Purpose:** Initiates the protocol version handshake. The server replies with `welcome` or `version_not_supported`.

**Fields:**

| Field | Required | Description |
|---|---|---|
| `version` | Yes | Client protocol version for compatibility check. |
| `agentId` | No | Identifies the agent the client wants to talk to. Allows multi-agent servers to route the session to the correct agent. If omitted, the server uses its default agent. |
| `inactivity_timeout_ms` | No | The client's preferred inactivity timeout in milliseconds. Must not exceed the server's `inactivity_timeout_ms` advertised in the `welcome` capabilities. If it does, the server ignores it and uses its own value. See [Inactivity timeout](#inactivity-timeout). |

---

#### `message`

**When to use:** Emit when the user submits a new message. The server will enqueue an agent run for the thread and begin streaming responses.

**Payload:** `MessagePayload`

```ts
{
  text: string;           // Required. The user's message text.
  context?: Record<string, any>; // Optional. Inline context applied before the run (alternative to a prior set_context).
}
```

**Design note:** `context` on `message` is the preferred way to send per-turn context because it is applied atomically with the message, avoiding a race between `set_context` and `message`. Use a standalone `set_context` only when you need to update context without sending a message (e.g. on app load).

---

#### `start_attachments`

**When to use:** Emit to begin a multi-step attachment upload sequence before sending a message. The client generates a UUID `correlation_id` that ties the entire sequence together: `start_attachments` → N × `attachment` → `message`.

**Payload:** `StartAttachmentsPayload`

```ts
{
  correlation_id: string;  // Required. Client-generated UUID identifying this attachment sequence.
  count: number;           // Required. Exact number of `attachment` events that will follow.
}
```

**Fields:**

| Field | Required | Description |
|---|---|---|
| `correlation_id` | Yes | A client-generated UUID that uniquely identifies this attachment sequence. The same ID must appear on each subsequent `attachment` event and on the `message` that consumes them. |
| `count` | Yes | The exact number of `attachment` events the client will send. Must be ≥ 1. |

**Server behaviour:**
- Initializes per-socket staging state: `{ correlation_id, expected: count, received: Map<seq, Attachment> }`.
- If a previous staging sequence was in progress on this socket, it is silently discarded and replaced.
- Emits `error` if `count` is not a positive integer or `correlation_id` is missing/empty.

---

#### `attachment`

**When to use:** Emit once per attachment in the sequence started by `start_attachments`. Each attachment carries a 0-based sequence number (`seq`) for ordering, deduplication, and targeted retry.

**Payload:** `AttachmentPayload`

```ts
{
  correlation_id: string;          // Required. Must match the preceding start_attachments.
  seq: number;                     // Required. 0-based index of this attachment in the sequence.
  type: "image" | "markdown";      // Required. The kind of content being attached.
  body: string;                    // Required. Base64-encoded content.
  name?: string;                   // Optional. Filename or human-readable label.
}
```

**Fields:**

| Field | Required | Description |
|---|---|---|
| `correlation_id` | Yes | Must match the `correlation_id` from the preceding `start_attachments`. The server rejects attachments with a mismatched or unknown correlation ID. |
| `seq` | Yes | 0-based sequence number. Must satisfy `0 ≤ seq < count`. Used for ordering attachments when consumed, deduplication on retry, and identifying which attachment failed. |
| `type` | Yes | `"image"` for raster images (PNG, JPEG, WebP, etc.) or `"markdown"` for Markdown text files. |
| `body` | Yes | The file content encoded as a Base64 string. |
| `name` | No | An optional filename or label — e.g. `"screenshot.png"`, `"notes.md"`. Useful for display and logging. |

**Size constraint:** The `body` field **must not** exceed `max_message_size_bytes` advertised in the `welcome` capabilities. This is validated **per individual attachment**, not as a total across the sequence. Well-behaved clients validate the size locally before sending. The server rejects oversized attachments with an `error` event.

**Server behaviour:**
- If `correlation_id` does not match the active staging → emit `error`.
- If `seq` is out of range (`< 0` or `≥ expected`) → emit `error`.
- If `seq` is already present in the staging map (duplicate/retry) → **idempotent**: re-emit `attachment_ack` without double-storing.
- If `body` exceeds `max_message_size_bytes` → emit `error`. The staging remains active but the sequence can never complete (count cannot be fulfilled). The client should treat this as a fatal error for the sequence.
- Otherwise → store the attachment in the staging map keyed by `seq`, emit `attachment_ack({ correlation_id, seq })`.

**Delivery model:** The client fires all N `attachment` events immediately without waiting for individual acks (fire-and-send). Acks are tracked asynchronously. Before emitting `message`, the client should verify all N acks have been received. If any ack is missing after a timeout, the client retries those specific `attachment` events (same `correlation_id` + `seq`) — the server deduplicates gracefully.

---

#### `message`

**When to use:** Emit when the user submits a new message. The server will enqueue an agent run for the thread and begin streaming responses.

**Payload:** `MessagePayload`

```ts
{
  text: string;                          // Required. The user's message text.
  context?: Record<string, any>;         // Optional. Inline context applied before the run.
  attachment_correlation_id?: string;     // Optional. Ties this message to a preceding attachment sequence.
}
```

**Design note:** `context` on `message` is the preferred way to send per-turn context because it is applied atomically with the message, avoiding a race between `set_context` and `message`. Use a standalone `set_context` only when you need to update context without sending a message (e.g. on app load).

**Attachment correlation behaviour:**

| Scenario | Server behaviour |
|---|---|
| `attachment_correlation_id` matches active staging AND all `count` attachments received | Consume attachments (ordered by `seq`), clear staging, forward to agent alongside message text. |
| `attachment_correlation_id` matches active staging BUT count is incomplete | Emit `error`, discard staging, do **not** process the message. |
| No `attachment_correlation_id` while staging is active | **Implicit cancel**: silently discard staging, process message as a plain text message (no attachments). |
| `attachment_correlation_id` does not match active staging (or no staging exists) | **Implicit cancel**: silently discard any staging, process message as a plain text message. |

This design means a user who stages attachments but then changes their mind and sends a plain message naturally cancels the attachment sequence — no explicit cancel event is needed.

---

#### `set_context`

**When to use:** Emit to update the server's per-thread context object without sending a user message. Common on application startup to inject user profile, feature flags, or session metadata before the first message.

**Payload:** `SetContextPayload`

```ts
{ data: Record<string, any> }
```

The server calls `onContextUpdate(ctx, data, threadId)` with the existing mutable context object. The callback is responsible for merging/replacing fields.

---

#### `clear_context`

**When to use:** Emit when the user wants to start a fresh conversation. The server waits for any active run to finish, then resets all per-thread state (context, in-flight tools, queue).

**Payload:** None (emit with no arguments).

The server broadcasts `context_cleared` to all sockets in the `threadId` room after clearing — multi-tab users all see the reset simultaneously.

---

#### `local_tool_response`

**When to use:** Emit in reply to a `local_tool` event from the server. Must echo `request_id` and `tool_name` from the originating `local_tool` payload. Do **not** emit for `fire_and_forget` tools — the server does not expect or process a reply for those.

**Payload:** `LocalToolResponsePayload` — exactly one of the four discriminant fields must be present:

| Field | Type | Meaning |
|---|---|---|
| `response_json` | `object` | Tool ran successfully; carries the result. |
| `allowed: false` | literal | User explicitly denied the request. |
| `notSupported: true` | literal | Client does not implement this tool. |
| `error: true` | literal | Client encountered an error. Pair with optional `errorMessage`. |

```ts
// Success
{ request_id, tool_name, response_json: { ... } }

// Denied
{ request_id, tool_name, allowed: false }

// Not implemented
{ request_id, tool_name, notSupported: true }

// Error
{ request_id, tool_name, error: true, errorMessage: "Something went wrong" }
```

The server validates the payload strictly with `parseLocalToolResponseEnvelope` and silently ignores malformed or ambiguous payloads (more than one discriminant set, missing `request_id`, etc.).

**Reliability note:** For `sync` and `async` tools, send the response before `expires_at` elapses. After that timestamp the server has discarded the request and any response will be ignored.

---

### Server → Client

#### `welcome`

**When to receive:** Immediately after `client_hello` if versions are compatible.

**Payload:** `WelcomePayload`

```ts
{
  server_version: { major: number; minor: number };
  capabilities: {
    max_message_size_bytes: number;   // Maximum allowed payload size for client messages.
    inactivity_timeout_ms: number;    // Server's default inactivity timeout.
  };
}
```

**Fields:**

| Field | Description |
|---|---|
| `server_version` | Server protocol version. Store for diagnostics. |
| `capabilities.max_message_size_bytes` | The maximum size, in bytes, of any single client-to-server payload. Applies in particular to the `body` field of each individual `attachment` event. Clients **must not** send payloads exceeding this limit. |
| `capabilities.inactivity_timeout_ms` | The server's default inactivity timeout in milliseconds. Defaults to **600 000** (10 minutes) if not configured. See [Inactivity timeout](#inactivity-timeout). |

Store `server_version` for diagnostics and `capabilities` for enforcing local constraints. Normal operation can continue after this event.

---

#### `attachment_ack`

**When to receive:** After the server validates and stages an individual `attachment` event.

**Payload:** `AttachmentAckPayload`

```ts
{
  correlation_id: string;  // Echoes the correlation_id from the attachment.
  seq: number;             // Echoes the seq from the attachment.
}
```

**Idempotent:** If the client retries an attachment with the same `(correlation_id, seq)`, the server re-emits `attachment_ack` without double-storing. This makes retry logic safe across reconnections.

**When to use:** Track received acks in a `Set<number>`. Before emitting `message`, verify all N acks are present. If any are missing after a timeout, retry those specific `attachment` events using their `correlation_id` + `seq`. On reconnect mid-sequence, re-emit `start_attachments` (which resets server staging) then re-send all unacked attachments.

---

#### `version_not_supported`

**When to receive:** After `client_hello` if versions are incompatible. The server disconnects the socket immediately after emitting this event.

**Payload:** `VersionNotSupportedPayload`

```ts
{ server_version: { major, minor }; client_version: { major, minor } }
```

Show the user an upgrade notice or trigger an app refresh.

---

#### `agent_working`

**When to receive:** Whenever the per-thread run queue transitions between idle and active.

**Payload:** `AgentWorkingPayload`

```ts
{ working: boolean }
```

- `working: true` — emitted when the queue was idle and a new task is enqueued.
- `working: false` — emitted when the last queued task finishes and the queue drains.

**When to use:** Drive a global "thinking" indicator independently of streaming state. `isStreaming` only reflects whether an `agent_response` stream is open; `agent_working` also covers the period during which the server is processing local tool responses and re-running the agent.

---

#### `internal_token`

**When to receive:** While the agent is reasoning (extended thinking / chain-of-thought). These tokens arrive before the final `agent_response` stream.

**Payload:** `InternalTokenPayload`

```ts
{ token: string }
```

**When to use:** Display in a "thinking" panel or collapsible section — not as part of the final reply. Tokens are incremental and should be accumulated by the client.

---

#### `agent_response`

**When to receive:** As the agent streams its reply to the user.

**Payload:** `AgentResponsePayload`

```ts
{ chunk?: string; done: boolean }
```

Streaming convention:
- Zero or more emissions with `chunk` set and `done: false` — append each chunk to the current assistant message.
- Exactly one final emission with `done: true` (may also carry the last `chunk`) — mark the message as complete.

**Note:** The current reference server implementation may emit a single `done: true` event with the full accumulated reply instead of individual chunks. Both patterns are valid consumers of this type.

---

#### `local_tool`

**When to receive:** When the agent decides to delegate a tool execution to the client.

**Payload:** `LocalToolPayload`

```ts
{
  request_id: string;       // Server-generated UUID. Echo this in local_tool_response.
  tool_name: string;        // Canonical name identifying the tool.
  args_json: object;        // Tool arguments.
  tool_type: "sync" | "async" | "fire_and_forget";
  expires_at?: number;      // Unix ms deadline. Present for sync/async. Absent for fire_and_forget.
}
```

#### Tool type semantics

| `tool_type` | Server behaviour | Client must reply? | Notes |
|---|---|---|---|
| `sync` | Blocks the LLM — `await`s the response before returning a result. | Yes, before `expires_at`. | Reply as fast as possible. Server gives the LLM the response JSON directly. |
| `async` | Does not block. When the response arrives, the server enqueues a follow-up agent run with the result as context. | Yes, before `expires_at`. | Good for operations that take a few seconds (e.g. user confirmation dialogs). |
| `fire_and_forget` | Emits and immediately forgets. No response tracking. | **No.** | Good for push notifications, UI state updates, analytics. |

**When to use each mode from the server (LangChain `createLocalTool`):**
- `"sync"` — when the LLM needs the result to continue reasoning (e.g. user inputs a value, confirms an action).
- `"async"` — when the client does something that takes time and the LLM should acknowledge and wait for a follow-up (e.g. file upload, background fetch).
- `"fire_and_forget"` — when the client just needs to be notified, and the LLM does not need the result (e.g. trigger a UI animation, update a badge counter).

---

#### `local_tool_response_ack`

**When to receive:** After the server has processed a `local_tool_response`.

**Payload:** `LocalToolResponseAckPayload`

```ts
{ request_id: string; tool_name: string }
```

**When to use:** Cancel any retry timer the client set up for `request_id`. The React hook `useLocalToolHandler` handles this automatically when `retryOnNoAck` is enabled (the default).

---

#### `context_cleared`

**When to receive:** After `clear_context` is processed. Broadcast to all sockets sharing the same `threadId` room.

**Payload:** `ContextClearedPayload`

```ts
{ message: string }
```

**When to use:** Reset local conversation history, clear `internalThought`, and hide any active error banners. The `useAgentStream` hook does this automatically.

---

#### `inactive_close`

**When to receive:** When the server is about to disconnect the socket due to inactivity timeout expiry. This event is emitted **before** the server closes the connection.

**Payload:** `InactiveClosePayload`

```ts
{ reason: string }
```

**Client behaviour on receipt:**

1. **Do not auto-reconnect.** Clients **must not** attempt an automatic reconnect after receiving `inactive_close`. Socket.io's built-in reconnect should be suppressed for this disconnect reason.
2. **Show user feedback.** Display a clear message explaining that the session was closed due to inactivity (use `reason` for the display text).
3. **Reconnect only on user action.** The client should offer a "Reconnect" button or equivalent. A new connection cycle (including a fresh `client_hello`) must be initiated by the user.

---

#### `error`

**When to receive:** When an unhandled error occurs on the server during event processing.

**Payload:** `ErrorPayload`

```ts
{ message: string }
```

Display to the user or log for diagnostics. The current streaming operation is considered failed.

---

## Agent stream events (server-internal)

The `AgentStreamEvent` union is the internal contract between an agent implementation (e.g. a LangGraph graph) and the `AgentStreamAdapter` that translates them into socket emissions. These are not socket events — they are TypeScript values yielded by an async generator.

| `AgentStreamEvent.type` | Maps to socket event | Description |
|---|---|---|
| `internal_token` | `internal_token` | One chunk of the agent's reasoning stream. |
| `agent_response` | `agent_response` | One chunk (or final completion) of the assistant's reply. |
| `response_reference` | `response_reference` | A resource reference the agent used (e.g. an article). Client uses `refType` + `slug` to build a deep link. |

---

## Follow-up turns for async local tools

When a `local_tool_response` arrives for an `async` tool, the server does not just update context — it enqueues a new synthetic agent run whose message is a structured summary of the tool result (the "follow-up message"). The default summary is a markdown table; you can replace it with the `buildFollowUpMessage` option on `createAgentSocketListener`.

The follow-up message includes the `isLast` flag which indicates whether all pending tool responses for the thread have been received. Use it to control whether the agent should respond to the user immediately (`isLast: true`) or hold and wait for the remaining responses (`isLast: false`).

---

## TTL and expiry

Every `sync` and `async` `local_tool` request carries an `expires_at` timestamp (Unix milliseconds). The server tracks in-flight requests via `LocalToolRegistry`. On each `local_tool` emission and `local_tool_response` receipt, expired entries are swept first. Any `local_tool_response` that arrives after `expires_at` is ignored.

For `sync` tools, the registry's `awaitResponse()` promise resolves with `{ status: "error", errorMessage: "timeout" }` when the TTL fires — the agent run continues rather than hanging indefinitely.

Default TTL: **30 seconds** (configurable via `localToolTtlMs` on `createAgentSocketListener`).

---

## Inactivity timeout

To prevent idle connections from consuming server resources indefinitely, the protocol includes an inactivity timeout mechanism negotiated during the handshake.

### Negotiation rules

1. The server advertises its default timeout in `welcome.capabilities.inactivity_timeout_ms`. The default value is **600 000 ms (10 minutes)** when not explicitly configured.
2. The client may propose a shorter timeout by setting `inactivity_timeout_ms` in `client_hello`.
3. The **effective timeout** is `min(server, client)` when the client provides a value. If the client omits the field, the server's value is used as-is. If the client proposes a value *greater* than the server's, the server ignores it and uses its own.
4. "Inactivity" means no `message` or `local_tool_response` events are received on the socket within the effective timeout window. Presence of an active agent run (streaming response, pending local tool) resets the timer.

### Disconnect sequence

1. The server detects the effective timeout has elapsed without qualifying activity.
2. The server emits `inactive_close` with a human-readable `reason` string.
3. The server closes the socket.

### Client responsibilities

- **Well-behaved clients** should track the effective timeout locally and disconnect proactively before the server does (e.g. show a "session expiring" warning a minute before the deadline).
- **On receiving `inactive_close`:** suppress auto-reconnect, display the reason to the user, and only reconnect on explicit user action (button click, page refresh, etc.).
- **After self-disconnecting due to inactivity:** the same UX rules apply — show feedback and wait for user intent before reconnecting.
