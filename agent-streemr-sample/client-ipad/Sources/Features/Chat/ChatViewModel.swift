import Foundation
import Observation
import AgentStreemrSwift

@Observable
@MainActor
final class ChatViewModel {

    var inputText: String = ""
    private(set) var threadId: String

    private let threadIdKey = "agent_streemr_thread_id"

    init() {
        if let stored = UserDefaults.standard.string(forKey: "agent_streemr_thread_id") {
            threadId = stored
        } else {
            let id = UUID().uuidString
            UserDefaults.standard.set(id, forKey: "agent_streemr_thread_id")
            threadId = id
        }
    }

    func canSend(stream: AgentStream) -> Bool {
        stream.status.isConnected
            && !stream.isStreaming
            && !inputText.trimmingCharacters(in: .whitespaces).isEmpty
    }

    func send(using stream: AgentStream) {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        inputText = ""
        Task { try? await stream.sendMessage(text) }
    }

    func connect(to stream: AgentStream) {
        stream.connect(threadId: threadId)
    }
}
