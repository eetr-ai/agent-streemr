import SwiftUI
import Observation
import AgentStreemrSwift

@main
struct AgentStreemrApp: App {

    @State private var recipeService = RecipeService(
        repository: SwiftDataRecipeRepository()
    )

    /// Server URL and token. For Simulator use http://localhost:PORT.
    /// For a physical iPad use your Mac's IP (e.g. http://192.168.1.x:3000).
    /// If the server requires auth, set a non-empty token.
    @State private var stream = AgentStream(
        configuration: AgentStreamConfiguration(
            url: URL(string: "http://localhost:8080")!,
            token: "",
            inactivityTimeoutMs: 60_000
        )
    )

    @State private var chatViewModel = ChatViewModel()
    @State private var toolApprovalService = ToolApprovalService()
    @State private var photoStagingService = PhotoStagingService()
    @State private var attachmentReferenceStore = AttachmentReferenceStore()
    @State private var selectedRecipeState = SelectedRecipeState()
    @State private var recipeEditorViewModel = RecipeEditorViewModel()
    @State private var toolCallLogViewModel = ToolCallLogViewModel()
    @State private var protocolLogViewModel = ProtocolLogViewModel()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(\.recipeService, recipeService)
                .environment(stream)
                .environment(chatViewModel)
                .environment(toolApprovalService)
                .environment(\.photoStagingService, photoStagingService)
                .environment(attachmentReferenceStore)
                .environment(selectedRecipeState)
                .environment(recipeEditorViewModel)
                .environment(toolCallLogViewModel)
                .environment(protocolLogViewModel)
                .task {
                    protocolLogViewModel.observe(stream: stream)
                    attachmentReferenceStore.observe(stream: stream)
                    await registerRecipeListTools(
                        on: stream,
                        recipeService: recipeService,
                        selectedRecipeState: selectedRecipeState,
                        recipeEditorViewModel: recipeEditorViewModel,
                        toolCallLog: toolCallLogViewModel
                    )
                    await registerRecipeEditorTools(
                        on: stream,
                        recipeService: recipeService,
                        photoStagingService: photoStagingService,
                        attachmentReferenceStore: attachmentReferenceStore,
                        selectedRecipeState: selectedRecipeState,
                        recipeEditorViewModel: recipeEditorViewModel,
                        toolCallLog: toolCallLogViewModel
                    )
                }
        }
    }
}

@Observable
@MainActor
final class ToolApprovalService {
    var pendingApprovals: [PendingToolApproval] = []
    var rememberedToolsList: [String] = []

    private var stream: AgentStream?
    private var observationTask: Task<Void, Never>?
    private let rememberedToolsKey = "tool_approval_service.remembered_tools"

    init() {
        rememberedToolsList = UserDefaults.standard.stringArray(forKey: rememberedToolsKey) ?? []
    }

    func observe(stream: AgentStream) {
        guard observationTask == nil else { return }
        self.stream = stream
        observationTask = Task { @MainActor [weak self] in
            guard let self else { return }
            for await payload in stream.localToolPublisher.values {
                if self.rememberedToolsList.contains(payload.toolName) {
                    await stream.executeApprovedTool(
                        requestId: payload.requestId,
                        toolName: payload.toolName,
                        args: payload.argsJson
                    )
                    continue
                }
                self.pendingApprovals.append(
                    PendingToolApproval(
                        id: payload.requestId,
                        requestId: payload.requestId,
                        toolName: payload.toolName,
                        args: payload.argsJson,
                        argumentsSummary: Self.stringify(payload.argsJson)
                    )
                )
            }
        }
    }

    func approve(_ approval: PendingToolApproval) {
        if !rememberedToolsList.contains(approval.toolName) {
            rememberedToolsList.append(approval.toolName)
            persistRememberedTools()
        }
        remove(approval)
        guard let stream else { return }
        Task {
            await stream.executeApprovedTool(
                requestId: approval.requestId,
                toolName: approval.toolName,
                args: approval.args
            )
        }
    }

    func deny(_ approval: PendingToolApproval) {
        stream?.respondToLocalTool(
            requestId: approval.requestId,
            toolName: approval.toolName,
            approved: false
        )
        remove(approval)
    }

    private func remove(_ approval: PendingToolApproval) {
        pendingApprovals.removeAll { $0.id == approval.id }
    }

    func forgetRemembered(toolName: String) {
        rememberedToolsList.removeAll { $0 == toolName }
        persistRememberedTools()
    }

    private func persistRememberedTools() {
        UserDefaults.standard.set(rememberedToolsList.sorted(), forKey: rememberedToolsKey)
    }

    private static func stringify(_ dictionary: [String: Any]) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: dictionary, options: [.prettyPrinted, .sortedKeys]),
              let string = String(data: data, encoding: .utf8) else {
            return ""
        }
        return string
    }
}

struct PendingToolApproval: Identifiable {
    let id: String
    let requestId: String
    let toolName: String
    let args: [String: Any]
    let argumentsSummary: String
}

final class PhotoStagingService {
    private var stagedPhoto: StagedPhoto?
    private var lastAttachedPhotoAssetIdentifier: String?

    func stage(data: Data, mimeType: String, assetIdentifier: String?) {
        stagedPhoto = StagedPhoto(data: data, mimeType: mimeType, assetIdentifier: assetIdentifier)
        if let assetIdentifier {
            lastAttachedPhotoAssetIdentifier = assetIdentifier
        }
    }

    func rememberLastAttachedPhoto(assetIdentifier: String?) {
        guard let assetIdentifier else { return }
        lastAttachedPhotoAssetIdentifier = assetIdentifier
    }

    func consume() -> StagedPhoto? {
        let photo = stagedPhoto
        stagedPhoto = nil
        return photo
    }

    func current() -> StagedPhoto? {
        stagedPhoto
    }

    func currentAssetIdentifier() -> String? {
        stagedPhoto?.assetIdentifier
    }

    func lastAttachedAssetIdentifier() -> String? {
        lastAttachedPhotoAssetIdentifier
    }

    func clear() {
        stagedPhoto = nil
    }
}

struct StagedPhoto {
    let data: Data
    let mimeType: String
    let assetIdentifier: String?
}

@Observable
@MainActor
final class AttachmentReferenceStore {
    private struct PendingBatch {
        let assetIdentifiers: [String?]
    }

    private struct StoredAttachmentReference: Codable {
        let correlationId: String?
        let sequence: Int?
        let assetIdentifier: String
        let timestamp: Date
    }

    private var pendingBatches: [PendingBatch] = []
    private var correlationToAssets: [String: [Int: String]] = [:]
    private var recentReferences: [StoredAttachmentReference] = []
    private var observationTask: Task<Void, Never>?
    private let persistenceKey = "attachment_reference_store.references"
    private let maxStoredReferences = 100

    init() {
        loadPersistedReferences()
    }

    func prepareOutgoingAttachments(assetIdentifiers: [String?]) {
        pendingBatches.append(PendingBatch(assetIdentifiers: assetIdentifiers))
        for (index, assetIdentifier) in assetIdentifiers.enumerated() {
            guard let assetIdentifier else { continue }
            remember(
                StoredAttachmentReference(
                    correlationId: nil,
                    sequence: index,
                    assetIdentifier: assetIdentifier,
                    timestamp: Date()
                )
            )
        }
    }

    func observe(stream: AgentStream) {
        guard observationTask == nil else { return }
        observationTask = Task { @MainActor [weak self] in
            guard let self else { return }
            for await record in stream.protocolEventPublisher.values {
                guard record.direction == .outgoing,
                      let payloadJSON = record.payloadJSON,
                      let data = payloadJSON.data(using: .utf8),
                      let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                    continue
                }

                switch record.name {
                case "start_attachments":
                    guard let correlationId = payload["correlation_id"] as? String else { continue }
                    let batch = pendingBatches.isEmpty ? nil : pendingBatches.removeFirst()
                    let indexed = Dictionary(uniqueKeysWithValues: (batch?.assetIdentifiers ?? []).enumerated().compactMap { index, assetIdentifier in
                        assetIdentifier.map { (index, $0) }
                    })
                    correlationToAssets[correlationId] = indexed
                    for (sequence, assetIdentifier) in indexed {
                        remember(
                            StoredAttachmentReference(
                                correlationId: correlationId,
                                sequence: sequence,
                                assetIdentifier: assetIdentifier,
                                timestamp: Date()
                            )
                        )
                    }

                case "attachment":
                    guard let correlationId = payload["correlation_id"] as? String,
                          let seq = payload["seq"] as? Int,
                          let batch = correlationToAssets[correlationId],
                          let assetIdentifier = batch[seq] else {
                        continue
                    }
                    correlationToAssets[correlationId, default: [:]][seq] = assetIdentifier
                    remember(
                        StoredAttachmentReference(
                            correlationId: correlationId,
                            sequence: seq,
                            assetIdentifier: assetIdentifier,
                            timestamp: Date()
                        )
                    )

                default:
                    continue
                }
            }
        }
    }

    func assetIdentifier(correlationId: String?, sequence: Int?) -> String? {
        if let correlationId, let sequence, let assetIdentifier = correlationToAssets[correlationId]?[sequence] {
            return assetIdentifier
        }
        if let correlationId, let sequence, sequence > 0,
           let assetIdentifier = correlationToAssets[correlationId]?[sequence - 1] {
            return assetIdentifier
        }
        if let correlationId, let first = correlationToAssets[correlationId]?.values.sorted().first {
            return first
        }
        if let correlationId,
           let assetIdentifier = recentReferences
            .reversed()
            .first(where: { $0.correlationId == correlationId })?
            .assetIdentifier {
            return assetIdentifier
        }
        if let sequence {
            for assetsBySequence in correlationToAssets.values.reversed() {
                if let assetIdentifier = assetsBySequence[sequence] {
                    return assetIdentifier
                }
                if sequence > 0, let assetIdentifier = assetsBySequence[sequence - 1] {
                    return assetIdentifier
                }
            }
            if let assetIdentifier = recentReferences
                .reversed()
                .first(where: { $0.sequence == sequence })?
                .assetIdentifier {
                return assetIdentifier
            }
            if sequence > 0,
               let assetIdentifier = recentReferences
                .reversed()
                .first(where: { $0.sequence == sequence - 1 })?
                .assetIdentifier {
                return assetIdentifier
            }
        }
        return recentReferences.last?.assetIdentifier
    }

    func mostRecentAssetIdentifier() -> String? {
        recentReferences.last?.assetIdentifier
    }

    private func remember(_ reference: StoredAttachmentReference) {
        recentReferences.removeAll {
            $0.correlationId == reference.correlationId &&
            $0.sequence == reference.sequence &&
            $0.assetIdentifier == reference.assetIdentifier
        }
        recentReferences.append(reference)
        if recentReferences.count > maxStoredReferences {
            recentReferences.removeFirst(recentReferences.count - maxStoredReferences)
        }
        persistReferences()
    }

    private func loadPersistedReferences() {
        guard let data = UserDefaults.standard.data(forKey: persistenceKey),
              let decoded = try? JSONDecoder().decode([StoredAttachmentReference].self, from: data) else {
            return
        }
        recentReferences = decoded
        for reference in decoded {
            if let correlationId = reference.correlationId,
               let sequence = reference.sequence {
                correlationToAssets[correlationId, default: [:]][sequence] = reference.assetIdentifier
            }
        }
    }

    private func persistReferences() {
        guard let data = try? JSONEncoder().encode(recentReferences) else { return }
        UserDefaults.standard.set(data, forKey: persistenceKey)
    }
}

private struct PhotoStagingServiceKey: EnvironmentKey {
    static let defaultValue = PhotoStagingService()
}

extension EnvironmentValues {
    var photoStagingService: PhotoStagingService {
        get { self[PhotoStagingServiceKey.self] }
        set { self[PhotoStagingServiceKey.self] = newValue }
    }
}

private struct AttachmentReferenceStoreKey: EnvironmentKey {
    static let defaultValue: AttachmentReferenceStore = MainActor.assumeIsolated {
        AttachmentReferenceStore()
    }
}

extension EnvironmentValues {
    var attachmentReferenceStore: AttachmentReferenceStore {
        get { self[AttachmentReferenceStoreKey.self] }
        set { self[AttachmentReferenceStoreKey.self] = newValue }
    }
}

@Observable
@MainActor
final class SelectedRecipeState {
    var selectedRecipeId: String?
}
