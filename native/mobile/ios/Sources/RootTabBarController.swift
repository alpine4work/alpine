import UIKit
import WebKit

class RootTabBarController: UITabBarController, SceneDelegateRootController,
    UITabBarControllerDelegate, WebNavigationControllerDelegate
{
    let spaceId: String
    let webNavigationController: WebNavigationController

    private weak var mainScrollView: UIScrollView?
    private var lastScrollOffset = 0.0
    private var lastScrollHeight = 0.0
    private var lastScrollDirection = ScrollDirection.down
    private var lastNavigationBarTopOffset = 0.0
    private var scrollDebounceTimeout: Timer?

    private enum ScrollDirection {
        case up
        case down
    }

    init(spaceId: String, session: String) {
        self.spaceId = spaceId

        // We use a non-persistent store while the user is signed out, but once they're
        // signed in we remember their `localStorage`, cookies, etc.
        let websiteDataStore = WKWebsiteDataStore.default()

        let sessionCookieProperties: [HTTPCookiePropertyKey: Any] = [
            .name: "session", .value: session, .domain: WebNavigationController.baseUrl.host()!,
            .path: "/",
            // iOS doesn't have a constant for the `HttpOnly` key so manually initialize.
            // https://forums.developer.apple.com/forums/thread/701770
            .init(rawValue: "HttpOnly"): true, .sameSitePolicy: HTTPCookieStringPolicy.sameSiteLax,
            .expires: NSDate(timeIntervalSinceNow: TimeInterval(60 * 60 * 24 * 365)),
        ]

        #if PRODUCTION_RUN_ENVIRONMENT
            sessionCookieProperties[.secure] = true
        #endif

        // This cookie needs to be the same as the session cookie created in
        // `session_cookie.ts`. We set the cookie within our native mobile app shell
        // instead of on the server for our native mobile app.
        let sessionCookie = HTTPCookie(properties: sessionCookieProperties)!

        // Make sure our `.init(rawValue: "HttpOnly")` worked.
        assert(sessionCookie.isHTTPOnly)

        websiteDataStore.httpCookieStore.setCookie(sessionCookie)

        webNavigationController = WebNavigationController(
            // NOCOMMIT: Proper initial path. Just for debugging
            // initialPath: "/s/\(spaceId)/tasks/wstgc96gen6yp2zfetsksmg4t0",
            // initialPath: "/s/\(spaceId)/tasks/aqz6s9yy1c8vwzpqvf8ngxjma0",
            // initialPath: "/s/\(spaceId)/chat/with/2wf86qqvavtzkgatx9czwbtcb8",
            initialPath: "/s/\(spaceId)/documents/2v1kz5r5w3tdb7zv6xt98wm7qg",
            // initialPath: "/s/\(spaceId)/documents/3bvke6qzpyr2tzysk0a9p5sa8r",
            websiteDataStore: websiteDataStore
        )

        let homeTabController = RootTabController(
            title: "Home",
            image: UIImage(named: "HouseIcon")!
        )

        let searchTabController = RootTabController(
            title: "Search",
            image: UIImage(named: "MagnifyingGlassIcon")!
        )

        let createTabController = RootTabController(
            title: "Create",
            image: UIImage(named: "PlusIcon")!
        )

        let inboxTabController = RootTabController(
            title: "Inbox",
            image: UIImage(named: "BellIcon")!
        )

        let moreTabController = RootTabController(title: "More", image: UIImage(named: "ListIcon")!)

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

        itemAppearance.selected.iconColor = UIColor(named: "grey-text")!
        itemAppearance.selected.titleTextAttributes = [
            .foregroundColor: UIColor(named: "grey-text")!
        ]

        appearance.backgroundColor = UIColor(named: "grey-0")!

        appearance.shadowImage = UIImage(named: "RootTabBarShadow")!
            // Must use template rendering mode for `shadowColor` to have any effect.
            .withRenderingMode(.alwaysTemplate)
        appearance.shadowColor = UIColor(named: "grey-10")!

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

        selectedViewController = homeTabController
        selectedViewController!.addChild(webNavigationController)
        selectedViewController!.view.addSubview(webNavigationController.view)
    }

    required init?(coder: NSCoder) { fatalError("Unimplemented") }

    func setWindowSafeAreaInsets(_ windowSafeAreaInsets: UIEdgeInsets) {
        webNavigationController.setWindowSafeAreaInsets(windowSafeAreaInsets)
    }

    func tabBarController(
        _ tabBarController: UITabBarController,
        didSelect viewController: UIViewController
    ) {
        // We only have one underlying web view for each tab. So whenever the user
        // switches the tab, move our web view to the new tab.
        webNavigationController.view.removeFromSuperview()
        webNavigationController.removeFromParent()
        viewController.addChild(webNavigationController)
        viewController.view.addSubview(webNavigationController.view)
    }

    func webNavigationController(
        _ navigationController: WebNavigationController,
        didAddWebScrollView scrollView: UIScrollView
    ) {
        // There may be other scroll views on our web page but we need to decide what
        // the "main" scroll view is so that as it scrolls we can show/hide the tab bar.
        // If a non-main scroll view scrolls we want to ignore those events.
        //
        // So we use a simple "is this scroll view big enough?" heuristic. For instance
        // in chat the main messaging section is big enough to be the main scroll view
        // but not the message input. This may not work in general but is practical
        // for our purposes.
        //
        // We also exclude the root scroll view since the root scroll view shouldn't be
        // scrollable.
        if scrollView.frame.width < view.frame.width * 0.5
            || scrollView.frame.height < view.frame.height * 0.5
        {
            return
        }

        // See the comment on the same statement in
        // `webNavigationController(didScroll:)` for more information on why we call
        // `max()` and `round()`.
        let scrollOffset = max(0, round(scrollView.contentOffset.y))
        let scrollHeight = round(scrollView.contentSize.height)

        lastScrollOffset = scrollOffset
        lastScrollHeight = scrollHeight
        lastScrollDirection = .down
        lastNavigationBarTopOffset = scrollOffset

        scrollDebounceTimeout?.invalidate()
        scrollDebounceTimeout = nil

        webNavigationController.setTabBarScrollOffset(0)

        mainScrollView = scrollView
    }

    func webNavigationController(
        _ navigationController: WebNavigationController,
        didScrollWebScrollView scrollView: UIScrollView
    ) {
        guard self.mainScrollView === scrollView else { return }

        // We implement the same logic here as in `use_navigation_bar.tsx` for
        // revealing/hiding our tab bar as the user scrolls. By implementing identical
        // logic to `use_navigation_bar.tsx` the app feels cohesive.
        //
        // Ideally, we'd only consider scroll events on scroll views
        // `use_navigation_bar.tsx` is initialized on. However, we can't really
        // associate `UIScrollView`s with WebKit DOM nodes from here. Instead we make
        // assumptions. Like assuming there's only one `useNavigationBar()` scroll view
        // on the page at a time.
        //
        // TODO(calebmer): Ignore scroll views that only scroll horizontally but not
        // vertically.
        //
        // TODO(calebmer): If we ever have nested vertical scroll views, ignore scrolls
        // from a scroll view that is nested inside another scroll view.

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

        let scrollHeight = round(scrollView.contentSize.height)
        let clientHeight = round(scrollView.frame.height)

        // Immediately finish any animations when scrolling begins.
        tabBar.layer.removeAllAnimations()

        let lastScrollOffset = self.lastScrollOffset
        self.lastScrollOffset = scrollOffset

        let lastScrollHeight = self.lastScrollHeight
        self.lastScrollHeight = scrollHeight

        // Edge case: If we resized and scrolled down at the same time (and scrolled
        // the same amount we resized) then we don't want our navigation bar's scroll
        // offset to change.
        //
        // This happens when the typing indicator appears then disappears. Try going to
        // a chat then typing in another tab to show the typing indicator, wait for it
        // to disappear, then type again. Do this a couple times. When the typing
        // indicator appears the view scrolls down to show it. We don't want that
        // scroll down to hide our tab bar.
        //
        // Ideally this logic would run only after a resize and before the resize
        // paints to the screen, but web code doesn't have a good way to listen for
        // scroll view content resize. (Whereas in iOS native code we can use KVO to
        // listen to `contentSize` on `UIScrollView`.)
        if scrollOffset > lastScrollOffset
            && scrollOffset - lastScrollOffset == scrollHeight - lastScrollHeight
        {
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

        let navigationBarScrollOffset = max(
            0,
            min(scrollOffset - self.lastNavigationBarTopOffset, navigationBarHeight)
        )

        if scrollDirection != lastScrollDirection {
            let navigationBarTopOffset = scrollOffset - navigationBarScrollOffset
            self.lastNavigationBarTopOffset = navigationBarTopOffset
        }

        // The following is only in native code: Actually update tab bar position based
        // on how much it's been offset. While we need to use `position: sticky` to be
        // frame perfect in web code, native code scroll handling is already frame
        // perfect.
        do {
            // Convert from navigation bar offset to tab bar offset. We want the native tab
            // bar to disappear at the same rate as the web navigation bar.
            let tabBarScrollOffset =
                ((tabBar.frame.height / navigationBarHeight) * navigationBarScrollOffset)

            tabBar.frame.origin.y = (view.frame.height - tabBar.frame.height) + tabBarScrollOffset
            webNavigationController.setTabBarScrollOffset(tabBarScrollOffset)

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

                let lastNavigationBarTopOffset = self.lastNavigationBarTopOffset
                self.lastNavigationBarTopOffset = navigationBarTopOffset

                let _ = lastNavigationBarTopOffset

                // The following is only in native code: Actually animate the tab bar into
                // position after our timeout has fired. Web code needs to wait for a React
                // effect before the animation can run.
                do {
                    let navigationBarScrollOffset = max(
                        0,
                        min(scrollOffset - navigationBarTopOffset, navigationBarTopOffset)
                    )

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
                            webNavigationController.setTabBarScrollOffset(tabBarScrollOffset)
                        },
                        completion: { [self] (finished) in
                            // Make sure even if the animation was cancelled we set the correct
                            // position.
                            if !finished {
                                tabBar.frame.origin.y = tabBarFrameOriginY
                                webNavigationController.setTabBarScrollOffset(tabBarScrollOffset)
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
}

class RootTabController: UIViewController {
    let image: UIImage

    init(title: String, image: UIImage) {
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
