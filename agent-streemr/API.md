# agent-streemr Server-Side API

> Package: `@eetr/agent-streemr`

## Installation

```bash
npm install @eetr/agent-streemr socket.io
# LangChain integration requires:
npm install @langchain/core zod
```

## Quick start

```ts
import { Server } from "socket.io";
import { createServer } from "http";
import {
  createAgentSocketListener,
  LocalToolRegistry,
  createLocalTool,
  buildLangChainConfig,
} from "@eetr/agent-streemr";
import { z } from "zod";

const httpServer = createServer();
const io = new Server(httpServer, { cors: { origin: "*" } });

// 1. Define your per-thread context shape.
type Ctx = { userId: string; prefs?: Record<string, unknown> };

// 2. Create a local tool registry and register processors.
const registry = new LocalToolRegistry<Ctx>();

registry.register("get_prefs", {
  onSuccess: (ctx, json) => { ctx.prefs = json as Record<string, unknown>; },
  onDenied:  (ctx)       => { ctx.prefs = {}; },
});

// 3. (Optional) Create LangChain local tools.
const getPrefsTool = createLocalTool({
  tool_name: "get_prefs",
  schema: z.object({ fields: z.array(z.string()) }),
  buildRequest: (args) => ({ fields: args.fields }),
  description: "Fetch user preferences from the client.",
  mode: "async",
});

// 4. Wire everything together.
createAgentSocketListener<Ctx>({
  io,
  authenticate: async (socket) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token || !await verifyJwt(token)) return null;
    const threadId = socket.handshake.auth?.installation_id as string;
    return { threadId, userId: getUserId(token) };
  },
  createContext: (threadId) => ({ userId: "unknown" }),
  localToolRegistry: registry,
  getAgentRunner: (_threadId) => myAgentRunner,
  onContextUpdate: (ctx, data) => { Object.assign(ctx, data); },
});

httpServer.listen(8080);
```

---

## `createAgentSocketListener(options)`

The main entry point. Attaches all Socket.io event listeners to `options.io` and manages per-thread queuing, local-tool dispatch, and context lifecycle.

### Options

| Option | Type | Required | Description |
|---|---|---|---|
| `io` | `Server` | Yes | The Socket.io `Server` instance. |
| `authenticate` | `(socket) => Promise<AuthResult \| null>` | Yes | Called in `io.use` middleware for every new connection. Return `{ threadId, ...extras }` to accept, or `null` to reject with "Unauthorized". |
| `createContext` | `(threadId) => TContext` | Yes | Factory for per-thread mutable context objects. Called lazily on the first message for each thread. |
| `getAgentRunner` | `(threadId) => AgentRunner<TContext>` | Yes | Returns the agent runner function to use for a thread. Called once per agent run. |
| `localToolRegistry` | `LocalToolRegistry<TContext>` | Yes | Registry instance shared between the listener and tools. |
| `buildFollowUpMessage` | `(args) => string` | No | Customize the synthetic message injected after an async `local_tool_response`. Receives `{ toolName, requestId, status, responseJson, errorMessage, isLast }`. |
| `onContextUpdate` | `(ctx, data, threadId) => void` | No | Called when `set_context` or `message.context` arrives. Mutate `ctx` in-place. |
| `onError` | `(err, socket, threadId?) => void` | No | Called on unhandled errors. Default emits `error` to the socket. |
| `localToolTtlMs` | `number` | No | TTL for in-flight local tool requests. Default: `30_000`. |

### `AuthResult`

The object returned by `authenticate`. The `threadId` field is mandatory; any additional fields are stored in `socket.data.auth` and forwarded to `getAgentRunner`.

```ts
type AuthResult = {
  threadId: string;
  [key: string]: unknown;
};
```

### `AgentRunner<TContext>`

An async generator factory that your application implements.

```ts
type AgentRunner<TContext> = (
  message: string,
  options: {
    threadId: string;
    topicName?: string;
    currentTopicName?: string;
    context?: TContext;
    emitLocalTool: EmitLocalToolFn;
    localToolRegistry: LocalToolRegistry<TContext>;
  }
) => AsyncIterable<AgentStreamEvent>;
```

The runner receives:
- `message` — the user text (or synthetic follow-up text for async tool responses).
- `threadId` — the conversation key for LangChain/LangGraph checkpointing.
- `topicName` — resolved topic name for this turn (from `message.topic_name` or first 80 chars of text).
- `currentTopicName` — the topic as supplied by the client (undefined if it was derived).
- `context` — the current per-thread context object (your `TContext`).
- `emitLocalTool` — unified emitter; use this to trigger local tool requests.
- `localToolRegistry` — inject into `buildLangChainConfig` for sync-mode tools.

---

## `LocalToolRegistry<TContext>`

Central hub for local-tool processor registration, in-flight request tracking, and sync-mode promise resolution. Generic over your context type.

### `registry.register(tool_name, processor)`

Registers a response processor for a tool. Overwrites any previous registration.

```ts
registry.register("confirm_action", {
  onSuccess:      (ctx, json) => { /* handle approval */ },
  onDenied:       (ctx)       => { /* user said no */ },
  onNotSupported: (ctx)       => { /* client doesn't know this tool */ },
  onError:        (ctx, msg)  => { /* client errored */ },
});
```

All four callbacks are optional. Omitted callbacks are silently skipped.

### `registry.getAwaitingCount(threadId)`

Returns the number of in-flight `local_tool` requests for a thread. Useful for deciding whether to send a follow-up message.

### `registry.clearThread(threadId)`

Removes all awaiting state for a thread and resolves any pending sync awaiters with `{ status: "error", errorMessage: "cleared" }`. Called automatically on `clear_context`.

### `registry.awaitResponse(args)` — sync mode

Returns a promise that resolves when the client responds to `request_id`, or when the TTL fires (resolves with `{ status: "error", errorMessage: "timeout" }`). Used internally by `createLocalTool` in `sync` mode.

---

## `createLocalTool(options)` — LangChain integration

Factory that produces a `DynamicStructuredTool` wired for the agent-streemr local-tool protocol. Requires `@langchain/core` and `zod`.

```ts
const tool = createLocalTool({
  tool_name: "confirm_action",
  schema: z.object({ action: z.string(), label: z.string() }),
  buildRequest: (args) => ({ action: args.action, label: args.label }),
  description: "Ask the user to confirm an action before proceeding.",
  mode: "sync",      // "async" (default) | "sync" | "fire_and_forget"
  ttlMs: 20_000,     // sync mode only; defaults to 30_000
});
```

### Options

| Option | Type | Required | Description |
|---|---|---|---|
| `tool_name` | `string` | Yes | Canonical tool name. Used in both LangChain and socket protocol. |
| `schema` | `ZodSchema<TArgs>` | Yes | Zod schema for tool input. |
| `buildRequest` | `(args: TArgs) => TRequest` | Yes | Maps LangChain input to the `args_json` sent to the client. |
| `description` | `string` | Yes | Human-readable description shown to the LLM. |
| `mode` | `"async" \| "sync" \| "fire_and_forget"` | No | Execution mode. Default: `"async"`. |
| `ttlMs` | `number` | No | Timeout for sync mode. Default: `30_000`. |
| `asyncPlaceholder` | `string` | No | String returned to LangChain in async mode. Make it instructive — the LLM sees it. |
| `fireAndForgetPlaceholder` | `string` | No | String returned to LangChain in fire-and-forget mode. |

### Mode comparison

| Mode | LLM blocks? | Client must reply? | When to use |
|---|---|---|---|
| `"async"` | No — returns placeholder immediately | Yes, triggers a follow-up turn | Background operations, user dialogs that take a few seconds |
| `"sync"` | Yes — `await`s client response | Yes, as fast as possible | LLM needs the result to continue (e.g. user inputs a value) |
| `"fire_and_forget"` | No — returns placeholder immediately | No | Notifications, UI updates, analytics |

---

## `buildLangChainConfig(options)`

Convenience helper that builds the `configurable` object for a LangChain/LangGraph `agent.stream()` call from the `AgentRunner` options.

```ts
export const myRunner: AgentRunner<Ctx> = async function* (message, options) {
  const stream = await agent.stream(
    { messages: [{ role: "user", content: message }] },
    {
      streamMode: "messages",
      configurable: buildLangChainConfig(options),
      // Spread to add extra keys:
      // configurable: { ...buildLangChainConfig(options), myKey: value },
    }
  );
  // yield AgentStreamEvent values from stream...
};
```

Sets `thread_id`, `EMIT_LOCAL_TOOL_KEY`, and `SYNC_REGISTRY_KEY` automatically.

---

## `AgentStreamAdapter`

Bridges an `AsyncIterable<AgentStreamEvent>` from your agent to Socket.io emissions. Used internally by `createAgentSocketListener`; exposed for custom wiring.

```ts
const adapter = new AgentStreamAdapter(socket);
try {
  await adapter.run(agentStream);
} catch (err) {
  socket.emit("error", { message: String(err) });
}
```

### Event mapping

| `AgentStreamEvent.type` | Socket.io event emitted |
|---|---|
| `topic_name` | `topic_name` |
| `internal_token` | `internal_token` |
| `agent_response` | `agent_response` |
| `response_reference` | `response_reference` |

---

## `ThreadQueue`

Per-thread task serialisation queue. Ensures at most one agent run is active per thread. Used internally; exported for advanced scenarios.

```ts
const queue = new ThreadQueue();
queue.enqueue(threadId, async () => { /* task */ });
queue.has(threadId);   // true while a task is pending or active
queue.clear(threadId); // remove tracking (call on clear_context)
```

Errors thrown inside a task are swallowed from the queue chain so subsequent tasks are not blocked.

---

## Protocol type exports

All socket payload types and the `AgentStreamEvent` union are re-exported from the package root for use in typed Socket.io server setups:

```ts
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  AgentStreamEvent,
} from "@eetr/agent-streemr";

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer);
```

See [PROTOCOL.md](./PROTOCOL.md) for the full event reference.
