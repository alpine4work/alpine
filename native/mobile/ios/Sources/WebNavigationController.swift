import OSLog
import UIKit
import WebKit

private let logger = Logger(
    subsystem: Bundle.main.bundleIdentifier!,
    category: "WebNavigationController"
)

@objc protocol WebNavigationControllerDelegate {
    @objc optional func webNavigationController(
        _ webNavigationController: WebNavigationController,
        didAddWebScrollView webScrollView: UIScrollView,
        isMain: Bool,
        isAnimated: Bool
    )
    @objc optional func webNavigationController(
        _ webNavigationController: WebNavigationController,
        didScrollWebScrollView webScrollView: UIScrollView
    )
    @objc optional func webNavigationController(
        runScrollDebounceTimeout webNavigationController: WebNavigationController
    )
    @objc optional func webNavigationController(
        _ webNavigationController: WebNavigationController,
        didHideTabBarChange hideTabBar: Bool
    )
}

class WebNavigationController: UINavigationController, WKNavigationDelegate, WKUIDelegate,
    WKScriptMessageHandler, WKScriptMessageHandlerWithReply, WKHTTPCookieStoreObserver,
    UIViewTreeObserverDelegate, UIScrollViewDelegate, WebInputAccessoryObserverViewDelegate
{
    #if PRODUCTION_RUN_ENVIRONMENT
        static let baseUrl = URL(string: "https://cyberworlds.dev")!
    #else
        static let baseUrl = URL(string: "http://localhost:3000")!
    #endif

    static private var baseUrlAbsoluteStringWithTrailingSlash = baseUrl.absoluteString + "/"

    // We use abbreviations since there's a character limit in WebKit layer names.
    //
    // - `nmbb` stands for `NativeMobileBottomBar`
    // - `kt` stands for `KeyboardToolbar`
    // - `wkt` stands for `WithKeyboardToolbar`
    static private let bottomBarRegex = try! Regex<(Substring, Substring, Substring?)>(
        " id='(nmbb-(w?kt-)?[^']*)'"
    )

    private let initialPath: String
    private let webConfiguration: WKWebViewConfiguration

    // Called `webDelegate` so we don't override `UINavigationController`'s
    // `delegate` property.
    weak var webDelegate: WebNavigationControllerDelegate?

    private var webView: WKWebView!
    private weak var webInputAccessoryObserverView: WebInputAccessoryObserverView?
    private var webViewTreeObserver: UIViewTreeObserver?
    private var hasInitialWebViewNavigationCommit = false
    private var windowSafeAreaInsets: UIEdgeInsets = .zero
    private var webMaskedViews = [UIView: CALayerMasker]()

    private var webViewHealthState = WebViewHealthState(
        readyTime: nil,
        lastPingTime: nil,
        provisionalNavigation: nil,
        isHealthy: true
    ) {
        didSet {
            let newValue = webViewHealthState

            if (oldValue.isLoading || oldValue.isHealthy)
                != (newValue.isLoading || newValue.isHealthy) && !newValue.isHealthy
            {
                logger.error(
                    "Web view is unhealthy after not receiving a ping for \(newValue.lastPingTime?.distance(to: DispatchTime.now()).toSeconds() ?? Double.nan)s"
                )
            }

            if oldValue.isLoading != newValue.isLoading || oldValue.isHealthy != newValue.isHealthy
            {

                ((modalPresentedViewController ?? topViewController)
                    as! WebNavigationEntryController)
                    .moveWebViewIntoIfHealthyOrElseReplaceWithSnapshotView(
                        webView,
                        healthState: newValue
                    )
            }
        }
    }

    private var webViewHealthTimer: Timer?

    fileprivate struct WebViewHealthState {
        var readyTime: DispatchTime?
        var lastPingTime: DispatchTime?
        var provisionalNavigation: WKNavigation?
        var isHealthy: Bool

        var isLoading: Bool { self.provisionalNavigation != nil || self.readyTime == nil }
    }

    private var webScrollViews = [UIScrollView: WebScrollViewState]()

    private struct WebScrollViewState {
        var isMain: Bool
        let delegateForwarder: UIScrollViewDelegateForwarder
    }

    /// Bottom bars are HTML elements which we optimistially translate in native
    /// code along with native UI like the tab bar or software keyboard for fluid
    /// animations. For an HTML element to be a bottom bar it must:
    ///
    /// 1. Set an `id` that starts with `nmbb-`.
    ///
    /// 2. Set the CSS `will-change: transform` property. (This creates a new
    ///    browser compositing layer which is necessary for our native code to
    ///    separate out the bottom bar element.)
    ///
    /// 3. NOT set the CSS `transform` property since native code will set that
    ///    property. Or set the CSS `transform` property to an initial value that
    ///    assumes the tab bar is up. Native code will override this value. While
    ///    setting an initial CSS transform property is optional we've found it
    ///    fixes a bug where the bottom bar sometimes flashes in on application
    ///    start.
    ///
    /// 4. Set the React `suppressHydrationWarning={true}` prop since our native
    ///    code may update the `transform` property before React hydration
    ///    finishes.
    ///
    /// `<MessageInput>` is an example of a component that meets these criteria.
    private var webBottomBarViews = [UIView: WebBottomBarViewState]()

    private enum WebBottomBarViewType {
        case normal(withKeyboardToolbar: Bool)
        case keyboardToolbar
    }

    private class WebBottomBarViewState {
        let id: String
        let type: WebBottomBarViewType
        var reconcileTimer: Timer?

        private var isAwaiting = false
        private var actionQueue = [() -> Void]()

        init(id: String, type: WebBottomBarViewType, reconcileTimer: Timer?) {
            self.id = id
            self.type = type
            self.reconcileTimer = reconcileTimer
        }

        // This is not thread safe but since it's always called from the main thread we
        // should be fine.
        func withLock(_ action: @escaping () -> Void) {
            if isAwaiting { actionQueue.append(action) } else { action() }
        }

        func withLock(_ action: @escaping (_ completionHandler: @escaping () -> Void) -> Void) {
            let actualAction = { [self] in
                isAwaiting = true

                action { [self] in
                    guard isAwaiting else { return }
                    isAwaiting = false

                    while actionQueue.count > 0 {
                        let action = actionQueue.removeFirst()

                        action()

                        // If `action()` moved us back into an awaiting state then we need to wait for
                        // the action to call its completion handler.
                        if isAwaiting { return }
                    }
                }

            }

            withLock(actualAction)
        }
    }

    private var tabBarScrollOffset = 0.0
    private var navigationBarScrollOffset = 0.0
    private var keyboardOffsetWithoutToolbar = 0.0 {
        didSet {
            // Don't allow popping view controllers while the keyboard is open. You must
            // first close the keyboard before you're allowed to pop. This will disable the
            // native drag from left to pop interaction when the keyboard is open.
            //
            // We primarily do this because our snapshot navigation animation technique
            // won't work when the keyboard is open. Since dragging to pop will close the
            // keyboard we end up taking a snapshot while the keyboard is animating to a
            // closed position which looks broken.
            //
            // However, there are some user experience benefits. If the user is focused on
            // editing a document it'll be good they can't accidentally navigate back with
            // a gesture.
            interactivePopGestureRecognizer?.isEnabled =
                !(keyboardAnimationState != nil || keyboardOffsetWithoutToolbar > 0)
        }
    }

    private var keyboardOffset: Double {
        keyboardOffsetWithoutToolbar
            // If there's a keyboard toolbar then it "covers" the visible rectangle.
            + (webBottomBarViews.contains(where: { (webBottomBarView, webBottomBarViewState) in
                switch webBottomBarViewState.type {
                case .normal(let withKeyboardToolbar): withKeyboardToolbar
                case .keyboardToolbar: true
                }
            }) ? bottomBarKeyboardToolbarHeight : 0)
    }

    private var lastApplicationDidBecomeActiveNotificationTime: DispatchTime?

    private var theme30Color = UIColor(named: "indigo-30")!
    private var theme40Color = UIColor(named: "indigo-40")!
    private var theme50Color = UIColor(named: "indigo-50")!
    private var theme60Color = UIColor(named: "indigo-60")!

    private var hideTabBarCount = 0 {
        didSet {
            let oldHideTabBar = oldValue > 0
            let newHideTabBar = hideTabBarCount > 0

            if oldHideTabBar != newHideTabBar {
                logger.info(
                    "Hide tab bar count updated: \(self.hideTabBarCount) (\(self.hideTabBarCount > 0 ? "hiding" : "showing"))"
                )
            }

            if oldHideTabBar != newHideTabBar {
                webDelegate?.webNavigationController?(self, didHideTabBarChange: newHideTabBar)
            }
        }
    }

    private var keyboardWebSubstituteState = KeyboardWebSubstituteState.closed {
        didSet {
            if case .closed = oldValue {
                if case .closed = keyboardWebSubstituteState {
                    // noop
                } else {
                    hideTabBarCount += 1
                }
            } else {
                if case .closed = keyboardWebSubstituteState { hideTabBarCount -= 1 }
            }
        }
    }

    private enum KeyboardWebSubstituteState {
        case closed
        case opening(oldKeyboardOffset: Double, timer: Timer)
        case opened(oldKeyboardOffset: Double)
    }

    /// If greater than zero then when we report a keyboard frame change we'll
    /// recommend that web code shouldn't scroll. For example, when our substitute
    /// keyboard hides and the text keyboard reappears we don't recommend
    /// scrolling.
    ///
    /// An integer instead of a boolean to help deal with race conditions. If two
    /// concurrent bits of code want to set this to true they can both `+= 1` then
    /// `-= 1`.
    private var shouldDisableScrollFromKeyboardFrameChange = 0

    private var isNavigationAnimating = false
    private var isAfterNavigationAnimationCallbackScheduled = false

    private var keyboardAnimationState: KeyboardAnimationState? = nil {
        didSet {
            // See comment in `keyboardOffsetWithoutToolbar` `didSet` callback.
            interactivePopGestureRecognizer?.isEnabled =
                !(keyboardAnimationState != nil || keyboardOffsetWithoutToolbar > 0)
        }
    }
    private var isAfterKeyboardAnimationCallbackScheduled = false

    private struct KeyboardAnimationState {
        let animationCurve: UInt
        let animationDuration: Double
    }

    /// The navigation entry we've presented modally or null if we haven't
    /// presented a navigation entry modally.
    fileprivate var modalPresentedViewController: WebNavigationEntryController? {
        if let presentedViewController = presentedViewController as? WebNavigationEntryController {
            return presentedViewController
        } else {
            return nil
        }
    }

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
                source: webBridgeSource,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
        )

        // Initialize `client-info` cookie to accurate values. This way the initial
        // server-side rendering is accurate.
        let clientInfo: [String: Any] = [
            "screenWidth": UIScreen.main.bounds.width, "screenHeight": UIScreen.main.bounds.height,
            "timeZone": TimeZone.current.identifier, "locale": "en-US", "isAppleDevice": true,
            "isNativeMobile": true,
        ]

        let clientInfoData = try! JSONSerialization.data(withJSONObject: clientInfo)
        let clientInfoString = String(data: clientInfoData, encoding: .utf8)!
            .addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed)!

        let clientInfoCookie = HTTPCookie(properties: [
            .domain: WebNavigationController.baseUrl.host()!, .path: "/", .name: "client-info",
            .value: clientInfoString,
            .expires: NSDate(timeIntervalSinceNow: TimeInterval(60 * 60 * 24 * 365)),
        ])!

        webConfiguration.websiteDataStore.httpCookieStore.setCookie(clientInfoCookie)

        super.init(nibName: nil, bundle: nil)

        // Web code is responsible for displaying a navigation bar.
        navigationBar.isHidden = true

        // Render content underneath opaque bars like the tab bar. We make sure content
        // isn't hidden by opaque bars in web code.
        extendedLayoutIncludesOpaqueBars = true

        webConfiguration.userContentController.add(self, name: "NativeMobileBridge")
        webConfiguration.userContentController.addScriptMessageHandler(
            self,
            contentWorld: WKContentWorld.page,
            name: "NativeMobileBridgeWithReply"
        )

        initWebView()

        // Tested this with:
        //
        // - Showing the keyboard
        // - Hiding the keyboard
        // - Switching the keyboard to emoji keyboard (different height)
        //
        // May still need to handle `keyboardWillChangeFrameNotification` but at the
        // moment it seems duplicative.
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(keyboardWillShow(notification:)),
            name: UIResponder.keyboardWillShowNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(keyboardDidShow(notification:)),
            name: UIResponder.keyboardDidShowNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(keyboardWillHide(notification:)),
            name: UIResponder.keyboardWillHideNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(keyboardDidHide(notification:)),
            name: UIResponder.keyboardDidHideNotification,
            object: nil
        )

        // We stop making health checks when the application is backgrounded.
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(applicationWillResignActive(notification:)),
            name: UIApplication.willResignActiveNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(applicationDidBecomeActive(notification:)),
            name: UIApplication.didBecomeActiveNotification,
            object: nil
        )

        let url = URL(string: initialPath, relativeTo: WebNavigationController.baseUrl)!
        let request = URLRequest(url: url)
        webView.load(request)

        let rootViewController = WebNavigationEntryController(
            url: url,
            webNavigationController: self,
            webView: webView,
            healthState: webViewHealthState
        )
        viewControllers = [rootViewController]

        initWebViewHealthTimer()
    }

    required init(coder: NSCoder) { fatalError("Unimplemented") }

    deinit {
        webViewHealthTimer?.invalidate()
        webViewHealthTimer = nil

        NotificationCenter.default.removeObserver(
            self,
            name: UIResponder.keyboardWillShowNotification,
            object: nil
        )
        NotificationCenter.default.removeObserver(
            self,
            name: UIResponder.keyboardDidShowNotification,
            object: nil
        )
        NotificationCenter.default.removeObserver(
            self,
            name: UIResponder.keyboardWillHideNotification,
            object: nil
        )
        NotificationCenter.default.removeObserver(
            self,
            name: UIResponder.keyboardDidHideNotification,
            object: nil
        )

        NotificationCenter.default.removeObserver(
            self,
            name: UIApplication.willResignActiveNotification,
            object: nil
        )
        NotificationCenter.default.removeObserver(
            self,
            name: UIApplication.didBecomeActiveNotification,
            object: nil
        )
    }

    private func initWebView() {
        guard self.webView == nil else { fatalError("`webView` already exists") }

        let webView = WKWebView(frame: view.bounds, configuration: webConfiguration)
        self.webView = webView
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.navigationDelegate = self
        webView.uiDelegate = self

        // Don't show white background color while content is loading.
        // https://stackoverflow.com/questions/27655930/how-can-i-give-wkwebview-a-colored-background
        webView.isOpaque = false

        // Use the space theme color as the tint color. The tint color will be used as
        // the selection and caret color among other things.
        webView.tintColor = initThemeTintColor()

        // Don't allow zooming.
        webView.scrollView.minimumZoomScale = 1
        webView.scrollView.maximumZoomScale = 1

        // Remove the accessory view with arrow up/down and "done" buttons. While
        // useful for web forms, users don't expect this in a native mobile app.
        let webInputAccessoryObserverView = WebInputAccessoryObserverView(frame: .zero)
        webInputAccessoryObserverView.delegate = self
        self.webInputAccessoryObserverView = webInputAccessoryObserverView
        swizzleWKWebView(webView, customInputAccessoryView: webInputAccessoryObserverView)

        // Completely disable iOS WebKit's software keyboard handling. It's a mess. See
        // `useMobileWebKitKeyboardSupport()` in `s.$spaceId.tsx` for how we make it
        // work in the Safari browser which we don't control. However, in our native
        // mobile app we have pretty broad control. We'll manually implement keyboard
        // support from here.
        //
        // I got the idea from this StackOverflow question:
        // https://stackoverflow.com/a/63136483/1568890
        //
        // Then I looked at the WebKit source code to get a comprehensive list of
        // keyboard notifications WebKit observes:
        // https://github.com/WebKit/WebKit/blob/39f36da26b7671d55bc256f852cc652255d1328b/Source/WebKit/UIProcess/API/ios/WKWebViewIOS.mm#L212-L216
        NotificationCenter.default.removeObserver(
            webView,
            name: UIResponder.keyboardWillChangeFrameNotification,
            object: nil
        )
        NotificationCenter.default.removeObserver(
            webView,
            name: UIResponder.keyboardDidChangeFrameNotification,
            object: nil
        )
        NotificationCenter.default.removeObserver(
            webView,
            name: UIResponder.keyboardWillShowNotification,
            object: nil
        )
        NotificationCenter.default.removeObserver(
            webView,
            name: UIResponder.keyboardDidShowNotification,
            object: nil
        )
        NotificationCenter.default.removeObserver(
            webView,
            name: UIResponder.keyboardWillHideNotification,
            object: nil
        )

        // Enable developer tool usage in development environments.
        #if DBG_COMPILATION_MODE || DEVELOPMENT_RUN_ENVIRONMENT
            if #available(iOS 16.4, *) { webView.isInspectable = true }
        #endif

        webViewTreeObserver = UIViewTreeObserver(delegate: self, rootView: webView)

        // When we initialize the web view, it's a child of our navigation controller
        // but hidden. It's revealed when we add it to a navigation stack entry. The
        // web view needs to be in our window for `requestAnimationFrame()` to run.
        // Otherwise the web view is considered backgrounded. `requestAnimationFrame()`
        // must run because we use it to initialize the UI (e.g. the `<script>` in
        // `<VirtualizedScrollView>`).
        webView.isHidden = true
        view.addSubview(webView)
    }

    private func initThemeTintColor() -> UIColor {
        return UIColor { [self] (traits) in
            traits.userInterfaceStyle == .dark ? theme60Color : theme40Color
        }
    }

    private func initWebViewHealthTimer() {
        self.webViewHealthTimer?.invalidate()
        self.webViewHealthTimer = nil

        // If we haven't received a ping from the web view in 1s then we consider the
        // web view unhealthy and ask the user to reload. If we aren't getting pings it
        // means our JavaScript code or React code has crashed. We should receive a
        // ping from our web view every 0.5s.
        let webViewHealthTimer = Timer(timeInterval: 0.5, repeats: true) { [self] (_) in
            if let lastPingTime = webViewHealthState.lastPingTime {
                if lastPingTime.distance(to: DispatchTime.now()).toSeconds() > 1 {
                    webViewHealthState.isHealthy = false
                }
            } else if let readyTime = webViewHealthState.readyTime {
                let currentTime = DispatchTime.now()

                let hasReadyTimeExpired = readyTime.distance(to: currentTime).toSeconds() > 5

                // When backgrounded we may stop receiving pings from the web view. So when our
                // application becomes active again, wait a bit for pings from the web view to
                // resume.
                let hasApplicationRecentlyBecameActive =
                    if let notificationTime = lastApplicationDidBecomeActiveNotificationTime {
                        notificationTime > readyTime
                            && notificationTime.distance(to: currentTime).toSeconds() <= 2
                    } else { false }

                if hasReadyTimeExpired && !hasApplicationRecentlyBecameActive {
                    webViewHealthState.isHealthy = false
                }
            }
        }
        self.webViewHealthTimer = webViewHealthTimer

        // Tolerance to reduce energy impact of timer. The maximium time it will take
        // to detect an unhealthy web view is 1.6s (`timeInterval * 3 + tolerance`).
        webViewHealthTimer.tolerance = 0.1

        // We need to add our timer to the common run loop mode so it can execute
        // even while a gesture is occuring.
        //
        // For more information about run loops:
        // https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/Multithreading/RunLoopManagement/RunLoopManagement.html
        RunLoop.current.add(webViewHealthTimer, forMode: .common)
    }

    /// Force reload our web view. If the web view is completely unresponsive (e.g.
    /// the main JavaScript thread is blocked) then we need to completely destroy
    /// our `WKWebView` instance and create a new one.
    ///
    /// Calling `webView.reload()` when the JavaScript thread is blocked doesn't
    /// seem to work.
    fileprivate func forceReloadWebView() {
        logger.info("Force reloading")

        let url = webView.url

        webInputAccessoryObserverView?.removeFromSuperview()
        webInputAccessoryObserverView = nil
        webView.removeFromSuperview()
        webView.navigationDelegate = nil
        webView.uiDelegate = nil
        hasInitialWebViewNavigationCommit = false
        webScrollViews = [:]
        webBottomBarViews = [:]
        webViewTreeObserver = nil
        webView = nil

        initWebView()

        webViewHealthState = WebViewHealthState(
            readyTime: nil,
            lastPingTime: nil,
            provisionalNavigation: nil,
            isHealthy: true
        )

        if let url = url { webView.load(URLRequest(url: url)) }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async
        -> WKNavigationActionPolicy
    {
        let requestUrl = navigationAction.request.url!
        let requestUrlAbsoluteString = requestUrl.absoluteString

        // Always open URLs outside of `baseUrl` with the app signed up to handle
        // the URL. (`https://` URLs typically open in Safari.)
        if !requestUrlAbsoluteString.starts(
            with: WebNavigationController.baseUrlAbsoluteStringWithTrailingSlash
        ) && requestUrlAbsoluteString != WebNavigationController.baseUrl.absoluteString {
            await UIApplication.shared.open(requestUrl)
            return .cancel
        }

        return .allow
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        let requestUrl = navigationAction.request.url!

        // Respond to `window.open()` calls by opening the URL in Safari (or another
        // app that handles the URL).
        //
        // We should consider opening an in-app browser instead so the user doesn't
        // have to leave our app. Or maybe we always open in Safari? So if they're
        // already logged in we can reuse that session state.
        UIApplication.shared.open(requestUrl)

        return nil
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        logger.info("Started navigation to: \(webView.url?.absoluteString ?? "nil")")

        cleanupModalPresentedViewController()

        // Dismiss any other presented view controllers (like alerts) on reload.
        dismiss(animated: false)

        webViewHealthState.provisionalNavigation = navigation
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        logger.info("Committed navigation to: \(webView.url?.absoluteString ?? "nil")")

        if webViewHealthState.provisionalNavigation === navigation {
            // Reset health state now that we have a new navigation.
            webViewHealthState.readyTime = nil
            webViewHealthState.lastPingTime = nil
            webViewHealthState.isHealthy = true

            webViewHealthState.provisionalNavigation = nil
        }

        hasInitialWebViewNavigationCommit = true

        // We need to execute the JavaScript to set the CSS safe area inset variables
        // but we don't need to call `setAllWebScrollViewScrollIndicatorInsets()`
        // again.
        actuallySetWindowSafeAreaInsets(windowSafeAreaInsets)

        // If we finished a new navigation then web code won't know it needs to
        // reset the substitute opened by the previous web process. Reset it here.
        cleanupAfterKeyboardWebSubstitute()

        // Reset any `hideTabBar()` calls after we finish loading.
        hideTabBarCount = 0
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptTextInputPanelWithPrompt prompt: String,
        defaultText: String?,
        initiatedByFrame frame: WKFrameInfo
    ) async -> String? {
        // Ignore messages from an unhealthy web view.
        if webViewHealthState.isLoading || !webViewHealthState.isHealthy { return nil }

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
            cleanupModalPresentedViewController()

            isNavigationAnimating = true

            // Beware! If `NativeMobileBridge.navigation.push()` is not promptly called the
            // app will appear frozen.
            (topViewController! as! WebNavigationEntryController).replaceWebViewWithSnapshotView()

            return nil
        } else if prompt == "%%%navigation.preparePop" {
            cleanupModalPresentedViewController()

            isNavigationAnimating = true

            // Beware! If `NativeMobileBridge.navigation.pop()` is not promptly called the
            // app will appear frozen.
            (topViewController! as! WebNavigationEntryController).replaceWebViewWithSnapshotView()

            return nil
        } else if prompt == "%%%navigation.preparePresentModal" {
            cleanupModalPresentedViewController()

            isNavigationAnimating = true

            // Beware! If `NativeMobileBridge.navigation.presentModal()` is not promptly called
            // the app will appear frozen.
            (topViewController! as! WebNavigationEntryController).replaceWebViewWithSnapshotView()
            return nil
        } else if prompt == "%%%navigation.prepareDismissModal" {
            isNavigationAnimating = true

            if let modalPresentedViewController = modalPresentedViewController {
                // Beware! If `NativeMobileBridge.navigation.dismissModal()` is not promptly
                // called the app will appear frozen.
                modalPresentedViewController.replaceWebViewWithSnapshotView()
            }
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
        guard message.name == "NativeMobileBridge",
            let originalMessageBody = message.body as? NSString
        else { return }

        let messageBody = originalMessageBody as String

        // Ignore messages from an unhealthy web view.
        if (webViewHealthState.isLoading || !webViewHealthState.isHealthy)
            && messageBody != "health.ready"
        {
            return
        }

        if messageBody.starts(with: "navigation.push:") {
            cleanupModalPresentedViewController()

            let urlString = messageBody.suffix(
                from: messageBody.index(messageBody.startIndex, offsetBy: 16)
            )
            let url = URL(string: String(urlString))!

            let viewController = WebNavigationEntryController(
                url: url,
                webNavigationController: self,
                webView: webView,
                healthState: webViewHealthState
            )

            super.pushViewController(viewController, animated: true)

            let completion = { [self] in
                isNavigationAnimating = false

                if isAfterNavigationAnimationCallbackScheduled {
                    isAfterNavigationAnimationCallbackScheduled = false
                    webView.evaluateJavaScript(
                        "window.__NativeMobileBridge.navigation._callScheduledAfterAnimationCallbacks()"
                    )
                }
            }

            // Call completion after push animation. Derived from:
            // https://stackoverflow.com/a/33767837/1568890
            if let transitionCoordinator = transitionCoordinator {
                transitionCoordinator.animate(alongsideTransition: nil) { _ in completion() }
            } else {
                DispatchQueue.main.async { completion() }
            }
        } else if messageBody == "navigation.finishExternalPop" {
            cleanupModalPresentedViewController()

            (topViewController! as! WebNavigationEntryController).moveWebViewInto(webView)
        } else if messageBody.starts(with: "navigation.pop:") {
            cleanupModalPresentedViewController()

            let urlString = messageBody.suffix(
                from: messageBody.index(messageBody.startIndex, offsetBy: 15)
            )
            let url = URL(string: String(urlString))!

            let viewController = viewControllers.last(where: { (viewController) in
                (viewController as! WebNavigationEntryController).url.absoluteString
                    == url.absoluteString
            })

            let completion = { [self] in
                isNavigationAnimating = false

                if isAfterNavigationAnimationCallbackScheduled {
                    isAfterNavigationAnimationCallbackScheduled = false
                    webView.evaluateJavaScript(
                        "window.__NativeMobileBridge.navigation._callScheduledAfterAnimationCallbacks()"
                    )
                }
            }

            if let viewController = viewController {
                (viewController as! WebNavigationEntryController).moveWebViewInto(webView)

                if viewController != topViewController {
                    // Important to call `super.popToViewController()` since we don't want our
                    // class's override to start an external pop.
                    super.popToViewController(viewController, animated: true)

                    // Call completion after pop animation. Derived from:
                    // https://stackoverflow.com/a/33767837/1568890
                    if let transitionCoordinator = transitionCoordinator {
                        transitionCoordinator.animate(alongsideTransition: nil) { _ in completion()
                        }
                    } else {
                        DispatchQueue.main.async { completion() }
                    }
                } else {
                    completion()
                }
            } else {
                // If we couldn't find the view controller to pop to, then set the top view
                // controller as the popped route.
                //
                // NOTE(calebmer): This branch really shouldn't happen. I'm not sure if this is
                // the best default if it does, though. If we find a valid use case where this
                // branch is executed then reconsider this behavior.
                (topViewController! as! WebNavigationEntryController).url = url
                (topViewController! as! WebNavigationEntryController).moveWebViewInto(webView)

                completion()
            }
        } else if messageBody.starts(with: "navigation.replace:") {
            let urlString = messageBody.suffix(
                from: messageBody.index(messageBody.startIndex, offsetBy: 19)
            )
            let url = URL(string: String(urlString))!

            // If the modal view controller is open it represents the same navigation stack
            // entry as the top view controller. When the modal is dismissed the top view
            // controller will be reinstated as the main view controller for the navigation
            // stack entry.
            if let modalPresentedViewController = modalPresentedViewController {
                modalPresentedViewController.url = url
            }
            (topViewController! as! WebNavigationEntryController).url = url
        } else if messageBody == "navigation.presentModal" {
            cleanupModalPresentedViewController()

            let viewController = WebNavigationEntryController(
                url: (topViewController! as! WebNavigationEntryController).url,
                webNavigationController: self,
                webView: webView,
                healthState: webViewHealthState
            )

            present(viewController, animated: true) { [self] in
                isNavigationAnimating = false

                if isAfterNavigationAnimationCallbackScheduled {
                    isAfterNavigationAnimationCallbackScheduled = false
                    webView.evaluateJavaScript(
                        "window.__NativeMobileBridge.navigation._callScheduledAfterAnimationCallbacks()"
                    )
                }
            }
        } else if messageBody == "navigation.dismissModal" {
            (topViewController as! WebNavigationEntryController).moveWebViewInto(webView)

            if modalPresentedViewController != nil {
                dismiss(animated: true) { [self] in
                    isNavigationAnimating = false

                    if isAfterNavigationAnimationCallbackScheduled {
                        isAfterNavigationAnimationCallbackScheduled = false
                        webView.evaluateJavaScript(
                            "window.__NativeMobileBridge.navigation._callScheduledAfterAnimationCallbacks()"
                        )
                    }
                }
            }
        } else if messageBody == "navigation.scheduleAfterAnimation" {
            if !isNavigationAnimating {
                isAfterNavigationAnimationCallbackScheduled = false
                webView.evaluateJavaScript(
                    "window.__NativeMobileBridge.navigation._callScheduledAfterAnimationCallbacks()"
                )
            } else {
                isAfterNavigationAnimationCallbackScheduled = true
            }
        } else if messageBody == "keyboard.scheduleAfterAnimation" {
            // NOTE(calebmer): This function is called after an inlined
            // `scheduleAfterNextBrowserPaint()`. since I've observed WebKit doesn't start
            // hiding the keyboard until the paint following the `blur` event.

            if keyboardAnimationState == nil {
                isAfterKeyboardAnimationCallbackScheduled = false
                webView.evaluateJavaScript(
                    "window.__NativeMobileBridge.keyboard._callScheduledAfterAnimationCallbacks()"
                )
            } else {
                isAfterKeyboardAnimationCallbackScheduled = true
            }
        } else if messageBody == "navigationBar.runScrollDebounceTimeout" {
            webDelegate?.webNavigationController?(runScrollDebounceTimeout: self)
        } else if messageBody == "health.ready" {
            webViewHealthState.readyTime = DispatchTime.now()
        } else if messageBody == "health.ping" {
            webViewHealthState.lastPingTime = DispatchTime.now()
        } else if messageBody.starts(with: "colors.setThemeColors:") {
            let colorsString = messageBody.suffix(
                from: messageBody.index(messageBody.startIndex, offsetBy: 22)
            )
            let colorStrings = colorsString.split(separator: ",")

            let colors = colorStrings.map({ (colorString) -> UIColor? in
                let scanner = Scanner(string: String(colorString.dropFirst(1)))
                var hexInt: UInt64 = 0

                if !scanner.scanHexInt64(&hexInt) { return nil }

                let red = CGFloat((hexInt & 0xff0000) >> 16) / 255
                let green = CGFloat((hexInt & 0x00ff00) >> 8) / 255
                let blue = CGFloat((hexInt & 0x0000ff) >> 0) / 255

                return UIColor(red: red, green: green, blue: blue, alpha: 1.0)
            })

            theme30Color = (colors.count >= 1 ? colors[0] : nil) ?? UIColor(named: "indigo-30")!
            theme40Color = (colors.count >= 2 ? colors[1] : nil) ?? UIColor(named: "indigo-40")!
            theme50Color = (colors.count >= 3 ? colors[2] : nil) ?? UIColor(named: "indigo-50")!
            theme60Color = (colors.count >= 4 ? colors[2] : nil) ?? UIColor(named: "indigo-60")!

            // Use the space theme color as the tint color. The tint color will be used as
            // the selection and caret color among other things.
            //
            // We set it again here so the web view re-renders?
            webView.tintColor = initThemeTintColor()
        } else if messageBody.starts(with: "modal.presentDialog:") {
            let optionsString = messageBody.suffix(
                from: messageBody.index(messageBody.startIndex, offsetBy: 20)
            )

            let decoder = JSONDecoder()
            let options = try! decoder.decode(
                WebBridgeModalPresentDialogOptions.self,
                from: optionsString.data(using: .utf8)!
            )

            let alertController = UIAlertController(
                title: options.title,
                message: options.description,
                preferredStyle: .alert
            )

            if !(options.shouldHideCancelButton ?? false) {
                alertController.addAction(
                    UIAlertAction(
                        title: options.cancelButtonLabel ?? "Cancel",
                        style: .cancel,
                        handler: { [self] (_) in
                            webView.evaluateJavaScript(
                                "window.__NativeMobileBridge._callCallbackById(\(options.onCancelButtonPressCallbackId))"
                            )
                        }
                    )
                )
            }

            let primaryAction = UIAlertAction(
                title: options.primaryButtonLabel,
                style: .default,
                handler: { [self] (_) in
                    webView.evaluateJavaScript(
                        "window.__NativeMobileBridge._callCallbackById(\(options.onPrimaryButtonPressCallbackId))"
                    )
                }
            )
            if options.isPrimaryButtonDisabled ?? false { primaryAction.isEnabled = false }
            alertController.addAction(primaryAction)
            alertController.preferredAction = primaryAction

            // TODO(calebmer): What happens in the case of conflicting presented view
            // controllers? How the presentation system works with multiple `present()`
            // calls is a little confusing to me. I'd love to create our own presenter
            // system that can confidentally handle multiple presented view controllers.
            (modalPresentedViewController ?? topViewController)!
                .present(alertController, animated: true)
        } else if messageBody == "editMenu.enableAddCommentAction" {
            setSwizzledWKWebViewAddCommentEditMenuAction(
                webView,
                action: { [self] in
                    webView.evaluateJavaScript(
                        "window.__NativeMobileBridge.editMenu._callAddCommentActionListeners()"
                    )
                }
            )
        } else if messageBody == "editMenu.disableAddCommentAction" {
            setSwizzledWKWebViewAddCommentEditMenuAction(webView, action: nil)
        } else if messageBody == "navigationBar.hideTabBar" {
            hideTabBarCount += 1
        } else if messageBody == "navigationBar.showTabBar" {
            hideTabBarCount -= 1
        } else {
            logger.warning("Received unrecognized message from web view: \(messageBody)")
        }
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        guard message.name == "NativeMobileBridgeWithReply",
            let originalMessageBody = message.body as? NSString
        else { return }

        let messageBody = originalMessageBody as String

        // Ignore messages from an unhealthy web view.
        if webViewHealthState.isLoading || !webViewHealthState.isHealthy { return }

        if messageBody == "keyboard.prepareForSubstitute" {
            prepareForKeyboardWebSubstitute { replyHandler(nil, nil) }
        } else if messageBody == "keyboard.cleanupAfterSubstitute" {
            cleanupAfterKeyboardWebSubstitute { replyHandler(nil, nil) }
        } else {
            logger.warning("Received unrecognized message from web view: \(messageBody)")

            // Don't call `replyHandler()`. We don't want to return a value that will cause
            // a crash.
        }
    }

    func viewTreeObserver(_ viewTreeObserver: UIViewTreeObserver, didAdd webSubview: UIView) {
        // When this function is called with a `webSubview`, WebKit may not have
        // finished initializing everything. So properties like `view.frame` and
        // `view.layer.name` haven't been set.
        //
        // However, for some work we do (e.g. setting scroll indicator insets needs
        // `view.frame`) we need all properties to be initialized. Wait until the
        // current call stack is finished so everything is initialized. (Assuming
        // initialization finishes in this callstack.)
        //
        // NOTE(calebmer): Effectively, what I want here is the equivalent of
        // `scheduleMicrotask()` in JavaScript. The best option I found after a bit of
        // research is using [GCD][1]. The main dispatch queue is a serial FIFO queue
        // and we should currently be running on the main thread.
        //
        // [1]: https://developer.apple.com/documentation/DISPATCH
        let schedule = { (execute: @escaping () -> Void) in
            DispatchQueue.main.async(execute: execute)
        }

        // Don't include `webView.scrollView` in `webScrollViews`.
        if let webScrollView = webSubview as? UIScrollView, webScrollView !== webView.scrollView {
            let isAnimated = isNavigationAnimating || transitionCoordinator != nil

            webScrollViews[webScrollView] = WebScrollViewState(
                // Can't know whether this is a main scroll view until after `schedule`.
                isMain: false,
                delegateForwarder: UIScrollViewDelegateForwarder(
                    scrollView: webScrollView,
                    delegate: self
                )
            )

            schedule { [self] in
                // Make sure scroll view wasn't removed.
                guard webScrollViews[webScrollView] != nil else { return }

                // There may be other scroll views on our web page but we need to decide what
                // the "main" scroll view is so that as it scrolls we can show/hide the tab
                // bar, dismiss the keyboard, and more.
                //
                // So we use a simple "is this scroll view big enough?" heuristic. For instance
                // in chat the main messaging section is big enough to be the main scroll view
                // but not the message input. This may not work in general but is practical
                // for our purposes.
                //
                // The root scroll view may not be the main scroll view since the root scroll
                // view shouldn't be scrollable.
                let isMain =
                    webScrollView.frame.width >= view.frame.width * 0.5
                    // 200px is selected to exclude the document comment thread bottom sheet that
                    // opens when you tap a comment.
                    && webScrollView.frame.height >= view.frame.height - 200

                webScrollViews[webScrollView]!.isMain = isMain

                if isMain { setMainWebScrollViewScrollIndicatorInsets(webScrollView) }

                // The main scrollbar pushes the keyboard down when it scrolls.
                if isMain { webScrollView.keyboardDismissMode = .interactive }

                webDelegate?.webNavigationController?(
                    self,
                    didAddWebScrollView: webScrollView,
                    isMain: isMain,
                    isAnimated: isAnimated
                )
            }
        }

        // We want to find compositing layers with an ID prefix of `nmbb-`. We will
        // animate these `UIView`s with the software keyboard and tab bar to make sure
        // we see smooth animations. We can find the element ID that created the
        // compositing layer in the layer name. An example layer name:
        //
        // ```
        // RenderBlock 0x136339300 DIV 0x10dff9d50 id='nmbb-:Raml6:' class='sprinkles_flexShri...
        // ```
        //
        // ([The layer name is also appended to the view description][1].)
        //
        // The code that builds the name starts in the WebKit source code with
        // [`appendAttributes()` in `Element.cpp`][2]. `Element` inherits from
        // `ContainerNode` which inherits from `Node`. [`RenderObject.cpp` then calls
        // `node()->description()`][3]. This string ends up being set to the
        // `CALayer`'s `name` property.
        //
        // `name` isn't initialized until after this callstack so we need to call
        // `schedule`.
        //
        // In order for web code to force the creation of a compositing layer, web code
        // can add the CSS property `will-change: transform`. However,
        // `will-change: transform` should be used sparingly! Or else the cost of
        // rendering the web page will increase.
        //
        // [1]: https://github.com/WebKit/WebKit/blob/b3b7144bd152111660f81e9aecb76b0a4a8642ab/Source/WebKit/UIProcess/RemoteLayerTree/ios/RemoteLayerTreeViews.mm#L334-L337
        // [2]: https://github.com/WebKit/WebKit/blob/6c1979d64380ab4eedf703a4dd4f92eca1e61515/Source/WebCore/dom/Element.cpp#L3173-L3217
        // [3]: https://github.com/WebKit/WebKit/blob/6c1979d64380ab4eedf703a4dd4f92eca1e61515/Source/WebCore/rendering/RenderObject.cpp#L2706-L2715
        if type(of: webSubview).description() == "WKCompositingView" {
            let webBottomBarView = webSubview

            schedule { [self] in
                if let match = try! WebNavigationController.bottomBarRegex.firstMatch(
                    in: (webSubview.layer.name ?? "")
                ) {
                    let webBottomBarViewType: WebBottomBarViewType =
                        if let typeMatch = match.2 {
                            if typeMatch == "wkt-" {
                                .normal(withKeyboardToolbar: true)
                            } else {
                                .keyboardToolbar
                            }
                        } else { .normal(withKeyboardToolbar: false) }

                    let webBottomBarViewState = WebBottomBarViewState(
                        id: String(match.1),
                        type: webBottomBarViewType,
                        reconcileTimer: nil
                    )

                    webBottomBarViews[webBottomBarView] = webBottomBarViewState

                    updateWebBottomBarFrame(webBottomBarView, webBottomBarViewState)
                    setAllMainWebScrollViewScrollIndicatorInsets()
                }
            }
        }

        // `WKContentView` is the root view of `WKWebView` and manages most integration
        // of UI interactions with web code. It implements [`UITextInput`][1] (and
        // [`BETextInput`][2] when BrowserEngineKit is used). It is also returned as
        // [`textInputView`][3] (from the `UITextInput` protocol). So the UI for
        // rendering selections are added as subviews to `WKContentView`. This means
        // selection UI renders on top of all web content! This is problematic because
        // Our web content has a navigation bar and toolbar that should occlude the
        // text editor underneath. But if the selection UI intersects with the toolbar
        // it renders on top of the toolbar!
        //
        // Coincidentally, we've observed that none of the selection UI views added to
        // `WKContentView` have a [`CALayer.mask`][4] property. So we add a mask that
        // clips the selection to our text editor! Excluding the navigation bar and
        // toolbar.
        //
        // This is certainly a clever trick, ideally selection UI would naturally be
        // rendered in the same `WKCompositingView` (or whatever) as the text editor so
        // it has proper z-ordering. But we don't get that luxury and have to integrate
        // with the text editing system Apple has provided.
        //
        // [1]: https://developer.apple.com/documentation/uikit/uitextinput
        // [2]: https://developer.apple.com/documentation/browserenginekit/betextinput
        // [3]: https://developer.apple.com/documentation/uikit/uitextinput/1614564-textinputview
        // [4]: https://developer.apple.com/documentation/quartzcore/calayer/1410861-mask
        if let webSuperview = webSubview.superview
            // `webSubview.superview` may not be set yet at this point but `superlayer`
            // will be set (view observer works by observing changes to the layer tree). So
            // grab the superview from `superlayer.delegate`.
            ?? webSubview.layer.superlayer?.delegate as? UIView,
            type(of: webSuperview).description() == "WKContentView_Custom"
                && webSubview.layer.name != "FixedClipping"
        {
            let layerMasker = CALayerMasker(
                layer: webSubview.layer,
                maskSuperlayerRect: getWebMaskedViewsMaskRect()
            )
            webMaskedViews[webSubview] = layerMasker
        }
    }

    func viewTreeObserver(_ viewTreeObserver: UIViewTreeObserver, didRemove webSubview: UIView) {
        // We may need this to match the timing of tasks queued by `viewTreeObserver(didAdd:)`.
        let schedule = { (execute: @escaping () -> Void) in
            DispatchQueue.main.async(execute: execute)
        }

        if let webScrollView = webSubview as? UIScrollView, webScrollView !== webView.scrollView {
            webScrollViews.removeValue(forKey: webScrollView)
        }

        // Remove with `schedule` to prevent race conditions. If
        // `viewTreeObserver(didAdd:)` is called then `viewTreeObserver(didRemove:)` is
        // called immediately after, the scheduled block from
        // `viewTreeObserver(didAdd:)` may not have been run.
        if type(of: webSubview).description() == "WKCompositingView" {
            schedule { [self] in
                if let _ = try! WebNavigationController.bottomBarRegex.firstMatch(
                    in: (webSubview.layer.name ?? "")
                ) {
                    let webBottomBarViewState = webBottomBarViews.removeValue(forKey: webSubview)
                    webBottomBarViewState?.reconcileTimer?.invalidate()
                    webBottomBarViewState?.reconcileTimer = nil

                    setAllMainWebScrollViewScrollIndicatorInsets()
                }
            }
        }

        if let webSuperview = webSubview.superview ?? webSubview.layer.superlayer?.delegate
            as? UIView,
            type(of: webSuperview).description() == "WKContentView_Custom"
                && webSubview.layer.name != "FixedClipping"
        {
            webMaskedViews.removeValue(forKey: webSubview)
        }
    }

    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        webDelegate?.webNavigationController?(self, didScrollWebScrollView: scrollView)
    }

    @objc private func keyboardWillShow(notification: NSNotification) {
        // `keyboardOffset` (which this function call uses) is updated in
        // `webInputAccessoryObserverView(_:didMoveTo:)`. This method happens to run
        // after that method.
        setAllMainWebScrollViewScrollIndicatorInsets()

        let screen = notification.object as! UIScreen
        let beginScreenFrame =
            (notification.userInfo![UIResponder.keyboardFrameBeginUserInfoKey] as! NSValue)
            .cgRectValue
        let endScreenFrame =
            (notification.userInfo![UIResponder.keyboardFrameEndUserInfoKey] as! NSValue)
            .cgRectValue
        let animationCurve =
            (notification.userInfo![UIResponder.keyboardAnimationCurveUserInfoKey] as! UInt)
        let animationDuration =
            (notification.userInfo![UIResponder.keyboardAnimationDurationUserInfoKey] as! Double)

        keyboardAnimationState = KeyboardAnimationState(
            animationCurve: animationCurve,
            animationDuration: animationDuration
        )

        // As a backup, call our delegate method when the keyboard opens/closes. While
        // the observer view should call `webInputAccessoryObserverView(_:didMoveTo:)`
        // when the keyboard opens/closes we observe sometimes in practice we don't get
        // the animation. Calling `webInputAccessoryObserverView(_:didMoveTo:)` twice
        // with identical keyboard offset is a noop.
        webInputAccessoryObserverView(
            nil,
            didMoveTo: screen.coordinateSpace.bounds.height - endScreenFrame.origin.y
        )

        // While the keyboard is opening:
        //
        // 1. Add extra bottom safe area inset
        // 2. Scroll the content to continue showing whatever was underneath the
        //    keyboard
        //
        // The scroll animation will not be perfectly synced with the keyboard
        // animation. This is fine. It will appear as if the content is "reacting" to
        // the keyboard (e.g. the keyboard is pushing the content up). The iMessage
        // keyboard open animation is like this.
        updateWebViewSafeAreaInsets(
            alsoCallFrameChangeListeners: (
                screen.coordinateSpace.bounds.height - beginScreenFrame.origin.y,
                screen.coordinateSpace.bounds.height - endScreenFrame.origin.y,
                shouldDisableScrollFromKeyboardFrameChange == 0,
                UIView.inheritedAnimationDuration > 0
            )
        )
    }

    @objc private func keyboardDidShow(notification: NSNotification) {
        keyboardAnimationState = nil

        if isAfterKeyboardAnimationCallbackScheduled {
            isAfterKeyboardAnimationCallbackScheduled = false
            webView.evaluateJavaScript(
                "window.__NativeMobileBridge.keyboard._callScheduledAfterAnimationCallbacks()"
            )
        }
    }

    @objc private func keyboardWillHide(notification: NSNotification) {
        // `keyboardOffset` (which this function call uses) is updated in
        // `webInputAccessoryObserverView(_:didMoveTo:)`. This method happens to run
        // after that method.
        setAllMainWebScrollViewScrollIndicatorInsets()

        let screen = notification.object as! UIScreen
        let beginScreenFrame =
            (notification.userInfo![UIResponder.keyboardFrameBeginUserInfoKey] as! NSValue)
            .cgRectValue
        let endScreenFrame =
            (notification.userInfo![UIResponder.keyboardFrameEndUserInfoKey] as! NSValue)
            .cgRectValue
        let animationCurve =
            (notification.userInfo![UIResponder.keyboardAnimationCurveUserInfoKey] as! UInt)
        let animationDuration =
            (notification.userInfo![UIResponder.keyboardAnimationDurationUserInfoKey] as! Double)

        keyboardAnimationState = KeyboardAnimationState(
            animationCurve: animationCurve,
            animationDuration: animationDuration
        )

        // As a backup, call our delegate method when the keyboard opens/closes. While
        // the observer view should call `webInputAccessoryObserverView(_:didMoveTo:)`
        // when the keyboard opens/closes we observe sometimes in practice we don't get
        // the animation. Calling `webInputAccessoryObserverView(_:didMoveTo:)` twice
        // with identical keyboard offset is a noop.
        webInputAccessoryObserverView(
            nil,
            didMoveTo: screen.coordinateSpace.bounds.height - endScreenFrame.origin.y
        )

        let args = [
            "\(screen.coordinateSpace.bounds.height - beginScreenFrame.origin.y)",
            "\(screen.coordinateSpace.bounds.height - endScreenFrame.origin.y)",
            "\(shouldDisableScrollFromKeyboardFrameChange == 0)",
            "\(UIView.inheritedAnimationDuration > 0)",
        ]
        .joined(separator: ", ")

        // Start animating the main content down but don't remove safe area insets
        // until the keyboard is fully hidden.
        webView.evaluateJavaScript(
            "window.__NativeMobileBridge.keyboard._callFrameChangeListeners(\(args))"
        )
    }

    @objc private func keyboardDidHide(notification: NSNotification) {
        var shouldCallScheduledAfterKeyboardAnimationCallbacks = false
        keyboardAnimationState = nil

        if isAfterKeyboardAnimationCallbackScheduled {
            isAfterKeyboardAnimationCallbackScheduled = false
            shouldCallScheduledAfterKeyboardAnimationCallbacks = true
        }

        // Once the keyboard is fully hidden, now we update safe area insets so they
        // don't include space for the keyboard anymore.
        updateWebViewSafeAreaInsets(
            alsoCallFrameChangeListeners: nil,
            completion: shouldCallScheduledAfterKeyboardAnimationCallbacks
                ? { [self] in
                    webView.evaluateJavaScript(
                        "window.__NativeMobileBridge.keyboard._callScheduledAfterAnimationCallbacks()"
                    )
                } : nil
        )
    }

    fileprivate func webInputAccessoryObserverView(
        _ webInputAccessoryObserverView: WebInputAccessoryObserverView?,
        didMoveTo keyboardOffsetWithoutToolbar: Double
    ) {
        let lastKeyboardOffsetWithoutToolbar = self.keyboardOffsetWithoutToolbar
        guard lastKeyboardOffsetWithoutToolbar != keyboardOffsetWithoutToolbar else { return }
        self.keyboardOffsetWithoutToolbar = keyboardOffsetWithoutToolbar

        // We don't need to do any `UIView.animate()` business since it seems like
        // this function is called in the context of an animation.
        //
        // This changes the translation of a `CALayer` owned by WebKit! It should be
        // fine mutating the translation from native code as long as web code doesn't
        // touch it overriding our change.
        updateAllWebBottomBarFrames()

        // Masks should change when `keyboardOffset` changes.
        updateAllWebMaskedViewMasks()
    }

    @objc private func applicationWillResignActive(notification: NSNotification) {
        webViewHealthTimer?.invalidate()
        webViewHealthTimer = nil
    }

    @objc private func applicationDidBecomeActive(notification: NSNotification) {
        lastApplicationDidBecomeActiveNotificationTime = DispatchTime.now()
        initWebViewHealthTimer()
    }

    private func getSafeAreaInsets(
        withoutPreservingOldKeyboardOffsetForOpenWebSubstitue: Bool = false
    ) -> UIEdgeInsets {
        let safeAreaInsetTop = windowSafeAreaInsets.top

        let keyboardSafeAreaInsetBottom =
            switch keyboardWebSubstituteState {
            case .closed: keyboardOffset
            // Maintain the old keyboard offset while the keyboard substitute is open so
            // layout doesn't shift around.
            case .opening(let oldKeyboardOffset, _):
                withoutPreservingOldKeyboardOffsetForOpenWebSubstitue
                    ? bottomBarKeyboardSubstituteHeight + windowSafeAreaInsets.bottom
                    : oldKeyboardOffset
            case .opened(let oldKeyboardOffset):
                withoutPreservingOldKeyboardOffsetForOpenWebSubstitue
                    ? bottomBarKeyboardSubstituteHeight + windowSafeAreaInsets.bottom
                    : oldKeyboardOffset
            }

        // Include the tab bar in our safe area insets.
        let safeAreaInsetBottom = max(
            windowSafeAreaInsets.bottom,
            tabBarController?.tabBar.frame.height ?? 0,
            keyboardSafeAreaInsetBottom
        )

        let safeAreaInsetLeft = windowSafeAreaInsets.left
        let safeAreaInsetRight = windowSafeAreaInsets.right

        return UIEdgeInsets(
            top: safeAreaInsetTop,
            left: safeAreaInsetLeft,
            bottom: safeAreaInsetBottom,
            right: safeAreaInsetRight
        )
    }

    func setWindowSafeAreaInsets(_ windowSafeAreaInsets: UIEdgeInsets) {
        actuallySetWindowSafeAreaInsets(windowSafeAreaInsets)

        // Scroll indicator insets and masked view masks change when window safe
        // area changes.
        setAllMainWebScrollViewScrollIndicatorInsets()
        updateAllWebMaskedViewMasks()
    }

    // We set safe area insets as CSS variables. Then we use these CSS
    // variables to apply padding.
    //
    // WebKit does provide `env(safe-area-inset-*)` variables we could use. [The
    // problem is they are not immediately available][1] in `WKWebView` causing
    // a flash of incorrectly styled content as it moves to the correct location.
    //
    // [1]: https://bugs.webkit.org/show_bug.cgi?id=191872
    private func actuallySetWindowSafeAreaInsets(_ windowSafeAreaInsets: UIEdgeInsets) {
        self.windowSafeAreaInsets = windowSafeAreaInsets

        if !hasInitialWebViewNavigationCommit { return }

        updateWebViewSafeAreaInsets()
    }

    private func updateWebViewSafeAreaInsets(
        alsoCallFrameChangeListeners: (Double, Double, Bool, Bool)? = nil,
        completion: (() -> Void)? = nil
    ) {
        let safeAreaInsets = getSafeAreaInsets()

        let styleString = """
            :root {
                --safe-area-inset-top: \(safeAreaInsets.top)px;
                --safe-area-inset-bottom: \(safeAreaInsets.bottom)px;
                --safe-area-inset-left: \(safeAreaInsets.left)px;
                --safe-area-inset-right: \(safeAreaInsets.right)px;
                --window-safe-area-inset-bottom: \(windowSafeAreaInsets.bottom)px;
            }
            """

        let alsoCallFromChangeListenersSource =
            if let alsoCallFrameChangeListeners = alsoCallFrameChangeListeners {
                "\n    window.__NativeMobileBridge.keyboard._callFrameChangeListeners(\(alsoCallFrameChangeListeners.0), \(alsoCallFrameChangeListeners.1), \(alsoCallFrameChangeListeners.2), \(alsoCallFrameChangeListeners.3));\n"
            } else { "" }

        let source = """
            {
                const styleString = `\(styleString)`;
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
            \(alsoCallFromChangeListenersSource)}
            """

        let completionHandler: ((Any?, Error?) -> Void)? =
            if let completion = completion { { (_, _) in completion() } } else { nil }

        webView.evaluateJavaScript(source, completionHandler: completionHandler)
    }

    private func setAllMainWebScrollViewScrollIndicatorInsets() {
        setMainWebScrollViewScrollIndicatorInsets(webView.scrollView)

        for (webScrollView, webScrollViewState) in webScrollViews {
            if webScrollViewState.isMain {
                setMainWebScrollViewScrollIndicatorInsets(webScrollView)
            }
        }
    }

    private func setMainWebScrollViewScrollIndicatorInsets(_ webScrollView: UIScrollView) {
        let safeAreaInsets = getSafeAreaInsets(
            // Normally, we preserve the old keyboard offset in our safe area inset when a
            // keyboard substitute is open so we don't shift layout when switching between
            // the substitute and the regular keyboard. However, the scroll indicator
            // insets don't effect document layout.
            withoutPreservingOldKeyboardOffsetForOpenWebSubstitue: true
        )

        var verticalScrollIndicatorInsets = UIEdgeInsets(
            top: safeAreaInsets.top + navigationBarHeight,
            left: safeAreaInsets.left,
            bottom: safeAreaInsets.bottom,
            right: safeAreaInsets.right
        )

        // Make sure vertical scroll indicators make space for bottom bars:
        for webBottomBarView in webBottomBarViews.keys {
            let webBottomBarViewOriginY = webBottomBarView.superview!
                .convert(
                    CGPoint(
                        x: 0,
                        // `view.layer.position`, `view.layer.anchorPoint`, and `view.layer.bounds`
                        // gives us layer sizing before `view.layer.transform` is applied. [The
                        // documentation tells us][1] to not use `view.frame` if there's a transform
                        // so instead we use `view.layer` properties.
                        //
                        // [1]: https://developer.apple.com/documentation/uikit/uiview/1622621-frame
                        y: webBottomBarView.layer.position.y
                            - (webBottomBarView.layer.anchorPoint.y
                                * webBottomBarView.layer.bounds.height)
                    ),
                    to: view
                )
                .y

            let webBottomBarAdditionalBottomInset = max(
                0,
                view.frame.height - webBottomBarViewOriginY - windowSafeAreaInsets.bottom
            )

            verticalScrollIndicatorInsets.bottom = max(
                verticalScrollIndicatorInsets.bottom,
                safeAreaInsets.bottom + webBottomBarAdditionalBottomInset
            )
        }

        let webScrollViewFrame = webScrollView.superview!.convert(webScrollView.frame, to: view)
        let webScrollViewTop = webScrollViewFrame.origin.y
        let webScrollViewBottom =
            view.frame.height - (webScrollViewFrame.origin.y + webScrollViewFrame.height)

        webScrollView.automaticallyAdjustsScrollIndicatorInsets = false
        webScrollView.verticalScrollIndicatorInsets = UIEdgeInsets(
            top: max(0, verticalScrollIndicatorInsets.top - webScrollViewTop),
            left: verticalScrollIndicatorInsets.left,
            bottom: max(0, verticalScrollIndicatorInsets.bottom - webScrollViewBottom),
            right: verticalScrollIndicatorInsets.right
        )
    }

    override func pushViewController(_ viewController: UIViewController, animated: Bool) {
        // Noop. Don't allow external classes to push view controllers.
        // `WebNavigationController` completely manages its navigation stack.
    }

    // Override pop navigation functions. We need to let JavaScript control when
    // the pop happens since it may need to load data.
    override func popViewController(animated: Bool) -> UIViewController? {
        // While we have a modal view controller, we don't support external pops from
        // the navigation controller.
        guard modalPresentedViewController == nil else { return nil }

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
        // While we have a modal view controller, we don't support external pops from
        // the navigation controller.
        guard modalPresentedViewController == nil else { return nil }

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
        // While we have a modal view controller, we don't support external pops from
        // the navigation controller.
        guard modalPresentedViewController == nil else { return nil }

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
        // While we have a modal view controller, we don't support external pops from
        // the navigation controller.
        guard modalPresentedViewController == nil else { return }

        // TODO(calebmer): If `NativeMobileBridge.navigation.finishExternalPop()` is
        // never called after this then we show a loading spinner forever. It's
        // certainly possible for an external pop to take a while (e.g. we need to load
        // new data from the network). But if JavaScript code crashes the app will be
        // frozen forever. We need some recovery mechanisms to unfreeze the app.
        lastTopViewController.replaceWebViewWithSnapshotView()

        let url = (topViewController! as! WebNavigationEntryController).url

        if let transitionCoordinator = topViewController!.transitionCoordinator {
            if !transitionCoordinator.isInteractive {
                callNavigationExternalPopListeners(delta: delta, url: url)
            } else {
                transitionCoordinator.notifyWhenInteractionChanges { [self] (context) in
                    // Wait until the transition has finished.
                    if context.isInteractive { return }

                    // If the transition was cancelled, remove the snapshot view and place the web
                    // view back. (Unless the web view has found a new home. e.g. Because a push
                    // navigation happened.)
                    if context.isCancelled {
                        if webView.superview == nil || webView.superview == view {
                            lastTopViewController.moveWebViewInto(webView)
                        }
                    } else {
                        callNavigationExternalPopListeners(delta: delta, url: url)
                    }
                }
            }
        } else {
            callNavigationExternalPopListeners(delta: delta, url: url)
        }
    }

    private func callNavigationExternalPopListeners(delta: Int, url: URL) {
        let jsonEncoder = JSONEncoder()
        let jsonString = String(data: try! jsonEncoder.encode(url.absoluteString), encoding: .utf8)!

        webView.evaluateJavaScript(
            #"window.__NativeMobileBridge.navigation._callExternalPopListeners(\#(delta), \#(jsonString))"#
        )
    }

    func setTabBarScrollOffset(_ tabBarScrollOffset: Double, navigationBarScrollOffset: Double) {
        let tabBarHeight = tabBarController?.tabBar.frame.height ?? 0

        let lastTabBarScrollOffset = self.tabBarScrollOffset
        self.tabBarScrollOffset = hideTabBarCount > 0 ? tabBarHeight : tabBarScrollOffset
        let lastNavigationBarScrollOffset = self.navigationBarScrollOffset
        self.navigationBarScrollOffset =
            hideTabBarCount > 0 ? navigationBarHeight : navigationBarScrollOffset

        // Optimization: If tab bar scroll offset didn't change then don't update our
        // bottom frames.
        //
        // Optimization: If the keyboard is open, we don't need to update bottom bar
        // frames since bottom bar position will be dominated by the keyboard.
        if lastTabBarScrollOffset != tabBarScrollOffset
            && keyboardOffsetWithoutToolbar < tabBarHeight
        {
            // This may be called in the context of a `UIView.animate()` which will cause
            // our frame change to update as well.
            updateAllWebBottomBarFrames()
        }

        // Optimization: If tab bar scroll offset didn't change then don't update our
        // masked view masks.
        if lastNavigationBarScrollOffset != navigationBarScrollOffset {
            updateAllWebMaskedViewMasks()
        }
    }

    private func updateAllWebBottomBarFrames() {
        for (webBottomBarView, webBottomBarViewState) in webBottomBarViews {
            updateWebBottomBarFrame(webBottomBarView, webBottomBarViewState)
        }
    }

    private func updateWebBottomBarFrame(
        _ webBottomBarView: UIView,
        _ webBottomBarViewState: WebBottomBarViewState
    ) {
        let tabBarHeight = tabBarController?.tabBar.frame.height ?? 0

        let translateY =
            switch webBottomBarViewState.type {
            case .normal(let withKeyboardToolbar):
                -max(
                    0,
                    (tabBarHeight - tabBarScrollOffset) - windowSafeAreaInsets.bottom,
                    keyboardOffsetWithoutToolbar - windowSafeAreaInsets.bottom
                        + (withKeyboardToolbar && keyboardOffsetWithoutToolbar > 0
                            ? bottomBarKeyboardToolbarHeight : 0)
                )
            case .keyboardToolbar:
                -max(
                    0,
                    keyboardOffsetWithoutToolbar > 0
                        ? keyboardOffsetWithoutToolbar + bottomBarKeyboardToolbarHeight : 0
                )
            }

        webBottomBarViewState.withLock { [self] in
            // If we update the bottom bar position while the keyboard is animating
            // (`keyboardAnimationState` is non-null) but are not inheriting an animation
            // (`UIView.inheritedAnimationDuration` is 0) then animate with the same
            // properties as the keyboard animation. This happens when you select some text
            // in a content editor (without going into edit mode) and selecting "Add
            // Comment" from the edit menu. The bottom bar `WKCompositingView` is
            // discovered in a way that doesn't automatically inherit the keyboard
            // animation.
            if let keyboardAnimationState = keyboardAnimationState,
                keyboardAnimationState.animationDuration != 0
                    && UIView.inheritedAnimationDuration == 0
            {
                UIView.animate(
                    withDuration: keyboardAnimationState.animationDuration,
                    delay: 0,
                    options: UIView.AnimationOptions(
                        rawValue: keyboardAnimationState.animationCurve << 16
                    )
                ) {
                    webBottomBarView.layer.transform = CATransform3DMakeAffineTransform(
                        CGAffineTransform(translationX: 0, y: translateY)
                    )
                }
            } else {
                webBottomBarView.layer.transform = CATransform3DMakeAffineTransform(
                    CGAffineTransform(translationX: 0, y: translateY)
                )
            }
        }

        webBottomBarViewState.reconcileTimer?.invalidate()

        // We update `layer.transform` in native code optimistically to make sure it's
        // in sync with native code animations (like the keyboard opening animation).
        // However, we also need to apply this transformation in web code so WebKit hit
        // testing still works. The way we do this is by evaluating some JavaScript to
        // update the `transform` CSS on our bottom bar element after a debounce.
        //
        // Transforms on WebKit layers are [eventually written as transforms][1] on
        // UIKit's native `CALayer`s.
        //
        // [1]: https://github.com/WebKit/WebKit/blob/8c986e80a9f1cb83e4a58ed27f9ba14e2848d631/Source/WebKit/Shared/RemoteLayerTree/RemoteLayerTreePropertyApplier.mm#L165-L166
        let reconcileTimer = Timer(
            // If we are in a `UIView.animate` block (e.g. when the keyboard is
            // opening/closing) then `UIView.inheritedAnimationDuration` will be the
            // duration of that animation block. We shouldn't reconcile until the end of
            // the animation block.
            //
            // If we are not in a `UIView.animate` block then
            // `UIView.inheritedAnimationDuration` will be 0. In that case we want to
            // debounce with a duration of 100ms.
            timeInterval: max(
                0.1,
                UIView.inheritedAnimationDuration != 0
                    ? UIView.inheritedAnimationDuration
                    : keyboardAnimationState?.animationDuration ?? 0
            ),
            repeats: false
        ) { [self] (_) in
            // To avoid race conditions, if JavaScript hasn't returned yet we don't want to
            // update `layer.transform`.
            webBottomBarViewState.withLock { [self] (completionHandler) in
                webView.evaluateJavaScript(
                    #"const element = document.getElementById("\#(webBottomBarViewState.id)"); if (element) element.style.transform = "translateY(\#(translateY)px)""#,
                    completionHandler: { (_, _) in completionHandler() }
                )
            }
        }

        // Add some tolerance to reduce timer energy impact.
        reconcileTimer.tolerance = 0.05

        // We need to add our timer to the common run loop mode so it can execute
        // even while a gesture is occuring.
        //
        // For more information about run loops:
        // https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/Multithreading/RunLoopManagement/RunLoopManagement.html
        RunLoop.current.add(reconcileTimer, forMode: .common)

        webBottomBarViewState.reconcileTimer = reconcileTimer
    }

    /// Get the visible rectangle we use when masking views. This
    /// rectangle excludes:
    ///
    /// - The navigation bar from web code
    /// - The keyboard toolbar from web code
    /// - The software keyboard
    private func getWebMaskedViewsMaskRect() -> CGRect {
        let top = navigationBarHeight - navigationBarScrollOffset + windowSafeAreaInsets.top

        let substituteBottom: Double =
            if case .opened(_) = keyboardWebSubstituteState {
                bottomBarKeyboardSubstituteHeight + windowSafeAreaInsets.bottom
            } else { 0 }

        let bottom = max(
            // The `keyboardOffset` variable contains the keyboard toolbar height if a
            // keyboard toolbar exists.
            keyboardOffset,
            substituteBottom
        )

        return CGRect(
            x: 0,
            y: top,
            width: view.frame.width,
            height: view.frame.height - top - bottom
        )
    }

    private func updateAllWebMaskedViewMasks() {
        let maskRect = getWebMaskedViewsMaskRect()

        for (_, layerMasker) in webMaskedViews { layerMasker.updateMaskSuperlayerRect(maskRect) }
    }

    private func prepareForKeyboardWebSubstitute(completion: (() -> Void)? = nil) {
        switch keyboardWebSubstituteState {
        case .opened(_):
            completion?()
            return
        case .opening(_, _):
            completion?()
            return
        case .closed: break
        }

        let oldKeyboardOffset = keyboardOffset

        // We observe the keyboard hide animation takes 0.25s. The animation
        // automatically runs when we call `reloadInputViews()`.
        let timer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: false) { [self] (_) in
            shouldDisableScrollFromKeyboardFrameChange -= 1

            keyboardWebSubstituteState = .opened(oldKeyboardOffset: oldKeyboardOffset)
            updateAllWebMaskedViewMasks()

            completion?()
        }

        keyboardWebSubstituteState = .opening(oldKeyboardOffset: oldKeyboardOffset, timer: timer)
        shouldDisableScrollFromKeyboardFrameChange += 1

        // Replace the input view with an empty `UIView`. This will animate the
        // keyboard offscreen. We will render a substitute for the keyboard in the
        // web view.
        reloadSwizzledWKWebViewInputView(webView, inputView: UIView())
    }

    private func cleanupAfterKeyboardWebSubstitute(completion: (() -> Void)? = nil) {
        switch keyboardWebSubstituteState {
        case .closed:
            completion?()
            return
        case .opening(_, let timer):
            timer.invalidate()
            break
        case .opened(_): break
        }

        shouldDisableScrollFromKeyboardFrameChange += 1

        keyboardWebSubstituteState = .closed
        updateAllWebMaskedViewMasks()

        reloadSwizzledWKWebViewInputView(webView, inputView: nil)

        // We observe the keyboard hide animation takes 0.25s. The animation
        // automatically runs when we call `reloadInputViews()`.
        Timer.scheduledTimer(withTimeInterval: 0.25, repeats: false) { [self] (_) in
            shouldDisableScrollFromKeyboardFrameChange -= 1

            completion?()
        }
    }

    private func cleanupModalPresentedViewController() {
        guard modalPresentedViewController != nil else { return }

        (topViewController! as! WebNavigationEntryController)
            .moveWebViewIntoIfHealthyOrElseReplaceWithSnapshotView(
                webView,
                healthState: webViewHealthState
            )

        dismiss(animated: false)
    }
}

private class WebNavigationEntryController: UIViewController {
    var url: URL
    private weak var webNavigationController: WebNavigationController?
    private var loadingIndicatorTimer: Timer?
    private var loadingIndicatorTimerGeneration: Int = 0
    private var hasViewAppeared: Bool = false
    private var willViewDisappear: Bool = false
    private var shouldPresentLoadingIndicator = false

    // Presentation style needs to be over fullscreen because:
    //
    // 1. We want the modal to slide up and cover the app.
    // 2. It needs to be "over" so we keep rendering the navigation view below.
    //    That way when `NativeMobileBridge.navigation.preparePop()` is called and
    //    the web view moves back to the underlying navigation controller the web
    //    view will keep running.
    override var modalPresentationStyle: UIModalPresentationStyle {
        get { .overFullScreen }
        set {}
    }

    init(
        url: URL,
        webNavigationController: WebNavigationController,
        webView: WKWebView,
        healthState: WebNavigationController.WebViewHealthState
    ) {
        self.url = url
        self.webNavigationController = webNavigationController

        super.init(nibName: nil, bundle: nil)

        // While the web view isn't mounted, show our primary background color.
        view.backgroundColor = UIColor(named: "grey-0")!

        // Render content underneath opaque bars like the tab bar. We make sure content
        // isn't hidden by opaque bars in web code.
        extendedLayoutIncludesOpaqueBars = true

        moveWebViewIntoIfHealthyOrElseReplaceWithSnapshotView(webView, healthState: healthState)
    }

    required init(coder: NSCoder) { fatalError("Unimplemented") }

    func moveWebViewIntoIfHealthyOrElseReplaceWithSnapshotView(
        _ webView: WKWebView,
        healthState: WebNavigationController.WebViewHealthState
    ) {
        // We may become unhealthy while loading as WebKit stops executing JavaScript.
        // So if `isLoading` is true then don't show the unhealthy alert.
        if healthState.isLoading {
            replaceWebViewWithSnapshotView()

            // If there's currently stuff in our view then immediately show a loading
            // indicator. If there's nothing in our view then the loading indicator timer
            // set by `replaceWebViewWithSnapshotView()` will eventually show the loading
            // indicator after a delay.
            if view.subviews.count > 0 {
                clearLoadingIndicatorTimer()
                presentLoadingIndicator()
            }
        } else if !healthState.isHealthy {
            replaceWebViewWithSnapshotView()
            clearLoadingIndicatorTimer()
            presentUnhealthyAlert()
        } else {
            moveWebViewInto(webView)
        }
    }

    func replaceWebViewWithSnapshotView() {
        // Only replace with snapshot view if there's a web view.
        let webView = view.subviews.first(where: { (view) in view is WKWebView })
        guard let webView = webView else {
            resetLoadingIndicatorTimer()
            return
        }

        let snapshotView = webView.snapshotView(
            // Snapshotting a view that is not in a visible window requires
            // `afterScreenUpdates: true`. `false` the rest of the time because I
            // assume `true` is potentially expensive? It may force the screen to
            // paint.
            afterScreenUpdates: !(webView.window?.isHidden ?? true)
        )!

        if presentedViewController is WebLoadingIndicatorController { dismiss(animated: false) }
        for subview in view.subviews {
            subview.removeFromSuperview()

            // Add the web view back, as hidden, to our navigation controller so it can
            // continue receiving `requestAnimationFrame()` events.
            if subview === webView {
                webView.isHidden = true
                webNavigationController!.view.addSubview(webView)
            }
        }

        view.addSubview(snapshotView)

        resetLoadingIndicatorTimer()
    }

    func moveWebViewInto(_ webView: WKWebView) {
        if presentedViewController is WebLoadingIndicatorController { dismiss(animated: false) }

        var hasWebView = false
        for subview in view.subviews {
            // If we already have the web view, this is a noop.
            if subview === webView {
                hasWebView = true
                continue
            }

            subview.removeFromSuperview()
        }

        if hasWebView {
            resetLoadingIndicatorTimer()
            return
        }

        // The web view is hidden when initialized, make sure it's visible.
        webView.isHidden = false

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
        webView.frame = view.bounds

        // If we are initializing with a web view, the web view should have already
        // been removed from its super view, but just in case perform the remove again.
        webView.removeFromSuperview()

        view.addSubview(webView)

        resetLoadingIndicatorTimer()
    }

    override func viewWillLayoutSubviews() {
        let webView = view.subviews.first(where: { $0 is WKWebView })
        webView?.frame = view.bounds
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        hasViewAppeared = true
        willViewDisappear = false

        if shouldPresentLoadingIndicator {
            shouldPresentLoadingIndicator = false
            clearLoadingIndicatorTimer()
            presentLoadingIndicator()
        } else {
            resetLoadingIndicatorTimer()
        }
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        willViewDisappear = true
        clearLoadingIndicatorTimer()
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        hasViewAppeared = false
        willViewDisappear = false
        clearLoadingIndicatorTimer()

        shouldPresentLoadingIndicator = presentedViewController is WebLoadingIndicatorController
        if shouldPresentLoadingIndicator { dismiss(animated: false) }
    }

    private func clearLoadingIndicatorTimer() {
        loadingIndicatorTimer?.invalidate()
        loadingIndicatorTimer = nil
        loadingIndicatorTimerGeneration += 1
    }

    /// If we present a navigation entry to the user that's just a snapshot, wait a
    /// bit and then show a loading indicator instead of showing a frozen UI which
    /// feels broken.
    ///
    /// The loading indicator blurs the snapshot and adds an animated loading
    /// spinner in the center.
    private func resetLoadingIndicatorTimer() {
        // Loading indicator already presented...
        if presentedViewController is WebLoadingIndicatorController { return }

        let hasWebView = view.subviews.first(where: { (view) in view is WKWebView }) != nil

        clearLoadingIndicatorTimer()
        let currentLoadingIndicatorTimerGeneration = loadingIndicatorTimerGeneration

        // Don't show loading indicator if we have a web view.
        if hasWebView { return }

        // Don't show loading indicator if our entry isn't visible.
        if !hasViewAppeared || willViewDisappear { return }

        // If there's a modal view controller (that's not ourself), don't show
        // loading indicator. Since our view is hidden under the modal.
        if let modalPresentedViewController = webNavigationController?.modalPresentedViewController,
            modalPresentedViewController != self
        {
            return
        }

        // If the user is dragging to pop then the top view controller will have a
        // `transitionCoordinator`. So if we detect no transition coordinator directly
        // on our view controller, check the top view controller in our navigation
        // controller.
        let transitionCoordinator =
            self.transitionCoordinator
            ?? (webNavigationController?.modalPresentedViewController
            ?? webNavigationController?.topViewController)!
            .transitionCoordinator

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
            withTimeInterval: delayScreenTransitionLoadingIndicatorLimitSeconds,
            repeats: false
        ) { [self] timer in
            loadingIndicatorTimer = nil
            presentLoadingIndicator()
        }

        // Add some tolerance to reduce timer energy impact.
        loadingIndicatorTimer?.tolerance = 0.1
    }

    private func presentLoadingIndicator() {
        if !hasViewAppeared || willViewDisappear {
            shouldPresentLoadingIndicator = true
            return
        }

        // If there's a modal view controller (that's not ourselves), don't show
        // loading indicator. It's like our view is hidden.
        //
        // A modal may have opened while waiting for the timer. We don't call
        // `resetLoadingIndicatorTimer()` if the modal view controller changes.
        if let modalPresentedViewController = webNavigationController?.modalPresentedViewController,
            modalPresentedViewController != self
        {
            return
        }

        // If we're already presenting, noop. This should be an idempotent function.
        if presentedViewController is WebLoadingIndicatorController { return }

        let loadingIndicator = WebLoadingIndicatorController()

        // Only blur if there's stuff in our view. On initial load there will be
        // no stuff.
        loadingIndicator.withBlur = view.subviews.count > 0

        present(loadingIndicator, animated: false)
    }

    // NOCOMMIT: I want a button in the "More" tab for developers that debugs
    // unhealthy.
    private func presentUnhealthyAlert() {
        let alert = UIAlertController(
            title: "Couldn’t respond",
            // This message is copied from `error_display_message_renderer.tsx`. If we update
            // the message here then we should update it there as well.
            message:
                "An unexpected error occurred, please try again. If the problem continues, let us know at support@cyberworlds.dev",
            preferredStyle: .alert
        )

        alert.addAction(
            UIAlertAction(
                title: "Retry",
                style: .default,
                handler: { [self] (_) in webNavigationController!.forceReloadWebView() }
            )
        )

        // If we're already presenting a loading indicator, dismiss it before
        // presenting our alert.
        if presentedViewController is WebLoadingIndicatorController { dismiss(animated: false) }

        present(alert, animated: true)
    }
}

private class WebLoadingIndicatorController: UIViewController {
    var withBlur = true

    override var modalPresentationStyle: UIModalPresentationStyle {
        get { .overFullScreen }
        set {}
    }

    private var blurEffectView: UIVisualEffectView?
    private var loadingIndicatorView: UIImageView?

    override func viewDidLoad() {
        if withBlur {
            let blurEffectView = UIVisualEffectView()
            self.blurEffectView = blurEffectView
            blurEffectView.frame = view.bounds
            blurEffectView.autoresizingMask = [.flexibleWidth, .flexibleHeight]

            view.addSubview(blurEffectView)
        }

        let loadingIndicatorView = UIImageView(
            image: UIImage(named: "SpinnerGapIcon")!
                // Must use template rendering mode for `tintColor` to have any effect.
                .withRenderingMode(.alwaysTemplate)
        )
        self.loadingIndicatorView = loadingIndicatorView

        // The equivalent of size `spacing["6"]` which is used for peek loading
        // indicators. `spacing["6"]` is 1.5rem and the mobile rem size is 20px.
        // So 1.5 * 20 = 30.
        loadingIndicatorView.frame.size.width = 30
        loadingIndicatorView.frame.size.height = 30

        loadingIndicatorView.center = view.center

        loadingIndicatorView.tintColor = UIColor(named: "grey-70")!

        view.addSubview(loadingIndicatorView)
    }

    override func viewDidAppear(_ animated: Bool) {
        if let blurEffectView = blurEffectView {
            UIView.animate(withDuration: 0.2) {
                blurEffectView.effect = UIBlurEffect(style: .systemUltraThinMaterial)
            }
        }

        if let loadingIndicatorView = loadingIndicatorView {
            let rotationAnimation = CABasicAnimation(keyPath: "transform.rotation")

            // Same rotation animation as `spinAnimationClassName`. 1s infinite repeat.
            rotationAnimation.fromValue = 0.0
            rotationAnimation.toValue = Float.pi * 2.0
            rotationAnimation.duration = 1
            rotationAnimation.repeatCount = Float.infinity

            loadingIndicatorView.layer.add(rotationAnimation, forKey: "rotationAnimation")
        }
    }

    override func viewWillLayoutSubviews() {
        blurEffectView?.frame = view.bounds
        loadingIndicatorView?.center = view.center
    }
}

private protocol WebInputAccessoryObserverViewDelegate: AnyObject {
    func webInputAccessoryObserverView(
        _ webInputAccessoryObserverView: WebInputAccessoryObserverView?,
        didMoveTo keyboardOffset: Double
    )
}

/// We add this empty accessory view as the `inputAccessoryView` of our
/// `WKWebView`. Then we observe changes to `inputAccessoryView`'s `superview`
/// (the keyboard view). We must observe changes to the keyboard this way to
/// detect when a gesture is dragging the keyboard down. A gesture to drag the
/// keyboard down does not fire `keyboardWillShow` or `keyboardWillHide`
/// notifications. So in order to both detect keyboard show/hide animations and
/// drag gesture keyboard changes we need this observer.
private class WebInputAccessoryObserverView: UIView {
    weak var delegate: WebInputAccessoryObserverViewDelegate?

    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = false
    }

    required init(coder: NSCoder) { fatalError("Unimplemented") }

    deinit { superview?.removeObserver(self, forKeyPath: "center") }

    override func willMove(toSuperview newSuperview: UIView?) {
        superview?.removeObserver(self, forKeyPath: "center")
        newSuperview?.addObserver(self, forKeyPath: "center", options: .init(), context: nil)
    }

    override func observeValue(
        forKeyPath keyPath: String?,
        of object: Any?,
        change: [NSKeyValueChangeKey: Any]?,
        context: UnsafeMutableRawPointer?
    ) {
        if keyPath != "center" { return }

        let superview = object as! UIView

        if let superSuperview = superview.superview {
            let keyboardOffset = max(0, superSuperview.bounds.height - superview.frame.origin.y)

            delegate?.webInputAccessoryObserverView(self, didMoveTo: keyboardOffset)
        }
    }
}

private struct WebBridgeModalPresentDialogOptions: Codable {
    let title: String
    let description: String
    let primaryButtonLabel: String
    let isPrimaryButtonDisabled: Bool?
    let onPrimaryButtonPressCallbackId: Int
    let cancelButtonLabel: String?
    let onCancelButtonPressCallbackId: Int
    let shouldHideCancelButton: Bool?
}

private let webBridgeSource = """
    {
        const navigationExternalPopListeners = new Set();
        const keyboardFrameChangeListeners = new Set();
        const addCommentEditMenuListeners = new Set();

        let scheduledAfterNavigationAnimationCallbacks = [];
        let scheduledAfterKeyboardAnimationCallbacks = [];

        let nextCallbackId = 0;
        const callbackById = new Map();

        const registerCallback = callback => {
            if (!callback) return callback;

            const callbackId = nextCallbackId++;
            callbackById.set(callbackId, callback);

            return callbackId;
        };

        const unregisterCallback = callbackId => {
            callbackById.delete(callbackId);
        };

        const NativeMobileBridge = {
            _callCallbackById: callbackId => {
                const callback = callbackById.get(callbackId);
                if (!callback) return;

                const result = callback();
                if (result instanceof Promise) {
                    result.catch(error => {
                        setTimeout(() => {
                            throw error;
                        }, 0);
                    });
                }
            },
            health: {
                ready: () => {
                    window.webkit.messageHandlers.NativeMobileBridge.postMessage("health.ready");
                },
                ping: () => {
                    window.webkit.messageHandlers.NativeMobileBridge.postMessage("health.ping");
                },
            },
            colors: {
                setThemeColors: options => {
                    window.webkit.messageHandlers.NativeMobileBridge.postMessage(`colors.setThemeColors:${options["theme-30"]},${options["theme-40"]},${options["theme-50"]},${options["theme-60"]}`);
                },
            },
            navigation: {
                preparePush: () => {
                    prompt("%%%navigation.preparePush");
                },
                push: url => {
                    window.webkit.messageHandlers.NativeMobileBridge.postMessage(`navigation.push:${url}`);
                },
                subscribeToExternalPop: listener => {
                    navigationExternalPopListeners.add(listener);
                    return () => {
                        navigationExternalPopListeners.delete(listener);
                    };
                },
                _callExternalPopListeners: (delta, urlString) => {
                    const url = new URL(urlString);

                    for (const listener of navigationExternalPopListeners) {
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
                preparePresentModal: () => {
                    prompt("%%%navigation.preparePresentModal");
                },
                presentModal: () => {
                    window.webkit.messageHandlers.NativeMobileBridge.postMessage("navigation.presentModal");
                },
                prepareDismissModal: () => {
                    prompt("%%%navigation.prepareDismissModal");
                },
                dismissModal: () => {
                    window.webkit.messageHandlers.NativeMobileBridge.postMessage("navigation.dismissModal");
                },
                scheduleAfterAnimation: action => {
                    if (scheduledAfterNavigationAnimationCallbacks.length === 0) {
                        window.webkit.messageHandlers.NativeMobileBridge.postMessage("navigation.scheduleAfterAnimation");
                    }

                    scheduledAfterNavigationAnimationCallbacks.push(action);
                },
                _callScheduledAfterAnimationCallbacks: () => {
                    const callbacks = scheduledAfterNavigationAnimationCallbacks;
                    scheduledAfterNavigationAnimationCallbacks = [];

                    for (const callback of callbacks) {
                        try {
                            callback();
                        } catch (error) {
                            setTimeout(() => {
                                throw error;
                            }, 0);
                        }
                    }
                },
            },
            navigationBar: {
                tabBarHeight: \(UITabBarController().tabBar.frame.height),
                runScrollDebounceTimeout: () => {
                    window.webkit.messageHandlers.NativeMobileBridge.postMessage("navigationBar.runScrollDebounceTimeout");
                },
                hideTabBar: () => {
                    window.webkit.messageHandlers.NativeMobileBridge.postMessage("navigationBar.hideTabBar");
                },
                showTabBar: () => {
                    window.webkit.messageHandlers.NativeMobileBridge.postMessage("navigationBar.showTabBar");
                },
            },
            keyboard: {
                subscribeToFrameChange: listener => {
                    keyboardFrameChangeListeners.add(listener);
                    return () => {
                        keyboardFrameChangeListeners.delete(listener);
                    };
                },
                _callFrameChangeListeners: (oldKeyboardHeight, newKeyboardHeight, shouldScroll, isAnimated) => {
                    for (const listener of keyboardFrameChangeListeners) {
                        try {
                            listener({oldKeyboardHeight, newKeyboardHeight, shouldScroll, isAnimated});
                        } catch (error) {
                            setTimeout(() => {
                                throw error;
                            }, 0);
                        }
                    }
                },
                prepareForSubstitute: () => {
                    return window.webkit.messageHandlers.NativeMobileBridgeWithReply.postMessage("keyboard.prepareForSubstitute");
                },
                cleanupAfterSubstitute: () => {
                    return window.webkit.messageHandlers.NativeMobileBridgeWithReply.postMessage("keyboard.cleanupAfterSubstitute");
                },
                scheduleAfterAnimation: action => {
                    if (scheduledAfterKeyboardAnimationCallbacks.length === 0) {
                        const channel = new MessageChannel();
                        channel.port1.onmessage = () => {
                            window.webkit.messageHandlers.NativeMobileBridge.postMessage("keyboard.scheduleAfterAnimation");
                        };
                        channel.port2.postMessage(undefined);
                    }

                    scheduledAfterKeyboardAnimationCallbacks.push(action);
                },
                _callScheduledAfterAnimationCallbacks: () => {
                    const callbacks = scheduledAfterKeyboardAnimationCallbacks;
                    scheduledAfterKeyboardAnimationCallbacks = [];

                    for (const callback of callbacks) {
                        try {
                            callback();
                        } catch (error) {
                            setTimeout(() => {
                                throw error;
                            }, 0);
                        }
                    }
                },
            },
            modal: {
                presentDialog: options => {
                    const actualOptions = {
                        title: options.title,
                        description: options.description,
                        primaryButtonLabel: options.primaryButtonLabel,
                        isPrimaryButtonDisabled: options.isPrimaryButtonDisabled,
                        onPrimaryButtonPressCallbackId: registerCallback(() => {
                            unregisterCallback(actualOptions.onPrimaryButtonPressCallbackId);
                            unregisterCallback(actualOptions.onCancelButtonPressCallbackId);
                            if (options.onPrimaryButtonPress) return options.onPrimaryButtonPress();
                        }),
                        cancelButtonLabel: options.cancelButtonLabel,
                        onCancelButtonPressCallbackId: registerCallback(() => {
                            unregisterCallback(actualOptions.onPrimaryButtonPressCallbackId);
                            unregisterCallback(actualOptions.onCancelButtonPressCallbackId);
                            if (options.onCancelButtonPress) return options.onCancelButtonPress();
                        }),
                        shouldHideCancelButton: options.shouldHideCancelButton,
                    };

                    window.webkit.messageHandlers.NativeMobileBridge.postMessage(`modal.presentDialog:${JSON.stringify(actualOptions)}`);
                },
            },
            editMenu: {
                enableAddCommentAction: () => {
                    window.webkit.messageHandlers.NativeMobileBridge.postMessage("editMenu.enableAddCommentAction");
                },
                disableAddCommentAction: () => {
                    window.webkit.messageHandlers.NativeMobileBridge.postMessage("editMenu.disableAddCommentAction");
                },
                subscribeToAddCommentAction: listener => {
                    addCommentEditMenuListeners.add(listener);
                    return () => {
                        addCommentEditMenuListeners.delete(listener);
                    };
                },
                _callAddCommentActionListeners: () => {
                    for (const listener of addCommentEditMenuListeners) {
                        try {
                            listener();
                        } catch (error) {
                            setTimeout(() => {
                                throw error;
                            }, 0);
                        }
                    }
                },
            },
        };

        window.__NativeMobileBridge = NativeMobileBridge;
    }
    """
