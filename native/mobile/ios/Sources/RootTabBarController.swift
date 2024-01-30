import UIKit
import WebKit

class RootTabBarController: UITabBarController, SceneDelegateRootController,
    UITabBarControllerDelegate, WebNavigationControllerDelegate
{
    let spaceId: String
    let webNavigationController: WebNavigationController

    private var lastScrollOffset = 0.0
    private var lastScrollDirection = ScrollDirection.down
    private var lastTabBarTopOffset = 0.0
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
            initialPath: "/s/\(spaceId)/tasks/aqz6s9yy1c8vwzpqvf8ngxjma0",
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

    func webScrollViewDidScroll(_ scrollView: UIScrollView) {
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

        // Immediately finish any animations when scrolling begins.
        tabBar.layer.removeAllAnimations()

        // Clamp scroll offset so it's not affected by overscroll at the top of the
        // scroll view. Overscroll at the bottom of the scroll view is desired! We want
        // the top bar (which should be collapsed) to continue with the scroll window
        // when at the bottom of the view.
        //
        // This also creates a neat effect where when the overscroll bounces back the
        // navigation bar is revealed. If the user is at the end of the scroll view
        // they probably need the navigation bar to navigate out.
        let scrollOffset = max(0, scrollView.contentOffset.y)

        let lastScrollOffset = self.lastScrollOffset
        self.lastScrollOffset = scrollOffset

        let tabBarHeight = tabBar.frame.height

        let scrollDirection: ScrollDirection = scrollOffset > lastScrollOffset ? .down : .up
        let lastScrollDirection = self.lastScrollDirection
        self.lastScrollDirection = scrollDirection

        let tabBarScrollOffset = max(0, min(scrollOffset - self.lastTabBarTopOffset, tabBarHeight))

        if scrollDirection != lastScrollDirection {
            let tabBarTopOffset = scrollOffset - tabBarScrollOffset
            self.lastTabBarTopOffset = tabBarTopOffset
        }

        // This is only in native code: Actually update tab bar position based on how
        // much it's been offset. While we need to use `position: sticky` to be frame
        // perfect in web code, native code scroll handling is already frame perfect.
        tabBar.frame.origin.y = (view.frame.height - tabBar.frame.height) + tabBarScrollOffset

        self.scrollDebounceTimeout?.invalidate()
        self.scrollDebounceTimeout = nil

        let scrollDebounceTimeout = Timer(
            timeInterval: navigationBarTransitionDebounceScrollTimeoutSeconds,
            repeats: false
        ) { [self] (_) in
            self.scrollDebounceTimeout = nil

            // Navigation bar is completely scrolled in or completely scrolled out. We don't
            // need to animate.
            if tabBarScrollOffset == 0 || tabBarScrollOffset == tabBarHeight { return }

            var tabBarTopOffset: Double

            print("DIFFERENCE", tabBarHeight - tabBarScrollOffset)

            if tabBarHeight - tabBarScrollOffset >= navigationBarRevealAfterScrollThreshold {
                tabBarTopOffset = scrollOffset
            } else {
                tabBarTopOffset = max(0, scrollOffset - tabBarHeight)
            }

            let lastTabBarTopOffset = self.lastTabBarTopOffset
            self.lastTabBarTopOffset = tabBarTopOffset

            let animateNavigationBarTranslateY = tabBarTopOffset - lastTabBarTopOffset

            // The following is only in native code: Actually animate the tab bar into
            // position after our timeout has fired. Web code needs to wait for a React
            // effect before the animation can run.

            let tabBarScrollOffset = max(0, min(scrollOffset - tabBarTopOffset, tabBarHeight))
            let tabBarFrameOriginY = (view.frame.height - tabBar.frame.height) + tabBarScrollOffset

            UIView.animate(
                withDuration: abs(animateNavigationBarTranslateY)
                    / navigationBarRevealOrHideAnimationSpeed,
                delay: 0,
                options: .curveLinear,
                animations: { [self] in tabBar.frame.origin.y = tabBarFrameOriginY },
                completion: { [self] (finished) in
                    // Make sure even if the animation was cancelled we set the correct
                    // position.
                    if !finished { tabBar.frame.origin.y = tabBarFrameOriginY }
                }
            )
        }

        // Add some tolerance to reduce energy impact of timer.
        scrollDebounceTimeout.tolerance = 0.05

        self.scrollDebounceTimeout = scrollDebounceTimeout

        // We need to add our timeout to the common run loop mode so it can execute
        // even while a drag is occuring.
        //
        // For more information about run loops:
        // https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/Multithreading/RunLoopManagement/RunLoopManagement.html
        RunLoop.current.add(scrollDebounceTimeout, forMode: .common)
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
