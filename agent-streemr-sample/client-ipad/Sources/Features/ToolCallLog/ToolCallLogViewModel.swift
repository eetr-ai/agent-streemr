import SwiftUI
import Observation
import AgentStreemrSwift

// MARK: - Models

enum ToolCallStatus {
    case pending
    case success
    case failure(String)

    var label: String {
        switch self {
        case .pending:  return "Pending"
        case .success:  return "Success"
        case .failure:  return "Failed"
        }
    }

    var color: Color {
        switch self {
        case .pending:  return .orange
        case .success:  return .green
        case .failure:  return .red
        }
    }
}

struct ToolCallEntry: Identifiable {
    let id: String          // request_id
    let toolName: String
    let arguments: String   // JSON string
    var status: ToolCallStatus
    let startedAt: Date
    var endedAt: Date?

    var duration: String? {
        guard let end = endedAt else { return nil }
        let ms = Int(end.timeIntervalSince(startedAt) * 1000)
        return "\(ms) ms"
    }
}

// MARK: - ViewModel

@Observable
@MainActor
final class ToolCallLogViewModel {
    var entries: [ToolCallEntry] = []

    func append(_ entry: ToolCallEntry) {
        entries.append(entry)
    }

    func update(id: String, status: ToolCallStatus, endedAt: Date = Date()) {
        guard let index = entries.firstIndex(where: { $0.id == id }) else { return }
        entries[index].status = status
        entries[index].endedAt = endedAt
    }

    func clear() {
        entries.removeAll()
    }

    /// Wraps a local tool handler to log start/end and status to this view model.
    func wrap(_ toolName: String, _ handler: @escaping LocalToolHandler) -> LocalToolHandler {
        return { [weak self] args in
            guard let self else { return .error(message: "Tool call log unavailable") }
            let logId = UUID().uuidString
            let argsStr: String
            if let data = try? JSONSerialization.data(withJSONObject: args),
               let str = String(data: data, encoding: .utf8) {
                argsStr = str
            } else {
                argsStr = String(describing: args)
            }
            await MainActor.run {
                self.append(ToolCallEntry(id: logId, toolName: toolName, arguments: argsStr, status: .pending, startedAt: Date(), endedAt: nil))
            }
            let result: LocalToolHandlerResult
            do {
                result = try await handler(args)
            } catch {
                result = .error(message: error.localizedDescription)
            }
            let status: ToolCallStatus = switch result {
            case .success: .success
            case .denied: .failure("Denied")
            case .notSupported: .failure("Not supported")
            case .error(let msg): .failure(msg ?? "Unknown error")
            }
            await MainActor.run {
                self.update(id: logId, status: status, endedAt: Date())
            }
            return result
        }
    }
}
