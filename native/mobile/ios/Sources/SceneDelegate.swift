import OSLog
import Security
import UIKit
import WebKit

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier!, category: "SceneDelegate")

protocol SceneDelegateRootController: UIViewController {
    func setWindowSafeAreaInsets(_ windowSafeAreaInsets: UIEdgeInsets)
}

class SceneDelegate: NSObject, UIWindowSceneDelegate {
    private struct State {
        let window: UIWindow
        var rootViewController: SceneDelegateRootController
    }

    private var state: State?

    private var nextTransitionStateId = 1
    private var transitionStateById = [Int: TransitionState]()

    private struct TransitionState {
        let timer: Timer
        let observation: NSKeyValueObservation
    }

    deinit {
        for transitionState in transitionStateById.values {
            transitionState.timer.invalidate()
            transitionState.observation.invalidate()
        }
    }

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

        let rootViewController: SceneDelegateRootController
        if let session = Session.get() {
            rootViewController = RootTabBarController(
                session: session,
                signOut: { [weak self] in self?.signOut() }
            )
        } else {
            rootViewController = RootAnonymousController(signIn: { [weak self] (token, spaceId) in
                self?.signIn(token: token, spaceId: spaceId)
            })
        }

        let window = UIWindow(frame: windowScene.coordinateSpace.bounds)
        window.windowScene = windowScene
        window.rootViewController = rootViewController
        window.makeKeyAndVisible()

        rootViewController.setWindowSafeAreaInsets(window.safeAreaInsets)

        self.state = State(window: window, rootViewController: rootViewController)
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

        state.rootViewController.setWindowSafeAreaInsets(state.window.safeAreaInsets)
    }

    private func signIn(token: String, spaceId: String) {
        // Save session to keychain and `SpaceId` to user defaults. On next launch of
        // the app the user will still be signed in and will return to the last space
        // they were in.
        let session = Session.set(token: token, spaceId: spaceId)

        guard let window = self.state?.window else { return }

        let oldRootViewController = self.state!.rootViewController

        let newRootViewController = RootTabBarController(
            session: session,
            signOut: { [weak self] in self?.signOut() }
        )
        newRootViewController.setWindowSafeAreaInsets(window.safeAreaInsets)

        let action = { [weak self] in
            guard let this = self, this.state?.window == window else { return }

            UIView.transition(
                with: window,
                duration: 0.35,
                options: [.transitionFlipFromLeft],
                animations: {
                    this.state!.rootViewController = newRootViewController
                    window.rootViewController = newRootViewController
                },
                completion: { (_) in
                    let oldRootViewControllerRetainCount =
                        CFGetRetainCount(oldRootViewController) - 2
                    if oldRootViewControllerRetainCount > 0 {
                        logger.warning(
                            "Old root view controller had \(oldRootViewControllerRetainCount, privacy: .public) more references than expected, there may be a memory cycle preventing deinitialization!"
                        )
                    }
                }
            )
        }

        if !newRootViewController.webNavigationController.isLoading {
            action()
        }
        // Race to see whether `delayScreenTransitionLoadingIndicatorLimitSeconds`
        // completes first or `isLoading` is set to false first.
        else {
            let transitionStateId = nextTransitionStateId
            nextTransitionStateId += 1

            let timer = Timer.scheduledTimer(
                withTimeInterval: delayScreenTransitionLoadingIndicatorLimitSeconds,
                repeats: false
            ) { [weak self] _ in
                guard let this = self else { return }

                this.transitionStateById[transitionStateId]?.timer.invalidate()
                this.transitionStateById[transitionStateId]?.observation.invalidate()
                this.transitionStateById.removeValue(forKey: transitionStateId)

                action()
            }

            // Add some tolerance to reduce timer energy impact.
            timer.tolerance = 0.1

            let observation = newRootViewController.webNavigationController.observe(
                \.isLoading,
                options: []
            ) { [weak self] _, _ in
                guard let this = self else { return }

                // Make sure we've actually stopped loading...
                guard !newRootViewController.webNavigationController.isLoading else { return }

                this.transitionStateById[transitionStateId]?.timer.invalidate()
                this.transitionStateById[transitionStateId]?.observation.invalidate()
                this.transitionStateById.removeValue(forKey: transitionStateId)

                action()
            }

            transitionStateById[transitionStateId] = TransitionState(
                timer: timer,
                observation: observation
            )
        }

    }

    private func signOut() {
        Session.delete()

        guard let window = self.state?.window else { return }

        let oldRootViewController = self.state!.rootViewController

        let newRootViewController = RootAnonymousController(signIn: {
            [weak self] (token, spaceId) in self?.signIn(token: token, spaceId: spaceId)
        })
        newRootViewController.setWindowSafeAreaInsets(window.safeAreaInsets)

        let action = { [weak self] in
            guard let this = self, this.state?.window == window else { return }

            UIView.transition(
                with: window,
                duration: 0.35,
                options: [.transitionFlipFromLeft],
                animations: {
                    this.state!.rootViewController = newRootViewController
                    window.rootViewController = newRootViewController
                },
                completion: { (_) in
                    let oldRootViewControllerRetainCount =
                        CFGetRetainCount(oldRootViewController) - 2
                    if oldRootViewControllerRetainCount > 0 {
                        logger.warning(
                            "Old root view controller had \(oldRootViewControllerRetainCount, privacy: .public) more references than expected, there may be a memory cycle preventing deinitialization!"
                        )
                    }
                }
            )
        }

        if !newRootViewController.isLoading {
            action()
        }
        // Race to see whether `delayScreenTransitionLoadingIndicatorLimitSeconds`
        // completes first or `isLoading` is set to false first.
        else {
            let transitionStateId = nextTransitionStateId
            nextTransitionStateId += 1

            let timer = Timer.scheduledTimer(
                withTimeInterval: delayScreenTransitionLoadingIndicatorLimitSeconds,
                repeats: false
            ) { [weak self] _ in
                guard let this = self else { return }

                this.transitionStateById[transitionStateId]?.timer.invalidate()
                this.transitionStateById[transitionStateId]?.observation.invalidate()
                this.transitionStateById.removeValue(forKey: transitionStateId)

                action()
            }

            // Add some tolerance to reduce timer energy impact.
            timer.tolerance = 0.1

            let observation = newRootViewController.observe(\.isLoading, options: []) {
                [weak self] _, _ in
                guard let this = self else { return }

                // Make sure we've actually stopped loading...
                guard !newRootViewController.isLoading else { return }

                this.transitionStateById[transitionStateId]?.timer.invalidate()
                this.transitionStateById[transitionStateId]?.observation.invalidate()
                this.transitionStateById.removeValue(forKey: transitionStateId)

                action()
            }

            transitionStateById[transitionStateId] = TransitionState(
                timer: timer,
                observation: observation
            )
        }
    }
}
