import OSLog
import Security
import UIKit
import WebKit

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier!, category: "SceneDelegate")

protocol SceneDelegateRootController: UIViewController {
    var webNavigationController: WebNavigationController { get }

    func setWindowSafeAreaInsets(_ windowSafeAreaInsets: UIEdgeInsets)
    func sceneDelegateWillRemove(_ sceneDelegate: SceneDelegate)
}

class SceneDelegate: NSObject, UIWindowSceneDelegate {
    private struct State {
        let window: UIWindow
        var rootViewController: SceneDelegateRootController
    }

    private var state: State?
    private var notificationRequestObservation: NSKeyValueObservation?

    private var nextTransitionStateId = 1
    private var transitionStateById = [Int: TransitionState]()

    private struct TransitionState {
        let timer: Timer
        let observation: NSKeyValueObservation
    }

    deinit {
        notificationRequestObservation?.invalidate()
        notificationRequestObservation = nil

        for transitionState in transitionStateById.values {
            transitionState.timer.invalidate()
            transitionState.observation.invalidate()
        }
    }

    func scene(
        _ scene: UIScene,
        willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        assert(self.state == nil)

        AppDelegate.shared.updateNotificationRequestFromSceneConnectionOptions(connectionOptions)

        guard let windowScene = (scene as? UIWindowScene) else { return }

        let rootViewController: SceneDelegateRootController
        if let session = Session.get() {
            if let notificationRequest = AppDelegate.shared.notificationRequest {
                // If the user opened a notification in a different space, then update the
                // session to the new space...
                let session =
                    if notificationRequest.spaceId != session.spaceId {
                        Session.set(token: session.token, spaceId: notificationRequest.spaceId)
                    } else { session }

                rootViewController = RootTabBarController(
                    scene: scene,
                    session: session,
                    signOut: { [weak self, weak scene] in
                        guard let scene = scene else { return }
                        self?.signOut(scene)
                    },
                    switchSpace: { [weak self, weak scene] (spaceId, session) in
                        guard let scene = scene else { return }
                        self?.switchSpace(scene, spaceId: spaceId, session: session)
                    },
                    initialTab: .inbox,
                    initialPath: notificationRequest.entryPath
                )
            } else {
                rootViewController = RootTabBarController(
                    scene: scene,
                    session: session,
                    signOut: { [weak self, weak scene] in
                        guard let scene = scene else { return }
                        self?.signOut(scene)
                    },
                    switchSpace: { [weak self, weak scene] (spaceId, session) in
                        guard let scene = scene else { return }
                        self?.switchSpace(scene, spaceId: spaceId, session: session)
                    }
                )
            }
        } else {
            rootViewController = RootAnonymousController(
                scene: scene,
                signIn: { [weak self, weak scene] (token, spaceId) in
                    guard let scene = scene else { return }
                    self?.signIn(scene, token: token, spaceId: spaceId)
                }
            )
        }

        logger.info(
            "Setting root view controller: \(type(of: rootViewController).description(), privacy: .public)"
        )

        let window = UIWindow(frame: windowScene.coordinateSpace.bounds)
        window.windowScene = windowScene
        window.rootViewController = rootViewController
        window.makeKeyAndVisible()

        rootViewController.setWindowSafeAreaInsets(window.safeAreaInsets)

        state = State(window: window, rootViewController: rootViewController)

        notificationRequestObservation = AppDelegate.shared.observe(
            \.notificationRequest,
            options: []
        ) { [weak self] (_, _) in
            guard let this = self else { return }

            guard let notificationRequest = AppDelegate.shared.notificationRequest else { return }

            guard let rootTabBarController = this.state?.rootViewController as? RootTabBarController
            else { return }

            // If the user opened a notification in a different space, then update the
            // session to the new space...
            let session =
                if notificationRequest.spaceId != rootTabBarController.spaceId {
                    Session.set(
                        token: rootTabBarController.session.token,
                        spaceId: notificationRequest.spaceId
                    )
                } else { rootTabBarController.session }

            this.setRootViewController(
                RootTabBarController(
                    scene: scene,
                    session: session,
                    signOut: { [weak self, weak scene] in
                        guard let scene = scene else { return }
                        self?.signOut(scene)
                    },
                    switchSpace: { [weak self, weak scene] (spaceId, session) in
                        guard let scene = scene else { return }
                        self?.switchSpace(scene, spaceId: spaceId, session: session)
                    },
                    initialTab: .inbox,
                    initialPath: notificationRequest.entryPath
                ),
                animated: false
            )
        }
    }

    func sceneDidDisconnect(_ scene: UIScene) {
        assert(self.state != nil)
        self.state = nil
    }

    var isFirst = true

    func windowScene(
        _ windowScene: UIWindowScene,
        didUpdate previousCoordinateSpace: UICoordinateSpace,
        interfaceOrientation previousInterfaceOrientation: UIInterfaceOrientation,
        traitCollection previousTraitCollection: UITraitCollection
    ) {
        guard let state = state else { return }

        state.rootViewController.setWindowSafeAreaInsets(state.window.safeAreaInsets)
    }

    private func signIn(_ scene: UIScene, token: String, spaceId: String) {
        // Save session to keychain and `SpaceId` to user defaults. On next launch of
        // the app the user will still be signed in and will return to the last space
        // they were in.
        let session = Session.set(token: token, spaceId: spaceId)

        let newRootViewController = RootTabBarController(
            scene: scene,
            session: session,
            signOut: { [weak self, weak scene] in
                guard let scene = scene else { return }
                self?.signOut(scene)
            },
            switchSpace: { [weak self, weak scene] (spaceId, session) in
                guard let scene = scene else { return }
                self?.switchSpace(scene, spaceId: spaceId, session: session)
            }
        )

        setRootViewController(newRootViewController, animated: true)
    }

    private func signOut(_ scene: UIScene) {
        Session.delete()

        let newRootViewController = RootAnonymousController(
            scene: scene,
            signIn: { [weak self, weak scene] (token, spaceId) in
                guard let scene = scene else { return }
                self?.signIn(scene, token: token, spaceId: spaceId)
            }
        )

        setRootViewController(newRootViewController, animated: true)
    }

    private func switchSpace(_ scene: UIScene, spaceId: String, session: Session) {
        let session = Session.set(token: session.token, spaceId: spaceId)

        let newRootViewController = RootTabBarController(
            scene: scene,
            session: session,
            signOut: { [weak self, weak scene] in
                guard let scene = scene else { return }
                self?.signOut(scene)
            },
            switchSpace: { [weak self, weak scene] (spaceId, session) in
                guard let scene = scene else { return }
                self?.switchSpace(scene, spaceId: spaceId, session: session)
            }
        )

        setRootViewController(newRootViewController, animated: true)
    }

    private func setRootViewController(
        _ newRootViewController: SceneDelegateRootController,
        animated: Bool
    ) {
        guard let window = self.state?.window else { return }

        newRootViewController.setWindowSafeAreaInsets(window.safeAreaInsets)

        let oldRootViewController = self.state!.rootViewController

        // Notify our root view controller that `SceneDelegate` is about to remove it.
        // If this is called after our web process has terminated, we shouldn't reload!
        oldRootViewController.sceneDelegateWillRemove(self)

        let action = { [weak self] in
            guard let this = self, this.state?.window == window else { return }

            if !animated {
                this.state!.rootViewController = newRootViewController
                window.rootViewController = newRootViewController
            } else {
                UIView.transition(
                    with: window,
                    duration: 0.35,
                    options: [.transitionFlipFromLeft],
                    animations: {
                        logger.info(
                            "Setting root view controller: \(type(of: newRootViewController).description(), privacy: .public)"
                        )

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
        }

        if !newRootViewController.webNavigationController.isLoading {
            action()
        }
        // Race to see whether `extraLongDelayScreenTransitionLoadingIndicatorLimitSeconds`
        // completes first or `isLoading` is set to false first.
        else {
            let transitionStateId = nextTransitionStateId
            nextTransitionStateId += 1

            let timer = Timer.scheduledTimer(
                // Use our "extra long" delay since when the view controller is switching
                // either:
                //
                // 1. There's an inline loading indicator (sign in/out and switching spaces
                //    have inline loading indicators).
                // 2. The user is opening the app from a push notification or deep link so
                //    they're expecting app startup. We want to show the old snapshot during
                //    this time.
                withTimeInterval: extraLongDelayScreenTransitionLoadingIndicatorLimitSeconds,
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
}
