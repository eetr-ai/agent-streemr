# Basic client setup

Minimal examples for connecting to an agent-streemr server from the React and Swift clients.

---

## React (`@eetr/agent-streemr-react`)

### 1. Hook-only setup

Use `useAgentStream` with your server URL and auth token, then call `connect(threadId)` when ready (e.g. after resolving user/session).

```tsx
import { useAgentStream } from "@eetr/agent-streemr-react";
import { useEffect } from "react";

function Chat() {
  const {
    connect,
    disconnect,
    sendMessage,
    messages,
    status,
    isStreaming,
    error,
  } = useAgentStream({
    url: "http://localhost:8080",
    token: "your-jwt-or-api-key",
  });

  useEffect(() => {
    const threadId = "user-123-session-abc"; // e.g. from auth or localStorage
    connect(threadId);
    return () => disconnect();
  }, [connect, disconnect]);

  return (
    <div>
      <p>Status: {status}</p>
      {error && <p>Error: {error}</p>}
      <ul>
        {messages.map((m) => (
          <li key={m.id}>
            <strong>{m.role}:</strong> {m.content}
            {m.streaming && " …"}
          </li>
        ))}
      </ul>
      <button
        onClick={() => sendMessage("Hello, agent!")}
        disabled={status !== "connected" || isStreaming}
      >
        Send
      </button>
    </div>
  );
}
```

### 2. Provider setup (shared connection)

Wrap your app (or a subtree) with `AgentStreamProvider` so any child can use `useAgentStreamContext()` without passing props.

```tsx
import {
  AgentStreamProvider,
  useAgentStreamContext,
} from "@eetr/agent-streemr-react";

function App() {
  return (
    <AgentStreamProvider
      url="http://localhost:8080"
      token={process.env.REACT_APP_AGENT_TOKEN ?? ""}
    >
      <Chat />
    </AgentStreamProvider>
  );
}

function Chat() {
  const { connect, sendMessage, messages, status } = useAgentStreamContext();

  useEffect(() => {
    connect("my-thread-id");
  }, [connect]);

  return (
    <div>
      <p>Status: {status}</p>
      {messages.map((m) => (
        <div key={m.id}>{m.role}: {m.content}</div>
      ))}
      <button onClick={() => sendMessage("Hi")} disabled={status !== "connected"}>
        Send
      </button>
    </div>
  );
}
```

**Dependencies:** `@eetr/agent-streemr`, `@eetr/agent-streemr-react`, `socket.io-client`, `react`.

---

## Swift (`AgentStreemrSwift`)

### 1. Basic setup with `AgentStream`

Create an `AgentStream` with `AgentStreamConfiguration`, then connect with a thread ID. Use the observable state (or Combine publishers) to drive your UI.

```swift
import AgentStreemrSwift

// Configuration
let serverURL = URL(string: "http://localhost:8080")!
let token = "your-jwt-or-api-key"
let config = AgentStreamConfiguration(url: serverURL, token: token)
let stream = AgentStream(configuration: config)

// Connect (e.g. when the user session is ready)
let threadId = "user-123-session-abc"
stream.connect(threadId: threadId)

// Send a message when connected
stream.sendMessage("Hello, agent!")

// Observe state
// - stream.messages
// - stream.status
// - stream.isStreaming
// - stream.internalThought
// - stream.error (if status == .error)
```

### 2. SwiftUI example (iOS 17+)

Use `@State` or inject `AgentStream` via environment and bind to its `@Observable` state.

```swift
import SwiftUI
import AgentStreemrSwift

struct ChatView: View {
    @State private var stream: AgentStream
    @State private var input = ""

    init() {
        let config = AgentStreamConfiguration(
            url: URL(string: "http://localhost:8080")!,
            token: "your-jwt-or-api-key"
        )
        _stream = State(initialValue: AgentStream(configuration: config))
    }

    var body: some View {
        VStack(alignment: .leading) {
            Text("Status: \(String(describing: stream.status))")

            List(stream.messages, id: \.id) { msg in
                Text("\(msg.role.rawValue): \(msg.content)")
                    .italic(msg.isStreaming)
            }

            HStack {
                TextField("Message", text: $input)
                Button("Send") {
                    stream.sendMessage(input)
                    input = ""
                }
                .disabled(!stream.status.isConnected || stream.isStreaming)
            }
        }
        .onAppear {
            stream.connect(threadId: "my-thread-id")
        }
        .onDisappear {
            stream.disconnect()
        }
    }
}
```

### 3. Combine (optional)

Subscribe to `statusPublisher`, `messagesPublisher`, or `isStreamingPublisher` for reactive updates without SwiftUI.

```swift
let stream = AgentStream(configuration: config)
stream.connect(threadId: "my-thread-id")

stream.messagesPublisher
    .sink { messages in
        print("Messages count: \(messages.count)")
    }
    .store(in: &cancellables)
```

**Dependencies:** Add `AgentStreemrSwift` and `Socket.IO-Client-Swift` to your Swift package or Xcode project.
