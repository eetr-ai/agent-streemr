import Foundation

/// The outcome of an allow-list permission check.
public enum AllowListDecision: String, Sendable {
    /// The tool is explicitly permitted.
    case allowed
    /// The tool is explicitly blocked.
    case denied
    /// No decision has been recorded for this tool yet (treated as denied).
    case unknown
    /// The approval decision has expired; the caller should skip silently.
    case expired
}

/// Optional metadata passed to `AllowListProtocol` checks.
public struct AllowListCheckMeta: Sendable {
    /// Millisecond deadline carried by `local_tool.expires_at`.
    public let expiresAt: Date?

    public init(expiresAt: Date?) {
        self.expiresAt = expiresAt
    }
}

/// A pluggable permission gate for local tool requests.
///
/// Implement this protocol to provide custom allow/deny logic (e.g. prompting the user,
/// checking a remote policy, or reading a configuration file).
///
/// The built-in ``InMemoryAllowList`` actor covers most in-process use cases.
public protocol AllowListProtocol: Sendable {
    /// Check whether the named tool is permitted to run with the given arguments.
    func check(
        toolName: String,
        args: [String: Any],
        meta: AllowListCheckMeta?
    ) async -> AllowListDecision
}
