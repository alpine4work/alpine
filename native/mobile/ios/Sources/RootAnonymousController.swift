import Security
import UIKit
import WebKit

// NOCOMMIT: Top bars and back buttons on sign in routes
// NOCOMMIT: Safe area inset should include top bar?
class RootAnonymousController: WebNavigationController, SceneDelegateRootController {
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

            if let spaceId = spaceIdQueryItem?.value, let session = sessionQueryItem?.value {
                // Save session to keychain and `SpaceId` to user defaults. On next launch of
                // the app the user will still be signed in and will return to the last space
                // they were in.
                setSessionToken(session)
                UserDefaults.standard.set(spaceId, forKey: "spaceId")

                // NOCOMMIT: Navigate to `RootTabBarController()`
            }
        }

        return await super.webView(webView, decidePolicyFor: navigationAction)
    }

    private func setSessionToken(_ sessionToken: String) {
        let sessionTokenData = sessionToken.data(using: .utf8)!

        // Save the session token to iOS keychain.
        var status = SecItemAdd(
            [
                kSecValueData: sessionTokenData, kSecClass: kSecClassGenericPassword,
                kSecAttrService: "cyberworlds.dev", kSecAttrAccount: "primary",
                kSecAttrSynchronizable: false,
                kSecAttrAccessible: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
                kSecAttrDescription: "Alpine session token",
            ] as CFDictionary,
            nil
        )

        // If we already had a session token then instead update our keychain with the
        // new session token.
        if status == errSecDuplicateItem {
            status = SecItemUpdate(
                [
                    kSecClass: kSecClassGenericPassword, kSecAttrService: "cyberworlds.dev",
                    kSecAttrAccount: "primary", kSecAttrSynchronizable: false,
                ] as CFDictionary,
                [kSecValueData: sessionTokenData] as CFDictionary
            )
        }

        guard status == errSecSuccess else {
            fatalError(
                "Failed to set session secret in keychain: \(SecCopyErrorMessageString(status, nil) ?? "unknown status \(status)" as CFString)"
            )
        }
    }
}
