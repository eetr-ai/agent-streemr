import Foundation
import Observation
import AgentStreemrSwift

@Observable
@MainActor
final class ChatViewModel {

    var inputText: String = ""
    private(set) var threadId: String

    struct PendingAttachment {
        let data: Data
        let mimeType: String
        let name: String
        let assetIdentifier: String?
    }
    var pendingAttachment: PendingAttachment? = nil
    private var pendingSend: (text: String, attachment: PendingAttachment?)? = nil
    private var statusObservationTask: Task<Void, Never>?
    private var messagesObservationTask: Task<Void, Never>?
    private var messageAttachmentPreviews: [String: Data] = [:]
    private var messageTimestamps: [String: Date] = [:]

    private let threadIdKey = "agent_streemr_thread_id"

    init() {
        if let stored = UserDefaults.standard.string(forKey: threadIdKey) {
            threadId = stored
        } else {
            let id = UUID().uuidString
            UserDefaults.standard.set(id, forKey: threadIdKey)
            threadId = id
        }
    }

    func canSend(stream: AgentStream) -> Bool {
        let trimmed = inputText.trimmingCharacters(in: .whitespaces)
        let hasAttachment = pendingAttachment != nil
        return !stream.isStreaming && (!trimmed.isEmpty || hasAttachment)
    }

    func send(using stream: AgentStream) {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        let att = pendingAttachment
        guard !text.isEmpty || att != nil else { return }
        inputText = ""
        pendingAttachment = nil
        if !stream.status.isConnected {
            pendingSend = (text: text, attachment: att)
            reconnect(stream: stream)
            return
        }
        sendToStream(stream, text: text, attachment: att)
    }

    func start(using stream: AgentStream) {
        if statusObservationTask == nil {
            statusObservationTask = Task {
                for await status in stream.statusPublisher.values {
                    if status.isConnected, let pending = pendingSend {
                        sendToStream(stream, text: pending.text, attachment: pending.attachment)
                        pendingSend = nil
                    }
                }
            }
        }
        if messagesObservationTask == nil {
            messagesObservationTask = Task {
                for await messages in stream.messagesPublisher.values {
                    for message in messages where messageTimestamps[message.id] == nil {
                        messageTimestamps[message.id] = Date()
                    }
                }
            }
        }

        guard case .disconnected = stream.status else { return }
        connect(to: stream)
    }

    func connect(to stream: AgentStream) {
        stream.connect(threadId: threadId)
    }

    func reconnect(stream: AgentStream) {
        connect(to: stream)
    }

    func disconnect(stream: AgentStream) {
        stream.disconnect()
    }

    var threadStatusLabel: String {
        "Thread \(threadId.prefix(8))"
    }

    func attachmentPreviewData(for message: AgentMessage) -> Data? {
        messageAttachmentPreviews[message.id]
    }

    func timestamp(for message: AgentMessage) -> Date? {
        messageTimestamps[message.id]
    }

    private func observeStatus(on stream: AgentStream) {
        guard statusObservationTask == nil else { return }
        statusObservationTask = Task {
            for await status in stream.statusPublisher.values {
                if status.isConnected, let pending = pendingSend {
                    let attachments: [Attachment]? = pending.attachment.map { makeAttachments(from: $0) }
                    stream.sendMessage(pending.text, attachments: attachments)
                    pendingSend = nil
                }
            }
        }
    }

    /// Builds protocol attachments from a pending attachment (e.g. photo). Uses `.image` for image MIME types.
    private func makeAttachments(from pending: PendingAttachment) -> [Attachment] {
        let type = AttachmentType(mimeType: pending.mimeType) ?? .image
        return [Attachment(type: type, body: pending.data.base64EncodedString(), name: pending.name)]
    }

    private func sendToStream(_ stream: AgentStream, text: String, attachment: PendingAttachment?) {
        let previousMessageCount = stream.messages.count
        let attachments: [Attachment]? = attachment.map { makeAttachments(from: $0) }
        stream.sendMessage(text, attachments: attachments)

        guard let attachment,
              stream.messages.count > previousMessageCount,
              let lastMessage = stream.messages.last,
              lastMessage.role == .user else {
            if let lastMessage = stream.messages.last {
                messageTimestamps[lastMessage.id] = Date()
            }
            return
        }

        messageTimestamps[lastMessage.id] = Date()
        messageAttachmentPreviews[lastMessage.id] = attachment.data
    }
}
