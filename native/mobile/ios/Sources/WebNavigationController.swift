// IMPORTANT: You have to be very careful about reference counting in this
// file! We've very carefully audited this code to make sure there are no
// reference cycles. When `SceneDelegate` changes its
// `window.rootViewController` the old `WebNavigationController` needs to be
// deinitialized.
//
// Every time you pass `self` as a reference to another function or capture
// `self` as a variable for your closure, you need to think carefully about
// whether you're extending the lifetime of `WebNavigationController`.
//
// A convention we've adopted in this file is to always capture a weak
// reference to self in closures. e.g.
//
// ```
// let timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: false) { [weak self] (_) in
//     guard let this = self else { return }
//
//     this.callSomething()
// }
// ```
//
// If we don't capture a weak reference in a closure (`[self]` instead of
// `[weak self]`) we explicitly document why. This convention helps you think
// less about memory cycles. A closure should never contribute to a memory
// cycle.
//
// If you're observing `WebNavigationController` is not deinitializing when
// you'd expect it to, one process for debugging is to literally search through
// every instance of `self` in this file and determine whether it could
// plausibly cause a memory cycle or not.

import OSLog
import UIKit
import WebKit

private let logger = Logger(
    subsystem: Bundle.main.bundleIdentifier!,
    category: "WebNavigationController"
)

private let tabBarHeight = UITabBarController().tabBar.frame.height

@objc protocol WebNavigationControllerDelegate {
    @objc optional func webNavigationController(
        signOut webNavigationController: WebNavigationController
    )
    @objc optional func webNavigationController(
        _ webNavigationController: WebNavigationController,
        switchSpace spaceId: String
    )
    @objc optional func webNavigationController(
        _ webNavigationController: WebNavigationController,
        didAddWebScrollView webScrollView: UIScrollView,
        navigationEntry webNavigationEntry: WebNavigationEntry,
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
        didDisableTabBarChange isDisabled: Bool,
        isHidden: Bool,
        isAnimated: Bool
    )
    @objc optional func webNavigationController(
        _ webNavigationController: WebNavigationController,
        didNavigate webNavigationEntry: WebNavigationEntry,
        hasMainScrollView: Bool
    )
    @objc optional func webNavigationController(
        clearInboxNotificationBadge webNavigationController: WebNavigationController
    )
    @objc optional func webNavigationController(
        _ webNavigationController: WebNavigationController,
        setInboxLoudNotificationBadge loudNotificationCount: Int
    )
    @objc optional func webNavigationController(
        setInboxSubtleNotificationBadge webNavigationController: WebNavigationController
    )
}

class WebNavigationController: UINavigationController, WKNavigationDelegate, WKUIDelegate,
    WKScriptMessageHandler, WKScriptMessageHandlerWithReply, WKHTTPCookieStoreObserver,
    UIViewTreeObserverDelegate, UIScrollViewDelegate, WebInputAccessoryObserverViewDelegate
{
    #if DEVELOPMENT_RUN_ENVIRONMENT || TEST_RUN_ENVIRONMENT
        // NOTE(calebmer): This variable is from a Swift file generated at build time
        // by the rule `//native/mobile/ios:build_config`.
        static let baseUrl = URL(string: webBaseUrl)!
    #else
        static let baseUrl = URL(string: "https://cyberworlds.dev")!
    #endif

    static private var baseUrlAbsoluteStringWithTrailingSlash = baseUrl.absoluteString + "/"

    // We use abbreviations since there's a character limit in WebKit layer names.
    //
    // - `nmbb` stands for `NativeMobileBottomBar`
    // - `kt` stands for `KeyboardToolbar`
    // - `wkt` stands for `WithKeyboardToolbar`
    // - `gli` stands for `GlobalLoadingIndicator`
    static private let bottomBarRegex = try! Regex<(Substring, Substring, Substring?)>(
        " id='(nmbb-(?:(kt|wkt|gli)-)?[^']*)'"
    )

    static private let inboxBannerUrlQueryRegex = try! Regex<Substring>(
        "(?:^|\\?|&)inbox=show(?:&|$)"
    )

    fileprivate weak var scene: UIScene?
    private let initialPathByTab: InitialPathByTab
    private let webConfiguration: WKWebViewConfiguration
    private let weakScriptMessageHandler: WeakScriptMessageHandler
    private var remoteNotificationDeviceTokenCountObservation: NSKeyValueObservation?

    struct InitialPathByTab {
        let home: String
        let search: String
        let create: String
        let inbox: String
        let more: String

        func get(_ tab: Tab) -> String {
            switch tab {
            case .home: home
            case .search: search
            case .create: create
            case .inbox: inbox
            case .more: more
            }
        }
    }

    private var currentTab: Tab

    enum Tab {
        case home
        case search
        case create
        case inbox
        case more

        static func fromString(_ string: Substring) -> Tab? {
            switch string {
            case "Home": .home
            case "Search": .search
            case "Create": .create
            case "Inbox": .inbox
            case "More": .more
            default: nil
            }
        }

        func jsonString() -> String {
            let string =
                switch self {
                case .home: "Home"
                case .search: "Search"
                case .create: "Create"
                case .inbox: "Inbox"
                case .more: "More"
                }

            return Cyberworlds.jsonString(string)
        }
    }

    private var viewControllersByInactiveTab = [Tab: [UIViewController]]()

    // Called `webDelegate` so we don't override `UINavigationController`'s
    // `delegate` property.
    weak var webDelegate: WebNavigationControllerDelegate?

    private var webView: WKWebView!
    private weak var webInputAccessoryObserverView: WebInputAccessoryObserverView?
    private var webViewTreeObserver: UIViewTreeObserver?
    private var hasInitialWebViewNavigationCommit = false
    private(set) var windowSafeAreaInsets: UIEdgeInsets = .zero
    private var webMaskedViews = [UIView: CALayerMasker]()

    private var webViewHealthState = WebViewHealthState(
        readyTime: nil,
        lastPingTime: nil,
        provisionalNavigation: nil,
        isHealthy: true,
        shouldSuppressUnhealthyAlert: false
    ) {
        didSet {
            let newValue = webViewHealthState

            if oldValue.isHealthy != newValue.isHealthy && !newValue.isHealthy {
                logger.error(
                    "Web view is unhealthy after not receiving a ping for \(newValue.lastPingTime?.distance(to: DispatchTime.now()).toSeconds() ?? Double.nan, privacy: .public)s"
                )
            }

            if oldValue.isLoading != newValue.isLoading || oldValue.isHealthy != newValue.isHealthy
                || oldValue.shouldSuppressUnhealthyAlert != newValue.shouldSuppressUnhealthyAlert
                || (oldValue.navigationError == nil) != (newValue.navigationError == nil)
            {
                ((modalPresentedViewController ?? topViewController)
                    as! WebNavigationEntryController)
                    .moveWebViewIntoIfHealthyOrElseReplaceWithSnapshotView(
                        webView,
                        healthState: newValue
                    )
            }

            if oldValue.isLoading != newValue.isLoading { isLoading = newValue.isLoading }
        }
    }

    // Same as `webViewHealthState.isLoading`. Only `webViewHealthState`'s `didSet`
    // callback should update it.
    @objc private(set) dynamic var isLoading: Bool = true

    private var webViewHealthTimer: Timer?

    fileprivate struct WebViewHealthState {
        var readyTime: DispatchTime?
        var lastPingTime: DispatchTime?
        var provisionalNavigation: WKNavigation?
        var navigationError: (any Error)?
        var isHealthy: Bool
        var shouldSuppressUnhealthyAlert: Bool

        var isLoading: Bool { provisionalNavigation != nil || readyTime == nil }
    }

    private var webScrollViews = [UIScrollView: WebScrollViewState]()

    private struct WebScrollViewState {
        var isMain: Bool
        let delegateForwarder: UIScrollViewDelegateForwarder
        let resizeObserver: UIViewResizeObserver
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
    private var webBottomBarViews = [UIView: WebBottomBarViewState]() {
        didSet {
            let isTabBarHidden = hideTabBarCount > 0

            let isTabBarDisabledBase = isTabBarHidden

            let oldIsTabBarDisabled =
                isTabBarDisabledBase || oldValue.values.contains(where: { $0.type.isNormal })
            let newIsTabBarDisabled =
                isTabBarDisabledBase
                || webBottomBarViews.values.contains(where: { $0.type.isNormal })

            if oldIsTabBarDisabled != newIsTabBarDisabled {
                webDelegate?.webNavigationController?(
                    self,
                    didDisableTabBarChange: newIsTabBarDisabled,
                    isHidden: isTabBarHidden,
                    isAnimated: false
                )
            }
        }
    }

    private enum WebBottomBarViewType {
        case normal(withKeyboardToolbar: Bool)
        case keyboardToolbar
        case globalLoadingIndicator

        var isNormal: Bool {
            switch self {
            case .normal(withKeyboardToolbar: _): true
            case .keyboardToolbar: false
            case .globalLoadingIndicator: false
            }
        }
    }

    private class WebBottomBarViewState {
        let id: String
        let type: WebBottomBarViewType
        var reconcileTimer: Timer?
        let resizeObserver: UIViewResizeObserver

        private var isAwaiting = false
        private var actionQueue = [() -> Void]()

        init(
            id: String,
            type: WebBottomBarViewType,
            reconcileTimer: Timer?,
            resizeObserver: UIViewResizeObserver
        ) {
            self.id = id
            self.type = type
            self.reconcileTimer = reconcileTimer
            self.resizeObserver = resizeObserver
        }

        // This is not thread safe but since it's always called from the main thread we
        // should be fine.
        func withLock(_ action: @escaping () -> Void) {
            if isAwaiting { actionQueue.append(action) } else { action() }
        }

        func withLock(_ action: @escaping (_ completionHandler: @escaping () -> Void) -> Void) {
            // Strong reference to `self`. We call everything in `actionQueue` even when
            // all other references to this class are released.
            let actualAction = { [self] in
                isAwaiting = true

                // Strong reference to `self`. We call everything in `actionQueue` even when
                // all other references to this class are released.
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
    private var tabBarScrollOffsetReconcileTimer: Timer?

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

    private var lastKeyboardOffsetWithoutToolbar = 0.0

    private var keyboardOffset: Double {
        keyboardOffsetWithoutToolbar
            // If there's a keyboard toolbar then it "covers" the visible rectangle.
            + (keyboardOffsetWithoutToolbar > 0
                && webBottomBarViews.contains(where: { (webBottomBarView, webBottomBarViewState) in
                    switch webBottomBarViewState.type {
                    case .normal(let withKeyboardToolbar): withKeyboardToolbar
                    case .keyboardToolbar: true
                    case .globalLoadingIndicator: false
                    }
                }) ? bottomBarKeyboardToolbarHeight : 0)
    }

    private var temporarilyPreservedKeyboardOffset: Double?
    private var temporarilyPreservedKeyboardOffsetReconcileTimer: Timer?

    private var keyboardWillHideCallCount: UInt = 0
    private var keyboardWillHideAnimationTimer: Timer?

    private var willSceneDelegateRemove = false
    fileprivate var didSceneEnterBackground = false
    fileprivate var didSceneEnterBackgroundWithKeyboardShown = false
    private var lastSceneDidActivateNotificationTime: DispatchTime?

    private var theme10Color = UIColor(named: "indigo-10")!
    private var theme20Color = UIColor(named: "indigo-20")!
    private var theme30Color = UIColor(named: "indigo-30")!
    private var theme40Color = UIColor(named: "indigo-40")!
    private var theme50Color = UIColor(named: "indigo-50")!
    private var theme60Color = UIColor(named: "indigo-60")!
    private var theme70Color = UIColor(named: "indigo-70")!
    private var theme80Color = UIColor(named: "indigo-80")!
    private var theme90Color = UIColor(named: "indigo-90")!

    private var isHideTabBarChangeAnimated: Bool?
    fileprivate var hideTabBarCount = 0 {
        didSet {
            let oldIsTabBarHidden = oldValue > 0
            let newIsTabBarHidden = hideTabBarCount > 0

            let isTabBarDisabledBase = webBottomBarViews.values.contains(where: { $0.type.isNormal }
            )

            let oldIsTabBarDisabled = isTabBarDisabledBase || oldIsTabBarHidden
            let newIsTabBarDisabled = isTabBarDisabledBase || newIsTabBarHidden

            if oldIsTabBarDisabled != newIsTabBarDisabled || oldIsTabBarHidden != newIsTabBarHidden
            {
                logger.info(
                    "Hide tab bar count updated: \(self.hideTabBarCount, privacy: .public) (\(self.hideTabBarCount > 0 ? "hiding" : "showing", privacy: .public))"
                )

                webDelegate?.webNavigationController?(
                    self,
                    didDisableTabBarChange: newIsTabBarDisabled,
                    isHidden: newIsTabBarHidden,
                    isAnimated: isHideTabBarChangeAnimated
                        ?? ((isNavigationAnimating || transitionCoordinator != nil)
                            // Never animate when hiding the tab bar. We mostly want this when popping back
                            // to a screen that has the tab bar hidden (since the snapshot was rendered
                            // with a hidden tab bar). Maybe we can refine this to say if we're animating a
                            // pop disable any tab bar change animation.
                            && !newIsTabBarHidden)
                )
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

    /// The latest navigation entry we've presented modally or null if we haven't
    /// presented a navigation entry modally.
    fileprivate var modalPresentedViewController: WebNavigationEntryController? {
        var viewController = presentedViewController as? WebNavigationEntryController

        while let currentViewController = viewController {
            if let newViewController = currentViewController.presentedViewController
                as? WebNavigationEntryController
            {
                viewController = newViewController
            } else {
                break
            }
        }

        return viewController
    }

    /// The previous navigation entry we've presented modally or null if we haven't
    /// presented a navigation entry modally.
    fileprivate var previousModalPresentedViewController: WebNavigationEntryController? {
        var previousViewController: WebNavigationEntryController? = nil
        var viewController = presentedViewController as? WebNavigationEntryController

        while let currentViewController = viewController {
            if let newViewController = currentViewController.presentedViewController
                as? WebNavigationEntryController
            {
                previousViewController = viewController
                viewController = newViewController
            } else {
                break
            }
        }

        return previousViewController
    }

    private var preparingNavigationEntry: WebNavigationEntry?
    private var hasAddedMainScrollViewWhilePreparingNavigation = false

    init(
        scene: UIScene,
        initialTab: Tab,
        initialPath: String,
        initialPathByTab: InitialPathByTab,
        websiteDataStore: WKWebsiteDataStore
    ) {
        self.scene = scene

        let initialUrl = URL(string: initialPath, relativeTo: WebNavigationController.baseUrl)!

        logger.info("Initializing at: \(initialUrl.absoluteString, privacy: .public)")

        self.currentTab = initialTab
        self.initialPathByTab = initialPathByTab

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
                source: createWebBridgeSource(initialTab: initialTab),
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

        weakScriptMessageHandler = WeakScriptMessageHandler()

        super.init(nibName: nil, bundle: nil)

        // Web code is responsible for displaying a navigation bar.
        navigationBar.isHidden = true

        // Render content underneath opaque bars like the tab bar. We make sure content
        // isn't hidden by opaque bars in web code.
        extendedLayoutIncludesOpaqueBars = true

        // `webConfiguration.userContentController.add()` creates a strong reference to
        // the script handler object. So we have an intermediate
        // `weakScriptMessageHandler` that holds a weak reference to `self` to avoid a
        // retain cycle.
        weakScriptMessageHandler.delegate = self
        webConfiguration.userContentController.add(
            weakScriptMessageHandler,
            name: "NativeMobileBridge"
        )
        webConfiguration.userContentController.addScriptMessageHandler(
            weakScriptMessageHandler,
            contentWorld: WKContentWorld.page,
            name: "NativeMobileBridgeWithReply"
        )

        initWebView()

        remoteNotificationDeviceTokenCountObservation = AppDelegate.shared.observe(
            \.remoteNotificationDeviceTokenCount,
            options: []
        ) { [weak self] _, _ in
            guard let this = self else { return }

            this.webView.evaluateJavaScript(
                "window.__NativeMobileBridge.notifications._callIosDeviceTokensUpdate()"
            )
        }

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

        // Subscribe to scene foreground/background notifications. So we can prepare
        // for WebKit suspending our web process.
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(sceneDidActivate(notification:)),
            name: UIScene.didActivateNotification,
            object: scene
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(sceneDidEnterBackground(notification:)),
            name: UIScene.didEnterBackgroundNotification,
            object: scene
        )

        let request = URLRequest(url: initialUrl)
        webView.load(request)

        if initialPath == initialPathByTab.get(initialTab) {
            viewControllers = [
                WebNavigationEntryController(
                    entry: WebNavigationEntry(),
                    url: initialUrl,
                    webNavigationController: self,
                    webView: webView,
                    healthState: webViewHealthState
                )
            ]
        } else {
            viewControllers = [
                WebNavigationEntryController(
                    entry: WebNavigationEntry(),
                    url: URL(
                        string: initialPathByTab.get(initialTab),
                        relativeTo: WebNavigationController.baseUrl
                    )!,
                    webNavigationController: self,
                    webView: webView,
                    healthState: webViewHealthState
                ),
                WebNavigationEntryController(
                    entry: WebNavigationEntry(),
                    url: initialUrl,
                    webNavigationController: self,
                    webView: webView,
                    healthState: webViewHealthState
                ),
            ]
        }

        initWebViewHealthTimer()
    }

    required init(coder: NSCoder) { fatalError("Unimplemented") }

    deinit {
        let url = webView.url
        logger.info("Deinitializing at: \(url?.absoluteString ?? "nil", privacy: .public)")

        remoteNotificationDeviceTokenCountObservation?.invalidate()
        remoteNotificationDeviceTokenCountObservation = nil

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

        if let scene = scene {
            NotificationCenter.default.removeObserver(
                self,
                name: UIScene.didEnterBackgroundNotification,
                object: scene
            )
            NotificationCenter.default.removeObserver(
                self,
                name: UIScene.didActivateNotification,
                object: scene
            )
        }
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

        // Don't allow scrolling the root scroll view. Scrolling should happen in
        // subviews. When the keyboard opens WebKit will want to scroll the root scroll
        // view.
        webView.scrollView.isScrollEnabled = false
        if #available(iOS 17.0, *) { webView.scrollView.allowsKeyboardScrolling = false }

        // We don't want Safari showing previews of links on long press. Since many
        // links navigate within the app. However, setting this to false also prevents
        // Safari's touch callout from opening when long pressing an image. Which we
        // depend on in `<ContentFileViewerModalMobile>` to allow the user to
        // download/share an image. They long press. So we need to leave this option on
        // to allow image touch callouts and find other ways to disable link touch
        // callouts.
        webView.allowsLinkPreview = true

        // As a final fallback, we set ourselves as the scroll view delegate and reset
        // scroll position to 0 if it ever changes.
        webView.scrollView.delegate = self

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
        NotificationCenter.default.removeObserver(
            webView,
            name: UIResponder.keyboardDidHideNotification,
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
        // NOTE(calebmer): Captures `self` weakly out of an abundance of caution to try
        // avoid creating a retain cycle. It's unclear to me whether or not a strong
        // reference would actually cause issues.
        return UIColor { [weak self] (traits) in
            traits.userInterfaceStyle == .dark
                ? self?.theme60Color ?? UIColor(named: "theme-60")!
                : self?.theme50Color ?? UIColor(named: "theme-50")!
        }
    }

    private func initWebViewHealthTimer() {
        self.webViewHealthTimer?.invalidate()
        self.webViewHealthTimer = nil

        // If we haven't received a ping from the web view in 1s then we consider the
        // web view unhealthy and ask the user to reload. If we aren't getting pings it
        // means our JavaScript code or React code has crashed. We should receive a
        // ping from our web view every 0.5s.
        let webViewHealthTimer = Timer(timeInterval: 0.5, repeats: true) {
            [weak self] (thisTimer) in
            guard let this = self else {
                thisTimer.invalidate()
                return
            }

            // If we've already marked the web view as unhealthy, we don't need to check
            // ping times anymore.
            guard this.webViewHealthState.isHealthy else { return }

            if this.didSceneEnterBackground {
                // This hopefully keeps the web view alive for 30s after the app's been
                // backgrounded. So if the user quickly switches to another app then back we
                // won't lose their state. It's unfortunate we only get 30s before we lose the
                // user's state but that's how Apple's decided to implement WebKit for healthy
                // resource utilization purposes.
                //
                // We believe this should work based on [this radar issue][1] and [this
                // StackOverflow answer][2] but have not extensively tested ourselves.
                //
                // We believe in [WebKit's source code `XPCConnectionTerminationWatchdog`][3]
                // is what's keeping our process alive. XPC standing for cross-process
                // communication.
                //
                // We don't use the `window.__nativeMobileKeepAliveCount` variable we're
                // updating. The theory is that doing something will make sure the garbage
                // collector / optimizer doesn't consider this timeout as dead code.
                //
                // [1]: https://openradar.appspot.com/7739943
                // [2]: https://stackoverflow.com/a/40739474/1568890
                // [3]: https://github.com/WebKit/WebKit/blob/5d6df46811480fb26abf29a0e34dc90ef720927e/Source/WebKit/UIProcess/Cocoa/AuxiliaryProcessProxyCocoa.mm#L70-L73
                this.webView.evaluateJavaScript(
                    "setTimeout(() => { window.__nativeMobileKeepAliveCount = (window.__nativeMobileKeepAliveCount || 0) + 1 }, 1000)"
                )
            }

            if let lastPingTime = this.webViewHealthState.lastPingTime {
                let currentTime = DispatchTime.now()

                if lastPingTime.distance(to: currentTime).toSeconds() > 1 {
                    // When backgrounded we may stop receiving pings from the web view. So when our
                    // application becomes active again, wait a bit for pings from the web view to
                    // resume.
                    let hasApplicationRecentlyBecomeActive =
                        if let sceneDidActivateTime = this.lastSceneDidActivateNotificationTime {
                            sceneDidActivateTime > lastPingTime
                                && sceneDidActivateTime.distance(to: currentTime).toSeconds() <= 2
                        } else { false }

                    if !hasApplicationRecentlyBecomeActive {
                        // We can't assign to `webViewHealthState.isHealthy` and
                        // `webViewHealthState.shouldSuppressUnhealthyAlert` individually since
                        // `didSet` should only run once.
                        this.webViewHealthState = WebViewHealthState(
                            readyTime: this.webViewHealthState.readyTime,
                            lastPingTime: this.webViewHealthState.lastPingTime,
                            provisionalNavigation: this.webViewHealthState.provisionalNavigation,
                            isHealthy: false,
                            // Suppress unhealthy alert until we've activated again.
                            shouldSuppressUnhealthyAlert: this.didSceneEnterBackground
                        )
                    }
                }
            } else if let readyTime = this.webViewHealthState.readyTime {
                let currentTime = DispatchTime.now()

                if readyTime.distance(to: currentTime).toSeconds() > 5 {
                    // When backgrounded we may stop receiving pings from the web view. So when our
                    // application becomes active again, wait a bit for pings from the web view to
                    // resume.
                    let hasApplicationRecentlyBecomeActive =
                        if let sceneDidActivateTime = this.lastSceneDidActivateNotificationTime {
                            sceneDidActivateTime > readyTime
                                && sceneDidActivateTime.distance(to: currentTime).toSeconds() <= 2
                        } else { false }

                    if !hasApplicationRecentlyBecomeActive {
                        // We can't assign to `webViewHealthState.isHealthy` and
                        // `webViewHealthState.shouldSuppressUnhealthyAlert` individually since
                        // `didSet` should only run once.
                        this.webViewHealthState = WebViewHealthState(
                            readyTime: this.webViewHealthState.readyTime,
                            lastPingTime: this.webViewHealthState.lastPingTime,
                            provisionalNavigation: this.webViewHealthState.provisionalNavigation,
                            isHealthy: false,
                            // Suppress unhealthy alert until we've activated again.
                            shouldSuppressUnhealthyAlert: this.didSceneEnterBackground
                        )
                    }
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
        let url = webView.url ?? (topViewController as! WebNavigationEntryController).url

        logger.info("Force reloading to: \(url.absoluteString, privacy: .public)")

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
            isHealthy: true,
            shouldSuppressUnhealthyAlert: false
        )

        webView.load(URLRequest(url: url))
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
        logger.info(
            "Started navigation to: \(webView.url?.absoluteString ?? "nil", privacy: .public)"
        )

        cleanupModalPresentedViewController()

        // Dismiss any other presented view controllers (like alerts) on reload. Except
        // the loading indicator. We wait until `health.ready` is called before
        // dismissing the loading indicator.
        if !(presentedViewController is WebLoadingIndicatorController) { dismiss(animated: false) }

        webViewHealthState.provisionalNavigation = navigation
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        logger.info(
            "Committed navigation to: \(webView.url?.absoluteString ?? "nil", privacy: .public)"
        )

        if webViewHealthState.provisionalNavigation === navigation {
            // Reset health state now that we have a new navigation.
            webViewHealthState = WebViewHealthState(
                readyTime: nil,
                lastPingTime: nil,
                provisionalNavigation: nil,
                navigationError: nil,
                isHealthy: true,
                shouldSuppressUnhealthyAlert: false
            )
        }

        hasInitialWebViewNavigationCommit = true

        // We need to execute the JavaScript to set the CSS safe area inset variables
        // but we don't need to call `setAllWebScrollViewScrollIndicatorInsets()`
        // again.
        actuallySetWindowSafeAreaInsets(windowSafeAreaInsets)

        // If we finished a new navigation then web code won't know it needs to
        // reset the substitute opened by the previous web process. Reset it here.
        cleanupAfterKeyboardWebSubstitute()

        // Clear tab bar state for view controllers since after a reload each route
        // doesn't remember its scroll state.
        for viewController in viewControllers {
            (viewController as! WebNavigationEntryController).entry.tabBarState = nil
        }

        // Reset any `hideTabBar()` calls after we finish loading.
        hideTabBarCount = 0
    }

    func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: Error
    ) {
        let url = webView.url ?? (topViewController as! WebNavigationEntryController).url

        logger.error(
            "Failed navigation (code: \(String((error as NSError).code), privacy: .public), \"\(error.localizedDescription, privacy: .public)\") to: \(url.absoluteString, privacy: .public)"
        )

        if webViewHealthState.provisionalNavigation === navigation {
            webViewHealthState.navigationError = error
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        let url = webView.url ?? (topViewController as! WebNavigationEntryController).url

        logger.error(
            "Failed navigation (code: \(String((error as NSError).code), privacy: .public), \"\(error.localizedDescription, privacy: .public)\") to: \(url.absoluteString, privacy: .public)"
        )

        if webViewHealthState.provisionalNavigation === navigation {
            webViewHealthState.navigationError = error
        }
    }

    // To test this, if you're running the app in a simulator run the following
    // command:
    //
    // ```
    // kill $(pgrep -P $(pgrep launchd_sim) 'com.apple.WebKit.WebContent')
    // ```
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        logger.info("Web process terminated")

        // If the web process terminated while in the foreground, reload and carry on.
        // If it terminated while in the background we need to wait for the app to be
        // foregrounded before reloading.
        if !didSceneEnterBackground {
            webView.reload()
        } else {
            // We can't assign to `webViewHealthState.isHealthy` and
            // `webViewHealthState.shouldSuppressUnhealthyAlert` individually since
            // `didSet` should only run once.
            webViewHealthState = WebViewHealthState(
                readyTime: webViewHealthState.readyTime,
                lastPingTime: webViewHealthState.lastPingTime,
                provisionalNavigation: webViewHealthState.provisionalNavigation,
                isHealthy: false,
                // Suppress unhealthy alert until we've activated again.
                shouldSuppressUnhealthyAlert: true
            )
        }
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
            preparingNavigationEntry = WebNavigationEntry()
            hasAddedMainScrollViewWhilePreparingNavigation = false

            cleanupModalPresentedViewController()

            isNavigationAnimating = true

            // Beware! If `NativeMobileBridge.navigation.push()` is not promptly called the
            // app will appear frozen.
            (topViewController! as! WebNavigationEntryController).replaceWebViewWithSnapshotView()

            return nil
        } else if prompt == "%%%navigation.prepareExternalPop" {
            // This may be called in either an immediate external pop or an eventual
            // external pop.
            //
            // - In an immediate external pop (from
            //   `propagateImmediateExternalPopNavigation()`) `preparingNavigationEntry`
            //   will be non-nill and `topViewController` will already have a snapshot.
            //
            // - In an eventual external pop (from `requestEventualExternalPop()`)
            //   `preparingNavigationEntry` will be nil, we won't have taken a snapshot of
            //   the top view controller yet, and we'll need to run the pop animation when
            //   `externalPop()` is called. So take a snapshot now before the web view
            //   re-render happens.
            if preparingNavigationEntry == nil {
                preparingNavigationEntry =
                    (viewControllers.count > 1
                    ? viewControllers[viewControllers.count - 2] as! WebNavigationEntryController
                    : topViewController! as! WebNavigationEntryController)
                    .entry
                hasAddedMainScrollViewWhilePreparingNavigation = false

                isNavigationAnimating = true

                cleanupModalPresentedViewController()

                // Beware! If `NativeMobileBridge.navigation.externalPop()` is not promptly
                // called the app will appear frozen.
                (topViewController! as! WebNavigationEntryController)
                    .replaceWebViewWithSnapshotView()
            }

            return nil
        } else if prompt.starts(with: "%%%navigation.preparePop:") {
            let urlString = prompt.suffix(from: prompt.index(prompt.startIndex, offsetBy: 25))
            let url = URL(string: String(urlString))!

            let viewController = viewControllers.last(where: { (viewController) in
                (viewController as! WebNavigationEntryController).url.absoluteString
                    == url.absoluteString
            })

            preparingNavigationEntry =
                ((viewController ?? topViewController) as! WebNavigationEntryController).entry
            hasAddedMainScrollViewWhilePreparingNavigation = false

            cleanupModalPresentedViewController()

            isNavigationAnimating = true

            // Beware! If `NativeMobileBridge.navigation.pop()` is not promptly called the
            // app will appear frozen.
            (topViewController! as! WebNavigationEntryController).replaceWebViewWithSnapshotView()

            return nil
        } else if prompt == "%%%navigation.prepareReplaceWithPushAnimation" {
            preparingNavigationEntry = (topViewController as! WebNavigationEntryController).entry
            hasAddedMainScrollViewWhilePreparingNavigation = false

            cleanupModalPresentedViewController()

            isNavigationAnimating = true

            // Beware! If `NativeMobileBridge.navigation.replaceWithPushAnimation()` is not
            // promptly called the app will appear frozen.
            (topViewController! as! WebNavigationEntryController).replaceWebViewWithSnapshotView()

            return nil
        } else if prompt == "%%%navigation.preparePresentModal" {
            preparingNavigationEntry = WebNavigationEntry()
            hasAddedMainScrollViewWhilePreparingNavigation = false

            isNavigationAnimating = true

            // Beware! If `NativeMobileBridge.navigation.presentModal()` is not promptly called
            // the app will appear frozen.
            (modalPresentedViewController ?? topViewController! as! WebNavigationEntryController)
                .replaceWebViewWithSnapshotView()

            return nil
        } else if prompt == "%%%navigation.prepareDismissModal" {
            preparingNavigationEntry = (topViewController as! WebNavigationEntryController).entry
            hasAddedMainScrollViewWhilePreparingNavigation = false

            isNavigationAnimating = true

            // Beware! If `NativeMobileBridge.navigation.dismissModal()` is not promptly
            // called the app will appear frozen.
            modalPresentedViewController?.replaceWebViewWithSnapshotView()

            return nil
        } else if prompt.starts(with: "%%%navigation.prepareSwitchTab:") {
            let tabString = prompt.suffix(from: prompt.index(prompt.startIndex, offsetBy: 31))
            let tab = Tab.fromString(tabString)!

            preparingNavigationEntry =
                (viewControllersByInactiveTab[tab]?.last as? WebNavigationEntryController)?.entry
                ?? WebNavigationEntry()
            hasAddedMainScrollViewWhilePreparingNavigation = false

            cleanupModalPresentedViewController()

            // Beware! If `NativeMobileBridge.navigation.switchTab()` is not promptly called the
            // app will appear frozen.
            (topViewController! as! WebNavigationEntryController).replaceWebViewWithSnapshotView()

            return nil
        } else {
            // Unrecognized prompt command. Do nothing.
            return nil
        }
    }

    @objc
    private class WeakScriptMessageHandler: NSObject, WKScriptMessageHandler,
        WKScriptMessageHandlerWithReply
    {
        weak var delegate: (WKScriptMessageHandler & WKScriptMessageHandlerWithReply)?

        func userContentController(
            _ userContentController: WKUserContentController,
            didReceive message: WKScriptMessage
        ) { delegate?.userContentController(userContentController, didReceive: message) }

        func userContentController(
            _ userContentController: WKUserContentController,
            didReceive message: WKScriptMessage,
            replyHandler: @escaping (Any?, String?) -> Void
        ) {
            delegate?
                .userContentController(
                    userContentController,
                    didReceive: message,
                    replyHandler: replyHandler
                )
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

            logger.info("Push navigation to: \(url.absoluteString, privacy: .public)")

            let viewController = WebNavigationEntryController(
                entry: preparingNavigationEntry ?? WebNavigationEntry(),
                url: url,
                webNavigationController: self,
                webView: webView,
                healthState: webViewHealthState
            )

            webDelegate?.webNavigationController?(
                self,
                didNavigate: viewController.entry,
                hasMainScrollView: hasAddedMainScrollViewWhilePreparingNavigation
            )

            preparingNavigationEntry = nil
            hasAddedMainScrollViewWhilePreparingNavigation = false

            super.pushViewController(viewController, animated: true)

            let completion = { [weak self] in
                guard let this = self else { return }

                this.isNavigationAnimating = false

                if this.isAfterNavigationAnimationCallbackScheduled {
                    this.isAfterNavigationAnimationCallbackScheduled = false
                    this.webView.evaluateJavaScript(
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
        } else if messageBody == "navigation.externalPop" {
            cleanupModalPresentedViewController()

            webDelegate?.webNavigationController?(
                self,
                didNavigate: (topViewController! as! WebNavigationEntryController).entry,
                hasMainScrollView: hasAddedMainScrollViewWhilePreparingNavigation
            )

            preparingNavigationEntry = nil
            hasAddedMainScrollViewWhilePreparingNavigation = false

            // - In an immediate external pop (from
            //   `propagateImmediateExternalPopNavigation()`) `isNavigationAnimating` is
            //   false since the animation already happened. We only need to put the web
            //   view back in the top view controller.
            //
            // - In an eventual external pop (from `requestEventualExternalPop()`)
            //   `isNavigationAnimating` is true and we'll need to run the pop animation.
            //
            // See how we handle `prepareExternalPop()` for more information.
            if !isNavigationAnimating {
                logger.info(
                    "External pop navigation to: \((self.topViewController! as! WebNavigationEntryController).url.absoluteString, privacy: .public)"
                )

                (topViewController! as! WebNavigationEntryController).moveWebViewInto(webView)
            } else {
                let viewController =
                    ((viewControllers.count > 1
                        ? viewControllers[viewControllers.count - 2] : topViewController!)
                        as! WebNavigationEntryController)

                logger.info(
                    "External pop navigation to: \(viewController.url.absoluteString, privacy: .public)"
                )

                viewController.moveWebViewInto(webView)

                super.popViewController(animated: true)

                let completion = { [weak self] in
                    guard let this = self else { return }

                    this.isNavigationAnimating = false

                    if this.isAfterNavigationAnimationCallbackScheduled {
                        this.isAfterNavigationAnimationCallbackScheduled = false
                        this.webView.evaluateJavaScript(
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
            }
        } else if messageBody.starts(with: "navigation.pop:") {
            cleanupModalPresentedViewController()

            let urlString = messageBody.suffix(
                from: messageBody.index(messageBody.startIndex, offsetBy: 15)
            )
            let url = URL(string: String(urlString))!

            logger.info("Pop navigation to: \(url.absoluteString, privacy: .public)")

            let viewController = viewControllers.last(where: { (viewController) in
                (viewController as! WebNavigationEntryController).url.absoluteString
                    == url.absoluteString
            })

            webDelegate?.webNavigationController?(
                self,
                didNavigate: ((viewController ?? topViewController) as! WebNavigationEntryController)
                    .entry,
                hasMainScrollView: hasAddedMainScrollViewWhilePreparingNavigation
            )

            preparingNavigationEntry = nil
            hasAddedMainScrollViewWhilePreparingNavigation = false

            let completion = { [weak self] in
                guard let this = self else { return }

                this.isNavigationAnimating = false

                if this.isAfterNavigationAnimationCallbackScheduled {
                    this.isAfterNavigationAnimationCallbackScheduled = false
                    this.webView.evaluateJavaScript(
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
        } else if messageBody == "navigation.requestEventualExternalPop" {
            logger.info("Requested eventual external pop")

            // Instead of calling `popViewController()`, tell web about the external pop
            // and wait for web to call `prepareExternalPop()` to replace the current view
            // with a snapshot view. This keeps the app responsive while loading the popped
            // route.
            if viewControllers.count > 1 {
                let nextViewController =
                    viewControllers[viewControllers.count - 2] as! WebNavigationEntryController

                callNavigationExternalPopListeners(delta: 1, url: nextViewController.url)
            }
        } else if messageBody.starts(with: "navigation.replace:") {
            let urlString = messageBody.suffix(
                from: messageBody.index(messageBody.startIndex, offsetBy: 19)
            )
            let url = URL(string: String(urlString))!

            logger.info("Replace navigation to: \(url.absoluteString, privacy: .public)")

            // If the modal view controller is open it represents the same navigation stack
            // entry as the top view controller. When the modal is dismissed the top view
            // controller will be reinstated as the main view controller for the navigation
            // stack entry.
            if let modalPresentedViewController = modalPresentedViewController {
                modalPresentedViewController.url = url
            }
            (topViewController! as! WebNavigationEntryController).url = url
        } else if messageBody.starts(with: "navigation.replaceWithPushAnimation:") {
            cleanupModalPresentedViewController()

            let urlString = messageBody.suffix(
                from: messageBody.index(messageBody.startIndex, offsetBy: 36)
            )
            let url = URL(string: String(urlString))!

            logger.info(
                "Replace with push animation navigation to: \(url.absoluteString, privacy: .public)"
            )

            let viewController = WebNavigationEntryController(
                entry: preparingNavigationEntry ?? WebNavigationEntry(),
                url: url,
                webNavigationController: self,
                webView: webView,
                healthState: webViewHealthState
            )

            var newViewControllers = Array(viewControllers.prefix(viewControllers.count - 1))
            newViewControllers.append(viewController)

            webDelegate?.webNavigationController?(
                self,
                didNavigate: viewController.entry,
                hasMainScrollView: hasAddedMainScrollViewWhilePreparingNavigation
            )

            preparingNavigationEntry = nil
            hasAddedMainScrollViewWhilePreparingNavigation = false

            super.setViewControllers(newViewControllers, animated: true)

            let completion = { [weak self] in
                guard let this = self else { return }

                this.isNavigationAnimating = false

                if this.isAfterNavigationAnimationCallbackScheduled {
                    this.isAfterNavigationAnimationCallbackScheduled = false
                    this.webView.evaluateJavaScript(
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
        } else if messageBody == "navigation.presentModal" {
            logger.info("Present modal navigation")

            let viewController = WebNavigationEntryController(
                entry: preparingNavigationEntry ?? WebNavigationEntry(),
                url: (topViewController! as! WebNavigationEntryController).url,
                webNavigationController: self,
                webView: webView,
                healthState: webViewHealthState
            )

            webDelegate?.webNavigationController?(
                self,
                didNavigate: (topViewController! as! WebNavigationEntryController).entry,
                hasMainScrollView: hasAddedMainScrollViewWhilePreparingNavigation
            )

            preparingNavigationEntry = nil
            hasAddedMainScrollViewWhilePreparingNavigation = false

            (modalPresentedViewController ?? (topViewController as! WebNavigationEntryController))
                .present(viewController, animated: true) { [weak self] in
                    guard let this = self else { return }

                    this.isNavigationAnimating = false

                    if this.isAfterNavigationAnimationCallbackScheduled {
                        this.isAfterNavigationAnimationCallbackScheduled = false
                        this.webView.evaluateJavaScript(
                            "window.__NativeMobileBridge.navigation._callScheduledAfterAnimationCallbacks()"
                        )
                    }
                }
        } else if messageBody == "navigation.dismissModal" {
            logger.info("Dismiss modal navigation")

            ((previousModalPresentedViewController ?? topViewController)
                as! WebNavigationEntryController)
                .moveWebViewInto(webView)

            webDelegate?.webNavigationController?(
                self,
                didNavigate: (topViewController! as! WebNavigationEntryController).entry,
                hasMainScrollView: hasAddedMainScrollViewWhilePreparingNavigation
            )

            preparingNavigationEntry = nil
            hasAddedMainScrollViewWhilePreparingNavigation = false

            (previousModalPresentedViewController ?? topViewController!)
                .dismiss(animated: true) { [weak self] in
                    guard let this = self else { return }

                    this.isNavigationAnimating = false

                    if this.isAfterNavigationAnimationCallbackScheduled {
                        this.isAfterNavigationAnimationCallbackScheduled = false
                        this.webView.evaluateJavaScript(
                            "window.__NativeMobileBridge.navigation._callScheduledAfterAnimationCallbacks()"
                        )
                    }
                }
        } else if messageBody.starts(with: "navigation.switchTab:") {
            cleanupModalPresentedViewController()

            let optionsString = messageBody.suffix(
                from: messageBody.index(messageBody.startIndex, offsetBy: 21)
            )
            let optionStrings = optionsString.split(separator: ",", maxSplits: 2)

            let tab = Tab.fromString(optionStrings[0])!

            let urlString = optionStrings[1]
            let url = URL(string: String(urlString))!

            logger.info(
                "Switch tab (`\(String(describing: tab), privacy: .public)`) navigation to: \(url.absoluteString, privacy: .public)"
            )

            viewControllersByInactiveTab[currentTab] = viewControllers
            currentTab = tab

            viewControllers = viewControllersByInactiveTab[tab] ?? []
            viewControllersByInactiveTab.removeValue(forKey: tab)

            var viewController: WebNavigationEntryController
            if let topViewController = self.topViewController {
                viewController = topViewController as! WebNavigationEntryController
                viewController.url = url
                viewController.moveWebViewInto(webView)
            } else {
                viewController = WebNavigationEntryController(
                    entry: preparingNavigationEntry ?? WebNavigationEntry(),
                    url: url,
                    webNavigationController: self,
                    webView: webView,
                    healthState: webViewHealthState
                )
                viewControllers.append(viewController)
            }

            webDelegate?.webNavigationController?(
                self,
                didNavigate: viewController.entry,
                hasMainScrollView: hasAddedMainScrollViewWhilePreparingNavigation
            )

            preparingNavigationEntry = nil
            hasAddedMainScrollViewWhilePreparingNavigation = false
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

            theme10Color = (colors.count >= 1 ? colors[0] : nil) ?? UIColor(named: "indigo-10")!
            theme20Color = (colors.count >= 2 ? colors[1] : nil) ?? UIColor(named: "indigo-20")!
            theme30Color = (colors.count >= 3 ? colors[2] : nil) ?? UIColor(named: "indigo-30")!
            theme40Color = (colors.count >= 4 ? colors[3] : nil) ?? UIColor(named: "indigo-40")!
            theme50Color = (colors.count >= 5 ? colors[4] : nil) ?? UIColor(named: "indigo-50")!
            theme60Color = (colors.count >= 6 ? colors[5] : nil) ?? UIColor(named: "indigo-60")!
            theme70Color = (colors.count >= 7 ? colors[6] : nil) ?? UIColor(named: "indigo-70")!
            theme80Color = (colors.count >= 8 ? colors[7] : nil) ?? UIColor(named: "indigo-80")!
            theme90Color = (colors.count >= 9 ? colors[8] : nil) ?? UIColor(named: "indigo-90")!

            // Use the space theme color as the tint color. The tint color will be used as
            // the selection and caret color among other things.
            //
            // We set it again here so the web view re-renders?
            webView.tintColor = initThemeTintColor()
        } else if messageBody == "session.signOut" {
            webDelegate?.webNavigationController?(signOut: self)
        } else if messageBody.starts(with: "session.switchSpace:") {
            let spaceId = messageBody.suffix(
                from: messageBody.index(messageBody.startIndex, offsetBy: 20)
            )

            webDelegate?.webNavigationController?(self, switchSpace: String(spaceId))
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
                        handler: { [weak self] (_) in
                            guard let this = self else { return }

                            this.webView.evaluateJavaScript(
                                "window.__NativeMobileBridge._callCallbackById(\(options.onCancelButtonPressCallbackId))"
                            )
                        }
                    )
                )
            }

            let primaryAction = UIAlertAction(
                title: options.primaryButtonLabel,
                style: .default,
                handler: { [weak self] (_) in
                    guard let this = self else { return }

                    this.webView.evaluateJavaScript(
                        "window.__NativeMobileBridge._callCallbackById(\(options.onPrimaryButtonPressCallbackId))"
                    )
                }
            )
            if options.isPrimaryButtonDisabled ?? false { primaryAction.isEnabled = false }
            alertController.addAction(primaryAction)
            alertController.preferredAction = primaryAction

            (modalPresentedViewController ?? topViewController)!
                .present(alertController, animated: true)
        } else if messageBody == "editMenu.enableAddCommentAction" {
            setSwizzledWKWebViewAddCommentEditMenuAction(
                webView,
                action: { [weak self] in
                    self?.webView
                        .evaluateJavaScript(
                            "window.__NativeMobileBridge.editMenu._callAddCommentActionListeners()"
                        )
                }
            )
        } else if messageBody == "editMenu.disableAddCommentAction" {
            setSwizzledWKWebViewAddCommentEditMenuAction(webView, action: nil)
        } else if messageBody.starts(with: "tabBar.hide:") {
            let isAnimatedString = messageBody.suffix(
                from: messageBody.index(messageBody.startIndex, offsetBy: 15)
            )

            isHideTabBarChangeAnimated = isAnimatedString == "true"
            hideTabBarCount += 1
            isHideTabBarChangeAnimated = nil
        } else if messageBody.starts(with: "tabBar.unhide:") {
            let isAnimatedString = messageBody.suffix(
                from: messageBody.index(messageBody.startIndex, offsetBy: 14)
            )

            isHideTabBarChangeAnimated = isAnimatedString == "true"
            hideTabBarCount -= 1
            isHideTabBarChangeAnimated = nil
        } else if messageBody == "tabBar.clearInboxNotificationBadge" {
            webDelegate?.webNavigationController?(clearInboxNotificationBadge: self)
        } else if messageBody.starts(with: "tabBar.setInboxLoudNotificationBadge:") {
            let loudNotificationCountString = messageBody.suffix(
                from: messageBody.index(messageBody.startIndex, offsetBy: 37)
            )

            let loudNotificationCount = Int(loudNotificationCountString)!

            webDelegate?.webNavigationController?(
                self,
                setInboxLoudNotificationBadge: loudNotificationCount
            )
        } else if messageBody == "tabBar.setInboxSubtleNotificationBadge" {
            webDelegate?.webNavigationController?(setInboxSubtleNotificationBadge: self)
        } else if messageBody == "scrollbar.updateAllInsets" {
            setAllWebScrollViewScrollIndicatorInsets()
        } else if messageBody == "haptic.playLightImpact" {
            let generator = UIImpactFeedbackGenerator(style: .light)
            generator.impactOccurred()
        } else if messageBody == "haptic.playMediumImpact" {
            let generator = UIImpactFeedbackGenerator(style: .medium)
            generator.impactOccurred()
        } else if messageBody == "haptic.playHeavyImpact" {
            let generator = UIImpactFeedbackGenerator(style: .heavy)
            generator.impactOccurred()
        } else if messageBody == "haptic.playSelectionChanged" {
            let generator = UISelectionFeedbackGenerator()
            generator.selectionChanged()
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
        } else if messageBody == "notifications.takeAppleDeviceTokens" {
            let deviceTokens = AppDelegate.shared.takeRemoteNotificationDeviceTokens()
            replyHandler(deviceTokens.map { [UInt8]($0) }, nil)
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
                ),
                // We've observed that `UIScrollViewDelegate.scrollViewDidScroll(_:)` is not
                // called after the `UIScrollView` has resized. This is not documented
                // anywhere. So watch when `bounds` changes and call
                // `UIScrollViewDelegate.scrollViewDidScroll(_:)` whenever the width or height
                // changes even if the content offset didn't change. The delegate's
                // `UIScrollViewDelegate.scrollViewDidScroll(_:)` implementation must be
                // idempotent since there may not have actually been a scroll when it's
                // called.
                resizeObserver: UIViewResizeObserver(
                    view: webScrollView,
                    action: { [weak self] in self?.scrollViewDidScroll(webScrollView) }
                )
            )

            // We're ok with a strong reference to `self` since this runs on the next turn
            // of the run loop.
            schedule { [self] in
                // Make sure scroll view wasn't removed.
                guard webScrollViews[webScrollView] != nil else { return }

                // Don't consider safe area insets in our main scroll view determination
                // calculation.
                let viewFrameForMainDetermination = view.bounds.inset(by: windowSafeAreaInsets)

                // Only consider scroll view bounds that are visible onscreen for determining
                // whether this is a main scroll view. This is for comment threads in
                // `<DocumentContentEditor>` who have a scroll view that extends below the
                // screen which shouldn't be considered main.
                let webScrollViewFrameForMainDetermination =
                    webScrollView.convert(webScrollView.bounds, to: view)
                    .intersection(viewFrameForMainDetermination)

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
                    webScrollViewFrameForMainDetermination.width >= viewFrameForMainDetermination
                    .width * 0.5
                    // 225px is selected to exclude the document comment thread bottom sheet that
                    // opens when you tap a comment but include new chat views.
                    && webScrollViewFrameForMainDetermination.height
                        >= viewFrameForMainDetermination.height - 225

                webScrollViews[webScrollView]!.isMain = isMain

                setWebScrollViewScrollIndicatorInsets(webScrollView)

                // The main scrollbar pushes the keyboard down when it scrolls.
                if isMain { webScrollView.keyboardDismissMode = .interactive }

                webDelegate?.webNavigationController?(
                    self,
                    didAddWebScrollView: webScrollView,
                    // Used our prepared navigation entry while...preparing a navigation. Since the
                    // top view controller doesn't represent what we're actively rendering.
                    navigationEntry: preparingNavigationEntry
                        ?? (modalPresentedViewController
                        ?? (topViewController as! WebNavigationEntryController))
                        .entry,
                    isMain: isMain,
                    isAnimated: isAnimated
                )

                if isMain && preparingNavigationEntry != nil {
                    hasAddedMainScrollViewWhilePreparingNavigation = true
                }
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

            // We're ok with a strong reference to `self` since this runs on the next turn
            // of the run loop.
            schedule { [self] in
                // Make sure view wasn't removed while waiting for the `schedule` to run.
                guard webSubview.isDescendant(of: webView) else { return }

                if let match = try! WebNavigationController.bottomBarRegex.firstMatch(
                    in: (webSubview.layer.name ?? "")
                ) {
                    let webBottomBarViewType: WebBottomBarViewType =
                        if let typeMatch = match.2 {
                            if typeMatch == "wkt" {
                                .normal(withKeyboardToolbar: true)
                            } else if typeMatch == "gli" {
                                .globalLoadingIndicator
                            } else {
                                .keyboardToolbar
                            }
                        } else { .normal(withKeyboardToolbar: false) }

                    let webBottomBarViewState = WebBottomBarViewState(
                        id: String(match.1),
                        type: webBottomBarViewType,
                        reconcileTimer: nil,
                        resizeObserver: UIViewResizeObserver(
                            view: webBottomBarView,
                            action: { [weak self] in
                                // Whenever any bottom bar resizes, update everything that depends on the
                                // bottom bar's height.
                                self?.setAllWebScrollViewScrollIndicatorInsets()
                                self?.updateWebInputAccessoryObserverViewHeight()
                            }
                        )
                    )

                    webBottomBarViews[webBottomBarView] = webBottomBarViewState

                    updateWebBottomBarFrame(webBottomBarView, webBottomBarViewState)
                    updateAllWebMaskedViewMasks()
                    setAllWebScrollViewScrollIndicatorInsets()
                    updateWebInputAccessoryObserverViewHeight()
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
                && !type(of: webSubview).description().starts(with: "WKInspector")
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
        if let webScrollView = webSubview as? UIScrollView, webScrollView !== webView.scrollView {
            webScrollViews.removeValue(forKey: webScrollView)
        }

        if type(of: webSubview).description() == "WKCompositingView" {
            if webBottomBarViews[webSubview] != nil {
                let webBottomBarViewState = webBottomBarViews.removeValue(forKey: webSubview)
                webBottomBarViewState?.reconcileTimer?.invalidate()
                webBottomBarViewState?.reconcileTimer = nil

                setAllWebScrollViewScrollIndicatorInsets()
                updateWebInputAccessoryObserverViewHeight()
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
        if scrollView == webView.scrollView {
            // `WKWebView`'s document scroll view should never be scrolled! WebKit by
            // default scrolls the document when the keyboard is open even when
            // `overflow: hidden` is set on `<body>`. We have a number of protections in
            // place to prevent this and here is our last stand.
            if scrollView.contentOffset.y != 0 { scrollView.contentOffset.y = 0 }
        } else {
            webDelegate?.webNavigationController?(self, didScrollWebScrollView: scrollView)
        }
    }

    @objc private func keyboardWillShow(notification: NSNotification) {
        // `keyboardOffset` (which this function call uses) is updated in
        // `webInputAccessoryObserverView(_:didMoveTo:)`. This method happens to run
        // after that method.
        setAllWebScrollViewScrollIndicatorInsets()

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
            didMoveTo: webInputAccessoryObserverView?.getKeyboardOffset() ?? 0
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
                // We use `keyboardOffsetWithoutToolbar` for measuring the keyboard which is
                // populated by `webInputAccessoryObserverView` instead of
                // `notification.userInfo`'s `keyboardFrameBeginUserInfoKey` and
                // `keyboardFrameEndUserInfoKey`. We do this because
                // `webInputAccessoryObserverView` gives us the correct keyboard offset even
                // when the user is scrolling down to dismiss the keyboard and we want one
                // consistent keyboard height measurement everywhere.
                //
                // Also `notification.userInfo`'s `keyboardFrameBeginUserInfoKey` and
                // `keyboardFrameEndUserInfoKey` include the keyboard input accessory view's
                // height which we don't want.
                lastKeyboardOffsetWithoutToolbar, keyboardOffsetWithoutToolbar,
                shouldDisableScrollFromKeyboardFrameChange == 0,
                UIView.inheritedAnimationDuration > 0
            )
        )

        // After sending an update to web code, update
        // `lastKeyboardOffsetWithoutToolbar`.
        lastKeyboardOffsetWithoutToolbar = keyboardOffsetWithoutToolbar
    }

    @objc private func keyboardDidShow(notification: NSNotification) {
        logger.info("Keyboard was shown")

        keyboardAnimationState = nil

        if isAfterKeyboardAnimationCallbackScheduled {
            isAfterKeyboardAnimationCallbackScheduled = false

            webView.evaluateJavaScript(
                "window.__NativeMobileBridge.keyboard._callScheduledAfterAnimationCallbacks()"
            )
        }
    }

    @objc private func keyboardWillHide(notification: NSNotification) {
        keyboardWillHideCallCount += 1
        keyboardWillHideAnimationTimer?.invalidate()
        keyboardWillHideAnimationTimer = nil

        // `keyboardOffset` (which this function call uses) is updated in
        // `webInputAccessoryObserverView(_:didMoveTo:)`. This method happens to run
        // after that method.
        setAllWebScrollViewScrollIndicatorInsets()

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
            didMoveTo: webInputAccessoryObserverView?.getKeyboardOffset() ?? 0
        )

        let args = [
            "\(lastKeyboardOffsetWithoutToolbar)", "\(keyboardOffsetWithoutToolbar)",
            "\(shouldDisableScrollFromKeyboardFrameChange == 0)",
            // Don't animate the keyboard frame change if the app is backgrounded.
            "\(UIView.inheritedAnimationDuration > 0 && !didSceneEnterBackground)",
        ]
        .joined(separator: ", ")

        // Start animating the main content down but don't remove safe area insets
        // until the keyboard is fully hidden.
        webView.evaluateJavaScript(
            "window.__NativeMobileBridge.keyboard._callFrameChangeListeners(\(args))"
        )

        // After sending an update to web code, update
        // `lastKeyboardOffsetWithoutToolbar`.
        lastKeyboardOffsetWithoutToolbar = keyboardOffsetWithoutToolbar

        // We observe that `keyboardDidHide()` is called after ~500ms whereas
        // `animationDuration` is 250ms. We want to call our keyboard animation
        // listeners promptly once the keyboard closes (since keyboard animations block
        // navigation) so set a timer for when the keyboard animation completes and
        // call `keyboardDidHide()` ourselves if it hasn't been called yet.
        let timer = Timer.scheduledTimer(withTimeInterval: animationDuration, repeats: false) {
            [weak self] (_) in
            guard let this = self else { return }

            this.keyboardWillHideAnimationTimer = nil
            this.actuallyKeyboardDidHide()
        }

        // Add some tolerance to reduce timer energy impact.
        timer.tolerance = 0.05

        keyboardWillHideAnimationTimer = timer
    }

    @objc private func keyboardDidHide(notification: NSNotification) {
        logger.info("Keyboard was hidden")

        actuallyKeyboardDidHide()
    }

    private func actuallyKeyboardDidHide() {
        if keyboardWillHideCallCount == 0 { return }
        keyboardWillHideCallCount -= 1
        keyboardWillHideAnimationTimer?.invalidate()
        keyboardWillHideAnimationTimer = nil

        var alsoCallScheduledAfterKeyboardAnimationCallbacks = false
        keyboardAnimationState = nil

        if isAfterKeyboardAnimationCallbackScheduled {
            isAfterKeyboardAnimationCallbackScheduled = false
            alsoCallScheduledAfterKeyboardAnimationCallbacks = true
        }

        // Once the keyboard is fully hidden, now we update safe area insets so they
        // don't include space for the keyboard anymore.
        updateWebViewSafeAreaInsets(
            alsoCallFrameChangeListeners: nil,
            alsoCallScheduledAfterKeyboardAnimationCallbacks:
                alsoCallScheduledAfterKeyboardAnimationCallbacks
        )
    }

    fileprivate func webInputAccessoryObserverView(
        _ webInputAccessoryObserverView: WebInputAccessoryObserverView?,
        didMoveTo keyboardOffsetWithoutToolbar: Double
    ) {
        let lastKeyboardOffsetWithoutToolbar = self.keyboardOffsetWithoutToolbar
        guard lastKeyboardOffsetWithoutToolbar != keyboardOffsetWithoutToolbar else { return }
        let temporarilyPreservedKeyboardOffset =
            keyboardOffsetWithoutToolbar == 0 ? keyboardOffset : nil
        self.keyboardOffsetWithoutToolbar = keyboardOffsetWithoutToolbar

        self.temporarilyPreservedKeyboardOffsetReconcileTimer?.invalidate()
        self.temporarilyPreservedKeyboardOffsetReconcileTimer = nil

        // We want to keep the safe area for the keyboard for a short period of time
        // while we animate to the right scroll position. So we maintain the
        // `temporarilyPreservedKeyboardOffset` variable when the keyboard closes to
        // accomplish this.
        //
        // An example of something that breaks without this: If you drag down on the
        // keyboard to dismiss then release the keyboard will finish closing before the
        // scroll animation finishes causing the screen to jump which looks glitchy.
        if let temporarilyPreservedKeyboardOffset = temporarilyPreservedKeyboardOffset {
            self.temporarilyPreservedKeyboardOffset = temporarilyPreservedKeyboardOffset

            let reconcileTimer = Timer.scheduledTimer(withTimeInterval: 0.3, repeats: false) {
                [weak self] (_) in
                guard let this = self else { return }

                this.temporarilyPreservedKeyboardOffset = nil
                this.temporarilyPreservedKeyboardOffsetReconcileTimer = nil

                // After our preserved keyboard offset is cleared, we need to update safe
                // area insets.
                this.updateWebViewSafeAreaInsets()
            }

            // Add some tolerance to reduce timer energy impact.
            reconcileTimer.tolerance = 0.05

            self.temporarilyPreservedKeyboardOffsetReconcileTimer = reconcileTimer
        } else {
            self.temporarilyPreservedKeyboardOffset = nil
        }

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

    /// Called by our `SceneDelegate` class after `setRootViewController()` as a
    /// way to let us know we're about to render a new `WebNavigationController`.
    func sceneDelegateWillRemove(_ sceneDelegate: SceneDelegate) { willSceneDelegateRemove = true }

    func sceneDelegateDidAdd(_ sceneDelegate: SceneDelegate) {
        (topViewController! as! WebNavigationEntryController).sceneDelegateDidAdd(sceneDelegate)
    }

    @objc private func sceneDidActivate(notification: NSNotification) {
        lastSceneDidActivateNotificationTime = DispatchTime.now()

        // If the web view was terminated while we were in the background, reload the
        // web view when the app is foregrounded again. Once the reload is done the web
        // view will be moved back into the top view controller.
        if !webViewHealthState.isHealthy {
            didSceneEnterBackground = false

            // If `SceneDelegate` is about to set a new root view controller and our web
            // view has been terminated then don't reload, keep the snapshot view. Instead
            // a new root view controller instance will become visible arrive and this view
            // controller will be deinitialized.
            if !willSceneDelegateRemove {
                logger.info(
                    "Reloading upon activating after web process became unhealthy in background"
                )

                webView.reload()
            }
        } else if didSceneEnterBackground {
            didSceneEnterBackground = false

            (topViewController! as! WebNavigationEntryController)
                .moveWebViewIntoIfHealthyOrElseReplaceWithSnapshotView(
                    webView,
                    healthState: webViewHealthState
                )
        }
    }

    @objc private func sceneDidEnterBackground(notification: NSNotification) {
        logger.info("Entering background")

        didSceneEnterBackground = true

        // If the keyboard is open when we enter the background we need to hide the tab
        // bar so it's not rendered on top of our web view snapshot that includes the
        // keyboard! Rendering our tab bar on top of the keyboard looks weird.
        didSceneEnterBackgroundWithKeyboardShown = keyboardOffset > 0
        if didSceneEnterBackgroundWithKeyboardShown { hideTabBarCount += 1 }

        // When the application is backgrounded, make sure to render a snapshot view.
        // So when the application opens back up we don't have a white screen due to
        // the web view having been terminated.
        //
        // We must take a snapshot in this function, so take a snapshot while the
        // keyboard is still up (if it's up).
        (topViewController! as! WebNavigationEntryController).replaceWebViewWithSnapshotView()

        // If there's a focused element, blur it when the app is backgrounded. When the
        // app reopens the user will need to pick a new element to focus.
        //
        // We've observed that `keyboardWillHide` and `keyboardDidHide` are called
        // before the blur returns. We want to wait until the keyboard has finished
        // animating closed before we take our snapshot.
        webView.evaluateJavaScript("if (document.activeElement) document.activeElement.blur()")
    }

    private func getSafeAreaInsets(withoutPreserving: Bool = false) -> UIEdgeInsets {
        let safeAreaInsetTop = windowSafeAreaInsets.top

        let keyboardSafeAreaInsetBottom =
            switch keyboardWebSubstituteState {
            case .closed:
                withoutPreserving
                    ? keyboardOffset : temporarilyPreservedKeyboardOffset ?? keyboardOffset
            // Maintain the old keyboard offset while the keyboard substitute is open so
            // layout doesn't shift around.
            case .opening(let oldKeyboardOffset, _):
                withoutPreserving
                    ? bottomBarKeyboardSubstituteHeight + windowSafeAreaInsets.bottom
                    : oldKeyboardOffset
            case .opened(let oldKeyboardOffset):
                withoutPreserving
                    ? bottomBarKeyboardSubstituteHeight + windowSafeAreaInsets.bottom
                    : oldKeyboardOffset
            }

        // Include the tab bar in our safe area insets.
        let safeAreaInsetBottom = max(
            windowSafeAreaInsets.bottom
                // NOTE(calebmer): We can't use `tabBarController?.frame.size.height` because
                // that'll only include safe area when `WebNavigationController` has been added
                // to a `UIWindow`. When switching spaces, we create a
                // `WebNavigationController` and wait for it to load before making it the root
                // view controller.
                + (tabBarController == nil || withoutPreserving && hideTabBarCount > 0
                    ? 0 : tabBarHeight),
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
        // HACK(calebmer, 2024-07-17): There's this bug I've been seeing where if you
        // open a notification sometimes it loads the page with no safe area insets. I
        // don't know why this is happening and can't reproduce the issue in a
        // development build. So taking a shot in the dark that when backgrounding the
        // app safe area insets are at some point being set to zero?
        if windowSafeAreaInsets == .zero && self.windowSafeAreaInsets != .zero {
            logger.warning(
                "Ignoring the `UIEdgeInsets.zero` we just recieved when we previously had non-`UIEdgeInsets.zero`"
            )
            return
        }

        // Noop if safe area insets didn't actually change.
        if self.windowSafeAreaInsets == windowSafeAreaInsets { return }

        actuallySetWindowSafeAreaInsets(windowSafeAreaInsets)

        // Scroll indicator insets and masked view masks change when window safe
        // area changes.
        setAllWebScrollViewScrollIndicatorInsets()
        updateWebInputAccessoryObserverViewHeight()
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
        alsoCallScheduledAfterKeyboardAnimationCallbacks: Bool = false,
        completionHandler: (() -> Void)? = nil
    ) {
        let safeAreaInsets = getSafeAreaInsets()

        // When setting `--safe-area-inset-top` we need to set
        // `--safe-area-inset-top-base` to the same value. Some code (e.g. inbox
        // notification banner) will need the base value to override
        // `--safe-area-inset-top`.
        let styleString = """
            :root {
                --safe-area-inset-top-base: \(safeAreaInsets.top)px;
                --safe-area-inset-top: \(safeAreaInsets.top)px;
                --safe-area-inset-bottom: \(safeAreaInsets.bottom)px;
                --safe-area-inset-left: \(safeAreaInsets.left)px;
                --safe-area-inset-right: \(safeAreaInsets.right)px;
                --window-safe-area-inset-bottom: \(windowSafeAreaInsets.bottom)px;
                --keyboard-safe-area-inset-bottom: \(max(keyboardOffset, windowSafeAreaInsets.bottom))px;
                --safe-area-inset-bottom-without-keyboard: \(windowSafeAreaInsets.bottom + (tabBarController != nil ? tabBarHeight : 0))px;
            }
            """

        let alsoCallFromChangeListenersSource =
            if let alsoCallFrameChangeListeners = alsoCallFrameChangeListeners {
                "\n    window.__NativeMobileBridge.keyboard._callFrameChangeListeners(\(alsoCallFrameChangeListeners.0), \(alsoCallFrameChangeListeners.1), \(alsoCallFrameChangeListeners.2), \(alsoCallFrameChangeListeners.3));\n"
            } else { "" }

        let alsoCallScheduledAfterKeyboardAnimationCallbacksSource =
            if alsoCallScheduledAfterKeyboardAnimationCallbacks {
                "\n    window.__NativeMobileBridge.keyboard._callScheduledAfterAnimationCallbacks();\n"
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
            \(alsoCallFromChangeListenersSource)\(alsoCallScheduledAfterKeyboardAnimationCallbacksSource)}
            """

        let actualCompletionHandler: ((Any?, (any Error)?) -> Void)? =
            if let completionHandler = completionHandler { { (_, _) in completionHandler() } } else
            { nil }

        webView.evaluateJavaScript(source, completionHandler: actualCompletionHandler)
    }

    private func setAllWebScrollViewScrollIndicatorInsets() {
        setWebScrollViewScrollIndicatorInsets(webView.scrollView)

        for (webScrollView, _) in webScrollViews {
            setWebScrollViewScrollIndicatorInsets(webScrollView)
        }
    }

    private func setWebScrollViewScrollIndicatorInsets(_ webScrollView: UIScrollView) {
        let safeAreaInsets = getSafeAreaInsets(
            // Normally, we preserve the old keyboard offset in our safe area inset when a
            // keyboard substitute is open so we don't shift layout when switching between
            // the substitute and the regular keyboard. However, the scroll indicator
            // insets don't effect document layout.
            //
            // Also makes it so we don't preserve space for the tab bar.
            withoutPreserving: true
        )

        var verticalScrollIndicatorInsets = UIEdgeInsets(
            top: safeAreaInsets.top + navigationBarHeight
                // If `inbox=show` is in the URL then we'll render an inbox banner over our
                // navigation bar and so need to update our vertical scroll indicator insets
                // appropriately.
                + ((webView.url?.query() ?? "")
                    .contains(WebNavigationController.inboxBannerUrlQueryRegex)
                    ? mobileLayoutInboxBannerHeight : 0),
            left: safeAreaInsets.left,
            bottom: safeAreaInsets.bottom,
            right: safeAreaInsets.right
        )

        let webScrollViewFrame = webScrollView.convert(webScrollView.bounds, to: view)
        let webScrollViewTop = webScrollViewFrame.origin.y
        let webScrollViewBottom =
            view.frame.height - (webScrollViewFrame.origin.y + webScrollViewFrame.height)

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

            // Don't apply this bottom bar view's scroll indicator inset to children. For
            // example, `<MessageInput>`s are bottom bars but have a child scrollable
            // `<ContentEditor>`.
            if webScrollView.isDescendant(of: webBottomBarView) { continue }

            let webBottomBarAdditionalBottomInset = max(
                0,
                view.frame.height - webBottomBarViewOriginY - windowSafeAreaInsets.bottom
            )

            verticalScrollIndicatorInsets.bottom = max(
                verticalScrollIndicatorInsets.bottom,
                safeAreaInsets.bottom + webBottomBarAdditionalBottomInset
            )
        }

        // Compute the corner radius to make sure scrollbars are inset to not conflict
        // with the corner radius. WebKit sets the `cornerRadius` property for
        // `border-radius` CSS. It may not be on our layer but on a parent layer (e.g.
        // a parent flex or overflow hidden container). Unwrap parent layers as long
        // as no Y translation occurs until we get a layer with corner radius.
        //
        // Most notably this logic adds scroll indicator inset to the `<MessageInput>`
        // component.
        var cornerRadius = webScrollView.layer.cornerRadius

        if cornerRadius == 0 && webScrollView.layer.frame.origin.y == 0 {
            var superlayer = webScrollView.layer.superlayer
            while let layer = superlayer {
                cornerRadius = layer.cornerRadius

                if cornerRadius == 0 && layer.frame.origin.y == 0 && layer != view.layer {
                    superlayer = layer.superlayer
                } else {
                    break
                }
            }
        }

        webScrollView.automaticallyAdjustsScrollIndicatorInsets = false

        webScrollView.verticalScrollIndicatorInsets = UIEdgeInsets(
            top: max(0, verticalScrollIndicatorInsets.top - webScrollViewTop, cornerRadius),
            left: verticalScrollIndicatorInsets.left,
            bottom: max(
                0,
                verticalScrollIndicatorInsets.bottom - webScrollViewBottom,
                cornerRadius
            ),
            right: verticalScrollIndicatorInsets.right
        )
    }

    /// Update `webInputAccessoryObserverView`'s height to be equal to the height of
    /// our web view bottom bars. The input accessory view's height determines where
    /// the keyboard scroll to dismiss gesture
    /// (`scrollView.keyboardDismissMode = .interactive`) begins. We want the
    /// gesture to be gin at the top of our bottom bar, not where the keyboard
    /// starts.
    ///
    /// To make sure the input accessory view is the right height you can add the
    /// following to `webInputAccessoryObserverView` to help you debug.
    ///
    /// ```
    /// backgroundColor = .red
    /// layer.opacity = 0.5
    /// ```
    private func updateWebInputAccessoryObserverViewHeight() {
        guard let webInputAccessoryObserverView = webInputAccessoryObserverView else { return }

        var maxWebBottomBarHeight = 0.0

        for (webBottomBarView, webBottomBarViewState) in webBottomBarViews {
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

            // Include the keyboard toolbar height in the input accessory view's height
            // even when the keyboard is not expanded.
            let extraWebBottomBarHeight =
                switch webBottomBarViewState.type {
                case .normal(let withKeyboardToolbar):
                    withKeyboardToolbar ? bottomBarKeyboardToolbarHeight : 0.0
                case .keyboardToolbar: bottomBarKeyboardToolbarHeight
                case .globalLoadingIndicator: 0.0
                }

            let webBottomBarHeight =
                (view.bounds.height - windowSafeAreaInsets.bottom - webBottomBarViewOriginY)
                + extraWebBottomBarHeight

            maxWebBottomBarHeight = max(maxWebBottomBarHeight, webBottomBarHeight)
        }

        webInputAccessoryObserverView.frame.size.height = maxWebBottomBarHeight
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

        propagateImmediateExternalPopNavigation(
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

        let poppedViewControllers = super.popToRootViewController(animated: animated)!

        propagateImmediateExternalPopNavigation(
            lastTopViewController: poppedViewControllers.last! as! WebNavigationEntryController,
            delta: poppedViewControllers.count
        )

        return poppedViewControllers
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

        let poppedViewControllers = super.popToViewController(viewController, animated: animated)!

        propagateImmediateExternalPopNavigation(
            lastTopViewController: poppedViewControllers.last! as! WebNavigationEntryController,
            delta: poppedViewControllers.count
        )

        return poppedViewControllers
    }

    private func propagateImmediateExternalPopNavigation(
        lastTopViewController: WebNavigationEntryController,
        delta: Int
    ) {
        // While we have a modal view controller, we don't support external pops from
        // the navigation controller.
        guard modalPresentedViewController == nil else { return }

        logger.info("Propagating immediate external pop")

        preparingNavigationEntry = (topViewController! as! WebNavigationEntryController).entry
        hasAddedMainScrollViewWhilePreparingNavigation = false

        // TODO(calebmer): If `NativeMobileBridge.navigation.externalPop()` is
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
                transitionCoordinator.notifyWhenInteractionChanges { [weak self] (context) in
                    guard let this = self else { return }

                    // Wait until the transition has finished.
                    if context.isInteractive { return }

                    // If the transition was cancelled, remove the snapshot view and place the web
                    // view back. (Unless the web view has found a new home. e.g. Because a push
                    // navigation happened.)
                    if context.isCancelled {
                        if this.webView.superview == nil || this.webView.superview == this.view {
                            lastTopViewController.moveWebViewInto(this.webView)
                        }
                    } else {
                        this.callNavigationExternalPopListeners(delta: delta, url: url)
                    }
                }
            }
        } else {
            callNavigationExternalPopListeners(delta: delta, url: url)
        }
    }

    private func callNavigationExternalPopListeners(delta: Int, url: URL) {
        webView.evaluateJavaScript(
            #"window.__NativeMobileBridge.navigation._callExternalPopListeners(\#(delta), \#(jsonString(url.absoluteString)))"#
        )
    }

    func setTabBarScrollOffset(_ tabBarScrollOffset: Double, navigationBarScrollOffset: Double) {
        // Ignore any tab bar scroll offset updates while we're hiding the tab bar when
        // in the backgrounded. Since we don't want our `hideTabBarCount += 1` to
        // change layout. We're only hiding the tab bar for snapshots, it shouldn't
        // change the web view's layout.
        if didSceneEnterBackgroundWithKeyboardShown { return }

        let actualTabBarHeight =
            (tabBarController != nil ? tabBarHeight + windowSafeAreaInsets.bottom : 0)

        let lastTabBarScrollOffset = self.tabBarScrollOffset
        self.tabBarScrollOffset = tabBarScrollOffset
        let lastNavigationBarScrollOffset = self.navigationBarScrollOffset
        self.navigationBarScrollOffset = navigationBarScrollOffset

        // Optimization: If tab bar scroll offset didn't change then don't update our
        // bottom frames.
        //
        // Optimization: If the keyboard is open, we don't need to update bottom bar
        // frames since bottom bar position will be dominated by the keyboard.
        if lastTabBarScrollOffset != tabBarScrollOffset
            && keyboardOffsetWithoutToolbar < actualTabBarHeight
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

        // Optimization: If tab bar scroll offset didn't change then don't update our
        // web view.
        if lastTabBarScrollOffset != tabBarScrollOffset {
            tabBarScrollOffsetReconcileTimer?.invalidate()
            tabBarScrollOffsetReconcileTimer = nil

            let reconcileTimer = Timer(
                // If we are in a `UIView.animate` block (e.g. when the tab bar is
                // fully opening/closing) then `UIView.inheritedAnimationDuration` will be the
                // duration of that animation block. We shouldn't reconcile until the end of
                // the animation block.
                //
                // If we are not in a `UIView.animate` block then
                // `UIView.inheritedAnimationDuration` will be 0. In that case we want to
                // debounce with a duration of 100ms.
                timeInterval: max(0.1, UIView.inheritedAnimationDuration),
                repeats: false
            ) { [weak self] (_) in
                guard let this = self else { return }

                this.webView.evaluateJavaScript(
                    "window.__NativeMobileBridge.tabBar._scrollOffset = \(tabBarScrollOffset)"
                )
            }

            // Add some tolerance to reduce timer energy impact.
            reconcileTimer.tolerance = 0.05

            // We need to add our timer to the common run loop mode so it can execute
            // even while a gesture is occuring.
            //
            // For more information about run loops:
            // https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/Multithreading/RunLoopManagement/RunLoopManagement.html
            RunLoop.current.add(reconcileTimer, forMode: .common)

            tabBarScrollOffsetReconcileTimer = reconcileTimer
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
        let actualTabBarHeight =
            (tabBarController != nil ? tabBarHeight + windowSafeAreaInsets.bottom : 0)

        let translateY =
            switch webBottomBarViewState.type {
            case .normal(let withKeyboardToolbar):
                -max(
                    0,
                    (actualTabBarHeight - tabBarScrollOffset) - windowSafeAreaInsets.bottom,
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
            // The global loading indicator doesn't move with the keyboard. Just the
            // tab bar.
            case .globalLoadingIndicator:
                -max(
                    0,
                    actualTabBarHeight - tabBarScrollOffset
                )
            }

        webBottomBarViewState.withLock { [weak self] in
            guard let this = self else { return }

            // If we update the bottom bar position while the keyboard is animating
            // (`keyboardAnimationState` is non-null) but are not inheriting an animation
            // (`UIView.inheritedAnimationDuration` is 0) then animate with the same
            // properties as the keyboard animation. This happens when you select some text
            // in a content editor (without going into edit mode) and selecting "Add
            // Comment" from the edit menu. The bottom bar `WKCompositingView` is
            // discovered in a way that doesn't automatically inherit the keyboard
            // animation.
            if let keyboardAnimationState = this.keyboardAnimationState,
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
        ) { [weak self] (_) in
            // To avoid race conditions, if JavaScript hasn't returned yet we don't want to
            // update `layer.transform`.
            webBottomBarViewState.withLock { [weak self] (completionHandler) in
                guard let this = self else { return }

                this.webView.evaluateJavaScript(
                    #"{ const element = document.getElementById("\#(webBottomBarViewState.id)"); if (element) element.style.transform = "translateY(\#(translateY)px)" }"#,
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
        let timer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: false) {
            [weak self] (_) in
            guard let this = self else { return }

            this.shouldDisableScrollFromKeyboardFrameChange -= 1

            this.keyboardWebSubstituteState = .opened(oldKeyboardOffset: oldKeyboardOffset)
            this.updateAllWebMaskedViewMasks()

            completion?()
        }

        // Add some tolerance to reduce timer energy impact.
        timer.tolerance = 0.05

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
        Timer.scheduledTimer(withTimeInterval: 0.25, repeats: false) { [weak self] (_) in
            guard let this = self else { return }

            this.shouldDisableScrollFromKeyboardFrameChange -= 1

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

        topViewController!.dismiss(animated: false)
    }

    func canSwitchTab() -> Bool {
        return webViewHealthState.isHealthy && !webViewHealthState.isLoading
            && webViewHealthState.lastPingTime != nil
            && webViewHealthState.navigationError == nil
    }

    /// Change the tab currently being displayed in our web navigation controller.
    func switchTab(_ tab: WebNavigationController.Tab) {
        // If the web view is loading or unhealthy, don't switch tabs!
        guard canSwitchTab() else { return }

        if currentTab == tab {
            // NOTE(calebmer): Annoyingly, if we call `popToRootViewController(animated: true)`
            // directly in `tabBarController(_:didSelect:)` we successfully pop but we
            // don't animate! However, waiting a bit then calling
            // `popToRootViewController(animated: true)` does animate...
            //
            // I assume something before `tabBarController(_:didSelect:)` is blocking
            // animations but since I'm not a veteran iOS developer I don't know what or
            // how to go about debugging it.
            //
            // Hopefully StackOverflow can help:
            // https://stackoverflow.com/questions/78593250/poptorootviewcontrolleranimated-true-doesn-t-animate-when-called-from-tabbarc
            Timer.scheduledTimer(withTimeInterval: perceivedAsInstantLimitSeconds, repeats: false) {
                [weak self] (_) in let _ = self?.popToRootViewController(animated: true)
            }
        } else {
            let url =
                (viewControllersByInactiveTab[tab]?.last as? WebNavigationEntryController)?.url
                ?? URL(
                    string: initialPathByTab.get(tab),
                    relativeTo: WebNavigationController.baseUrl
                )!

            webView.evaluateJavaScript(
                "window.__NativeMobileBridge.navigation._callExternalSwitchTabListeners(\(tab.jsonString()), \(jsonString(url.absoluteString)))"
            )
        }
    }

    /// Currently unused. Useful why developing to see what native thinks the
    /// navigation stack is and compare that to what web thinks the navigation
    /// stack is.
    private func buildDebugNavigationStack() -> String {
        return """
            - viewControllers\(viewControllers.map({ "\n    - \(($0 as! WebNavigationEntryController).url.absoluteString)" }).joined())
            - viewControllersByInactiveTab\(viewControllersByInactiveTab.map({ "\n    - \($0.key)\($0.value.map({ "\n        - \(($0 as! WebNavigationEntryController).url.absoluteString)" }).joined()))" }).joined())
            """
    }
}

@objc class WebNavigationEntry: NSObject {
    var tabBarState: TabBarState?

    @objc class TabBarState: NSObject {
        let lastScrollOffset: Double
        let lastClientHeight: Double
        let lastScrollHeight: Double
        let lastScrollDirection: RootTabBarController.ScrollDirection
        let lastNavigationBarTopOffset: Double

        init(
            lastScrollOffset: Double,
            lastClientHeight: Double,
            lastScrollHeight: Double,
            lastScrollDirection: RootTabBarController.ScrollDirection,
            lastNavigationBarTopOffset: Double
        ) {
            self.lastScrollOffset = lastScrollOffset
            self.lastClientHeight = lastClientHeight
            self.lastScrollHeight = lastScrollHeight
            self.lastScrollDirection = lastScrollDirection
            self.lastNavigationBarTopOffset = lastNavigationBarTopOffset
        }

        override var debugDescription: String {
            "\(self) lastScrollOffset = \(lastScrollOffset), lastScrollHeight = \(lastScrollHeight), lastScrollDirection = \(lastScrollDirection), lastNavigationBarTopOffset = \(lastNavigationBarTopOffset)"
        }
    }
}

private class WebNavigationEntryController: UIViewController {
    let entry: WebNavigationEntry
    var url: URL
    private weak var scene: UIScene?
    private unowned let webNavigationController: WebNavigationController
    private var loadingIndicatorTimer: Timer?
    private var loadingIndicatorTimerGeneration: Int = 0
    private var didViewAppear: Bool = false
    private var willViewDisappear: Bool = false
    private var shouldPresentLoadingIndicator = false

    private var isAnySuperviewHidden: Bool {
        var superview = view.superview
        while let currentSuperview = superview {
            if currentSuperview.isHidden { return true }
            superview = currentSuperview.superview
        }
        return false
    }

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
        entry: WebNavigationEntry,
        url: URL,
        webNavigationController: WebNavigationController,
        webView: WKWebView,
        healthState: WebNavigationController.WebViewHealthState
    ) {
        self.entry = entry
        self.url = url
        self.scene = webNavigationController.scene
        self.webNavigationController = webNavigationController

        super.init(nibName: nil, bundle: nil)

        // While the web view isn't mounted, show our primary background color.
        view.backgroundColor = UIColor(named: "grey-0")!

        // Render content underneath opaque bars like the tab bar. We make sure content
        // isn't hidden by opaque bars in web code.
        extendedLayoutIncludesOpaqueBars = true

        moveWebViewIntoIfHealthyOrElseReplaceWithSnapshotView(webView, healthState: healthState)

        if let scene = webNavigationController.scene {
            NotificationCenter.default.addObserver(
                self,
                selector: #selector(sceneDidActivate(notification:)),
                name: UIScene.didActivateNotification,
                object: scene
            )
        }
    }

    required init(coder: NSCoder) { fatalError("Unimplemented") }

    deinit {
        if let scene = scene {
            NotificationCenter.default.removeObserver(
                self,
                name: UIScene.didActivateNotification,
                object: scene
            )
        }
    }

    func moveWebViewIntoIfHealthyOrElseReplaceWithSnapshotView(
        _ webView: WKWebView,
        healthState: WebNavigationController.WebViewHealthState
    ) {
        if let navigationError = healthState.navigationError {
            replaceWebViewWithSnapshotView()
            clearLoadingIndicatorTimer()
            presentUnhealthyAlert(navigationError: navigationError)
        }
        // We may become unhealthy while loading as WebKit stops executing JavaScript.
        // So if `isLoading` is true then don't show the unhealthy alert.
        else if healthState.isLoading {
            replaceWebViewWithSnapshotView()

            // We used to have the following code which would immediately show the loading
            // indicator if there was stuff in the navigation entry. However, we found this
            // to be jarring when the user opens the app after WebKit has suspended the web
            // process (so needs to reload) since the loading indicator briefly flashes in.
            //
            // We now think it's a better user experience to effectively freeze the app for
            // `delayScreenTransitionLoadingIndicatorLimitSeconds` and then showing a
            // loading spinner if loading doesn't finish during that time period.
            //
            // ```
            // if view.subviews.count > 0 {
            //     clearLoadingIndicatorTimer()
            //     presentLoadingIndicator()
            // }
            // ```
        } else if !healthState.isHealthy {
            replaceWebViewWithSnapshotView()
            clearLoadingIndicatorTimer()
            if !healthState.shouldSuppressUnhealthyAlert { presentUnhealthyAlert() }
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

        var snapshotView: UIView?

        // If we entered the background with the keyboard shown then take a snapshot of
        // the whole screen instead of just the web view. That way our snapshot will
        // include the iOS keyboard.
        if webNavigationController.didSceneEnterBackgroundWithKeyboardShown,
            let window = view.window
        {
            snapshotView = window.screen.snapshotView(
                // Snapshotting a view that is not in a visible window requires
                // `afterScreenUpdates: true`. `false` the rest of the time because I
                // assume `true` is potentially expensive? It may force the screen to
                // paint.
                afterScreenUpdates: window.isHidden
                    || webNavigationController.didSceneEnterBackground
            )

            // We're taking a snapshot of the screen but make sure we crop to our web
            // view's bounds.
            if let snapshotView = snapshotView {
                snapshotView.bounds = window.screen.coordinateSpace.convert(
                    webView.bounds,
                    from: webView.coordinateSpace
                )
            }
        } else {
            snapshotView = webView.snapshotView(
                // Snapshotting a view that is not in a visible window requires
                // `afterScreenUpdates: true`. `false` the rest of the time because I
                // assume `true` is potentially expensive? It may force the screen to
                // paint.
                afterScreenUpdates: (webView.window?.isHidden ?? true)
                    || webNavigationController.didSceneEnterBackground
            )
        }

        if presentedViewController is WebLoadingIndicatorController { dismiss(animated: false) }
        for subview in view.subviews {
            subview.removeFromSuperview()

            // Add the web view back, as hidden, to our navigation controller so it can
            // continue receiving `requestAnimationFrame()` events.
            if subview === webView {
                webView.isHidden = true
                webNavigationController.view.addSubview(webView)
            }
        }

        // NOTE(calebmer): `snapshotView` may be nil if `webView` is not part of our
        // key/visible `UIWindow`. While we should promptly deinitialize
        // `WebNavigationController`s that aren't visible, just in case tolerate a
        // nil `snapshotView`.
        if let snapshotView = snapshotView { view.addSubview(snapshotView) }

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

        if webNavigationController.didSceneEnterBackgroundWithKeyboardShown {
            webNavigationController.didSceneEnterBackgroundWithKeyboardShown = false
            webNavigationController.hideTabBarCount -= 1
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

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        didViewAppear = true
        willViewDisappear = false

        if shouldPresentLoadingIndicator && !webNavigationController.didSceneEnterBackground
            && !isAnySuperviewHidden
        {
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
        didViewAppear = false
        willViewDisappear = false
        clearLoadingIndicatorTimer()

        shouldPresentLoadingIndicator = presentedViewController is WebLoadingIndicatorController
        if shouldPresentLoadingIndicator { dismiss(animated: false) }
    }

    @objc private func sceneDidActivate(notification: NSNotification) {
        if shouldPresentLoadingIndicator && didViewAppear && !isAnySuperviewHidden {
            shouldPresentLoadingIndicator = false
            clearLoadingIndicatorTimer()
            presentLoadingIndicator()
        } else {
            resetLoadingIndicatorTimer()
        }
    }

    /// We expect `isAnySuperviewHidden` to change from true to false when
    /// `sceneDelegateDidAdd()` is called.
    fileprivate func sceneDelegateDidAdd(_ sceneDelegate: SceneDelegate) {
        if shouldPresentLoadingIndicator && didViewAppear
            && !webNavigationController.didSceneEnterBackground
        {
            shouldPresentLoadingIndicator = false
            clearLoadingIndicatorTimer()
            presentLoadingIndicator()
        } else {
            resetLoadingIndicatorTimer()
        }
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
        if !didViewAppear || willViewDisappear || webNavigationController.didSceneEnterBackground
            || isAnySuperviewHidden
        {
            return
        }

        // If there's a modal view controller (that's not ourself), don't show
        // loading indicator. Since our view is hidden under the modal.
        if let modalPresentedViewController = webNavigationController.modalPresentedViewController,
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
            ?? (webNavigationController.modalPresentedViewController
            ?? webNavigationController.topViewController)!
            .transitionCoordinator

        // Wait to show a loading indicator until any active transition is done.
        if let transitionCoordinator = transitionCoordinator {
            if !transitionCoordinator.isInteractive {
                startLoadingIndicatorTimer()
            } else {
                transitionCoordinator.notifyWhenInteractionChanges { [weak self] (context) in
                    guard let this = self else { return }

                    if context.isInteractive { return }
                    if context.isCancelled { return }

                    // If `resetLoadingIndicatorTimer()` was called since the notify callback was
                    // attached then we shouldn't start a new loading indicator timer.
                    if this.loadingIndicatorTimerGeneration
                        == currentLoadingIndicatorTimerGeneration
                    {
                        this.startLoadingIndicatorTimer()
                    }
                }
            }
        } else {
            startLoadingIndicatorTimer()
        }
    }

    private func startLoadingIndicatorTimer() {
        // If there are no subviews (no web view and no snapshot view) immediately show
        // the loading indicator because otherwise the user will be staring at a blank
        // screen which is no good.
        if view.subviews.count == 0 {
            presentLoadingIndicator()
            return
        }

        loadingIndicatorTimer = Timer.scheduledTimer(
            withTimeInterval: delayScreenTransitionLoadingIndicatorLimitSeconds,
            repeats: false
        ) { [weak self] timer in
            guard let this = self else { return }

            this.loadingIndicatorTimer = nil
            this.presentLoadingIndicator()
        }

        // Add some tolerance to reduce timer energy impact.
        loadingIndicatorTimer?.tolerance = 0.1
    }

    private func presentLoadingIndicator() {
        if !didViewAppear || willViewDisappear || webNavigationController.didSceneEnterBackground
            || isAnySuperviewHidden
        {
            shouldPresentLoadingIndicator = true
            return
        }

        // If there's a modal view controller (that's not ourselves), don't show
        // loading indicator. It's like our view is hidden.
        //
        // A modal may have opened while waiting for the timer. We don't call
        // `resetLoadingIndicatorTimer()` if the modal view controller changes.
        if let modalPresentedViewController = webNavigationController.modalPresentedViewController,
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

    private func presentUnhealthyAlert(navigationError: (any Error)? = nil) {
        let isOfflineNavigationError =
            if let navigationError = navigationError as NSError? {
                // This error mostly happens in development when the dev server isn't running.
                //
                // https://developer.apple.com/documentation/foundation/1508628-url_loading_system_error_codes/nsurlerrorcannotconnecttohost
                navigationError.code == -1004
                    // https://developer.apple.com/documentation/foundation/1508628-url_loading_system_error_codes/nsurlerrornetworkconnectionlost
                    || navigationError.code == -1005
                    // https://developer.apple.com/documentation/foundation/1508628-url_loading_system_error_codes/nsurlerrornotconnectedtointernet
                    || navigationError.code == -1009
            } else { false }

        let alert =
            if !isOfflineNavigationError {
                UIAlertController(
                    title: "Couldn’t respond",
                    // This message is copied from `error_display_message_renderer.tsx`. If we update
                    // the message here then we should update it there as well.
                    message:
                        "An unexpected error occurred, please try again. If the problem continues, let us know at support@cyberworlds.dev",
                    preferredStyle: .alert
                )
            } else {
                UIAlertController(
                    title: "Couldn’t connect",
                    // This message is copied from `fetch_with_tracer.ts`. If we update the message
                    // here then we should update it there as well.
                    message:
                        "Your device isn’t connected to the internet. Make sure you’re online and try again.",
                    preferredStyle: .alert
                )
            }

        alert.addAction(
            UIAlertAction(
                title: "Retry",
                style: .default,
                handler: { [weak self] (_) in
                    guard let this = self else { return }

                    #if PROVISIONING_PROFILE
                        if isOfflineNavigationError
                            && AppDelegate.shared.hasRegisterForRemoteNotificationsFailed
                        {
                            AppDelegate.shared.hasRegisterForRemoteNotificationsFailed = false
                            UIApplication.shared.registerForRemoteNotifications()
                        }
                    #endif

                    this.webNavigationController.forceReloadWebView()
                }
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

    // In order for the input accessory view to stay on top of the keyboard when
    // the height changes we need this bit of code. Adapted from:
    // https://stackoverflow.com/a/33988855/1568890
    //
    // To help you debug the accessory view's size is correct add this to
    // `init()`:
    //
    // ```
    // backgroundColor = .red
    // layer.opacity = 0.5
    // ```
    override var frame: CGRect {
        didSet {
            for constraint in constraints {
                if constraint.firstAttribute == .height {
                    constraint.constant = frame.size.height
                    break
                }
            }
        }
    }

    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = false
    }

    required init(coder: NSCoder) { fatalError("Unimplemented") }

    deinit { superview?.removeObserver(self, forKeyPath: "center") }

    override func willMove(toSuperview newSuperview: UIView?) {
        super.willMove(toSuperview: newSuperview)

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

        delegate?.webInputAccessoryObserverView(self, didMoveTo: getKeyboardOffset())
    }

    func getKeyboardOffset() -> Double {
        guard let superview = superview else { return 0 }
        guard let superSuperview = superview.superview else { return 0 }

        var keyboardOffset =
            superSuperview.bounds.height - superview.frame.origin.y - frame.size.height

        keyboardOffset = max(0, keyboardOffset)

        // Round keyboard offset to the nearest fourth point. This is typically what
        // CSS heights and widths in our product will be due to our spacing scale.
        // Rounding prevents small arbitrary updates like 4.999999999 to 5.000001
        // (which we've observed happen in iOS rendering code) from triggering an
        // update.
        keyboardOffset = round(keyboardOffset * 4) / 4

        return keyboardOffset
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

private func jsonString(_ string: String) -> String {
    let jsonEncoder = JSONEncoder()
    return String(data: try! jsonEncoder.encode(string), encoding: .utf8)!
}

private func createWebBridgeSource(initialTab: WebNavigationController.Tab) -> String {
    return """
        {
            const navigationExternalPopListeners = new Set();
            const navigationExternalSwitchTabListeners = new Set();
            const keyboardFrameChangeListeners = new Set();
            const addCommentEditMenuListeners = new Set();
            const notificationsIosDeviceTokensUpdateListeners = new Set();

            let scheduledAfterNavigationAnimationCallbacks = [];
            let scheduledAfterKeyboardAnimationCallbacks = [];

            let hideTabBarCount = 0;
            let isKeyboardSubstituteOpen = false;

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
                        window.webkit.messageHandlers.NativeMobileBridge.postMessage(`colors.setThemeColors:${options["theme-10"]},${options["theme-20"]},${options["theme-30"]},${options["theme-40"]},${options["theme-50"]},${options["theme-60"]},${options["theme-70"]},${options["theme-80"]},${options["theme-90"]}`);
                    },
                },
                session: {
                    signOut: () => {
                        window.webkit.messageHandlers.NativeMobileBridge.postMessage("session.signOut");
                    },
                    switchSpace: spaceId => {
                        window.webkit.messageHandlers.NativeMobileBridge.postMessage(`session.switchSpace:${spaceId}`);
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
                    prepareExternalPop: () => {
                        prompt("%%%navigation.prepareExternalPop");
                    },
                    externalPop: () => {
                        window.webkit.messageHandlers.NativeMobileBridge.postMessage("navigation.externalPop");
                    },
                    preparePop: url => {
                        prompt(`%%%navigation.preparePop:${url}`);
                    },
                    pop: url => {
                        window.webkit.messageHandlers.NativeMobileBridge.postMessage(`navigation.pop:${url}`);
                    },
                    requestEventualExternalPop: () => {
                        window.webkit.messageHandlers.NativeMobileBridge.postMessage("navigation.requestEventualExternalPop");
                    },
                    replace: url => {
                        window.webkit.messageHandlers.NativeMobileBridge.postMessage(`navigation.replace:${url}`);
                    },
                    prepareReplaceWithPushAnimation: () => {
                        prompt("%%%navigation.prepareReplaceWithPushAnimation");
                    },
                    replaceWithPushAnimation: url => {
                        window.webkit.messageHandlers.NativeMobileBridge.postMessage(`navigation.replaceWithPushAnimation:${url}`);
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
                    prepareSwitchTab: tab => {
                        prompt(`%%%navigation.prepareSwitchTab:${tab}`);
                    },
                    switchTab: (tab, url) => {
                        window.webkit.messageHandlers.NativeMobileBridge.postMessage(`navigation.switchTab:${tab},${url}`);
                    },
                    subscribeToExternalSwitchTab: listener => {
                        navigationExternalSwitchTabListeners.add(listener);
                        return () => {
                            navigationExternalSwitchTabListeners.delete(listener);
                        };
                    },
                    _callExternalSwitchTabListeners: async (tab, urlString) => {
                        const url = new URL(urlString);

                        for (const listener of navigationExternalSwitchTabListeners) {
                            try {
                                listener(tab, url);
                            } catch (error) {
                                setTimeout(() => {
                                    throw error;
                                }, 0);
                            }
                        }
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
                    runScrollDebounceTimeout: () => {
                        window.webkit.messageHandlers.NativeMobileBridge.postMessage("navigationBar.runScrollDebounceTimeout");
                    },
                },
                tabBar: {
                    initialTab: \(initialTab.jsonString()),
                    height: \(tabBarHeight),
                    _scrollOffset: 0,
                    getDeferredScrollOffset: () => {
                        return NativeMobileBridge.tabBar._scrollOffset;
                    },
                    isHidden: () => {
                        return hideTabBarCount > 0;
                    },
                    hide: ({isAnimated = false} = {}) => {
                        hideTabBarCount += 1;
                        window.webkit.messageHandlers.NativeMobileBridge.postMessage(`tabBar.hide:${isAnimated}`);
                    },
                    unhide: ({isAnimated = false} = {}) => {
                        hideTabBarCount -= 1;
                        window.webkit.messageHandlers.NativeMobileBridge.postMessage(`tabBar.unhide:${isAnimated}`);
                    },
                    clearInboxNotificationBadge: () => {
                        window.webkit.messageHandlers.NativeMobileBridge.postMessage("tabBar.clearInboxNotificationBadge");
                    },
                    setInboxLoudNotificationBadge: loudNotificationCount => {
                        window.webkit.messageHandlers.NativeMobileBridge.postMessage(`tabBar.setInboxLoudNotificationBadge:${loudNotificationCount}`);
                    },
                    setInboxSubtleNotificationBadge: () => {
                        window.webkit.messageHandlers.NativeMobileBridge.postMessage("tabBar.setInboxSubtleNotificationBadge");
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
                    isSubstituteOpen: () => {
                        return isKeyboardSubstituteOpen;
                    },
                    prepareForSubstitute: () => {
                        if (!isKeyboardSubstituteOpen) {
                            hideTabBarCount += 1;
                        }
                        isKeyboardSubstituteOpen = true;

                        return window.webkit.messageHandlers.NativeMobileBridgeWithReply.postMessage("keyboard.prepareForSubstitute");
                    },
                    cleanupAfterSubstitute: () => {
                        if (isKeyboardSubstituteOpen) {
                            hideTabBarCount -= 1;
                        }
                        isKeyboardSubstituteOpen = false;

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
                scrollbar: {
                    updateAllInsets: () => {
                        window.webkit.messageHandlers.NativeMobileBridge.postMessage("scrollbar.updateAllInsets");
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
                notifications: {
                    takeAppleDeviceTokens: async () => {
                        const deviceTokens = await window.webkit.messageHandlers.NativeMobileBridgeWithReply.postMessage("notifications.takeAppleDeviceTokens");
                        return deviceTokens.map(deviceToken => new Uint8Array(deviceToken));
                    },
                    subscribeToAppleDeviceTokensUpdate: listener => {
                        notificationsIosDeviceTokensUpdateListeners.add(listener);
                        return () => {
                            notificationsIosDeviceTokensUpdateListeners.delete(listener);
                        };
                    },
                    _callIosDeviceTokensUpdate: () => {
                        for (const listener of notificationsIosDeviceTokensUpdateListeners) {
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
                haptic: {
                    playLightImpact: () => {
                        window.webkit.messageHandlers.NativeMobileBridge.postMessage("haptic.playLightImpact");
                    },
                    playMediumImpact: () => {
                        window.webkit.messageHandlers.NativeMobileBridge.postMessage("haptic.playMediumImpact");
                    },
                    playHeavyImpact: () => {
                        window.webkit.messageHandlers.NativeMobileBridge.postMessage("haptic.playHeavyImpact");
                    },
                    playSelectionChanged: () => {
                        window.webkit.messageHandlers.NativeMobileBridge.postMessage("haptic.playSelectionChanged");
                    },
                },
            };

            window.__NativeMobileBridge = NativeMobileBridge;
        }
        """
}
