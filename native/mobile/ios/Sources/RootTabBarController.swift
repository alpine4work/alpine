import UIKit

class RootTabBarController: UITabBarController {
    override func viewDidLoad() {
        super.viewDidLoad()

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
