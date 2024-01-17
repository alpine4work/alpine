import UIKit
import WebKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    private struct State {
        let window: UIWindow
        let rootAnonymousController: RootAnonymousController
    }

    private var state: State?

    func scene(
        _ scene: UIScene,
        willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        assert(self.state == nil)

        guard let windowScene = (scene as? UIWindowScene) else { return }

        // NOCOMMIT: Logged in experience
        // RootTabBarController()
        let rootAnonymousController = RootAnonymousController()

        let window = UIWindow(frame: windowScene.coordinateSpace.bounds)
        window.windowScene = windowScene
        window.rootViewController = rootAnonymousController
        window.makeKeyAndVisible()

        rootAnonymousController.setWindowSafeAreaInsets(window.safeAreaInsets)

        self.state = State(window: window, rootAnonymousController: rootAnonymousController)
    }

    func sceneDidDisconnect(_ scene: UIScene) {
        assert(self.state != nil)
        self.state = nil
    }

    func windowScene(
        _ windowScene: UIWindowScene,
        didUpdate previousCoordinateSpace: UICoordinateSpace,
        interfaceOrientation previousInterfaceOrientation: UIInterfaceOrientation,
        traitCollection previousTraitCollection: UITraitCollection
    ) {
        guard let state = state else { return }

        state.rootAnonymousController.setWindowSafeAreaInsets(state.window.safeAreaInsets)
    }
}
