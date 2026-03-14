# @eetr/agent-streemr-react

React hooks for connecting to an [agent-streemr](../agent-streemr) server.

Wraps a Socket.io v4 connection with idiomatic React primitives: deferred
connect, streaming message accumulation, pluggable local tool handling, and an
optional context provider for tree-wide shared state.

---

## Installation

```bash
npm install @eetr/agent-streemr-react socket.io-client
# react >=18 is a peer dependency
```

---

## Quick start

```tsx
import { useAgentStream } from "@eetr/agent-streemr-react";

function Chat({ jwt, deviceId }: { jwt: string; deviceId: string }) {
  const { connect, sendMessage, messages, status, isStreaming } = useAgentStream({
    url: "http://localhost:8080",
    token: jwt,
  });

  // Connect once the identity is known (deferred — safe with async auth).
  useEffect(() => {
    connect(deviceId);
  }, [deviceId]);

  return (
    <div>
      <p>Status: {status}</p>

      {messages.map((m) => (
        <div key={m.id} className={m.role}>
          {m.content}
          {m.streaming && <span> ▌</span>}
        </div>
      ))}

      {isStreaming && <p>Agent is typing…</p>}

      <button onClick={() => sendMessage("Hello!")}>Send</button>
    </div>
  );
}
```

---

## Concepts

### Deferred connect

The hook does **not** open a socket on mount. Call `connect(threadId)` when
you have the user's identity — typically after an auth state change. This maps
`threadId` to `auth.installation_id` in the Socket.io handshake, which the
server uses as both the conversation checkpointing key and the socket room.

```tsx
const { connect } = useAgentStream({ url, token });

// Fires once JWT and deviceId are resolved from auth state
useEffect(() => {
  if (jwt && deviceId) connect(deviceId);
}, [jwt, deviceId]);
```

### Streaming messages

Assistant messages accumulate in-place while streaming. Each `AgentMessage`
has a `streaming: boolean` flag you can use to show a cursor or typing indicator:

```tsx
{messages.map((m) => (
  <p key={m.id}>
    {m.content}{m.streaming && <span className="cursor">▌</span>}
  </p>
))}
```

### Providing context to the agent

Call `setContext(data)` at any time to push a plain JSON object to the server.
The server invokes its `onContextUpdate` callback with the data, letting the
application merge or replace fields on its per-thread context before the next
agent run. Common uses include the current view state, loaded resources, or
user preferences that the agent should be aware of.

```tsx
const { connect, sendMessage, setContext } = useAgentStream({ url, token });

// After loading a record, push it into the agent's context
useEffect(() => {
  if (recipe) {
    setContext({ currentRecipe: recipe });
  }
}, [recipe]);
```

The server side must declare an `onContextUpdate` handler to act on this data:

```ts
createAgentSocketListener({
  createContext: () => ({ currentRecipe: null }),
  onContextUpdate(context, data) {
    Object.assign(context, data);
  },
  // …
});
```

---

### Reasoning / internal tokens

Reasoning tokens (agent "thinking" output) arrive as `internal_token` events
and are accumulated into the separate `internalThought` string. This is reset
on every `sendMessage` call.

```tsx
const { internalThought } = useAgentStream({ url, token });

// Render in a collapsible "Thinking…" panel
{internalThought && (
  <details>
    <summary>Thinking…</summary>
    <pre>{internalThought}</pre>
  </details>
)}
```

---

## Local tool handling

The server can request the client to execute a tool. Each tool gets its own
`useLocalToolHandler` hook instance.

```tsx
import { useLocalToolHandler } from "@eetr/agent-streemr-react";

function MyApp() {
  const { connect, socket, ...stream } = useAgentStream({ url, token });

  // Handle a "get_location" tool request from the server
  useLocalToolHandler(socket, "get_location", async (_args) => {
    const coords = await navigator.geolocation.getCurrentPosition(/* … */);
    return { response_json: { lat: coords.latitude, lng: coords.longitude } };
  });

  // Handle a "read_clipboard" tool that the user can deny
  useLocalToolHandler(socket, "read_clipboard", async (_args) => {
    const text = await navigator.clipboard.readText();
    return { response_json: { text } };
  });

  // Catch-all: reply notSupported for any tool this client doesn't handle
  useLocalToolFallback(socket);
}
```

### Handler return values

| Return value | Meaning |
|---|---|
| `{ response_json: object }` | Success — payload forwarded to the agent |
| `{ allowed: false }` | User denied the request |
| `{ notSupported: true }` | Client doesn't support this tool |
| `{ error: true; errorMessage?: string }` | Execution failed |

---

## AllowList: user-controlled tool permissions

Gate tool execution behind an explicit permission list. `useInMemoryAllowList`
provides React-state-backed allow/deny management; swap in your own `AllowList`
implementation for persistence or server-side policy.

### Using the built-in in-memory list

```tsx
import {
  useAgentStream,
  useLocalToolHandler,
  useInMemoryAllowList,
} from "@eetr/agent-streemr-react";

function App() {
  const { socket } = useAgentStream({ url, token });
  const { allowList, allow, deny, entries } = useInMemoryAllowList();

  useLocalToolHandler(socket, "read_file", async ({ path }) => {
    const content = await fs.readFile(path as string, "utf8");
    return { response_json: { content } };
  }, { allowList });

  return (
    <>
      {Object.entries(entries).map(([tool, permitted]) => (
        <div key={tool}>
          {tool}: {permitted ? "✅" : "❌"}
          <button onClick={() => allow(tool)}>Allow</button>
          <button onClick={() => deny(tool)}>Deny</button>
        </div>
      ))}
    </>
  );
}
```

### Interactive per-request approval (async `check`)

Because `check()` can return `Promise<AllowListDecision>`, you can suspend a tool
call until the user explicitly clicks Allow or Deny in the UI:

```tsx
import { useCallback, useMemo, useRef, useState } from "react";
import type { AllowList, AllowListDecision } from "@eetr/agent-streemr-react";

function useInteractiveAllowList() {
  const [pending, setPending] = useState<{ id: string; toolName: string; args: object }[]>([]);
  const resolversRef = useRef<Map<string, (d: AllowListDecision) => void>>(new Map());

  const allowList = useMemo<AllowList>(() => ({
    check(toolName, args): Promise<AllowListDecision> {
      return new Promise((resolve) => {
        const id = crypto.randomUUID();
        resolversRef.current.set(id, resolve);
        setPending((prev) => [...prev, { id, toolName, args }]);
      });
    },
  }), []);

  const approve = useCallback((id: string) => {
    resolversRef.current.get(id)?.('allowed');
    resolversRef.current.delete(id);
    setPending((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const deny = useCallback((id: string) => {
    resolversRef.current.get(id)?.('denied');
    resolversRef.current.delete(id);
    setPending((prev) => prev.filter((p) => p.id !== id));
  }, []);

  return { allowList, pending, approve, deny };
}
```

Each pending entry maps to an inline UI card. `useLocalToolHandler` already awaits
the result of `check()`, so the agent is suspended until the user acts.

See `agent-streemr-sample` for a full production implementation including
LocalStorage-backed "Remember for this tool" persistence.

### Supplying a custom AllowList

Implement the `AllowList` interface for server-side, persisted, or interactive
policy. `check()` can return a `Promise`, which suspends the tool handler until
the promise resolves — allowing interactive UIs where the user approves each call:

```ts
import type { AllowList } from "@eetr/agent-streemr-react";

// Server-side / async policy check
const policyList: AllowList = {
  async check(toolName, args) {
    const allowed = await myApi.checkPermission(toolName, args);
    return allowed ? "allowed" : "denied";
  },
};
```

**Decisions:**
- `"allowed"` → handler is called.
- `"denied"` → auto-reply `{ allowed: false }` to the server; handler skipped.
- `"unknown"` → treated as `"denied"` (explicit opt-in required).

---

## Context provider

Use `AgentStreamProvider` when multiple components in a subtree need access to
the same stream without prop drilling:

```tsx
import {
  AgentStreamProvider,
  useAgentStreamContext,
} from "@eetr/agent-streemr-react";

// Root
function Root({ jwt, deviceId }: { jwt: string; deviceId: string }) {
  return (
    <AgentStreamProvider url="http://localhost:8080" token={jwt}>
      <App deviceId={deviceId} />
    </AgentStreamProvider>
  );
}

// Anywhere in the tree
function MessageList() {
  const { messages, isStreaming } = useAgentStreamContext();
  return (/* … */);
}

function InputBar({ deviceId }: { deviceId: string }) {
  const { connect, sendMessage, status } = useAgentStreamContext();
  useEffect(() => { connect(deviceId); }, [deviceId]);
  return (/* … */);
}
```

---

## Full example: chat UI with tool permissions

```tsx
import React, { useEffect, useState } from "react";
import {
  AgentStreamProvider,
  useAgentStreamContext,
  useLocalToolHandler,
  useLocalToolFallback,
  useInMemoryAllowList,
} from "@eetr/agent-streemr-react";

// Wrap at root
export function AppRoot({ jwt, deviceId }: { jwt: string; deviceId: string }) {
  return (
    <AgentStreamProvider url="http://localhost:8080" token={jwt}>
      <ChatApp deviceId={deviceId} />
    </AgentStreamProvider>
  );
}

function ChatApp({ deviceId }: { deviceId: string }) {
  const { connect, sendMessage, clearContext, messages, status, internalThought, socket } =
    useAgentStreamContext();

  const { allowList, allow, deny, entries } = useInMemoryAllowList();
  const [input, setInput] = useState("");

  useEffect(() => { connect(deviceId); }, [deviceId]);

  // Grant location access by default
  useEffect(() => { allow("get_location"); }, []);

  useLocalToolHandler(socket, "get_location", async () => {
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ response_json: { lat: pos.coords.latitude, lng: pos.coords.longitude } }),
        () => resolve({ error: true, errorMessage: "Geolocation denied" })
      );
    });
  }, { allowList });

  useLocalToolFallback(socket);

  const handleSend = () => {
    if (!input.trim()) return;
    sendMessage(input.trim());
    setInput("");
  };

  return (
    <div>
      <header>
        <span>Status: {status}</span>
        <button onClick={clearContext}>Clear</button>
      </header>

      {internalThought && (
        <details>
          <summary>Thinking…</summary>
          <pre>{internalThought}</pre>
        </details>
      )}

      <main>
        {messages.map((m) => (
          <div key={m.id} className={`message ${m.role}`}>
            <strong>{m.role === "user" ? "You" : "Agent"}</strong>
            <p>{m.content}{m.streaming && " ▌"}</p>
          </div>
        ))}
      </main>

      <footer>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="Type a message…"
        />
        <button onClick={handleSend} disabled={status !== "connected"}>
          Send
        </button>
      </footer>
    </div>
  );
}
```

---

## Attachment uploads

Pass an array of `Attachment` objects as the third argument to `sendMessage`. The hook automatically performs the full multi-step handshake (`start_attachments` → N × `attachment` → wait for acks → `message`) before the agent run begins:

```tsx
import type { Attachment } from "@eetr/agent-streemr-react";

// Convert a File to base64, then send with message
async function sendWithImage(file: File) {
  const body = await fileToBase64(file);
  const attachment: Attachment = { type: "image", body, name: file.name };
  sendMessage("Here is a photo of my dish.", undefined, [attachment]);
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
```

The upload respects `attachmentAckTimeoutMs` (default 10 s per attachment). The server enforces `maxMessageSizeBytes` on each attachment body and rejects oversized uploads.

---

## Inactivity timeout

When the server closes a connection due to inactivity it emits `inactive_close` before disconnecting. The hook captures the reason in `inactiveCloseReason` and transitions `status` to `"disconnected"`:

```tsx
const { inactiveCloseReason, connect, status } = useAgentStream({ url, token });

// Show a banner when the server closed the connection due to inactivity
{inactiveCloseReason && (
  <div className="banner">
    Session ended: {inactiveCloseReason}
    <button onClick={() => connect(threadId)}>Reconnect</button>
  </div>
)}
```

`inactiveCloseReason` is cleared automatically on the next `connect()` call.

---

## API reference

### `useAgentStream(options)`

**Options:**

| Prop | Type | Description |
|---|---|---|
| `url` | `string` | Socket.io server URL |
| `token` | `string` | Bearer JWT passed as `auth.token` |
| `agentId?` | `string` | Optional agent identifier forwarded in `client_hello` for server-side routing |
| `inactivityTimeoutMs?` | `number` | Requested inactivity timeout sent to the server (0 = no timeout) |
| `attachmentAckTimeoutMs?` | `number` | Per-attachment ack wait before upload fails (default: 10 000 ms) |
| `socketOptions?` | `Partial<ManagerOptions & SocketOptions>` | Extra Socket.io options |

**Returns:** `UseAgentStreamResult`

| Field | Type | Description |
|---|---|---|
| `connect` | `(threadId: string) => void` | Open the socket; maps `threadId` → `auth.installation_id` |
| `disconnect` | `() => void` | Disconnect and reset all state |
| `sendMessage` | `(text: string, context?: Record<string, any>, attachments?: Attachment[]) => void` | Optimistic send; performs multi-step upload handshake when attachments are provided |
| `clearContext` | `() => void` | Emit `clear_context`; wipes local messages on confirmation |
| `setContext` | `(data: Record<string, any>) => void` | Emit `set_context`; server calls `onContextUpdate` with the data |
| `messages` | `AgentMessage[]` | Conversation history |
| `status` | `ConnectionStatus` | `"disconnected" \| "connecting" \| "connected" \| "error"` |
| `internalThought` | `string` | Accumulated reasoning tokens for the current turn |
| `isStreaming` | `boolean` | `true` while an assistant message is being streamed |
| `serverCapabilities` | `{ max_message_size_bytes: number; inactivity_timeout_ms: number } \| undefined` | Capabilities reported by the server after handshake |
| `inactiveCloseReason` | `string \| null` | Set when the server closes the connection due to inactivity; cleared on reconnect |
| `error` | `string \| null` | Last error message |
| `socket` | `Socket \| null` | Raw typed Socket.io socket (for `useLocalToolHandler`) |

---

### `useLocalToolHandler(socket, toolName, handler, options?)`

| Param | Type | Description |
|---|---|---|
| `socket` | `Socket \| null` | From `useAgentStream` return value |
| `toolName` | `string` | Tool name to handle (must match server `tool_name`) |
| `handler` | `(args: object) => LocalToolHandlerResult \| Promise<…>` | Called when a matching tool request arrives |
| `options.allowList?` | `AllowList` | Optional permission gate |

---

### `useLocalToolFallback(socket)`

Catch-all that auto-replies `{ notSupported: true }` for any `local_tool` event
not claimed by a `useLocalToolHandler`. Mount once near the root of your tree.

---

### `useInMemoryAllowList()`

**Returns:** `InMemoryAllowListResult`

| Field | Type | Description |
|---|---|---|
| `allowList` | `AllowList` | Pass to `useLocalToolHandler` options |
| `allow(toolName)` | `(string) => void` | Permit a tool |
| `deny(toolName)` | `(string) => void` | Block a tool |
| `remove(toolName)` | `(string) => void` | Remove (reverts to `"unknown"`) |
| `clear()` | `() => void` | Wipe all entries |
| `entries` | `Record<string, boolean>` | Snapshot for UI rendering |

---

### `AgentStreamProvider` / `useAgentStreamContext()`

Accepts the same props as `UseAgentStreamOptions` plus `children`. Provides the
full `UseAgentStreamResult` to all descendants via `useAgentStreamContext()`.

---

### Types

```ts
type AgentMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming: boolean;
};

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

type Attachment = {
  type: "image" | "markdown";
  body: string;   // Base64-encoded content
  name?: string;  // Optional filename
};

type LocalToolHandlerResult =
  | { response_json: object }
  | { allowed: false }
  | { notSupported: true }
  | { error: true; errorMessage?: string };

type AllowListDecision = "allowed" | "denied" | "unknown";

interface AllowList {
  // May return a Promise — the handler is suspended until it resolves.
  // This enables interactive per-request approval UIs.
  check(toolName: string, args: object): AllowListDecision | Promise<AllowListDecision>;
}
```
