# agent-streemr

**Reusable Socket.io + LangChain agent plumbing.**

`@eetr/agent-streemr` extracts the communication protocol, socket listener, local-tool registry, and stream adapter from a production LangChain/LangGraph agent into a standalone, dependency-tiered library — so you can build agents that use the same protocol with any tools or LLM, without rewriting the plumbing.

---

## Packages

| Package | Description | Status |
|---------|-------------|--------|
| [`agent-streemr`](./agent-streemr) | Core library: protocol types, socket listener, registry, adapter, LangChain factory | ✅ Ready |
| [`agent-streemr-react`](./agent-streemr-react) | React hooks and context for connecting a UI to an agent-streemr server | ✅ Ready |
| [`agent-streemr-swift`](./agent-streemr-swift) | Native Swift client for iOS, macOS, tvOS and watchOS (Swift Package Manager) | ✅ Ready |
| [`agent-streemr-sample`](./agent-streemr-sample) | Full-stack reference app: LangGraph agent + React/Vite chat UI with recipe management | ✅ Ready |

---

## Quick Start (`agent-streemr`)

```ts
import { createServer } from "http";
import { Server } from "socket.io";
import {
  createAgentSocketListener,
  LocalToolRegistry,
  createLocalTool,
  EMIT_LOCAL_TOOL_KEY,
  EMIT_LOCAL_TOOL_FIRE_FORGET_KEY,
  SYNC_REGISTRY_KEY,
} from "@eetr/agent-streemr";
import { z } from "zod";

// 1. Define your per-thread context shape
type MyCtx = { userId: string };

// 2. Define local tools (run on the client, result returned to agent)
const getLocation = createLocalTool({
  tool_name: "get_location",
  schema: z.object({}),
  buildRequest: () => ({}),
  description: "Get the user's current location from the client.",
  mode: "sync",   // agent awaits the client's response before continuing
});

// 3. Create the registry (optional — needed only for async/sync callbacks)
const registry = new LocalToolRegistry<MyCtx>();

// 4. Wire the listener
const io = new Server(createServer(), { cors: { origin: "*" } });

createAgentSocketListener({
  io,
  authenticate: async (socket) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token || !(await verify(token))) return null; // null rejects the connection
    const threadId = socket.handshake.auth?.installation_id as string;
    return { threadId };
  },
  createContext: (_threadId) => ({ userId: "unknown" }),
  localToolRegistry: registry,
  getAgentRunner: (_threadId) =>
    async (message, { threadId, emitLocalTool, emitLocalToolFireAndForget, localToolRegistry }) => {
      // Build your LangGraph agent here
      const stream = await agent.stream(
        { messages: [{ role: "user", content: message }] },
        {
          configurable: {
            thread_id: threadId,
            [EMIT_LOCAL_TOOL_KEY]: emitLocalTool,
            [EMIT_LOCAL_TOOL_FIRE_FORGET_KEY]: emitLocalToolFireAndForget,
            [SYNC_REGISTRY_KEY]: localToolRegistry,
          },
        }
      );
      return stream;
    },
});
```

---

## Architecture

```
@eetr/agent-streemr
├── protocol/           # Types + parse utilities — zero runtime deps
│   ├── events.ts       # All socket event payload types (C→S and S→C)
│   ├── localTool.ts    # local_tool envelope types + strict parser
│   └── stream.ts       # AgentStreamEvent union type
├── server/             # Socket.io server-side utilities — depends on socket.io
│   ├── listener.ts     # createAgentSocketListener()
│   ├── adapter.ts      # AgentStreamAdapter: event → socket.emit bridge
│   ├── queue.ts        # ThreadQueue: FIFO per-thread task serialisation
│   └── registry.ts     # LocalToolRegistry: processor dispatch + sync awaiting
└── langchain/          # LangChain helpers — depends on @langchain/core
    └── localTool.ts    # createLocalTool() factory (async / sync / fire-and-forget)
```

**Dependency tiers:**  
- `protocol/` — no runtime deps; safe for client SDKs  
- `server/` — `socket.io` peer dep  
- `langchain/` — `@langchain/core` + `zod` peer deps

---

## Quick Start (`agent-streemr-swift`)

```swift
import AgentStreemrSwift

// 1. Configure
let config = AgentStreamConfiguration(
    url: URL(string: "https://api.example.com")!,
    token: bearerJWT
)

// 2. Create stream — @Observable, @MainActor
let stream = AgentStream(configuration: config)

// 3. Register local tools (optional)
await stream.registerTool("get_location") { _ in
    let loc = try await LocationService.shared.current()
    return .success(responseJSON: ["lat": loc.latitude, "lon": loc.longitude])
}

// 4. Connect
stream.connect(threadId: UIDevice.current.identifierForVendor!.uuidString)

// 5. Inject via environment (SwiftUI / iOS 17+)
WindowGroup { ContentView().environment(stream) }

// 6. In a view
@Environment(AgentStream.self) private var stream
stream.sendMessage("Hello!")
```

Add the package via Swift Package Manager (Xcode → **File → Add Package Dependencies**) or in `Package.swift`:

```swift
dependencies: [
    .package(url: "https://github.com/your-org/agent-streemr", from: "1.0.0"),
],
targets: [
    .target(name: "MyApp", dependencies: [
        .product(name: "AgentStreemrSwift", package: "agent-streemr"),
    ]),
]
```

See [agent-streemr-swift/README.md](./agent-streemr-swift/README.md) for the full integration guide (Combine publishers, allow-lists, `LocalToolCoordinator`, UIKit usage, etc.).

---

## Socket Protocol

### Client → Server

| Event | Payload | Description |
|-------|---------|-------------|
| `message` | `{ text }` | Trigger an agent run |
| `local_tool_response` | `{ request_id, tool_name, response_json? \| allowed:false \| notSupported:true \| error:true }` | Reply to a `local_tool` request |
| `clear_context` | — | Reset conversation history for this thread |

### Server → Client

| Event | Payload | Description |
|-------|---------|-------------|
| `internal_token` | `{ token }` | Agent reasoning token (thinking panel) |
| `local_tool` | `{ request_id, tool_name, args_json }` | Delegate work to client |
| `agent_response` | `{ chunk?, done }` | Final assistant reply |
| `context_cleared` | `{ message }` | Broadcast: context was reset |
| `error` | `{ message }` | Error notification |

`createLocalTool` supports three execution modes:

### `"async"` (default)
Emit `local_tool`, return immediately, let the agent continue. The listener re-enqueues a follow-up run when `local_tool_response` arrives.

```ts
const tool = createLocalTool({ tool_name: "get_prefs", schema, buildRequest, description: "...", mode: "async" });
```

### `"sync"`
Emit `local_tool`, then **await** the client response before returning to LangChain. The tool call resolves with the client's data (or `{ status: "error", errorMessage: "timeout" }` after `ttlMs`).

```ts
const tool = createLocalTool({
  tool_name: "confirm_action",
  schema: z.object({ action: z.string() }),
  buildRequest: (args) => ({ action: args.action }),
  description: "Ask the client to confirm an action.",
  mode: "sync",
  ttlMs: 20_000,
});
```

### `"fire_and_forget"`
Emit `local_tool` with no tracking. The client does not send `local_tool_response`. Use for one-way notifications or side-effects.

```ts
const tool = createLocalTool({
  tool_name: "notify",
  schema: z.object({ message: z.string() }),
  buildRequest: (args) => ({ message: args.message }),
  description: "Push a one-way notification to the client.",
  mode: "fire_and_forget",
});
```

---

## `LocalToolRegistry` API

```ts
const registry = new LocalToolRegistry<MyCtx>();

// Register a processor
registry.register("tool_name", {
  onSuccess:      (ctx, responseJson) => { /* mutate ctx */ },
  onDenied:       (ctx)               => { /* user denied */ },
  onNotSupported: (ctx)               => { /* client doesn't support this */ },
  onError:        (ctx, errorMessage) => { /* client error */ },
});

// Track an emitted request (done automatically by createAgentSocketListener)
registry.trackEmit({ threadId, request_id, tool_name, nowMs: Date.now(), ttlMs: 30_000 });

// Handle an incoming response (done automatically by createAgentSocketListener)
registry.handleResponse({ ctx, threadId, request_id, tool_name, status, responseJson });

// Sync-mode: await a response with TTL
const result = await registry.awaitResponse({ threadId, request_id, tool_name, ttlMs: 20_000 });
// result: { status: "success" | "denied" | "not_supported" | "error", responseJson?, errorMessage? }

// Count pending requests for a thread (used to decide passive vs active follow-up)
registry.getAwaitingCount(threadId);

// On clear_context: resolves pending sync awaiters with status "error"
registry.clearThread(threadId);
```

---

## `ThreadQueue` API

```ts
const queue = new ThreadQueue();

// Enqueue a task; runs after any currently active task for the same threadId
queue.enqueue(threadId, async () => { /* ... */ });

// Check if there's an active/pending task
queue.has(threadId);  // boolean

// Remove tracking state (call on clear_context)
queue.clear(threadId);
```

---

## `AgentStreamAdapter` API

Bridges an `AsyncIterable<AgentStreamEvent>` to the correct socket emissions:

```ts
const adapter = new AgentStreamAdapter(socket);
try {
  await adapter.run(agentStream);
} catch (err) {
  socket.emit("error", { message: String(err) });
}
```

---

## `createAgentSocketListener` Options

```ts
createAgentSocketListener({
  io,                     // Socket.io Server instance
  authenticate,           // (socket) => Promise<{ threadId, ...} | null>
  createContext,          // (threadId) => TContext  — called once per new thread
  getAgentRunner,         // (threadId) => AgentRunner<TContext>
  localToolRegistry,      // LocalToolRegistry<TContext> instance
  buildFollowUpMessage?,  // custom follow-up message builder (optional)
  onError?,               // custom error handler (optional; default: socket.emit("error"))
  localToolTtlMs?,        // TTL for awaiting entries (default: 30 000 ms)
});
```

---

## Development

```bash
# Install all workspace dependencies
npm install

# Type-check all packages
npm run typecheck

# Run all tests
npm test

# Build all packages
npm run build
```

---

## License

Apache 2.0 — see [agent-streemr/LICENSE](./agent-streemr/LICENSE).  
Copyright 2026 Juan Alberto Lopez Cavallotti.
