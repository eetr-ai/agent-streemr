# AgentStreemrSwift

Swift client library for [agent-streemr](../agent-streemr) servers.  
Equivalent to `@eetr/agent-streemr-react` but for native Apple platforms.

## Requirements

| Platform | Minimum version |
|----------|----------------|
| iOS      | 17             |
| macOS    | 14             |
| tvOS     | 17             |
| watchOS  | 10             |

Swift 5.9+ / Xcode 15+.

---

## Installation

### Xcode — Swift Package Manager

1. Open your project in Xcode.
2. **File → Add Package Dependencies…**
3. Paste the repository URL and press **Add Package**.
4. Select the **AgentStreemrSwift** library product and add it to your target.

### Package.swift

```swift
// Package.swift
dependencies: [
    .package(url: "https://github.com/eetr-ai/agent-streemr", from: "0.1.4"),
],
targets: [
    .target(
        name: "MyApp",
        dependencies: [
            .product(name: "AgentStreemrSwift", package: "agent-streemr"),
        ]
    ),
]
```

> **Important:** Swift Package Manager resolves versions from **git tags**. SPM will only discover a release once the repository has a matching tag (e.g. `v0.1.4`) pushed to the remote. If you are working locally before the tag is published, use a local path dependency instead:
>
> ```swift
> .package(path: "../agent-streemr/agent-streemr-swift")
> ```

---

## Quick Start

### 1. Configure

```swift
import AgentStreemrSwift

let config = AgentStreamConfiguration(
    url: URL(string: "https://api.example.com")!,
    token: bearerJWT,                    // see your auth flow
    agentId: nil,                        // optional: route to a specific agent on the server
    inactivityTimeoutMs: 60_000,         // optional: request a 60 s inactivity timeout
    attachmentAckTimeoutSeconds: 10.0    // optional: per-attachment ack wait (default 10 s)
)
```

### 2. Create `AgentStream`

`AgentStream` is an `@Observable` `@MainActor` class. Create it once — in your
`App`, a root view model, or a SwiftUI `@State`:

```swift
@State private var stream = AgentStream(configuration: config)
```

Or create it at the app level and inject it via the environment:

```swift
@main
struct MyApp: App {
    private let stream = AgentStream(configuration: config)

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(stream)
        }
    }
}
```

### 3. Connect

Call `connect(threadId:)` with a stable per-user / per-installation identifier.
The thread ID is used by the server as the room / conversation scope.

```swift
stream.connect(threadId: UIDevice.current.identifierForVendor?.uuidString ?? UUID().uuidString)
```

Call this **after** you have resolved the user's identity (e.g. after sign-in).
It is safe to call again — it will disconnect the previous socket and reconnect.

### 4. Send messages

```swift
stream.sendMessage("Hello!")

// With optional inline context for this turn:
stream.sendMessage("What's the weather?", context: ["location": "Buenos Aires"])

// With attachments (performs multi-step upload handshake automatically):
let attachment = Attachment(type: .image, body: base64ImageString, name: "photo.jpg")
try await stream.sendMessage("Here is a photo.", attachments: [attachment])
```

### 5. Display conversation

```swift
struct ContentView: View {
    @Environment(AgentStream.self) private var stream

    var body: some View {
        List(stream.messages) { message in
            HStack {
                if message.role == .user { Spacer() }
                Text(message.content)
                    .padding(8)
                    .background(message.role == .user ? Color.blue : Color.secondary.opacity(0.2))
                    .cornerRadius(10)
                if message.role == .assistant { Spacer() }
            }
        }
        .overlay(alignment: .bottom) {
            if stream.isStreaming {
                ProgressView()
            }
        }
    }
}
```

---

## Observable State

All properties are `@MainActor`-isolated and observable via `@Observable`.

| Property | Type | Description |
|----------|------|-------------|
| `messages` | `[AgentMessage]` | Full conversation history, chronological |
| `status` | `ConnectionStatus` | Socket lifecycle state |
| `isStreaming` | `Bool` | `true` while the agent is mid-response |
| `isWorking` | `Bool` | `true` while the server queue is processing (includes tool calls) |
| `internalThought` | `String` | Accumulated reasoning tokens; reset on each `sendMessage` |
| `serverVersion` | `ProtocolVersion?` | Protocol version reported after handshake |
| `serverCapabilities` | `WelcomeCapabilities?` | Server capabilities (`maxMessageSizeBytes`, `inactivityTimeoutMs`) received after handshake |
| `inactiveCloseReason` | `String?` | Set when the server closes the connection due to inactivity; cleared on reconnect |

### `ConnectionStatus`

```swift
switch stream.status {
case .disconnected:  // not connected
case .connecting:    // handshake in progress
case .connected:     // ready to send messages
case .error(let msg): // connection or protocol error
}
```

---

## Combine Publishers

For UIKit or other reactive pipelines, every observable property has a
corresponding `AnyPublisher`:

```swift
stream.statusPublisher
    .receive(on: DispatchQueue.main)
    .sink { status in print("Status:", status) }
    .store(in: &cancellables)

stream.messagesPublisher
    .map(\.last?.content)
    .compactMap { $0 }
    .sink { lastContent in print("Latest:", lastContent) }
    .store(in: &cancellables)

// Also available:
stream.isStreamingPublisher
stream.internalThoughtPublisher
```

---

## Context Management

```swift
// Push arbitrary data into the server's per-thread context
stream.setContext(["user_plan": "pro", "locale": "es-AR"])

// Ask the server to clear thread history and context
stream.clearContext()
```

---

## Local Tools

Local tools let the server request execution of code that runs on the device
(e.g. reading the calendar, accessing location, querying a local database).

### Register a tool directly on the stream

```swift
await stream.registerTool("get_location") { _ in
    let loc = try await LocationService.shared.current()
    return .success(responseJSON: ["lat": loc.latitude, "lon": loc.longitude])
}
```

### Use a `LocalToolCoordinator` for more control

```swift
let coordinator = LocalToolCoordinator()

await coordinator.register("read_calendar") { args in
    guard let days = args["days"] as? Int else {
        return .error(message: "Missing 'days' parameter")
    }
    let events = try await CalendarService.fetch(days: days)
    return .success(responseJSON: ["events": events])
}

stream.setLocalToolCoordinator(coordinator)
```

### Handler result values

| Case | When to use |
|------|-------------|
| `.success(responseJSON:)` | Tool completed successfully |
| `.denied` | User or policy rejected the request |
| `.notSupported` | This client doesn't implement the tool |
| `.error(message:)` | Execution failed |

### Allow-lists

Use an `InMemoryAllowList` to gate whether a tool can run without asking the
user every time:

```swift
let allowList = InMemoryAllowList()
await allowList.allow("get_location")
await allowList.deny("read_contacts")

await stream.registerTool("get_location", allowList: allowList) { _ in
    // only called when allowList.check returns .allowed
    ...
}
```

For prompt-the-user style gating, implement `AllowListProtocol`:

```swift
actor ConfirmationAllowList: AllowListProtocol {
    func check(
        toolName: String,
        args: [String: Any],
        meta: AllowListCheckMeta?
    ) async -> AllowListDecision {
        // Show a confirmation sheet and await the user's response
        let approved = await ConfirmationSheet.show(toolName: toolName, args: args)
        // Return `.expired` if your approval UI timed out and the request should
        // be ignored without replying.
        return approved ? .allowed : .denied
    }
}
```

`AllowListDecision.expired` tells the coordinator to skip execution and skip
emitting `{ allowed: false }`, allowing the agent to retry if appropriate.

`fire_and_forget` tool requests are still gated by expiry + allow-list checks.
If they pass, the handler runs for side effects and no response is emitted.
Fallback `notSupported` responses are emitted only for non-`fire_and_forget`
requests.

---

## Attachment uploads

Use the `Attachment` struct to send files alongside a message. `sendMessage(_:context:attachments:)` performs the full protocol handshake (`start_attachments` → N × `attachment` → wait for acks → `message`) automatically:

```swift
import AgentStreemrSwift

// Build an Attachment from image data
let imageData: Data = ...   // e.g. UIImage compressed to JPEG
let attachment = Attachment(
    type: .image,
    body: imageData.base64EncodedString(),
    name: "recipe-photo.jpg"
)

// Send — handshake is handled internally; throws AgentStreemrError.attachmentAckTimeout on timeout
try await stream.sendMessage("Here's a photo of the dish.", attachments: [attachment])
```

The upload respects `attachmentAckTimeoutSeconds` (default `10.0`) per attachment and is gated by the server's `maxMessageSizeBytes` capability.

---

## Inactivity timeout

When the server closes the connection due to inactivity it emits `inactive_close`. `AgentStream` captures the reason in `inactiveCloseReason` and transitions to `.disconnected`:

```swift
struct InactivityBanner: View {
    @Environment(AgentStream.self) private var stream

    var body: some View {
        if let reason = stream.inactiveCloseReason {
            VStack {
                Text("Session ended: \(reason)")
                Button("Reconnect") {
                    stream.connect(threadId: savedThreadId)
                }
            }
            .padding()
            .background(Color.yellow.opacity(0.2))
            .cornerRadius(8)
        }
    }
}
```

`inactiveCloseReason` is cleared automatically on the next `connect(threadId:)` call.

---

## Disconnecting

```swift
// Graceful disconnect — also resets all conversation state
stream.disconnect()
```

---

## Architecture Notes

- `AgentStream` is `@Observable` and `@MainActor`-isolated. All socket callbacks
  are marshaled to the main actor internally — no manual `DispatchQueue.main` needed.
- `LocalToolCoordinator` is a Swift `actor` — handler registration and dispatch
  are automatically race-free.
- `AgentSocketProtocol` abstracts the Socket.IO connection, making `AgentStream`
  fully unit-testable without a network.

---

## License

Apache 2.0 — see [LICENSE](LICENSE). Copyright 2026 Juan Alberto Lopez Cavallotti.
