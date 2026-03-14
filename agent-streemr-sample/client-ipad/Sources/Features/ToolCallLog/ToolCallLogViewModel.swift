import SwiftUI
import Observation

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
}
