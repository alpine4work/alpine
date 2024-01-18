import UIKit
import WebKit

private let bridgeSource = """
    window.__NativeMobileBridge = {
        preparePushNavigationAnimation: () => {
            prompt("%%%preparePushNavigationAnimation");
        },
        runPushNavigationAnimation: () => {
            window.webkit.messageHandlers.NativeMobileBridge.postMessage("runPushNavigationAnimation");
        },
    };
    """

class WebNavigationController: UINavigationController, WKNavigationDelegate, WKUIDelegate,
    WKScriptMessageHandler
{
    var webView: WKWebView!
    private var hasInitialWebViewNavigationCommit = false
    private var windowSafeAreaInsets: UIEdgeInsets = .zero

    func getInitialPath() -> String {
        fatalError("Sub-class of `WebNavigationController` must implement `getInitialPath()`")
    }

    // Default to not persisting website data. Must manually specify whether
    // website data should be persisted.
    func getWebsiteDataStore() -> WKWebsiteDataStore { return WKWebsiteDataStore.nonPersistent() }

    override func viewDidLoad() {
        super.viewDidLoad()

        let rootStackEntryController = WebNavigationStackEntryController()
        viewControllers = [rootStackEntryController]

        let webConfiguration = WKWebViewConfiguration()
        webConfiguration.processPool = sharedWebProcessPool
        webConfiguration.applicationNameForUserAgent = "CyberworldsNativeMobileIos"
        webConfiguration.upgradeKnownHostsToHTTPS = true

        // iOS security feature. Apple only allows script injection, cookie inspection,
        // and other sensitive features from native code on app bound domains to avoid
        // bad clients from inspecting browser traffic.
        //
        // https://webkit.org/blog/10882/app-bound-domains
        webConfiguration.limitsNavigationsToAppBoundDomains = true

        webConfiguration.websiteDataStore = getWebsiteDataStore()

        webConfiguration.userContentController.add(self, name: "NativeMobileBridge")

        webConfiguration.userContentController.addUserScript(
            WKUserScript(
                source: bridgeSource,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
        )

        // NOCOMMIT: Initial cookies. Should set `clientInfo` with good values.

        // NOCOMMIT: Stop navigation out of `/sign-in` routes.

        webView = WKWebView(
            frame: CGRect(origin: .zero, size: view.frame.size),
            configuration: webConfiguration
        )
        webView.navigationDelegate = self
        webView.uiDelegate = self

        // Remove the accessory view with arrow up/down and "done" buttons. While
        // useful for web forms, users don't expect this in a native mobile app.
        swizzleWebViewInputAccessoryView(webView)

        // Enable developer tool usage in development environments.
        #if DBG_COMPILATION_MODE || DEVELOPMENT_RUN_ENVIRONMENT
            if #available(iOS 16.4, *) { webView.isInspectable = true }
        #endif

        rootStackEntryController.view.addSubview(webView)

        #if PRODUCTION_RUN_ENVIRONMENT
            let baseUrl = URL(string: "https://cyberworlds.dev")!
        #else
            let baseUrl = URL(string: "http://localhost:3000")!
        #endif

        let url = URL(string: getInitialPath(), relativeTo: baseUrl)!
        let request = URLRequest(url: url)
        webView.load(request)
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        hasInitialWebViewNavigationCommit = true

        // We need to update safe area insets after the document `<head>` has been
        // downloaded to the client.
        setWindowSafeAreaInsets(windowSafeAreaInsets)
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptTextInputPanelWithPrompt prompt: String,
        defaultText: String?,
        initiatedByFrame frame: WKFrameInfo
    ) async -> String? {
        // We use triple `%` to signal to our native app that we have a command.
        // Prompts that don't start with triple `%` should use default prompt handling.
        // Picked triple `%` since it should be very uncommon as the start of
        // regular prose.
        //
        // NOTE(calebmer): We should implement alerts with `UIAlertController`. But our
        // products don't use `alert()`/`prompt()` (they're bad UX) so for now we have
        // no reason to implement regular alerts.
        if !prompt.starts(with: "%%%") { return nil }

        // We want to block web code while preparing our navigation animation. That's
        // because we need to take a screenshot of the old screen so we can't have web
        // code paint a new screen. Since `WKWebKit` doesn't have a built-in API to
        // execute synchronous functions, we implement a bit of a [hack here using the
        // `prompt()` API][1] which will block until we finish our screenshot.
        //
        // [1]: https://stackoverflow.com/questions/29249132/wkwebview-complex-communication-between-javascript-native-code/49474323#49474323
        if prompt == "%%%preparePushNavigationAnimation" {
            let snapshotView = webView.snapshotView(afterScreenUpdates: false)!

            webView.removeFromSuperview()
            topViewController!.view.addSubview(snapshotView)

            return nil
        } else {
            // Unrecognized prompt. Do nothing.
            return nil
        }
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        if message.name == "NativeMobileBridge", let messageBody = message.body as? NSString {
            if messageBody == "runPushNavigationAnimation" {
                let stackEntryController = WebNavigationStackEntryController()

                // The web view should already have been removed from its superview in
                // `preparePushNavigationAnimation()` but for safety, make sure the web view is
                // actually removed.
                webView.removeFromSuperview()

                // NOTE(calebmer, 2023-01-18): My old coworker [Sean Keenan][1] invented the
                // technique of snapshotting a web view to get iOS native animations with web
                // views. In the code where he first implemented this technique (which he
                // shared with me) he wrote a comment above this same code:
                //
                // > Set Webview size to fill the view
                // > If you don't do this after moving the webview - it slowly degrades in perf
                //
                // I have no idea why perf would degrade if you didn't do this but I don't want
                // to degrade perf so I'll include this line as well!
                //
                // [1]: https://www.linkedin.com/in/sean9keenan
                webView.frame = CGRect(origin: .zero, size: view.frame.size)

                stackEntryController.view.addSubview(webView)

                pushViewController(stackEntryController, animated: true)
                return
            }
        }

        // If we reach here, we have an unrecognized message. Do nothing.
    }

    // We set safe area insets as CSS variables. Then we use these CSS
    // variables to apply padding.
    //
    // WebKit does provide `env(safe-area-inset-*)` variables we could use. [The
    // problem is they are not immediately available][1] in `WKWebView` causing
    // a flash of incorrectly styled content as it moves to the correct location.
    //
    // [1]: https://bugs.webkit.org/show_bug.cgi?id=191872
    func setWindowSafeAreaInsets(_ windowSafeAreaInsets: UIEdgeInsets) {
        self.windowSafeAreaInsets = windowSafeAreaInsets
        if !hasInitialWebViewNavigationCommit { return }

        let styleString =
            ":root { --safe-area-inset-top: \(windowSafeAreaInsets.top)px; --safe-area-inset-bottom: \(windowSafeAreaInsets.bottom)px; --safe-area-inset-left: \(windowSafeAreaInsets.left)px; --safe-area-inset-right: \(windowSafeAreaInsets.right)px }"

        let source = """
            {
                const styleString = "\(styleString)";
                const styleElementId = "safe-area-inset-style";
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

        webView.evaluateJavaScript(source)
    }
}

private class WebNavigationStackEntryController: UIViewController {}
