# @eetr/agent-streemr

Socket.io + LangChain agent streaming infrastructure — protocol, registry, and tool plumbing for building real-time AI agent servers.

## Installation

```bash
npm install @eetr/agent-streemr
```

### Peer dependencies

```bash
npm install socket.io @langchain/core zod
```

## What it does

`@eetr/agent-streemr` handles the "boring plumbing" between a Socket.io server and a LangChain agent:

- Defines the **wire protocol** for agent stream events and local tool calls
- Provides a **registry** that bridges async Socket.io responses back into synchronous LangChain tool calls
- Implements a **thread queue** so one socket can only run one agent invocation at a time
- Exports **`createAgentSocketListener`** which wires all of the above together with your authentication and agent runner logic

## Quick start

```ts
import { createAgentSocketListener, createLocalTool } from "@eetr/agent-streemr";
import { Server } from "socket.io";
import http from "http";

const httpServer = http.createServer();
const io = new Server(httpServer);

// 1. Define local tools that run on the client
const getProfileTool = createLocalTool({
  name: "get_user_profile",
  description: "Fetches the current user's profile from the client",
  schema: z.object({}),
  mode: "sync",
});

// 2. Wire up the listener
io.on("connection", createAgentSocketListener({
  authenticate: async (socket) => {
    const token = socket.handshake.auth.token;
    // verify token and return { success: true, context: { userId: "..." } }
    return { success: true, context: { userId: "u_123" } };
  },
  runner: async ({ socket, message, thread_id, context, adapter }) => {
    // Invoke your LangChain agent here
    const agent = createYourAgent([getProfileTool]);
    const stream = await agent.streamEvents({ messages: [message] }, {
      configurable: { thread_id, ...adapter.getConfigurable(socket) },
    });
    for await (const event of stream) {
      adapter.processEvent(event);
    }
  },
}));

httpServer.listen(3000);
```

## Protocol events

> See the [main README](../README.md#socket-protocol) for the full protocol reference. The tables below list the events this package defines.

### Client → Server

| Event | Payload | Description |
|---|---|---|
| `client_hello` | `{ version, agent_id?, inactivity_timeout_ms? }` | Handshake; request optional agent routing and inactivity timeout |
| `message` | `{ text, context?, attachment_correlation_id? }` | Trigger an agent run |
| `start_attachments` | `{ correlation_id, count }` | Begin a multi-file upload sequence |
| `attachment` | `{ correlation_id, seq, type, body, name? }` | One attachment (Base64-encoded) |
| `local_tool_response` | `{ request_id, tool_name, response_json? \| allowed:false \| notSupported:true \| error:true }` | Reply to a `local_tool` request |
| `clear_context` | — | Reset conversation history for this thread |

### Server → Client

| Event | Payload | Description |
|---|---|---|
| `welcome` | `{ server_version, capabilities: { max_message_size_bytes, inactivity_timeout_ms } }` | Handshake reply with server capabilities |
| `internal_token` | `{ token }` | Agent reasoning token (thinking panel) |
| `local_tool` | `{ request_id, tool_name, args_json, tool_type, expires_at? }` | Delegate work to client |
| `attachment_ack` | `{ correlation_id, seq }` | Idempotent confirmation of one staged attachment |
| `agent_response` | `{ chunk?, done }` | Final assistant reply |
| `inactive_close` | `{ reason }` | Connection closing due to inactivity timeout |
| `context_cleared` | `{ message }` | Broadcast: context was reset |
| `error` | `{ message }` | Error notification |

Response statuses: `"success"` · `"denied"` · `"not_supported"` · `"error"`

## Local tool modes

| Mode | Behaviour |
|---|---|
| `async` | Emits `local_tool:call`, returns a placeholder immediately, does not wait for a response |
| `sync` | Emits `local_tool:call`, blocks until the client responds (or the socket disconnects) |
| `fire_and_forget` | Emits `local_tool:call` without going through the registry at all — no response expected |

## API reference

### `createAgentSocketListener<TContext>(options)`

Creates a Socket.io `connection` handler. Options:

| Property | Type | Description |
|---|---|---|
| `authenticate` | `(socket) => Promise<{ threadId, ... } \| null>` | Verify the connecting client; return `null` to reject |
| `createContext` | `(threadId) => TContext` | Called once per new thread to create the mutable context |
| `getAgentRunner` | `(threadId, agentId?) => AgentRunner<TContext>` | Returns the runner for a thread; `agentId` enables per-agent routing |
| `localToolRegistry` | `LocalToolRegistry<TContext>` | Registry instance for dispatching local tool responses |
| `buildFollowUpMessage?` | `(toolName, responseJson) => string` | Custom follow-up message builder |
| `onError?` | `(err, socket) => void` | Custom error handler (default: `socket.emit("error")`) |
| `localToolTtlMs?` | `number` | TTL for sync-awaiting entries (default: 30 000 ms) |
| `maxMessageSizeBytes?` | `number` | Max allowed size for messages and attachments (default: 5 MiB) |
| `inactivityTimeoutMs?` | `number` | Server-side inactivity cap; emits `inactive_close` then disconnects |

`onContextUpdate` example:

```ts
createAgentSocketListener({
  // …
  createContext: (_threadId) => ({ userId: "unknown", prefs: {} }),
  onContextUpdate(context, data, _threadId) {
    // Merge the client-supplied fields into the mutable per-thread context.
    Object.assign(context, data);
  },
});
```

### `createLocalTool(options)`

Creates a LangChain `StructuredTool` backed by a Socket.io local tool call.

| Option | Type | Default |
|---|---|---|
| `name` | `string` | required |
| `description` | `string` | required |
| `schema` | `ZodObject` | required |
| `mode` | `"async" \| "sync" \| "fire_and_forget"` | `"async"` |

### `AgentStreamAdapter`

Processes LangChain `streamEvents` output and forwards relevant events to the socket. Obtain via `adapter.getConfigurable(socket)` to inject into `config.configurable`.

### `LocalToolRegistry<TContext>`

Manages in-flight sync tool calls per thread. Automatically created inside `createAgentSocketListener`.

### `ThreadQueue`

Ensures at most one agent run per Socket.io socket is active at a time. Automatically managed by `createAgentSocketListener`.

## License

Apache 2.0 — Copyright 2026 Juan Alberto Lopez Cavallotti
