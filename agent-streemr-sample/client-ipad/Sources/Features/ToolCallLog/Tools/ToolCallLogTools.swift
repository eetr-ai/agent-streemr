import Foundation
import AgentStreemrSwift

/// Registers tool-call-log handlers on the given coordinator.
/// The tool call log is read-only; no local tools are needed for it.
func registerToolCallLogTools(coordinator: LocalToolCoordinator) async {
    // No local tools required.
}
