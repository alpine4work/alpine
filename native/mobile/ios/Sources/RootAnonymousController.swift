import UIKit
import WebKit

protocol RootAnonymousControllerDelegate: AnyObject {
    func rootAnonymousController(
        _ rootAnonymousController: RootAnonymousController,
        didWebViewCommit navigation: WKNavigation!
    )
}

class RootAnonymousController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    weak var delegate: RootAnonymousControllerDelegate?

    private var webView: WKWebView!

    override func loadView() {
        let webConfiguration = WKWebViewConfiguration()
        webConfiguration.processPool = sharedWebProcessPool
        webConfiguration.applicationNameForUserAgent = "CyberworldsNativeMobileIos"  // NOCOMMIT: Check out what the user agent string looks like. A name like `cyberworlds-native-mobile-ios` could be cleaner but if it doesn't fit don't with user agent style then don't bother
        webConfiguration.upgradeKnownHostsToHTTPS = true

        // iOS security feature. Apple only allows script injection, cookie inspection,
        // and other sensitive features from native code on app bound domains to avoid
        // bad clients from inspecting browser traffic.
        //
        // https://webkit.org/blog/10882/app-bound-domains
        webConfiguration.limitsNavigationsToAppBoundDomains = true

        // NOCOMMIT: This should be non-persistent while logged out then persistent
        // when logged in? But persistent with a custom identifier?
        webConfiguration.websiteDataStore = WKWebsiteDataStore.nonPersistent()

        // NOCOMMIT: Initial cookies. Should set `clientInfo` with good values.

        // NOCOMMIT: Stop navigation out of `/sign-in` routes.

        // NOCOMMIT: Show busy indicator while reloading. Especially useful in
        // development!

        webView = WKWebView(frame: .zero, configuration: webConfiguration)
        webView.navigationDelegate = self
        webView.uiDelegate = self

        // Remove the accessory view with arrow up/down and "done" buttons. While
        // useful for web forms, users don't expect this in a native mobile app.
        swizzleWebViewInputAccessoryView(webView)

        // Enable developer tool usage in development environments.
        #if DBG_COMPILATION_MODE || DEVELOPMENT_RUN_ENVIRONMENT
            if #available(iOS 16.4, *) { webView.isInspectable = true }
        #endif

        view = webView
    }

    override func viewDidLoad() {
        super.viewDidLoad()

        #if PRODUCTION_RUN_ENVIRONMENT
            let baseUrl = URL(string: "https://cyberworlds.dev")!
        #else
            let baseUrl = URL(string: "http://localhost:3000")!
        #endif

        let url = URL(string: "/sign-in", relativeTo: baseUrl)!
        let request = URLRequest(url: url)
        webView.load(request)
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        self.delegate?.rootAnonymousController(self, didWebViewCommit: navigation)
    }

    // We set safe area insets as CSS variables. Then we use these CSS
    // variables to apply padding.
    //
    // WebKit does provide `env(safe-area-inset-*)` variables we could use. [The
    // problem is they are not immediately available][1] in `WKWebView` causing
    // content to flash in one layout, then another, as content moves.
    //
    // [1]: https://bugs.webkit.org/show_bug.cgi?id=191872
    func setWindowSafeAreaInsets(_ windowSafeAreaInsets: UIEdgeInsets) {
        let styleString =
            ":root { --native-mobile-ios-safe-area-inset-top: \(windowSafeAreaInsets.top)px; --native-mobile-ios-safe-area-inset-bottom: \(windowSafeAreaInsets.bottom)px; --native-mobile-ios-safe-area-inset-left: \(windowSafeAreaInsets.left)px; --native-mobile-ios-safe-area-inset-right: \(windowSafeAreaInsets.right)px }"

        let javaScript = """
            {
                const styleString = "\(styleString)";
                const styleElementId = "native-mobile-ios-safe-area-insets";
                let styleElement = document.getElementById(styleElementId);
                if (styleElement) {
                    styleElement.innerHTML = styleString;
                } else {
                    styleElement = document.createElement("style");
                    styleElement.id = styleElementId;
                    styleElement.innerHTML = styleString;
                    document.head.appendChild(styleElement);
                }
            }
            """

        webView.evaluateJavaScript(javaScript)
    }
}
