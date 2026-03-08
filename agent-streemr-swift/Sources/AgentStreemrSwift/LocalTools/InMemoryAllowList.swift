/// An in-memory, actor-isolated implementation of ``AllowListProtocol``.
///
/// Tool decisions are stored as `[String: Bool]` entries. Tools not explicitly
/// registered return `.unknown` (treated as denied by the coordinator).
///
/// ## Usage
/// ```swift
/// let allowList = InMemoryAllowList()
/// await allowList.allow("get_location")
/// await allowList.deny("read_file")
///
/// stream.registerTool("get_location", allowList: allowList) { args in ... }
/// ```
public actor InMemoryAllowList: AllowListProtocol {
    private var entries: [String: Bool] = [:]

    public init() {}

    // MARK: - Mutation

    /// Allow the named tool.
    public func allow(_ toolName: String) {
        entries[toolName] = true
    }

    /// Deny the named tool.
    public func deny(_ toolName: String) {
        entries[toolName] = false
    }

    /// Remove any recorded decision for the named tool (reverts to `.unknown`).
    public func remove(_ toolName: String) {
        entries.removeValue(forKey: toolName)
    }

    /// Remove all recorded decisions.
    public func clear() {
        entries.removeAll()
    }

    // MARK: - Read

    /// A snapshot of all current entries suitable for UI rendering.
    public func snapshot() -> [String: Bool] {
        entries
    }

    // MARK: - AllowListProtocol

    public func check(toolName: String, args: [String: Any]) async -> AllowListDecision {
        guard let value = entries[toolName] else { return .unknown }
        return value ? .allowed : .denied
    }
}
