import UIKit

class RootTabBarController: UITabBarController {
    override func viewDidLoad() {
        super.viewDidLoad()

        let homeTabController = RootTabController()
        homeTabController.title = "Home"
        homeTabController.image = UIImage(named: "HouseIcon")
        homeTabController.initTabBarItem()

        let searchTabController = RootTabController()
        searchTabController.title = "Search"
        searchTabController.image = UIImage(named: "MagnifyingGlassIcon")
        searchTabController.initTabBarItem()

        let createTabController = RootTabController()
        createTabController.title = "Create"
        createTabController.image = UIImage(named: "PlusIcon")
        createTabController.initTabBarItem()

        let inboxTabController = RootTabController()
        inboxTabController.title = "Inbox"
        inboxTabController.image = UIImage(named: "BellIcon")
        inboxTabController.initTabBarItem()

        let moreTabController = RootTabController()
        moreTabController.title = "More"
        moreTabController.image = UIImage(named: "ListIcon")
        moreTabController.initTabBarItem()

        viewControllers = [
            homeTabController, searchTabController, createTabController, inboxTabController,
            moreTabController,
        ]
    }
}

class RootTabController: UIViewController {
    var image: UIImage?

    func initTabBarItem() {
        tabBarItem = UITabBarItem(title: title, image: image, selectedImage: image)

        tabBarItem.setTitleTextAttributes(
            [.font: UIFont(name: "Inter-Regular", size: 13)!],
            for: .normal
        )
    }

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
