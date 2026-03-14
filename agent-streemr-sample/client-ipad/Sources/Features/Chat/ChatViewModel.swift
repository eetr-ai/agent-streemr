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
    }
    var pendingAttachment: PendingAttachment? = nil
    private var pendingSend: (text: String, attachment: PendingAttachment?)? = nil

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
        let isDisconnected = !stream.status.isConnected
        return (!stream.isStreaming && trimmed.count > 0 && (stream.status.isConnected || isDisconnected))
    }

    func send(using stream: AgentStream) {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        let att = pendingAttachment
        inputText = ""
        pendingAttachment = nil
        if !stream.status.isConnected {
            pendingSend = (text: text, attachment: att)
            reconnect(stream: stream)
            return
        }
        let attachments: [Attachment]? = att.map {
            [Attachment(type: $0.mimeType, body: $0.data.base64EncodedString(), name: $0.name)]
        }
        stream.sendMessage(text, attachments: attachments)
    }

    func connect(to stream: AgentStream) {
        stream.connect(threadId: threadId)
        Task {
            for await status in stream.statusPublisher.values {
                if status.isConnected, let pending = pendingSend {
                    let attachments: [Attachment]? = pending.attachment.map {
                        [Attachment(type: $0.mimeType, body: $0.data.base64EncodedString(), name: $0.name)]
                    }
                    stream.sendMessage(pending.text, attachments: attachments)
                    pendingSend = nil
                }
            }
        }
    }

    func reconnect(stream: AgentStream) {
        stream.connect(threadId: threadId)
    }
}
