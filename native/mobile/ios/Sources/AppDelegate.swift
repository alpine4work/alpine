import OSLog
import UIKit

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier!, category: "AppDelegate")

@UIApplicationMain class AppDelegate: NSObject, UIApplicationDelegate {
    public static var shared: AppDelegate { UIApplication.shared.delegate as! AppDelegate }

    var hasRegisterForRemoteNotificationsFailed = false
    private var remoteNotificationDeviceTokens = [Data]()

    /// The number of times a device token for remote notifications has been
    /// registered with our `AppDelegate`. To retrieve these device tokens call
    /// `takeRemoteNotificationDeviceTokens()`. You may only retrieve each
    /// device token once.
    ///
    /// You may observe this variable to be notified when there are new device
    /// tokens for you to retrieve.
    @objc private(set) dynamic var remoteNotificationDeviceTokenCount = 0

    func application(
        _ application: UIApplication,
        configurationForConnecting connectingSceneSession: UISceneSession,
        options: UIScene.ConnectionOptions
    ) -> UISceneConfiguration {
        return UISceneConfiguration(
            name: "Main Configuration",
            sessionRole: connectingSceneSession.role
        )
    }

    func registerForRemoteNotificationsAndRequestAuthorization() {
        // Only register for notifications if we have a provisioning profile. Which
        // will include the `aps-environment` entitlement that lets us send push
        // notifications.
        #if PROVISIONING_PROFILE
            Task { await actuallyRegisterForRemoteNotificationsAndRequestAuthorization() }
        #endif
    }

    private func actuallyRegisterForRemoteNotificationsAndRequestAuthorization() async {
        let notificationCenter = UNUserNotificationCenter.current()
        let settings = await notificationCenter.notificationSettings()

        if settings.authorizationStatus != .authorized {
            do {
                let granted = try await notificationCenter.requestAuthorization(options: [
                    .badge, .sound, .alert,
                ])

                if !granted {
                    logger.info("User denied authorization request to send push notifications")
                    return
                }
            } catch {
                logger.error(
                    "Failed to request authorization for push notifications: \(error.localizedDescription, privacy: .public)"
                )
            }
        }

        logger.info("Registering for push notifications")
        UIApplication.shared.registerForRemoteNotifications()
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        logger.info("Successfully registered for push notifications")

        remoteNotificationDeviceTokens.append(deviceToken)
        remoteNotificationDeviceTokenCount += 1
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        logger.error(
            "Failed to register for push notifications: \(error.localizedDescription, privacy: .public)"
        )

        // When this is true, we call
        // `UIApplication.shared.registerForRemoteNotifications()` again in
        // `WebNavigationController.swift` after the user presses "Retry" from an
        // offline error message.
        //
        // This works when registering for notifications failed because we aren't
        // connected to the internet.
        hasRegisterForRemoteNotificationsFailed = true
    }

    func takeRemoteNotificationDeviceTokens() -> [Data] {
        let deviceTokens = remoteNotificationDeviceTokens
        remoteNotificationDeviceTokens = []
        return deviceTokens
    }
}
