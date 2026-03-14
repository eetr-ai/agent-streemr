import Foundation
import Combine
import AgentStreemrSwift

// MARK: - Model

struct ProtocolLogEntry: Identifiable {
    let id = UUID()
    let timestamp: Date
    let eventName: String
    let direction: ProtocolEventRecord.Direction
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

    private var cancellable: AnyCancellable?

    /// Subscribe to `stream.protocolEventPublisher` and append an entry for
    /// every event. Safe to call multiple times — each call replaces the
    /// previous subscription.
    func observe(stream: AgentStream) {
        cancellable = stream.protocolEventPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] record in
                guard let self else { return }
                let entry = ProtocolLogEntry(
                    timestamp: record.timestamp,
                    eventName: record.name,
                    direction: record.direction,
                    payload: record.payloadJSON ?? ""
                )
                self.entries.append(entry)
            }
    }

    func append(_ entry: ProtocolLogEntry) {
        entries.append(entry)
    }

    func clear() {
        entries.removeAll()
    }
}
