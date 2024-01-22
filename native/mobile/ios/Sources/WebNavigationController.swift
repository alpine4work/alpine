import UIKit
import WebKit

private let bridgeSource = """
    {
        const externalPopNavigationListeners = new Set();

        const NativeMobileBridge = {
            navigation: {
                preparePush: () => {
                    prompt("%%%navigation.preparePush");
                },
                push: url => {
                    window.webkit.messageHandlers.NativeMobileBridge.postMessage(`navigation.push:${url}`);
                },
                subscribeToExternalPop: listener => {
                    externalPopNavigationListeners.add(listener);
                    return () => {
                        externalPopNavigationListeners.delete(listener);
                    };
                },
                _callExternalPopListeners: (delta, urlString) => {
                    const url = new URL(urlString);

                    for (const listener of externalPopNavigationListeners) {
                        try {
                            listener(delta, url);
                        } catch (error) {
                            setTimeout(() => {
                                throw error;
                            }, 0);
                        }
                    }
                },
                finishExternalPop: () => {
                    window.webkit.messageHandlers.NativeMobileBridge.postMessage("navigation.finishExternalPop");
                },
                preparePop: () => {
                    prompt("%%%navigation.preparePop");
                },
                pop: url => {
                    window.webkit.messageHandlers.NativeMobileBridge.postMessage(`navigation.pop:${url}`);
                },
                replace: url => {
                    window.webkit.messageHandlers.NativeMobileBridge.postMessage(`navigation.replace:${url}`);
                },
            },
        };

        window.__NativeMobileBridge = NativeMobileBridge;
    }
    """

class WebNavigationController: UINavigationController, WKNavigationDelegate, WKUIDelegate,
    WKScriptMessageHandler
{
    let initialPath: String
    let webConfiguration: WKWebViewConfiguration

    var webView: WKWebView!
    private var hasInitialWebViewNavigationCommit = false
    private var windowSafeAreaInsets: UIEdgeInsets = .zero

    init(initialPath: String, websiteDataStore: WKWebsiteDataStore) {
        self.initialPath = initialPath

        webConfiguration = WKWebViewConfiguration()
        webConfiguration.processPool = sharedWebProcessPool
        webConfiguration.applicationNameForUserAgent = "CyberworldsNativeMobileIos"
        webConfiguration.upgradeKnownHostsToHTTPS = true

        // iOS security feature. Apple only allows script injection, cookie inspection,
        // and other sensitive features from native code on app bound domains to avoid
        // bad clients from inspecting browser traffic.
        //
        // https://webkit.org/blog/10882/app-bound-domains
        webConfiguration.limitsNavigationsToAppBoundDomains = true

        webConfiguration.websiteDataStore = websiteDataStore

        webConfiguration.userContentController.addUserScript(
            WKUserScript(
                source: bridgeSource,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
        )

        // NOCOMMIT: Initial cookies. Should set `clientInfo` with good values.

        super.init(nibName: nil, bundle: nil)

        webConfiguration.userContentController.add(self, name: "NativeMobileBridge")
    }

    required init(coder: NSCoder) { fatalError("Unimplemented") }

    override func viewDidLoad() {
        super.viewDidLoad()

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

        let url = URL(string: initialPath, relativeTo: baseUrl)!
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
        if prompt == "%%%navigation.preparePush" {
            // TODO(calebmer): If `NativeMobileBridge.navigation.push()` is not called
            // after this the app will appear to be frozen. We expect JavaScript code to
            // promptly call `NativeMobileBridge.navigation.push()`. But what if JavaScript
            // code crashes? We need some recovery mechanisms to unfreeze the app.
            (topViewController! as! WebNavigationEntryController).replaceSubviewsWithSnapshotView()
            return nil
        } else if prompt == "%%%navigation.preparePop" {
            // TODO(calebmer): If `NativeMobileBridge.navigation.pop()` is not called
            // after this the app will appear to be frozen. We expect JavaScript code to
            // promptly call `NativeMobileBridge.navigation.pop()`. But what if JavaScript
            // code crashes? We need some recovery mechanisms to unfreeze the app.
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

            if messageBody.starts(with: "navigation.push:") {
                let urlString = messageBody.suffix(
                    from: messageBody.index(messageBody.startIndex, offsetBy: 16)
                )
                let url = URL(string: String(urlString))!

                let viewController = WebNavigationEntryController(url: url, webView: webView)
                pushViewController(viewController, animated: true)
            } else if messageBody == "navigation.finishExternalPop" {
                (topViewController! as! WebNavigationEntryController)
                    .replaceSubviewsWithWebView(webView: webView)
            } else if messageBody.starts(with: "navigation.pop:") {
                let urlString = messageBody.suffix(
                    from: messageBody.index(messageBody.startIndex, offsetBy: 15)
                )
                let url = URL(string: String(urlString))!

                let viewController = viewControllers.last(where: { (viewController) in
                    (viewController as! WebNavigationEntryController).url.absoluteString
                        == url.absoluteString
                })

                if let viewController = viewController {
                    (viewController as! WebNavigationEntryController)
                        .replaceSubviewsWithWebView(webView: webView)

                    // Important to call `super.popToViewController()` since we don't want our
                    // class's override to start an external pop.
                    super.popToViewController(viewController, animated: true)
                } else {
                    // If we couldn't find the view controller to pop to, then set the top view
                    // controller's view controller as the popped route.
                    //
                    // NOTE(calebmer): This branch really shouldn't happen. I'm not sure if this is
                    // the best default if it does, though. If we find a valid use case where this
                    // branch is executed then reconsider this behavior.
                    (topViewController! as! WebNavigationEntryController).url = url
                    (topViewController! as! WebNavigationEntryController)
                        .replaceSubviewsWithWebView(webView: webView)
                }
            } else if messageBody.starts(with: "navigation.replace:") {
                let urlString = messageBody.suffix(
                    from: messageBody.index(messageBody.startIndex, offsetBy: 19)
                )
                let url = URL(string: String(urlString))!

                (topViewController! as! WebNavigationEntryController).url = url
            }
        }
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
        if viewControllers.count <= 1 { return nil }

        let viewController = super.popViewController(animated: animated)!

        propagateExternalPopNavigation(
            lastTopViewController: viewController as! WebNavigationEntryController,
            delta: 1
        )

        return viewController
    }

    // Override pop navigation functions. We need to let JavaScript control when
    // the pop happens since it may need to load data.
    override func popToRootViewController(animated: Bool) -> [UIViewController]? {
        // If we're already at the root view controller, don't pop more.
        if viewControllers.count <= 1 { return nil }

        let viewControllers = super.popToRootViewController(animated: animated)!

        propagateExternalPopNavigation(
            lastTopViewController: viewControllers.last! as! WebNavigationEntryController,
            delta: viewControllers.count - 1
        )

        return viewControllers
    }

    // Override pop navigation functions. We need to let JavaScript control when
    // the pop happens since it may need to load data.
    override func popToViewController(_ viewController: UIViewController, animated: Bool)
        -> [UIViewController]?
    {
        guard let index = (viewControllers.lastIndex { $0 == viewController }) else { return nil }

        // We're trying to pop to the view controller that's already visible.
        if viewControllers.count == index + 1 { return nil }

        let viewControllers = super.popToViewController(viewController, animated: animated)!

        propagateExternalPopNavigation(
            lastTopViewController: viewControllers.last! as! WebNavigationEntryController,
            delta: viewControllers.count - (index + 1)
        )

        return viewControllers
    }

    private func propagateExternalPopNavigation(
        lastTopViewController: WebNavigationEntryController,
        delta: Int
    ) {
        // TODO(calebmer): If `NativeMobileBridge.navigation.finishExternalPop()` is
        // not called after this the app will appear to be frozen. We expect JavaScript
        // code to promptly call `NativeMobileBridge.navigation.finishExternalPop()`.
        // But what if JavaScript code crashes? We need some recovery mechanisms to
        // unfreeze the app.
        lastTopViewController.replaceSubviewsWithSnapshotView()

        let url = (topViewController! as! WebNavigationEntryController).url

        if let transitionCoordinator = topViewController!.transitionCoordinator {
            if !transitionCoordinator.isInteractive {
                callWebViewExternalPopNavigationListeners(delta: delta, url: url)
            } else {
                transitionCoordinator.notifyWhenInteractionChanges { [self] (context) in
                    // Wait until the transition has finished.
                    if context.isInteractive { return }

                    // If the transition was cancelled, remove the snapshot view and place the web
                    // view back. (Unless the web view has found a new home. e.g. Because a push
                    // navigation happened.)
                    if context.isCancelled {
                        if webView.superview == nil {
                            lastTopViewController.replaceSubviewsWithWebView(webView: webView)
                        }
                    } else {
                        callWebViewExternalPopNavigationListeners(delta: delta, url: url)
                    }
                }
            }
        } else {
            callWebViewExternalPopNavigationListeners(delta: delta, url: url)
        }
    }

    private func callWebViewExternalPopNavigationListeners(delta: Int, url: URL) {
        let jsonEncoder = JSONEncoder()
        var jsonString: String
        do {
            jsonString = String(data: try jsonEncoder.encode(url.absoluteString), encoding: .utf8)!
        } catch { jsonString = "" }

        webView.evaluateJavaScript(
            #"window.__NativeMobileBridge.navigation._callExternalPopListeners(\#(delta), \#(jsonString))"#
        )
    }
}

private class WebNavigationEntryController: UIViewController {
    var url: URL
    private var loadingIndicatorTimer: Timer?
    private var loadingIndicatorTimerGeneration: Int = 0
    private var hasViewAppeared: Bool = false

    init(url: URL, webView: WKWebView) {
        self.url = url

        super.init(nibName: nil, bundle: nil)

        replaceSubviewsWithWebView(webView: webView)
    }

    required init(coder: NSCoder) { fatalError("Unimplemented") }

    func replaceSubviewsWithSnapshotView() {
        let snapshotView = view.snapshotView(afterScreenUpdates: false)!

        for subview in view.subviews { subview.removeFromSuperview() }
        view.addSubview(snapshotView)

        resetLoadingIndicatorTimer()
    }

    func replaceSubviewsWithWebView(webView: WKWebView) {
        // If we are initializing with a web view, the web view should have already
        // been removed from its super view, but just in case perform the remove again.
        webView.removeFromSuperview()

        for subview in view.subviews { subview.removeFromSuperview() }

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

        view.addSubview(webView)

        resetLoadingIndicatorTimer()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        hasViewAppeared = true
        resetLoadingIndicatorTimer()
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        hasViewAppeared = false
        resetLoadingIndicatorTimer()
    }

    private func resetLoadingIndicatorTimer() {
        let hasWebView = view.subviews.first(where: { (view) in view is WKWebView }) != nil

        loadingIndicatorTimer?.invalidate()
        loadingIndicatorTimer = nil
        loadingIndicatorTimerGeneration += 1
        let currentLoadingIndicatorTimerGeneration = loadingIndicatorTimerGeneration

        // Don't show loading indicator if we have a web view.
        if hasWebView { return }

        // Don't show loading indicator if our entry isn't visible.
        if !hasViewAppeared { return }

        // Wait to show a loading indicator until any active transition is done.
        if let transitionCoordinator = transitionCoordinator {
            if !transitionCoordinator.isInteractive {
                startLoadingIndicatorTimer()
            } else {
                transitionCoordinator.notifyWhenInteractionChanges { [self] (context) in
                    if context.isInteractive { return }
                    if context.isCancelled { return }

                    // If `resetLoadingIndicatorTimer()` was called since the notify callback was
                    // attached then we shouldn't start a new loading indicator timer.
                    if loadingIndicatorTimerGeneration == currentLoadingIndicatorTimerGeneration {
                        startLoadingIndicatorTimer()
                    }
                }
            }
        } else {
            startLoadingIndicatorTimer()
        }
    }

    private func startLoadingIndicatorTimer() {
        loadingIndicatorTimer = Timer.scheduledTimer(
            withTimeInterval: delayFullPageTransitionLoadingIndicatorLimitSeconds,
            repeats: false
        ) { [self] timer in addLoadingIndicatorSubviews() }

        // Add some tolerance to reduce timer energy impact.
        loadingIndicatorTimer?.tolerance = 0.1
    }

    /// If we present a navigation entry to the user that's just a snapshot, wait a
    /// bit and then show a loading indicator instead of showing a frozen UI which
    /// feels broken.
    ///
    /// The loading indicator blurs the snapshot and adds an animated loading
    /// spinner in the center.
    private func addLoadingIndicatorSubviews() {
        let blurEffectView = UIVisualEffectView()
        blurEffectView.frame = view.bounds
        blurEffectView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(blurEffectView)

        UIView.animate(withDuration: 0.2) {
            blurEffectView.effect = UIBlurEffect(style: .systemUltraThinMaterial)
        }

        let imageView = UIImageView(
            image: UIImage(named: "SpinnerGapIcon")!
                // Must use template rendering mode for `tintColor` to have any effect.
                .withRenderingMode(.alwaysTemplate)
        )

        // The equivalent of size `spacing["6"]` which is used for peek loading
        // indicators. `spacing["6"]` is 1.5rem and the mobile rem size is 20px.
        // So 1.5 * 20 = 30.
        imageView.frame.size.width = 30
        imageView.frame.size.height = 30

        imageView.tintColor = UIColor(named: "grey-70")!

        view.addSubview(imageView)
        imageView.center = view.center

        let rotationAnimation = CABasicAnimation(keyPath: "transform.rotation")

        // Same rotation animation as `spinAnimationClassName`. 1s infinite repeat.
        rotationAnimation.fromValue = 0.0
        rotationAnimation.toValue = Float.pi * 2.0
        rotationAnimation.duration = 1
        rotationAnimation.repeatCount = Float.infinity

        imageView.layer.add(rotationAnimation, forKey: "rotationAnimation")

    }
}
