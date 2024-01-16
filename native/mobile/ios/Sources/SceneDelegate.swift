import UIKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(
        _ scene: UIScene,
        willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        guard let windowScene = (scene as? UIWindowScene) else { return }

        let homeController = TabController()
        homeController.title = "Home"
        homeController.tabBarItem = UITabBarItem(
            title: "Home",
            image: UIImage(named: "HouseIcon"),
            tag: 1
        )

        let searchController = TabController()
        searchController.title = "Search"
        searchController.tabBarItem = UITabBarItem(
            title: "Search",
            image: UIImage(named: "MagnifyingGlassIcon"),
            tag: 2
        )

        let createController = TabController()
        createController.title = "Create"
        createController.tabBarItem = UITabBarItem(
            title: "Create",
            image: UIImage(named: "PlusIcon"),
            tag: 3
        )

        let inboxController = TabController()
        inboxController.title = "Inbox"
        inboxController.tabBarItem = UITabBarItem(
            title: "Inbox",
            image: UIImage(named: "BellIcon"),
            tag: 4
        )

        let moreController = TabController()
        moreController.title = "More"
        moreController.tabBarItem = UITabBarItem(
            title: "More",
            image: UIImage(named: "ListIcon"),
            tag: 5
        )

        let tabBarController = UITabBarController()
        tabBarController.viewControllers = [
            homeController, searchController, createController, inboxController, moreController,
        ]

        let window = UIWindow(frame: windowScene.coordinateSpace.bounds)
        self.window = window
        window.windowScene = windowScene
        window.rootViewController = tabBarController
        window.makeKeyAndVisible()
    }
}
