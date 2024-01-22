import UIKit
import WebKit

private let bridgeSource = """
    {
        const popNavigationListeners = new Set();

        const NativeMobileBridge = {
            preparePushNavigationAnimation: () => {
                prompt("%%%preparePushNavigationAnimation");
            },
            runPushNavigationAnimation: url => {
                window.webkit.messageHandlers.NativeMobileBridge.postMessage(`runPushNavigationAnimation:${url}`);
            },
            subscribeToPopNavigation: listener => {
                popNavigationListeners.add(listener);
                return () => {
                    popNavigationListeners.delete(listener);
                };
            },
            _callPopNavigationListeners: delta => {
                for (const listener of popNavigationListeners) {
                    try {
                        listener(delta);
                    } catch (error) {
                        setTimeout(() => {
                            throw error;
                        }, 0);
                    }
                }
            },
            finishPopNavigationAnimation: () => {
                window.webkit.messageHandlers.NativeMobileBridge.postMessage("finishPopNavigationAnimation");
            },
        };

        window.__NativeMobileBridge = NativeMobileBridge;
    }
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

        #if PRODUCTION_RUN_ENVIRONMENT
            let baseUrl = URL(string: "https://cyberworlds.dev")!
        #else
            let baseUrl = URL(string: "http://localhost:3000")!
        #endif

        let url = URL(string: getInitialPath(), relativeTo: baseUrl)!
        let request = URLRequest(url: url)
        webView.load(request)

        let rootViewController = WebNavigationEntryController(url: url, webView: webView)
        viewControllers = [rootViewController]
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
        //
        // TODO(calebmer): If `runPushNavigationAnimation()` is not called after this
        // the app will appear frozen. We expect JavaScript code to promptly call
        // `runPushNavigationAnimation()`. But what if JavaScript code crashes? We need
        // some recovery mechanisms to unfreeze the app.
        if prompt == "%%%preparePushNavigationAnimation" {
            (topViewController! as! WebNavigationEntryController).replaceSubviewsWithSnapshotView()
            return nil
        } else {
            // Unrecognized prompt command. Do nothing.
            return nil
        }
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        if message.name == "NativeMobileBridge", let messageBody = message.body as? NSString {
            let messageBody: String = messageBody as String

            if messageBody.starts(with: "runPushNavigationAnimation:") {
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
                // When I asked Sean if he could recall why this was necessary he said:
                //
                // > What I remember: definitely not documented anywhere, [that line] was added
                // > after some good ol'fashion "playing around with it and then noticing
                // > things got laggy". I believe I saw this sort of issue when I put my finger
                // > on the far left of the screen and would swipe right, but bring it back and
                // > forth a whole bunch of times so that it constantly was retriggering the
                // > associated logic
                //
                // [1]: https://www.linkedin.com/in/sean9keenan
                webView.frame = CGRect(origin: .zero, size: view.frame.size)

                let urlString = messageBody.suffix(
                    from: messageBody.index(messageBody.startIndex, offsetBy: 27)
                )
                let url = URL(string: String(urlString))!

                let viewController = WebNavigationEntryController(url: url, webView: webView)
                pushViewController(viewController, animated: true)
                return
            } else if messageBody == "finishPopNavigationAnimation" {
                // See comment above about why we reset `frame`.
                webView.frame = CGRect(origin: .zero, size: view.frame.size)

                // NOCOMMIT: Can we confirm this is the right URL?
                (topViewController! as! WebNavigationEntryController)
                    .replaceSubviewsWithWebView(webView: webView)
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

    // Override pop navigation functions. We need to let JavaScript control when
    // the pop happens since it may need to load data.
    override func popViewController(animated: Bool) -> UIViewController? {
        propagatePopNavigationAnimation(delta: 1)

        return super.popViewController(animated: animated)
    }

    // Override pop navigation functions. We need to let JavaScript control when
    // the pop happens since it may need to load data.
    override func popToRootViewController(animated: Bool) -> [UIViewController]? {
        // If we're already at the root view controller, don't pop more.
        if viewControllers.count <= 1 { return super.popToRootViewController(animated: animated) }

        propagatePopNavigationAnimation(delta: viewControllers.count - 1)

        return super.popToRootViewController(animated: animated)
    }

    // Override pop navigation functions. We need to let JavaScript control when
    // the pop happens since it may need to load data.
    override func popToViewController(_ viewController: UIViewController, animated: Bool)
        -> [UIViewController]?
    {
        guard let index = (viewControllers.lastIndex { $0 == viewController }) else {
            return super.popToViewController(viewController, animated: animated)
        }

        // We're trying to pop to the view controller that's already visible.
        if viewControllers.count == index + 1 {
            return super.popToViewController(viewController, animated: animated)
        }

        propagatePopNavigationAnimation(delta: viewControllers.count - (index + 1))

        return super.popToViewController(viewController, animated: animated)
    }

    private func propagatePopNavigationAnimation(delta: Int) {
        (topViewController! as! WebNavigationEntryController).replaceSubviewsWithSnapshotView()

        webView.evaluateJavaScript(
            "window.__NativeMobileBridge._callPopNavigationListeners(\(delta))"
        )
    }
}

private class WebNavigationEntryController: UIViewController {
    init(url: URL, webView: WKWebView) {
        super.init(nibName: nil, bundle: nil)

        // If we are initializing with a web view, the web view should have already
        // been removed from its super view, but just in case perform the remove again.
        webView.removeFromSuperview()

        view.addSubview(webView)
    }

    required init(coder: NSCoder) { fatalError("Unimplemented") }

    func replaceSubviewsWithSnapshotView() {
        let snapshotView = view.snapshotView(afterScreenUpdates: false)!

        for subview in view.subviews { subview.removeFromSuperview() }
        view.addSubview(snapshotView)
    }

    func replaceSubviewsWithWebView(webView: WKWebView) {
        // If we are initializing with a web view, the web view should have already
        // been removed from its super view, but just in case perform the remove again.
        webView.removeFromSuperview()

        for subview in view.subviews { subview.removeFromSuperview() }
        view.addSubview(webView)
    }
}
