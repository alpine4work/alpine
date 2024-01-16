import UIKit

class RootTabBarController: UITabBarController {
    override func viewDidLoad() {
        super.viewDidLoad()

        let appearance = UITabBarAppearance()
        let itemAppearance = UITabBarItemAppearance()

        itemAppearance.normal.iconColor = UIColor.green
        itemAppearance.normal.titleTextAttributes = [
            .foregroundColor: UIColor.green, .font: UIFont(name: "Inter-Regular", size: 13)!,
        ]

        itemAppearance.selected.iconColor = UIColor.red
        itemAppearance.selected.titleTextAttributes = [.foregroundColor: UIColor.red]

        appearance.backgroundColor = .orange

        appearance.shadowImage = UIImage(named: "RootTabBarShadow")!
            // Must use template rendering mode for `shadowColor` to have any effect.
            .withRenderingMode(.alwaysTemplate)
        appearance.shadowColor = .purple

        appearance.stackedLayoutAppearance = itemAppearance
        appearance.compactInlineLayoutAppearance = itemAppearance
        appearance.inlineLayoutAppearance = itemAppearance

        tabBar.isTranslucent = false
        tabBar.standardAppearance = appearance
        tabBar.scrollEdgeAppearance = appearance

        let homeTabController = RootTabController()
        homeTabController.title = "Home"
        homeTabController.image = UIImage(named: "HouseIcon")!

        let searchTabController = RootTabController()
        searchTabController.title = "Search"
        searchTabController.image = UIImage(named: "MagnifyingGlassIcon")!

        let createTabController = RootTabController()
        createTabController.title = "Create"
        createTabController.image = UIImage(named: "PlusIcon")!

        let inboxTabController = RootTabController()
        inboxTabController.title = "Inbox"
        inboxTabController.image = UIImage(named: "BellIcon")!

        let moreTabController = RootTabController()
        moreTabController.title = "More"
        moreTabController.image = UIImage(named: "ListIcon")!

        let tabControllers = [
            homeTabController, searchTabController, createTabController, inboxTabController,
            moreTabController,
        ]

        for tabController in tabControllers {
            tabController.tabBarItem = UITabBarItem(
                title: tabController.title,
                image: tabController.image,
                selectedImage: tabController.image
            )
        }

        viewControllers = tabControllers
    }
}

class RootTabController: UIViewController {
    var image: UIImage?

    override func viewDidLoad() {
        super.viewDidLoad()

        view.backgroundColor = UIColor.white

        let label = UILabel()
        label.translatesAutoresizingMaskIntoConstraints = false
        label.text = title
        label.textColor = UIColor.black

        view.addSubview(label)

        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: self.view.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: self.view.centerYAnchor),
        ])
    }
}
