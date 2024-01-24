import UIKit
import WebKit

class RootTabBarController: UITabBarController, SceneDelegateRootController,
    UITabBarControllerDelegate
{
    let spaceId: String
    let webNavigationController: WebNavigationController

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
            initialPath: "/s/\(spaceId)/tasks/wstgc96gen6yp2zfetsksmg4t0",
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
        self.tabBarItem = UITabBarItem(title: title, image: image, selectedImage: image)
    }

    required init?(coder: NSCoder) { fatalError("Unimplemented") }
}
