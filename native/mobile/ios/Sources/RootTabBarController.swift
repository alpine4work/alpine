import UIKit
import WebKit

class RootTabBarController: UITabBarController, SceneDelegateRootController,
    UITabBarControllerDelegate, WebNavigationControllerDelegate
{
    var spaceId: String { session.spaceId }
    let webNavigationController: WebNavigationController

    let session: Session
    private let signOut: () -> Void
    private let switchSpace: (String, Session) -> Void

    private var inboxNotificationBadgeView: UIView?
    private var inboxLoudNotificationCount = 0
    private var isInboxSubtleNotificationBadgeView = false

    private weak var mainScrollView: UIScrollView?
    private weak var mainNavigationEntry: WebNavigationEntry?
    private var lastScrollOffset = 0.0
    private var lastClientHeight = 0.0
    private var lastScrollHeight = 0.0
    private var lastScrollDirection = ScrollDirection.down
    private var lastNavigationBarTopOffset = 0.0
    private var scrollDebounceTimeout: Timer?

    enum ScrollDirection {
        case up
        case down
    }

    /// We want to hide the tab bar while the keyboard web substitute is open. Since
    /// the tab bar renders on top of the web view and we don't want it to cover the
    /// keyboard substitute.
    private var disabledTabBarState: DisabledTabBarState?

    private struct DisabledTabBarState { let isHidden: Bool }

    init(
        scene: UIScene,
        session: Session,
        signOut: @escaping () -> Void,
        switchSpace: @escaping (String, Session) -> Void,
        initialTab: WebNavigationController.Tab = .home,
        initialPath: String? = nil
    ) {
        self.session = session
        self.signOut = signOut
        self.switchSpace = switchSpace

        // We use a non-persistent store while the user is signed out, but once they're
        // signed in we remember their `localStorage`, cookies, etc.
        let websiteDataStore = WKWebsiteDataStore.default()

        let baseSessionCookieProperties: [HTTPCookiePropertyKey: Any] = [
            .name: "session", .value: session.token,
            .domain: WebNavigationController.baseUrl.host()!, .path: "/",
            // iOS doesn't have a constant for the `HttpOnly` key so manually initialize.
            // https://forums.developer.apple.com/forums/thread/701770
            .init(rawValue: "HttpOnly"): true, .sameSitePolicy: HTTPCookieStringPolicy.sameSiteLax,
            .expires: NSDate(timeIntervalSinceNow: TimeInterval(60 * 60 * 24 * 365)),
        ]

        #if PRODUCTION_RUN_ENVIRONMENT
            let newSessionCookieProperties: [HTTPCookiePropertyKey: Any] = [.secure: true]

            let sessionCookieProperties = baseSessionCookieProperties.merging(
                newSessionCookieProperties
            ) { (_, newValue) in newValue }
        #else
            let sessionCookieProperties = baseSessionCookieProperties
        #endif

        // This cookie needs to be the same as the session cookie created in
        // `session_cookie.ts`. We set the cookie within our native mobile app shell
        // instead of on the server for our native mobile app.
        let sessionCookie = HTTPCookie(properties: sessionCookieProperties)!

        // Make sure our `.init(rawValue: "HttpOnly")` worked.
        assert(sessionCookie.isHTTPOnly)

        websiteDataStore.httpCookieStore.setCookie(sessionCookie)

        webNavigationController = WebNavigationController(
            scene: scene,
            initialTab: initialTab,
            initialPath: initialPath ?? "/s/\(session.spaceId)",
            initialPathByTab: WebNavigationController.InitialPathByTab(
                home: "/s/\(session.spaceId)",
                search: "/s/\(session.spaceId)/search",
                create: "/s/\(session.spaceId)/create",
                inbox: "/s/\(session.spaceId)/inbox",
                more: "/s/\(session.spaceId)/more"
            ),
            websiteDataStore: websiteDataStore
        )

        let homeTabController = RootTabController(
            tab: .home,
            title: "Home",
            image: UIImage(named: "HouseIcon")!
        )

        let searchTabController = RootTabController(
            tab: .search,
            title: "Search",
            image: UIImage(named: "MagnifyingGlassIcon")!
        )

        let createTabController = RootTabController(
            tab: .create,
            title: "Create",
            image: UIImage(named: "PlusIcon")!
        )

        let inboxTabController = RootTabController(
            tab: .inbox,
            title: "Inbox",
            image: UIImage(named: "BellIcon")!
        )

        let moreTabController = RootTabController(
            tab: .more,
            title: "More",
            image: UIImage(named: "ListIcon")!
        )

        super.init(nibName: nil, bundle: nil)

        delegate = self
        webNavigationController.webDelegate = self

        let appearance = UITabBarAppearance()
        let itemAppearance = UITabBarItemAppearance()

        itemAppearance.normal.iconColor = UIColor(named: "grey-30")!
        itemAppearance.normal.titleTextAttributes = [
            .foregroundColor: UIColor(named: "grey-30")!,
            .font: UIFont(name: "Inter-Regular", size: 11)!,
        ]

        itemAppearance.selected.iconColor = UIColor(named: "grey-100")!
        itemAppearance.selected.titleTextAttributes = [
            .foregroundColor: UIColor(named: "grey-100")!
        ]

        appearance.backgroundColor = UIColor(named: "grey-0")!
        appearance.backgroundEffect = nil
        appearance.shadowImage = nil
        appearance.shadowColor = nil

        appearance.stackedLayoutAppearance = itemAppearance
        appearance.compactInlineLayoutAppearance = itemAppearance
        appearance.inlineLayoutAppearance = itemAppearance

        tabBar.isTranslucent = false
        tabBar.standardAppearance = appearance
        tabBar.scrollEdgeAppearance = appearance

        viewControllers = [
            homeTabController, searchTabController, createTabController, inboxTabController,
            moreTabController,
        ]

        selectedViewController =
            viewControllers?.first(where: { ($0 as! RootTabController).webTab == initialTab })
            ?? homeTabController
        selectedViewController!.addChild(webNavigationController)
        selectedViewController!.view.addSubview(webNavigationController.view)
    }

    required init?(coder: NSCoder) { fatalError("Unimplemented") }

    func setWindowSafeAreaInsets(_ windowSafeAreaInsets: UIEdgeInsets) {
        webNavigationController.setWindowSafeAreaInsets(windowSafeAreaInsets)
    }

    func sceneDelegateWillRemove(_ sceneDelegate: SceneDelegate) {
        webNavigationController.sceneDelegateWillRemove(sceneDelegate)
    }

    func sceneDelegateDidAdd(_ sceneDelegate: SceneDelegate) {
        webNavigationController.sceneDelegateDidAdd(sceneDelegate)
    }

    override func viewDidAppear(_ animated: Bool) {
        // Wait until the user is logged in to ask for authorization to send push
        // notifications.
        AppDelegate.shared.registerForRemoteNotificationsAndRequestAuthorization()

        // HACK(calebmer): Without this code, when you open the app from a notification
        // then hit the back button there will be no navigation animations until the
        // user switches tabs. After three hours of debugging, including trying to
        // dissassemble UIKit code, I can't figure out what's happening here and why
        // switching the selected tab works. I only know it does work. Committing this
        // fix and moving on.
        let homeTabController = viewControllers![0]
        let searchTabController = viewControllers![1]
        if selectedViewController != homeTabController {
            let originalViewController = selectedViewController
            selectedViewController = homeTabController
            selectedViewController = originalViewController
        } else {
            selectedViewController = searchTabController
            selectedViewController = homeTabController
        }
    }

    func tabBarController(
        _ tabBarController: UITabBarController,
        shouldSelect viewController: UIViewController
    ) -> Bool { return webNavigationController.canSwitchTab() }

    func tabBarController(
        _ tabBarController: UITabBarController,
        didSelect viewController: UIViewController
    ) {
        // If we have a subtle notification badge then reset it whenever the tab
        // changes. Since the background color may need to change depending on the
        // selected tab.
        if isInboxSubtleNotificationBadgeView { setInboxSubtleNotificationBadge() }

        let tabViewController = viewController as! RootTabController

        // We only have one underlying web view for each tab. So whenever the user
        // switches the tab, move our web view to the new tab.
        //
        // We need to both move the `UIView` in the view hierarchy and move the
        // `UIViewController` in the view controller hierarchy.
        webNavigationController.view.removeFromSuperview()
        webNavigationController.removeFromParent()
        tabViewController.addChild(webNavigationController)
        tabViewController.view.addSubview(webNavigationController.view)

        webNavigationController.switchTab(tabViewController.webTab)
    }

    func webNavigationController(signOut webNavigationController: WebNavigationController) {
        signOut()
    }

    func webNavigationController(
        _ webNavigationController: WebNavigationController,
        switchSpace spaceId: String
    ) { switchSpace(spaceId, session) }

    func webNavigationController(
        _ navigationController: WebNavigationController,
        didAddWebScrollView scrollView: UIScrollView,
        navigationEntry: WebNavigationEntry,
        isMain: Bool,
        isAnimated: Bool
    ) {
        // Only the main scroll view may push the tab bar down when scrolled.
        guard isMain else { return }

        resetTabBar(
            navigationController,
            scrollView: scrollView,
            navigationEntry: navigationEntry,
            isAnimated: isAnimated
        )
    }

    func webNavigationController(
        _ navigationController: WebNavigationController,
        didNavigate navigationEntry: WebNavigationEntry,
        hasMainScrollView: Bool
    ) {
        if !hasMainScrollView {
            resetTabBar(
                navigationController,
                scrollView: nil,
                navigationEntry: navigationEntry,
                isAnimated: true
            )
        }
    }

    private func resetTabBar(
        _ navigationController: WebNavigationController,
        scrollView: UIScrollView?,
        navigationEntry: WebNavigationEntry,
        isAnimated: Bool
    ) {
        // Defense in case this method is called with the same scroll view twice.
        if let scrollView = scrollView, scrollView === mainScrollView { return }

        // See the comment on the same statement in
        // `webNavigationController(didScroll:)` for more information on why we call
        // `max()` and `round()`.
        var scrollOffset: Double = 0
        var clientHeight: Double = 0
        var scrollHeight: Double = 0
        if let scrollView = scrollView {
            scrollOffset = max(0, round(scrollView.contentOffset.y))
            clientHeight = round(scrollView.bounds.height)
            scrollHeight = round(scrollView.contentSize.height)
        }

        let restoredTabBarState = navigationEntry.tabBarState

        mainNavigationEntry?.tabBarState = WebNavigationEntry.TabBarState(
            lastScrollOffset: lastScrollOffset,
            lastClientHeight: lastClientHeight,
            lastScrollHeight: lastScrollHeight,
            lastScrollDirection: lastScrollDirection,
            lastNavigationBarTopOffset: lastNavigationBarTopOffset
        )

        lastScrollOffset = restoredTabBarState?.lastScrollOffset ?? scrollOffset
        lastClientHeight = restoredTabBarState?.lastClientHeight ?? clientHeight
        lastScrollHeight = restoredTabBarState?.lastScrollHeight ?? scrollHeight
        lastScrollDirection =
            restoredTabBarState?.lastScrollDirection
            ?? (scrollOffset > navigationBarHeight ? .up : .down)
        lastNavigationBarTopOffset = restoredTabBarState?.lastNavigationBarTopOffset ?? scrollOffset

        scrollDebounceTimeout?.invalidate()
        scrollDebounceTimeout = nil

        mainScrollView = scrollView
        mainNavigationEntry = navigationEntry

        let hasScrollOffsetChanged = lastScrollOffset != scrollOffset

        // Reset tab bar offset when we get a new main scroll view. This happens:
        //
        // 1. When the page reloads (e.g. live reload during development)
        // 2. When the user navigates to a new route (e.g. push or pop animation)
        do {
            let navigationBarScrollOffset =
                if let state = disabledTabBarState { state.isHidden ? navigationBarHeight : 0 } else
                { max(0, min(scrollOffset - lastNavigationBarTopOffset, navigationBarHeight)) }

            // Convert from navigation bar offset to tab bar offset. We want the native tab
            // bar to disappear at the same rate as the web navigation bar.
            let tabBarScrollOffset =
                ((tabBar.frame.height / navigationBarHeight) * navigationBarScrollOffset)

            let tabBarFrameOriginY = (view.frame.height - tabBar.frame.height) + tabBarScrollOffset

            if tabBar.frame.origin.y != tabBarFrameOriginY {
                // Immediately finish any current animations.
                tabBar.layer.removeAllAnimations()

                let newTabBarIsHidden = navigationBarScrollOffset >= navigationBarHeight

                if !isAnimated || hasScrollOffsetChanged {
                    tabBar.frame.origin.y = tabBarFrameOriginY
                    webNavigationController.setTabBarScrollOffset(
                        tabBarScrollOffset,
                        navigationBarScrollOffset: navigationBarScrollOffset
                    )

                    // Mark the tab bar as hidden if the navigation bar is fully scrolled.
                    tabBar.isHidden = newTabBarIsHidden
                } else {
                    // Make sure tab bar is not hidden for the animation.
                    tabBar.isHidden = tabBar.isHidden && newTabBarIsHidden

                    UIView.animate(
                        withDuration: navigationBarRevealOrHideAnimationDurationSeconds,
                        delay: 0,
                        options: .curveEaseIn,
                        animations: { [self] in
                            tabBar.frame.origin.y = tabBarFrameOriginY

                            // Never animate bottom bars when hiding the tab bar. We want this when
                            // popping back to a screen that has the tab bar hidden (since the snapshot was
                            // rendered with a hidden tab bar). It's weird for the bottom bar to jump up
                            // then animate down with the tab bar.
                            let previousAreAnimationsEnabeld = UIView.areAnimationsEnabled
                            if newTabBarIsHidden { UIView.setAnimationsEnabled(false) }

                            webNavigationController.setTabBarScrollOffset(
                                tabBarScrollOffset,
                                navigationBarScrollOffset: navigationBarScrollOffset
                            )

                            if newTabBarIsHidden {
                                UIView.setAnimationsEnabled(previousAreAnimationsEnabeld)
                            }
                        },
                        completion: { [self] (finished) in
                            // Make sure even if the animation was cancelled we set the correct
                            // position.
                            if !finished {
                                tabBar.frame.origin.y = tabBarFrameOriginY
                                webNavigationController.setTabBarScrollOffset(
                                    tabBarScrollOffset,
                                    navigationBarScrollOffset: navigationBarScrollOffset
                                )
                            }

                            // Mark the tab bar as hidden if the navigation bar is fully scrolled.
                            tabBar.isHidden = newTabBarIsHidden
                        }
                    )
                }
            }
        }

        // If the scroll offset changed while the scroll view was unmounted, then run
        // our scroll event handler to update the tab bar's state according to the new
        // scroll.
        if hasScrollOffsetChanged, let scrollView = scrollView {
            webNavigationController(navigationController, didScrollWebScrollView: scrollView)
        }
    }

    func webNavigationController(
        _ navigationController: WebNavigationController,
        didScrollWebScrollView scrollView: UIScrollView
    ) {
        guard self.mainScrollView === scrollView else { return }

        // We implement the same logic here as in `navigation_bar.tsx` for
        // revealing/hiding our tab bar as the user scrolls. By implementing identical
        // logic to `navigation_bar.tsx` the app feels cohesive.
        //
        // Ideally, we'd only consider scroll events on scroll views
        // `navigation_bar.tsx` is initialized on. However, we can't really
        // associate `UIScrollView`s with WebKit DOM nodes from here. Instead we make
        // assumptions. Like assuming there's only one `useNavigationBar()` scroll view
        // on the page at a time.

        // Clamp scroll offset so it's not affected by overscroll at the top of the
        // scroll view. Overscroll at the bottom of the scroll view is desired! We want
        // the top bar (which should be collapsed) to continue with the scroll window
        // when at the bottom of the view.
        //
        // This also creates a neat effect where when the overscroll bounces back the
        // navigation bar is revealed. If the user is at the end of the scroll view
        // they probably need the navigation bar to navigate out.
        //
        // Native code only: We need to round the content offset since it's an integer
        // in web code but fractional in native code.
        let scrollOffset = max(0, round(scrollView.contentOffset.y))

        // Sometimes native code sends us a scroll event twice for the same scroll
        // offset. Since scroll offsets may not be integers (e.g. 574.3333) this may be
        // the fractional part changing but when rounded there's no change. Whatever
        // the reason, ignore scroll events that repeat a scroll offset.
        if scrollOffset == self.lastScrollOffset { return }

        let clientHeight = round(scrollView.bounds.height)
        let scrollHeight = round(scrollView.contentSize.height)

        // Immediately finish any animations when scrolling begins.
        tabBar.layer.removeAllAnimations()

        let lastScrollOffset = self.lastScrollOffset
        self.lastScrollOffset = scrollOffset

        let lastClientHeight = self.lastClientHeight
        self.lastClientHeight = clientHeight

        let lastScrollHeight = self.lastScrollHeight
        self.lastScrollHeight = scrollHeight

        // - Edge case 1: If our scroll content resized and scrolled down at the same
        //   time (and scrolled the same amount we resized) then we don't want our
        //   navigation bar's scroll offset to change.
        //
        //   This happens when the typing indicator appears then disappears. Try going
        //   to a chat then typing in another tab to show the typing indicator, wait
        //   for it to disappear, then type again. Do this a couple times. When the
        //   typing indicator appears the view scrolls down to show it. We don't want
        //   that scroll down to hide our tab bar.
        //
        // - Edge case 2: If our scroll view resized and scrolled at the same time
        //   (and scrolled the same amount we resized) then we don't want our
        //   navigation bar's scroll offset to change.
        //
        //   This happens when you're typing in the message input and there's a
        //   navigation bar. When the message input grows we want the navigation bar to
        //   stay as it is instead of jumping around.
        //
        // Ideally this logic would run only after a resize and before the resize
        // paints to the screen, but web code doesn't have a good way to listen for
        // scroll view content resize. (Whereas in iOS native code we can use KVO to
        // listen to `contentSize` on `UIScrollView`.)
        if (scrollHeight > lastScrollHeight && scrollOffset > lastScrollOffset
            && scrollOffset - lastScrollOffset <= scrollHeight - lastScrollHeight)
            || (clientHeight < lastClientHeight && scrollOffset > lastScrollOffset
                && scrollOffset - lastScrollOffset <= lastClientHeight - clientHeight)
            || (clientHeight > lastClientHeight && scrollOffset < lastScrollOffset
                && lastScrollOffset - scrollOffset <= clientHeight - lastClientHeight)
        {
            // Also perform the scroll direction change here.
            self.lastScrollDirection = scrollOffset > lastScrollOffset ? .down : .up

            let lastNavigationBarScrollOffset = max(
                0,
                min(lastScrollOffset - self.lastNavigationBarTopOffset, navigationBarHeight)
            )

            let navigationBarTopOffset = scrollOffset - lastNavigationBarScrollOffset
            self.lastNavigationBarTopOffset = navigationBarTopOffset
        }

        let scrollDirection: ScrollDirection = scrollOffset > lastScrollOffset ? .down : .up
        let lastScrollDirection = self.lastScrollDirection
        self.lastScrollDirection = scrollDirection

        let lastNavigationBarTopOffset = self.lastNavigationBarTopOffset
        var navigationBarTopOffset = lastNavigationBarTopOffset

        let lastNavigationBarScrollOffset = max(
            0,
            min(lastScrollOffset - lastNavigationBarTopOffset, navigationBarHeight)
        )

        if scrollDirection != lastScrollDirection {
            navigationBarTopOffset = lastScrollOffset - lastNavigationBarScrollOffset
            self.lastNavigationBarTopOffset = navigationBarTopOffset
        }

        let navigationBarScrollOffset = max(
            0,
            min(scrollOffset - navigationBarTopOffset, navigationBarHeight)
        )

        // The following is only in native code: Actually update tab bar position based
        // on how much it's been offset. While we need to use `position: sticky` to be
        // frame perfect in web code, native code scroll handling is already frame
        // perfect.
        do {
            let navigationBarScrollOffset =
                if let state = disabledTabBarState { state.isHidden ? navigationBarHeight : 0 } else
                { navigationBarScrollOffset }

            // Convert from navigation bar offset to tab bar offset. We want the native tab
            // bar to disappear at the same rate as the web navigation bar.
            let tabBarScrollOffset =
                (tabBar.frame.height / navigationBarHeight) * navigationBarScrollOffset

            tabBar.frame.origin.y = (view.frame.height - tabBar.frame.height) + tabBarScrollOffset
            webNavigationController.setTabBarScrollOffset(
                tabBarScrollOffset,
                navigationBarScrollOffset: navigationBarScrollOffset
            )

            // Mark the tab bar as hidden if the navigation bar is fully scrolled.
            tabBar.isHidden = navigationBarScrollOffset >= navigationBarHeight
        }

        self.scrollDebounceTimeout?.invalidate()
        self.scrollDebounceTimeout = nil

        // We only need a timeout to run our reveal/hide animation if the navigation
        // bar:
        //
        // - Isn't completely scrolled in or completely scrolled out; OR
        // - Is completely scrolled to the bottom
        if navigationBarScrollOffset != 0
            && (navigationBarScrollOffset != navigationBarHeight
                || scrollOffset >= scrollHeight - clientHeight)
        {
            let scrollDebounceTimeout = Timer(
                timeInterval: navigationBarTransitionDebounceScrollTimeoutSeconds,
                repeats: false
            ) { [self] (_) in
                self.scrollDebounceTimeout = nil

                // Reveal the navigation bar if:
                //
                // - We pass the visible height threshold; OR
                // - We've completely scrolled to the bottom
                //
                // We always show the navigation bar at the bottom since we assume the user has
                // completed reading the page and they're ready to take action. The only scroll
                // action they could make is to scroll up which would reveal the tab bar. This
                // also means, in our native mobile app, we're not showing extra safe area at
                // the bottom of the page.
                var navigationBarTopOffset: Double
                if navigationBarHeight - navigationBarScrollOffset
                    >= navigationBarVisibleHeightThresholdForReveal
                    || scrollOffset >= scrollHeight - clientHeight
                {
                    navigationBarTopOffset = scrollOffset
                } else {
                    navigationBarTopOffset = max(0, scrollOffset - navigationBarHeight)
                }

                let lastNavigationBarTopOffset =
                    scrollOffset >= scrollHeight - clientHeight
                    ?  // If we're at the bottom of the screen, the last navigation bar top offset may
                    // be many pixels above us (where the last scroll direction change happened).
                    // This happens when you perfectly scroll to the end of the scroll view and
                    // don't overscroll (hard to do with a finger gesture on iOS).
                    //
                    // We saw an issue here on iOS when `<DocumentContentEditor>` calls
                    // `scrollTo()` when the keyboard opens scrolling to the bottom of the view.
                    // The navigation bar animation appeared a little glitchy because it was
                    // animating from a much higher position in the scroll view.
                    max(
                        self.lastNavigationBarTopOffset,
                        scrollHeight - clientHeight - navigationBarHeight
                    ) : self.lastNavigationBarTopOffset
                self.lastNavigationBarTopOffset = navigationBarTopOffset

                let _ = lastNavigationBarTopOffset

                // The following is only in native code: Actually animate the tab bar into
                // position after our timeout has fired. Web code needs to wait for a React
                // effect before the animation can run.
                do {
                    let navigationBarScrollOffset =
                        if let state = disabledTabBarState {
                            state.isHidden ? navigationBarHeight : 0
                        } else {
                            max(
                                0,
                                min(scrollOffset - navigationBarTopOffset, navigationBarTopOffset)
                            )
                        }

                    // Convert from navigation bar offset to tab bar offset. We want the native tab
                    // bar to disappear at the same rate as the web navigation bar.
                    let tabBarScrollOffset =
                        ((tabBar.frame.height / navigationBarHeight) * navigationBarScrollOffset)

                    let tabBarFrameOriginY =
                        (view.frame.height - tabBar.frame.height) + tabBarScrollOffset

                    UIView.animate(
                        withDuration: navigationBarRevealOrHideAnimationDurationSeconds,
                        delay: 0,
                        options: .curveEaseIn,
                        animations: { [self] in
                            tabBar.frame.origin.y = tabBarFrameOriginY
                            webNavigationController.setTabBarScrollOffset(
                                tabBarScrollOffset,
                                navigationBarScrollOffset: navigationBarScrollOffset
                            )
                        },
                        completion: { [self] (finished) in
                            // Make sure even if the animation was cancelled we set the correct
                            // position.
                            if !finished {
                                tabBar.frame.origin.y = tabBarFrameOriginY
                                webNavigationController.setTabBarScrollOffset(
                                    tabBarScrollOffset,
                                    navigationBarScrollOffset: navigationBarScrollOffset
                                )
                            }

                            // Mark the tab bar as hidden if the navigation bar is fully scrolled.
                            tabBar.isHidden = navigationBarScrollOffset >= navigationBarHeight
                        }
                    )
                }
            }

            self.scrollDebounceTimeout = scrollDebounceTimeout

            // We need to add our timer to the common run loop mode so it can execute
            // even while a gesture is occuring.
            //
            // For more information about run loops:
            // https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/Multithreading/RunLoopManagement/RunLoopManagement.html
            RunLoop.current.add(scrollDebounceTimeout, forMode: .common)
        }
    }

    func webNavigationController(
        runScrollDebounceTimeout navigationController: WebNavigationController
    ) {
        // If web code tells us to fire the scroll debounce timeout then don't wait for
        // the timer, fire immediately since we want to run our animation at the same
        // time as web.
        if let scrollDebounceTimeout = scrollDebounceTimeout {
            scrollDebounceTimeout.fire()
            scrollDebounceTimeout.invalidate()
            self.scrollDebounceTimeout = nil
        }
    }

    func webNavigationController(
        _ navigationController: WebNavigationController,
        didDisableTabBarChange isDisabled: Bool,
        isHidden: Bool,
        isAnimated: Bool
    ) {
        self.disabledTabBarState = isDisabled ? DisabledTabBarState(isHidden: isHidden) : nil

        let navigationBarScrollOffset =
            if let state = disabledTabBarState { state.isHidden ? navigationBarHeight : 0 } else {
                max(0, min(lastScrollOffset - self.lastNavigationBarTopOffset, navigationBarHeight))
            }

        let previousIsHidden = tabBar.isHidden

        let nextIsHidden = navigationBarScrollOffset >= navigationBarHeight

        // If the keyboard substitute closes and the tab bar should be visible (because
        // the navigation bar is visible) then animate the tab bar into the right
        // position.
        //
        // Test case: Unfocus a content editor when the keyboard substitute is open.
        if previousIsHidden && !nextIsHidden {
            // Immediately finish any current animations.
            tabBar.layer.removeAllAnimations()

            // Convert from navigation bar offset to tab bar offset. We want the native tab
            // bar to disappear at the same rate as the web navigation bar.
            let tabBarScrollOffset =
                (tabBar.frame.height / navigationBarHeight) * navigationBarScrollOffset

            let tabBarFrameOriginY = (view.frame.height - tabBar.frame.height) + tabBarScrollOffset

            if !isAnimated {
                tabBar.frame.origin.y = tabBarFrameOriginY
                webNavigationController.setTabBarScrollOffset(
                    tabBarScrollOffset,
                    navigationBarScrollOffset: navigationBarScrollOffset
                )

                tabBar.isHidden = nextIsHidden
            } else {
                // 1. Start the animation offscreen
                tabBar.frame.origin.y =
                    (view.frame.height - tabBar.frame.height) + tabBar.frame.height

                // Make sure the tab bar is visible during the animation.
                tabBar.isHidden = false

                UIView.animate(
                    withDuration: navigationBarRevealOrHideAnimationDurationSeconds,
                    delay: 0,
                    options: .curveEaseIn,
                    animations: { [self] in
                        // 2. Animate to the tab bar's current position
                        tabBar.frame.origin.y = tabBarFrameOriginY
                        webNavigationController.setTabBarScrollOffset(
                            tabBarScrollOffset,
                            navigationBarScrollOffset: navigationBarScrollOffset
                        )
                    },
                    completion: { [self] (finished) in
                        // Make sure even if the animation was cancelled we set the correct
                        // position.
                        if !finished {
                            tabBar.frame.origin.y = tabBarFrameOriginY
                            webNavigationController.setTabBarScrollOffset(
                                tabBarScrollOffset,
                                navigationBarScrollOffset: navigationBarScrollOffset
                            )
                        }

                        // Mark the tab bar as hidden if the navigation bar is fully scrolled.
                        tabBar.isHidden = nextIsHidden
                    }
                )
            }
        }

        if !previousIsHidden && nextIsHidden {
            // Convert from navigation bar offset to tab bar offset. We want the native tab
            // bar to disappear at the same rate as the web navigation bar.
            let nextTabBarScrollOffset = tabBar.frame.height

            let nextTabBarFrameOriginY =
                (view.frame.height - tabBar.frame.height) + nextTabBarScrollOffset

            if !isAnimated {
                tabBar.frame.origin.y = nextTabBarFrameOriginY
                webNavigationController.setTabBarScrollOffset(
                    nextTabBarScrollOffset,
                    navigationBarScrollOffset: navigationBarScrollOffset
                )

                tabBar.isHidden = navigationBarScrollOffset >= navigationBarHeight
            } else {
                // Immediately finish any current animations.
                tabBar.layer.removeAllAnimations()

                UIView.animate(
                    withDuration: navigationBarRevealOrHideAnimationDurationSeconds,
                    delay: 0,
                    options: .curveEaseIn,
                    animations: { [self] in
                        // Animate to the tab bar's current position
                        tabBar.frame.origin.y = nextTabBarFrameOriginY
                        webNavigationController.setTabBarScrollOffset(
                            nextTabBarScrollOffset,
                            navigationBarScrollOffset: navigationBarScrollOffset
                        )
                    },
                    completion: { [self] (finished) in
                        // Make sure even if the animation was cancelled we set the correct
                        // position.
                        if !finished {
                            tabBar.frame.origin.y = nextTabBarFrameOriginY
                            webNavigationController.setTabBarScrollOffset(
                                nextTabBarScrollOffset,
                                navigationBarScrollOffset: navigationBarScrollOffset
                            )
                        }

                        // Mark the tab bar as hidden if the navigation bar is fully scrolled.
                        tabBar.isHidden = navigationBarScrollOffset >= navigationBarHeight
                    }
                )
            }
        }
    }

    func webNavigationController(
        clearInboxNotificationBadge webNavigationController: WebNavigationController
    ) { clearInboxNotificationBadge() }

    func webNavigationController(
        _ webNavigationController: WebNavigationController,
        setInboxLoudNotificationBadge loudNotificationCount: Int
    ) { setInboxLoudNotificationBadge(loudNotificationCount) }

    func webNavigationController(
        setInboxSubtleNotificationBadge webNavigationController: WebNavigationController
    ) { setInboxSubtleNotificationBadge() }

    private static let inboxLoudNotificationBadgeFontSize = 12.0
    private static let inboxNotificationBadgeBorderWidth = inboxLoudNotificationBadgeFontSize * 0.15

    private func clearInboxNotificationBadge() {
        inboxNotificationBadgeView?.removeFromSuperview()
        inboxNotificationBadgeView = nil
        inboxLoudNotificationCount = 0
        isInboxSubtleNotificationBadgeView = false
    }

    private func setInboxLoudNotificationBadge(_ loudNotificationCount: Int) {
        inboxNotificationBadgeView?.removeFromSuperview()
        inboxNotificationBadgeView = nil
        inboxLoudNotificationCount = loudNotificationCount
        isInboxSubtleNotificationBadgeView = false

        let inboxTabIndex =
            (viewControllers?.firstIndex(where: { ($0 as? RootTabController)?.webTab == .inbox }))!

        let tabBarItemWidth = tabBar.frame.width / CGFloat(tabBar.items!.count)

        let fontSize = RootTabBarController.inboxLoudNotificationBadgeFontSize
        let borderWidth = RootTabBarController.inboxNotificationBadgeBorderWidth

        let offsetX = 7.5
        let offsetY = -8.0

        // The view we create here should render the same as `<LoudNotificationBadge>`.
        // `<LoudNotificationBadge>` renders with a 10px font size (on mobile) but we
        // want to render with a larger font size. So all measurements are relative to
        // `fontSize` but with the same proportions as `<LoudNotificationBadge>`.
        let badgeView = UILabel()
        badgeView.text = loudNotificationCount > 99 ? "99+" : String(loudNotificationCount)

        badgeView.backgroundColor = UIColor(named: "red-50-const")!
        badgeView.textColor = UIColor(named: "grey-0-const")!
        badgeView.textAlignment = .center
        badgeView.font = UIFont(name: "Inter-Medium", size: fontSize)!

        badgeView.clipsToBounds = true
        badgeView.frame.size = CGSize(
            width: max(
                fontSize * 1.5,
                // `intrinsicContentSize` may only be measured after setting text and font.
                badgeView.intrinsicContentSize.width + (fontSize / 2)
            ) + borderWidth * 2,
            height: fontSize * 1.5 + borderWidth * 2
        )

        badgeView.center = CGPoint(
            x: (tabBarItemWidth * CGFloat(inboxTabIndex)) + (tabBarItemWidth / 2.0) + offsetX,
            y: (tabBar.frame.height - view.safeAreaInsets.bottom) / 2.0 + offsetY
        )

        badgeView.layer.cornerRadius = badgeView.bounds.height / 2
        badgeView.layer.borderColor = UIColor(named: "grey-0")!.cgColor
        badgeView.layer.borderWidth = borderWidth

        tabBar.addSubview(badgeView)

        inboxNotificationBadgeView = badgeView
    }

    private func setInboxSubtleNotificationBadge() {
        inboxNotificationBadgeView?.removeFromSuperview()
        inboxNotificationBadgeView = nil
        inboxLoudNotificationCount = 0
        isInboxSubtleNotificationBadgeView = false

        let inboxTabIndex =
            (viewControllers?.firstIndex(where: { ($0 as? RootTabController)?.webTab == .inbox }))!

        let tabBarItemWidth = tabBar.frame.width / CGFloat(tabBar.items!.count)

        let borderWidth = RootTabBarController.inboxNotificationBadgeBorderWidth

        let offsetX = 5.0
        let offsetY = -6.5

        let badgeView = InboxSubtleNotificationBadgeView()

        badgeView.frame.size = CGSize(width: 5 + borderWidth, height: 5 + borderWidth)
        badgeView.center = CGPoint(
            x: (tabBarItemWidth * CGFloat(inboxTabIndex)) + (tabBarItemWidth / 2.0) + offsetX,
            y: (tabBar.frame.height - view.safeAreaInsets.bottom) / 2.0 + offsetY
        )

        badgeView.layer.fillColor =
            UIColor(
                named: (selectedViewController as! RootTabController).webTab == .inbox
                    ? "grey-100" : "grey-30"
            )!
            .cgColor
        badgeView.layer.strokeColor = UIColor(named: "grey-0")!.cgColor
        badgeView.layer.lineWidth = borderWidth
        badgeView.layer.cornerRadius = badgeView.bounds.height / 2

        tabBar.addSubview(badgeView)

        inboxNotificationBadgeView = badgeView
        isInboxSubtleNotificationBadgeView = true
    }

    func copyInboxNotificationBadge(from otherTabBarController: RootTabBarController) {
        if otherTabBarController.isInboxSubtleNotificationBadgeView {
            setInboxSubtleNotificationBadge()
        } else if otherTabBarController.inboxLoudNotificationCount > 0 {
            setInboxLoudNotificationBadge(otherTabBarController.inboxLoudNotificationCount)
        }
    }
}

class RootTabController: UIViewController {
    let webTab: WebNavigationController.Tab
    let image: UIImage

    init(tab: WebNavigationController.Tab, title: String, image: UIImage) {
        self.webTab = tab
        self.image = image

        super.init(nibName: nil, bundle: nil)

        // Render content underneath opaque bars like the tab bar. We make sure content
        // isn't hidden by opaque bars in web code.
        extendedLayoutIncludesOpaqueBars = true

        self.title = title

        // Only show icon in tab bar item. No word. With word it looks a little busy.
        // The icons we use are also fairly universally understood.
        tabBarItem = UITabBarItem(title: "", image: image, selectedImage: image)
    }

    required init?(coder: NSCoder) { fatalError("Unimplemented") }
}

/// Helper view for rendering a subtle notification badge without anti-aliasing
/// artifacts at the shape's border.
///
/// Adapted from:
/// https://stackoverflow.com/a/71185674/1568890
class InboxSubtleNotificationBadgeView: UIView {
    override class var layerClass: AnyClass { return CAShapeLayer.self }
    override var layer: CAShapeLayer { super.layer as! CAShapeLayer }

    override init(frame: CGRect) { super.init(frame: frame) }
    required init?(coder: NSCoder) { fatalError("Unimplemented") }

    override func layoutSubviews() {
        super.layoutSubviews()
        let path = UIBezierPath(roundedRect: bounds, cornerRadius: layer.cornerRadius)
        layer.path = path.cgPath
    }
}
