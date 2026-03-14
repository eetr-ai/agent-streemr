import Foundation
import Observation

// MARK: - Model

struct ProtocolLogEntry: Identifiable {
    let id = UUID()
    let timestamp: Date
    let eventName: String
    let payload: String

    var formattedTime: String {
        timestamp.formatted(.dateTime.hour().minute().second())
    }
}

// MARK: - ViewModel

@Observable
@MainActor
final class ProtocolLogViewModel {
    var entries: [ProtocolLogEntry] = []

    func append(_ entry: ProtocolLogEntry) {
        entries.append(entry)
    }

    func clear() {
        entries.removeAll()
    }
}
