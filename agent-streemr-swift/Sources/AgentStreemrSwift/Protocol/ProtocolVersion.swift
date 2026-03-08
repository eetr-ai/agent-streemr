/// The version of the agent-streemr wire protocol.
public struct ProtocolVersion: Codable, Equatable, Sendable {
    public let major: Int
    public let minor: Int

    public init(major: Int, minor: Int) {
        self.major = major
        self.minor = minor
    }

    /// The protocol version implemented by this client.
    public static let client = ProtocolVersion(major: 1, minor: 0)
}
