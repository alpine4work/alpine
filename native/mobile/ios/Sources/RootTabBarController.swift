import UIKit
import WebKit

class RootTabBarController: UITabBarController, SceneDelegateRootController,
    UITabBarControllerDelegate, WebNavigationControllerDelegate
{
    let spaceId: String
    let webNavigationController: WebNavigationController

    private var webDragScrollState: WebDragScrollState?

    private struct WebDragScrollState {
        let scrollView: UIScrollView
        let initialTabBarIsHidden: Bool
        let initialContentOffset: CGPoint
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

    func webScrollViewWillBeginDragging(_ scrollView: UIScrollView) {
        if webDragScrollState == nil {
            tabBar.layer.removeAllAnimations()

            if tabBar.isHidden {
                tabBar.frame = CGRect(
                    x: tabBar.frame.origin.x,
                    y: view.frame.height,
                    width: tabBar.frame.width,
                    height: tabBar.frame.height
                )
            } else {
                tabBar.frame = CGRect(
                    x: tabBar.frame.origin.x,
                    y: view.frame.height - tabBar.frame.height,
                    width: tabBar.frame.width,
                    height: tabBar.frame.height
                )
            }

            webDragScrollState = WebDragScrollState(
                scrollView: scrollView,
                initialTabBarIsHidden: tabBar.isHidden,
                initialContentOffset: scrollView.contentOffset
            )
        }
    }

    func webScrollViewDidScroll(_ scrollView: UIScrollView) {
        guard let webDragScrollState = webDragScrollState,
            webDragScrollState.scrollView === scrollView
        else { return }

        let initialY =
            webDragScrollState.initialTabBarIsHidden
            ? view.frame.height : view.frame.height - tabBar.frame.height

        let yDelta = scrollView.contentOffset.y - webDragScrollState.initialContentOffset.y
        var y = initialY + yDelta

        y = min(y, view.frame.height)
        y = max(y, view.frame.height - tabBar.frame.height)

        // If we are animating the tab bar from hidden offscreen to visible then we
        // need to mark `isHidden = false` while scrolling.
        if yDelta < 0 && tabBar.isHidden { tabBar.isHidden = false }

        tabBar.frame = CGRect(
            x: tabBar.frame.origin.x,
            y: y,
            width: tabBar.frame.width,
            height: tabBar.frame.height
        )

        if webDragScrollState.initialTabBarIsHidden {
            if yDelta > 0 {
                self.webDragScrollState = WebDragScrollState(
                    scrollView: scrollView,
                    initialTabBarIsHidden: true,
                    initialContentOffset: scrollView.contentOffset
                )
            } else if y <= view.frame.height - tabBar.frame.height {
                self.webDragScrollState = WebDragScrollState(
                    scrollView: scrollView,
                    initialTabBarIsHidden: false,
                    initialContentOffset: scrollView.contentOffset
                )
            }
        } else {
            if yDelta < 0 {
                self.webDragScrollState = WebDragScrollState(
                    scrollView: scrollView,
                    initialTabBarIsHidden: false,
                    initialContentOffset: scrollView.contentOffset
                )
            } else if y >= view.frame.height {
                self.webDragScrollState = WebDragScrollState(
                    scrollView: scrollView,
                    initialTabBarIsHidden: true,
                    initialContentOffset: scrollView.contentOffset
                )
            }
        }
    }

    func webScrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) {
        guard let webDragScrollState = webDragScrollState,
            webDragScrollState.scrollView === scrollView
        else { return }

        self.webDragScrollState = nil

        let speed = 250.0  // points per second
        let contentOffsetThreshold = decelerate ? 0 : 25.0

        let yDelta = scrollView.contentOffset.y - webDragScrollState.initialContentOffset.y

        let shouldHide =
            !webDragScrollState.initialTabBarIsHidden
            ? yDelta > contentOffsetThreshold : !(yDelta < -contentOffsetThreshold)

        let endY = shouldHide ? view.frame.height : view.frame.height - tabBar.frame.height

        UIView.animate(
            withDuration: abs(tabBar.frame.origin.y - endY) / speed,
            delay: 0,
            options: .curveLinear,
            animations: { [self] in
                tabBar.frame = CGRect(
                    x: tabBar.frame.origin.x,
                    y: endY,
                    width: tabBar.frame.width,
                    height: tabBar.frame.height
                )
            },
            completion: { [self] (finished) in if finished { tabBar.isHidden = shouldHide } }
        )
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
