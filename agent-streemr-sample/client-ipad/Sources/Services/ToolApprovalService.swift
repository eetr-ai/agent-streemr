import Foundation
import Observation
import AgentStreemrSwift
import Combine

@Observable
@MainActor
final class ToolApprovalService {
    struct PendingApproval: Identifiable {
        let id: String
        let toolName: String
        let args: [String: Any]
    }

    private static let userDefaultsKey = "agent_streemr_remembered_tools"

    var pendingApprovals: [PendingApproval] = []
    private var rememberedTools: Set<String> = [] {
        didSet {
            let array = Array(rememberedTools)
            UserDefaults.standard.set(array, forKey: Self.userDefaultsKey)
        }
    }

    /// Sorted list of remembered tool names for UI display.
    var rememberedToolsList: [String] { Array(rememberedTools) }

    private var cancellable: AnyCancellable?

    init() {
        if let stored = UserDefaults.standard.array(forKey: Self.userDefaultsKey) as? [String] {
            rememberedTools = Set(stored)
        }
    }

    func observe(stream: AgentStream) {
        cancellable = stream.localToolPublisher.sink { [weak self] payload in
            guard let self else { return }
            if self.rememberedTools.contains(payload.toolName) {
                Task { @MainActor in
                    await stream.executeApprovedTool(
                        requestId: payload.requestId,
                        toolName: payload.toolName,
                        args: payload.argsJson
                    )
                }
                return
            }
            let approval = PendingApproval(id: payload.requestId, toolName: payload.toolName, args: payload.argsJson)
            self.pendingApprovals.append(approval)
        }
    }

    func approve(id: String, remember: Bool, stream: AgentStream) {
        guard let idx = pendingApprovals.firstIndex(where: { $0.id == id }) else { return }
        let approval = pendingApprovals[idx]
        if remember {
            rememberedTools.insert(approval.toolName)
        }
        pendingApprovals.remove(at: idx)
        Task {
            await stream.executeApprovedTool(
                requestId: approval.id,
                toolName: approval.toolName,
                args: approval.args
            )
        }
    }

    func deny(id: String, stream: AgentStream) {
        guard let idx = pendingApprovals.firstIndex(where: { $0.id == id }) else { return }
        let approval = pendingApprovals[idx]
        stream.respondToLocalTool(requestId: approval.id, toolName: approval.toolName, approved: false)
        pendingApprovals.remove(at: idx)
    }

    func forgetRemembered(toolName: String) {
        rememberedTools.remove(toolName)
    }
}
