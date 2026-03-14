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

    var pendingApprovals: [PendingApproval] = []
    private var rememberedTools: Set<String> = []
    private var cancellable: AnyCancellable?

    func observe(stream: AgentStream) {
        cancellable = stream.localToolPublisher.sink { [weak self] payload in
            guard let self else { return }
            if self.rememberedTools.contains(payload.toolName) {
                stream.respondToLocalTool(requestId: payload.requestId, toolName: payload.toolName, approved: true)
                return
            }
            let approval = PendingApproval(id: payload.requestId, toolName: payload.toolName, args: payload.argsJson)
            self.pendingApprovals.append(approval)
        }
    }

    func approve(id: String, remember: Bool, stream: AgentStream) {
        guard let idx = pendingApprovals.firstIndex(where: { $0.id == id }) else { return }
        let approval = pendingApprovals[idx]
        stream.respondToLocalTool(requestId: approval.id, toolName: approval.toolName, approved: true)
        if remember {
            rememberedTools.insert(approval.toolName)
        }
        pendingApprovals.remove(at: idx)
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
