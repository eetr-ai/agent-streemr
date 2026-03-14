import Foundation
import Observation

/// Holds the most recently attached photo so that the agent can apply it to
/// a recipe via `recipe_set_photo` after the user sends a message with an image.
///
/// Set from `ChatView` when the user sends a message that includes a photo.
/// Consumed (and cleared) by the `recipe_set_photo` local tool handler.
@Observable
@MainActor
final class PhotoStagingService {

    private(set) var stagedData: Data?
    private(set) var stagedMimeType: String?

    var hasPhoto: Bool { stagedData != nil }

    func stage(data: Data, mimeType: String) {
        stagedData = data
        stagedMimeType = mimeType
    }

    /// Returns and clears the staged photo, or `nil` if nothing is staged.
    func consume() -> (data: Data, mimeType: String)? {
        guard let data = stagedData, let mimeType = stagedMimeType else { return nil }
        stagedData = nil
        stagedMimeType = nil
        return (data, mimeType)
    }
}
