import SwiftUI

private struct PhotoStagingServiceKey: EnvironmentKey {
    @MainActor static let defaultValue = PhotoStagingService()
}

extension EnvironmentValues {
    var photoStagingService: PhotoStagingService {
        get { self[PhotoStagingServiceKey.self] }
        set { self[PhotoStagingServiceKey.self] = newValue }
    }
}
