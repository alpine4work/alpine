import UIKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(
        _ scene: UIScene,
        willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        guard let windowScene = (scene as? UIWindowScene) else { return }

        let tabBarController = RootTabBarController()

        let window = UIWindow(frame: windowScene.coordinateSpace.bounds)
        self.window = window
        window.windowScene = windowScene
        window.rootViewController = tabBarController
        window.makeKeyAndVisible()
    }
}
