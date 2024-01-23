import UIKit
import WebKit

// NOCOMMIT: Top bars and back buttons on sign in routes
class RootAnonymousController: WebNavigationController {
    init() {
        super
            .init(
                initialPath: "/sign-in",
                // Don't persist data while signing in. Each time sign-in launches you get new
                // cookies, `localStorage`, etc.
                websiteDataStore: WKWebsiteDataStore.nonPersistent()
            )
    }

    required init(coder: NSCoder) { fatalError("Unimplemented") }
}
