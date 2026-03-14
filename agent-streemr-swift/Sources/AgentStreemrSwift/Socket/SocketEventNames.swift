/// String constants for every Socket.IO event name in the agent-streemr protocol.
enum SocketEvent {
    // MARK: Server → Client
    static let connect               = "connect"
    static let disconnect            = "disconnect"
    static let connectError          = "connect_error"
    static let welcome               = "welcome"
    static let versionNotSupported   = "version_not_supported"
    static let agentWorking          = "agent_working"
    static let internalToken         = "internal_token"
    static let agentResponse         = "agent_response"
    static let localTool             = "local_tool"
    static let localToolResponseAck  = "local_tool_response_ack"
    static let contextCleared        = "context_cleared"
    static let inactiveClose         = "inactive_close"
    static let attachmentAck         = "attachment_ack"
    static let error                 = "error"

    // MARK: Client → Server
    static let clientHello           = "client_hello"
    static let message               = "message"
    static let setContext            = "set_context"
    static let clearContext          = "clear_context"
    static let localToolResponse     = "local_tool_response"
    static let startAttachments      = "start_attachments"
    static let attachment            = "attachment"
}
