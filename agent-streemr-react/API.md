# agent-streemr-react API

> Package: `@eetr/agent-streemr-react`

React bindings for `@eetr/agent-streemr`. Provides hooks and a context provider for connecting a React application to an agent-streemr Socket.io server: managing the socket connection, streaming messages, handling local tool requests, and tracking conversation state.

## Installation

```bash
npm install @eetr/agent-streemr-react socket.io-client
```

---

## Quick start

```tsx
import {
  AgentStreamProvider,
  useAgentStreamContext,
  useLocalToolHandler,
  useLocalToolFallback,
  useInMemoryAllowList,
} from "@eetr/agent-streemr-react";
import { useEffect } from "react";

// Root: provide a shared socket to the whole app.
function App() {
  return (
    <AgentStreamProvider url="http://localhost:8080" token={jwtToken}>
      <Chat />
    </AgentStreamProvider>
  );
}

// Any descendant can consume the shared connection.
function Chat() {
  const { connect, sendMessage, messages, status, isWorking, socket } =
    useAgentStreamContext();

  const { allowList, allow } = useInMemoryAllowList();

  // Register a handler for a specific local tool.
  useLocalToolHandler(socket, "read_file", async (args) => {
    const content = await readLocalFile((args as any).path);
    return { response_json: { content } };
  }, { allowList });

  // Catch-all fallback: reply notSupported for unknown tools.
  useLocalToolFallback(socket);

  useEffect(() => { connect("my-thread-id"); }, []);

  return (
    <div>
      {isWorking && <p>Agent is thinking…</p>}
      {messages.map((m) => <p key={m.id}>[{m.role}] {m.content}</p>)}
      <button onClick={() => sendMessage("Hello!")}>Send</button>
    </div>
  );
}
```

---

## `useAgentStream(options)`

Core hook. Manages the full Socket.io connection lifecycle and returns the conversation state and control functions. Use this when you do not want the React context (`AgentStreamProvider`).

### Options — `UseAgentStreamOptions`

| Option | Type | Required | Description |
|---|---|---|---|
| `url` | `string` | Yes | Full URL of the agent-streemr server (e.g. `"http://localhost:8080"`). |
| `token` | `string` | Yes | Bearer JWT passed as `auth.token` in the Socket.io handshake. |
| `socketOptions` | `Partial<ManagerOptions & SocketOptions>` | No | Additional Socket.io client options. `auth` is reserved. |

### Return value — `UseAgentStreamResult`

| Field | Type | Description |
|---|---|---|
| `connect` | `(threadId: string) => void` | Open the socket for the given thread. Safe to call multiple times — reconnects with the new `threadId`. Maps `threadId` to `auth.installation_id` in the handshake. |
| `disconnect` | `() => void` | Disconnect the socket and reset all state. |
| `sendMessage` | `(text: string, topicName?: string) => void` | Optimistically push a user message and emit `message` to the server. Clears `internalThought`. |
| `clearContext` | `() => void` | Emit `clear_context`. On `context_cleared` confirmation, local messages are wiped. |
| `setContext` | `(data: Record<string, any>) => void` | Emit `set_context` with an arbitrary JSON object. |
| `messages` | `AgentMessage[]` | Local conversation history (user + assistant turns). |
| `status` | `ConnectionStatus` | Current socket connection status: `"disconnected" \| "connecting" \| "connected" \| "error"`. |
| `internalThought` | `string` | Accumulated reasoning tokens for the current turn. Reset on each `sendMessage` call. |
| `isStreaming` | `boolean` | `true` while an assistant message is being streamed. |
| `isWorking` | `boolean` | `true` while the server's run queue for this thread is active (covers streaming + tool processing). Use this for a global "thinking" indicator. |
| `error` | `string \| null` | Last server error message. `null` when none. |
| `serverVersion` | `ProtocolVersion \| undefined` | Protocol version reported by the server in `welcome`. Undefined before the handshake. |
| `socket` | `Socket \| null` | The raw typed Socket.io socket. Pass to `useLocalToolHandler` and `useLocalToolFallback`. `null` before `connect()` is called. |

### `AgentMessage`

```ts
type AgentMessage = {
  id: string;         // Stable client-generated ID.
  role: "user" | "assistant";
  content: string;    // Full accumulated text content.
  streaming: boolean; // true while the server is still streaming this message.
};
```

### Behaviour details

- The hook automatically emits `client_hello` on `connect`.
- On `version_not_supported` the status is set to `"error"` with a descriptive message.
- `sendMessage` appends an optimistic user message immediately before the server responds.
- `isStreaming` is set to `true` on `sendMessage` and to `false` when `agent_response` with `done: true` arrives.
- `internalThought` accumulates all `internal_token` chunks for the current turn and is cleared when the response completes.

---

## `AgentStreamProvider` + `useAgentStreamContext()`

React context that wraps a single `useAgentStream` instance so all components in a subtree share one socket connection.

### `AgentStreamProvider`

Props are the same as `UseAgentStreamOptions` plus `children`.

```tsx
<AgentStreamProvider url="http://localhost:8080" token={jwt}>
  <App />
</AgentStreamProvider>
```

### `useAgentStreamContext()`

Returns the shared `UseAgentStreamResult` from the nearest `AgentStreamProvider`. Throws if called outside a provider.

```tsx
const { sendMessage, messages, socket } = useAgentStreamContext();
```

---

## `useLocalToolHandler(socket, toolName, handler, options?)`

Registers a handler for `local_tool` events matching `toolName`. The hook automatically sends `local_tool_response` back to the server after the handler completes.

```ts
useLocalToolHandler(
  socket,
  "read_file",
  async (args) => {
    const content = await readLocalFile((args as any).path);
    return { response_json: { content } };
  },
  { allowList }
);
```

### Parameters

| Parameter | Type | Description |
|---|---|---|
| `socket` | `AgentSocket \| null` | The socket from `useAgentStream` or `useAgentStreamContext`. Pass `null` safely — the hook is a no-op. |
| `toolName` | `string` | The tool name to handle. Only `local_tool` events with a matching `tool_name` are processed. |
| `handler` | `(args: object) => LocalToolHandlerResult \| Promise<LocalToolHandlerResult>` | Async function that executes the tool. Must return one of the four result shapes below. |
| `options` | `UseLocalToolHandlerOptions` | Optional settings. |

### Handler return type — `LocalToolHandlerResult`

Return exactly one of the following:

```ts
{ response_json: object }    // Success — include the result data.
{ allowed: false }           // User denied the request.
{ notSupported: true }       // This client does not implement the tool.
{ error: true; errorMessage?: string }  // An error occurred.
```

### `UseLocalToolHandlerOptions`

| Option | Type | Default | Description |
|---|---|---|---|
| `allowList` | `AllowList` | — | Optional allowlist gate. Checked before the handler is called. `"denied"` or `"unknown"` auto-replies `{ allowed: false }` and skips the handler. |
| `retryOnNoAck` | `boolean` | `true` | If `true`, re-emits the response once if no `local_tool_response_ack` arrives before `expires_at − 1 s`. Only active for `sync`/`async` tools with an `expires_at`. |

### Execution flow

1. `tool_name` must match — otherwise ignored.
2. `fire_and_forget` tools: handler is called for side effects; no response is emitted.
3. `expires_at` check: if the deadline has passed, silently skip.
4. Allowlist check (if provided): `"denied"` or `"unknown"` → emit `{ allowed: false }` and return.
5. Call `handler(args_json)`.
6. Emit `local_tool_response` with the result (or `{ error: true }` if the handler throws).
7. Schedule retry if `retryOnNoAck` is enabled and `expires_at` is present.
8. On `local_tool_response_ack`: cancel the retry timer.

### Multiple tools

Register one `useLocalToolHandler` call per tool:

```tsx
useLocalToolHandler(socket, "read_file", readFileHandler, { allowList });
useLocalToolHandler(socket, "write_file", writeFileHandler, { allowList });
useLocalToolFallback(socket); // Always last
```

---

## `useLocalToolFallback(socket)`

Catch-all `local_tool` listener that auto-replies `{ notSupported: true }` for any tool with no registered handler. Mount once near the root of the component tree, **after** all `useLocalToolHandler` calls.

```tsx
useLocalToolFallback(socket);
```

`fire_and_forget` events are silently skipped. Prevents server-side TTL timeouts for unknown tools.

---

## `useInMemoryAllowList()`

Manages an in-memory per-tool allowlist backed by React state. Pass the returned `allowList` to `useLocalToolHandler` to gate tool execution.

```tsx
const { allowList, allow, deny, remove, clear, entries } = useInMemoryAllowList();

// Render a permissions UI using `entries`:
// entries = { read_file: true, write_file: false }

// Grant access to a tool:
allow("read_file");

// Revoke access:
deny("write_file");

// Remove from list (reverts to "unknown", treated as denied):
remove("read_file");

// Clear all entries:
clear();
```

### Return value — `InMemoryAllowListResult`

| Field | Type | Description |
|---|---|---|
| `allowList` | `AllowList` | Stable object to pass to `useLocalToolHandler`. |
| `allow` | `(toolName: string) => void` | Mark a tool as explicitly allowed. |
| `deny` | `(toolName: string) => void` | Mark a tool as explicitly denied. |
| `remove` | `(toolName: string) => void` | Remove from list — reverts to `"unknown"`. |
| `clear` | `() => void` | Clear all entries. |
| `entries` | `Record<string, boolean>` | Current snapshot: `true` = allowed, `false` = denied. |

### `AllowList` interface

Implement this to plug in your own persistence- or policy-backed allow logic (e.g. a database, localStorage, or a permissions API):

```ts
interface AllowList {
  check(toolName: string, args: object): AllowListDecision | Promise<AllowListDecision>;
}
// AllowListDecision = "allowed" | "denied" | "unknown"
```

`"unknown"` is treated as `"denied"` by `useLocalToolHandler`.

---

## Composing hooks with context

The recommended pattern for most applications:

```tsx
// 1. Provider at the root.
function Root() {
  return (
    <AgentStreamProvider url={SERVER_URL} token={jwt}>
      <ToolLayer />
    </AgentStreamProvider>
  );
}

// 2. Tool handlers registered once in a layout component.
function ToolLayer() {
  const { socket } = useAgentStreamContext();
  const { allowList, allow, deny } = useInMemoryAllowList();

  useLocalToolHandler(socket, "read_clipboard", clipboardHandler, { allowList });
  useLocalToolHandler(socket, "get_location", locationHandler, { allowList });
  useLocalToolFallback(socket);

  return <ChatUI allowList={{ allow, deny }} />;
}

// 3. UI components consume shared state.
function ChatUI({ allowList }: { allowList: { allow: (t: string) => void; deny: (t: string) => void } }) {
  const { connect, sendMessage, messages, isWorking } = useAgentStreamContext();
  // ...
}
```

---

## Protocol type re-exports

The React package re-exports the protocol payload types so you do not need to add `@eetr/agent-streemr` as a direct dependency in your frontend:

```ts
import type {
  MessagePayload,
  LocalToolPayload,
  LocalToolResponsePayload,
  AgentResponsePayload,
  InternalTokenPayload,
  ClientToServerEvents,
  ServerToClientEvents,
} from "@eetr/agent-streemr-react";
```

For the full protocol specification including event semantics and design considerations, see the [PROTOCOL.md](../agent-streemr/PROTOCOL.md) in the server package.
