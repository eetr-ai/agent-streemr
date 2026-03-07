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

---

## Connection lifecycle

```
Client                          Server
  |                               |
  |------ TCP / WS handshake ---->|  (Socket.io auth: { token, installation_id })
  |                               |  authenticate() → { threadId, ... }
  |                               |  socket.join(threadId)
  |                               |
  |------ client_hello ---------->|  { version: { major, minor } }
  |<----- welcome ----------------| compatible → { server_version }
  |   OR  version_not_supported --|  incompatible → disconnect
  |                               |
  |  ... conversation turns ...   |
  |                               |
  |------ clear_context -------->|
  |<----- context_cleared --------|  broadcast to entire threadId room
```

Authentication is handled in a Socket.io `io.use` middleware. If `authenticate()` returns `null` the socket is rejected before any events are processed.

---

## Event Reference

### Client → Server

#### `client_hello`

**When to use:** Emit immediately after the `connect` event fires. Must be the first event the client emits — no other events should be sent before `welcome` is received.

**Payload:** `ClientHelloPayload`

```ts
{ version: { major: number; minor: number } }
```

**Purpose:** Initiates the protocol version handshake. The server replies with `welcome` or `version_not_supported`.

---

#### `message`

**When to use:** Emit when the user submits a new message. The server will enqueue an agent run for the thread and begin streaming responses.

**Payload:** `MessagePayload`

```ts
{
  text: string;           // Required. The user's message text.
  topic_name?: string;    // Optional. Thread title visible to the client. Derived from the first 80 chars of text if omitted.
  context?: Record<string, any>; // Optional. Inline context applied before the run (alternative to a prior set_context).
}
```

**Design note:** `context` on `message` is the preferred way to send per-turn context because it is applied atomically with the message, avoiding a race between `set_context` and `message`. Use a standalone `set_context` only when you need to update context without sending a message (e.g. on app load).

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

**When to use:** Emit when the user wants to start a fresh conversation. The server waits for any active run to finish, then resets all per-thread state (context, topic name, in-flight tools, queue).

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
{ server_version: { major: number; minor: number } }
```

Store `server_version` for diagnostics. Normal operation can continue after this event.

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
| `topic_name` | `topic_name` | Sets the human-readable thread title. Emit once at the start of a turn. |
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
