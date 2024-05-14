import Security
import UIKit
import WebKit

protocol SceneDelegateRootController: UIViewController {
    func setWindowSafeAreaInsets(_ windowSafeAreaInsets: UIEdgeInsets)
}

class SceneDelegate: NSObject, UIWindowSceneDelegate {
    private struct State {
        let window: UIWindow
        let rootController: SceneDelegateRootController
    }

    private var state: State?

    func sceneDidBecomeActive(_ scene: UIScene) {
        // In development mode, don't let the screen sleep. This makes developing
        // easier since the developer doesn't have to keep tapping their screen to wake
        // it up.
        #if DEVELOPMENT_RUN_ENVIRONMENT
            UIApplication.shared.isIdleTimerDisabled = true
        #endif
    }

    func scene(
        _ scene: UIScene,
        willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        assert(self.state == nil)

        guard let windowScene = (scene as? UIWindowScene) else { return }

        let rootController: SceneDelegateRootController
        if let spaceId = UserDefaults.standard.string(forKey: "spaceId"),
            let session = getSessionToken()
        {
            rootController = RootTabBarController(spaceId: spaceId, session: session)
        } else {
            rootController = RootAnonymousController()
        }

        let window = UIWindow(frame: windowScene.coordinateSpace.bounds)
        window.windowScene = windowScene
        window.rootViewController = rootController
        window.makeKeyAndVisible()

        rootController.setWindowSafeAreaInsets(window.safeAreaInsets)

        self.state = State(window: window, rootController: rootController)
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

        state.rootController.setWindowSafeAreaInsets(state.window.safeAreaInsets)
    }

    private func getSessionToken() -> String? {
        var result: AnyObject?
        let status = SecItemCopyMatching(
            [
                kSecClass: kSecClassGenericPassword, kSecAttrService: "cyberworlds.dev",
                kSecAttrAccount: "primary", kSecAttrSynchronizable: false, kSecReturnData: true,
            ] as CFDictionary,
            &result
        )

        if status == errSecItemNotFound { return nil }

        guard status == errSecSuccess else {
            fatalError(
                "Failed to get session secret from keychain: \(SecCopyErrorMessageString(status, nil) ?? "unknown status \(status)" as CFString)"
            )
        }

        return String(data: result as! Data, encoding: .utf8)!
    }
}
