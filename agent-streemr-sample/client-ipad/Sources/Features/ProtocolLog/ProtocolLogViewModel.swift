import Foundation
import Combine
import SwiftUI
import AgentStreemrSwift

// MARK: - Event Metadata

private struct EventMeta {
    let color: Color
    let label: String
}

private let eventMetaMap: [String: EventMeta] = [
    // Client → Server
    "message":             EventMeta(color: .blue,   label: "Send message"),
    "local_tool_response": EventMeta(color: .blue,   label: "Tool response"),
    "clear_context":       EventMeta(color: .cyan,   label: "Clear context"),
    "set_context":         EventMeta(color: .cyan,   label: "Set context"),
    // Server → Client
    "internal_token":      EventMeta(color: .purple, label: "Thinking token"),
    "local_tool":          EventMeta(color: .orange, label: "Tool request"),
    "agent_response":      EventMeta(color: .green,  label: "Agent response"),
    "context_cleared":     EventMeta(color: .teal,   label: "Context cleared"),
    "error":               EventMeta(color: .red,    label: "Error"),
]

private func eventMeta(for name: String) -> EventMeta {
    eventMetaMap[name] ?? EventMeta(color: .gray, label: name)
}

// MARK: - Smart Summary

func summarise(eventName: String, payloadJSON: String?) -> String {
    guard let json = payloadJSON, !json.isEmpty else { return "—" }
    if let data = json.data(using: .utf8),
       let obj  = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
        if eventName == "internal_token", let token = obj["token"] as? String {
            return token.count > 60 ? "\"\(token.prefix(60))…\"" : "\"\(token)\""
        }
        if eventName == "agent_response" {
            let chunk  = obj["chunk"] as? String ?? ""
            let done   = obj["done"]  as? Bool   ?? false
            let suffix = done ? " ✓" : ""
            let body   = chunk.count > 60 ? "\"\(chunk.prefix(60))…\"" : "\"\(chunk)\""
            return body + suffix
        }
    }
    return json.count > 80 ? "\(json.prefix(80))…" : json
}

// MARK: - Model

struct ProtocolLogEntry: Identifiable {
    let id = UUID()
    var timestamp: Date
    let eventName: String
    let direction: ProtocolEventRecord.Direction
    var payloads: [String]
    var count: Int
    var isExpanded: Bool

    var formattedTime: String {
        timestamp.formatted(.dateTime.hour().minute().second())
    }

    var label: String      { eventMeta(for: eventName).label }
    var accentColor: Color { eventMeta(for: eventName).color }
    var latestPayload: String? { payloads.last }
}

// MARK: - ViewModel

@Observable
@MainActor
final class ProtocolLogViewModel {
    var entries: [ProtocolLogEntry] = []
    var totalEventCount: Int { entries.reduce(0) { $0 + $1.count } }

    private var cancellable: AnyCancellable?

    /// Subscribe to `stream.protocolEventPublisher` and append an entry for
    /// every event. Consecutive events with the same name and direction are
    /// merged into one entry with an incrementing count.
    func observe(stream: AgentStream) {
        cancellable = stream.protocolEventPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] record in
                guard let self else { return }
                let payload = record.payloadJSON ?? ""
                if let idx = entries.indices.last,
                   entries[idx].eventName == record.name,
                   entries[idx].direction == record.direction {
                    entries[idx].count    += 1
                    entries[idx].timestamp = record.timestamp
                    entries[idx].payloads.append(payload)
                } else {
                    entries.append(ProtocolLogEntry(
                        timestamp:  record.timestamp,
                        eventName:  record.name,
                        direction:  record.direction,
                        payloads:   [payload],
                        count:      1,
                        isExpanded: false
                    ))
                }
            }
    }

    func toggle(id: UUID) {
        guard let idx = entries.firstIndex(where: { $0.id == id }) else { return }
        entries[idx].isExpanded.toggle()
    }

    func clear() {
        entries.removeAll()
    }
}
