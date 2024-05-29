import Security
import UIKit
import WebKit

// NOCOMMIT: Top bars and back buttons on sign in routes
class RootAnonymousController: WebNavigationController, SceneDelegateRootController {
    private let signIn: (String, String) -> Void

    init(signIn: @escaping (String, String) -> Void) {
        self.signIn = signIn

        let initialPath = "/sign-in"

        super
            .init(
                initialPath: initialPath,
                // There is no tab navigation in an anonymous view. The user shouldn't be able
                // to switch tabs but in case they do always go back to the initial sign in
                // path.
                initialPathByTab: WebNavigationController.InitialPathByTab(
                    home: initialPath,
                    search: initialPath,
                    create: initialPath,
                    inbox: initialPath,
                    more: initialPath
                ),
                // Don't persist data while signing in. Each time sign-in launches you get new
                // cookies, `localStorage`, etc.
                websiteDataStore: WKWebsiteDataStore.nonPersistent()
            )
    }

    required init(coder: NSCoder) { fatalError("Unimplemented") }

    override func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction
    ) async -> WKNavigationActionPolicy {
        let requestUrl = navigationAction.request.url!
        let requestUrlAbsoluteString = requestUrl.absoluteString

        // Once the user successfully signs in, let's remove this anonymous view
        // controller and send them to our signed in experience.
        if requestUrlAbsoluteString.starts(with: "cyberworlds://sign-in/finish?") {
            let requestUrlComponents = URLComponents(url: requestUrl, resolvingAgainstBaseURL: true)

            let spaceIdQueryItem = requestUrlComponents?.queryItems?
                .first(where: { $0.name == "spaceId" })

            let sessionQueryItem = requestUrlComponents?.queryItems?
                .first(where: { $0.name == "session" })

            if let spaceId = spaceIdQueryItem?.value, let token = sessionQueryItem?.value {
                signIn(token, spaceId)
            }

            return .cancel
        }

        return await super.webView(webView, decidePolicyFor: navigationAction)
    }
}
