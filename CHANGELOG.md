# Changelog

All notable changes to `@eetr/agent-streemr`, `@eetr/agent-streemr-react`, and
`AgentStreemrSwift` are documented here.

All three libraries follow the same version number for simplicity.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [0.1.4] – unreleased

### @eetr/agent-streemr

#### Added
- `ClientHelloPayload` now accepts `agent_id?: string` and `inactivity_timeout_ms?: number`.
- `WelcomePayload` now includes a `capabilities` object (`max_message_size_bytes`, `inactivity_timeout_ms`) so clients know negotiated limits at handshake time.
- New `InactiveClosePayload` type (`{ reason: string }`) and corresponding `inactive_close` event in `ServerToClientEvents`.
- `createAgentSocketListener` options: `maxMessageSizeBytes?` (default 5 MiB) and `inactivityTimeoutMs?` (server-side cap / unilateral timeout).
- Per-socket inactivity timer: resets on every `start_attachments`, `attachment`, `message`, and `local_tool_response` event; fires `inactive_close` then disconnects when the deadline is reached.
- Multi-step attachment upload protocol on the server: `start_attachments` → N × `attachment` → `attachment_ack` (idempotent) → `message` with `attachment_correlation_id`.
- `AgentRunner` options now include `agent_id?: string` and `attachments?: Attachment[]`.
- `getAgentRunner` callback signature extended to `(threadId, agentId?)` for per-agent routing.
- Per-agent context isolation: when `agent_id` is present the context store uses the composite key `"${agentId}:${threadId}"`, so different agents serving the same thread never share context.
- `InactiveClosePayload` exported from the package barrel.

#### Removed
- `ResponseReferenceEvent` type (and its `response_reference` socket event) — superseded by the local-tool pattern.

---

### @eetr/agent-streemr-react

#### Added
- `UseAgentStreamOptions` gains `agentId?`, `inactivityTimeoutMs?`, and `attachmentAckTimeoutMs?` (default 10 s).
- `UseAgentStreamResult` gains `serverCapabilities?: { max_message_size_bytes, inactivity_timeout_ms }` and `inactiveCloseReason: string | null`.
- `sendMessage` signature updated to `(text, context?, attachments?)`. When attachments are provided the hook performs the full multi-step upload handshake automatically and only sends `message` once all acks are received.
- `inactive_close` event sets `inactiveCloseReason`, transitions `status` to `"disconnected"`, and clears streaming/working flags.
- `inactiveCloseReason` is cleared on the next `connect()` call.
- `Attachment` and `InactiveClosePayload` re-exported from the package barrel.
- `client_hello` now forwards `agent_id` and `inactivity_timeout_ms` when set in options.
- `welcome` handler stores `capabilities` in state.

---

### AgentStreemrSwift

#### Added
- `AgentStreamConfiguration` gains `agentId: String?`, `inactivityTimeoutMs: Int?`, and `attachmentAckTimeoutSeconds: Double` (default `10.0`).
- `ClientHelloPayload` serialises `agent_id` and `inactivity_timeout_ms` into the emitted dictionary when set.
- `WelcomePayload` decodes the new `capabilities` struct (`WelcomeCapabilities`).
- New server payload types: `InactiveClosePayload` and `AttachmentAckPayload`.
- New client payload types: `Attachment`, `StartAttachmentsPayload`, `AttachmentUploadPayload`.
- `MessagePayload` supports an optional `attachmentCorrelationId`.
- `SocketEventNames` constants: `inactiveClose`, `attachmentAck`, `startAttachments`, `attachment`.
- `AgentStream` observable properties: `serverCapabilities: WelcomeCapabilities?` and `inactiveCloseReason: String?`.
- `sendMessage(_:context:attachments:)` — when attachments are provided, performs the `start_attachments` → N × `attachment` → wait-for-acks → `message` handshake asynchronously before sending the message.
- `inactive_close` listener sets `inactiveCloseReason` and transitions to `.disconnected`.
- `attachment_ack` listener resolves in-flight attachment upload continuations.
- `AgentStreemrError.attachmentAckTimeout` case for upload timeouts.

---

## [0.1.2] – 2026-03-07

### @eetr/agent-streemr-react
- Initial public release on npm.
- `useAgentStream`, `useLocalToolHandler`, `useLocalToolFallback`, `useInMemoryAllowList`, `AgentStreamProvider` / `useAgentStreamContext`.

---

## [0.1.1] – 2026-03-07

### @eetr/agent-streemr
- Added `installation_id` to the Socket.IO handshake auth for thread routing.
- Added better handling of expired local-tool calls (TTL sweep on `local_tool_response`).
- Dual ESM + CJS package output.

---

## [0.1.0] – 2026-03-06

### @eetr/agent-streemr
- Initial public release on npm.
- `createAgentSocketListener`, `AgentStreamAdapter`, `ThreadQueue`, `LocalToolRegistry`, `createLocalTool`.
- Full typed Socket.IO protocol (`ClientToServerEvents` / `ServerToClientEvents`).

### AgentStreemrSwift
- Initial Swift Package Manager release.
- `AgentStream`, `AgentStreamConfiguration`, `LocalToolCoordinator`, `InMemoryAllowList`.
