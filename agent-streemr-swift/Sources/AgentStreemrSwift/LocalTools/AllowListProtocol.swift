/// The outcome of an allow-list permission check.
public enum AllowListDecision: String, Sendable {
    /// The tool is explicitly permitted.
    case allowed
    /// The tool is explicitly blocked.
    case denied
    /// No decision has been recorded for this tool yet (treated as denied).
    case unknown
}

/// A pluggable permission gate for local tool requests.
///
/// Implement this protocol to provide custom allow/deny logic (e.g. prompting the user,
/// checking a remote policy, or reading a configuration file).
///
/// The built-in ``InMemoryAllowList`` actor covers most in-process use cases.
public protocol AllowListProtocol: Sendable {
    /// Check whether the named tool is permitted to run with the given arguments.
    func check(toolName: String, args: [String: Any]) async -> AllowListDecision
}
