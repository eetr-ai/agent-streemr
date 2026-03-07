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

## Agent stream events (server → client)

| Event | Payload | Description |
|---|---|---|
| `agent:stream` | `AgentStreamEvent` | Streamed token or complete message chunk from the agent |
| `agent:error` | `{ message: string }` | Unrecoverable error during agent execution |
| `local_tool:call` | `LocalToolCallPayload` | Agent is requesting the client execute a local tool |

## Local tool response (client → server)

| Event | Payload |
|---|---|
| `local_tool:response` | `LocalToolResponsePayload` |

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
| `authenticate` | `(socket) => Promise<AuthResult<TContext>>` | Verify the connecting client; return `{ success: false }` to reject |
| `runner` | `AgentRunner<TContext>` | Called for each incoming `agent:message` event |

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
