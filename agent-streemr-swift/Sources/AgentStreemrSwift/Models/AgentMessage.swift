import Foundation

/// The role of a message participant in the conversation.
public enum AgentMessageRole: String, Sendable, Equatable {
    case user
    case assistant
}

/// A single message in the conversation between the user and the agent.
public struct AgentMessage: Identifiable, Sendable, Equatable {
    /// Unique identifier for this message (client-generated UUID).
    public let id: String
    /// Who authored the message.
    public let role: AgentMessageRole
    /// The text content. For assistant messages this grows as chunks arrive.
    public var content: String
    /// `true` while the server is still streaming this message's content.
    public var isStreaming: Bool

    public init(
        id: String = UUID().uuidString,
        role: AgentMessageRole,
        content: String,
        isStreaming: Bool = false
    ) {
        self.id = id
        self.role = role
        self.content = content
        self.isStreaming = isStreaming
    }
}
