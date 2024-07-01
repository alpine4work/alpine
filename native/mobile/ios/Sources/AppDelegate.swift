import OSLog
import UIKit

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier!, category: "AppDelegate")

@objc class AppNotificationRequest: NSObject {
    let identifier: String
    let spaceId: String
    let entryPath: String

    init(identifier: String, spaceId: String, entryPath: String) {
        self.identifier = identifier
        self.spaceId = spaceId
        self.entryPath = entryPath
    }

    override func isEqual(_ object: Any?) -> Bool {
        guard let object = object as? AppNotificationRequest else { return super.isEqual(object) }
        return object.identifier == self.identifier && object.spaceId == self.spaceId
            && object.entryPath == self.entryPath
    }
}

@UIApplicationMain
class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    public static var shared: AppDelegate { UIApplication.shared.delegate as! AppDelegate }

    static private let spacePathRegex = try! Regex<(Substring, Substring)>(
        "^/s/([a-zA-Z0-9]+)(?:/|$)"
    )

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

    /// The current notification request. Will be observed by our application code
    /// and used to immediately take the user to a notification which they tapped.
    @objc private(set) dynamic var notificationRequest: AppNotificationRequest?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        let notificationCenter = UNUserNotificationCenter.current()
        notificationCenter.delegate = self

        logger.info("Finished launching application")

        // In development mode, don't let the screen sleep. This makes developing
        // easier since the developer doesn't have to keep tapping their screen to wake
        // it up.
        #if DEVELOPMENT_RUN_ENVIRONMENT
            application.isIdleTimerDisabled = true
        #endif

        return true
    }

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

    func updateNotificationRequestFromSceneConnectionOptions(
        _ connectionOptions: UIScene.ConnectionOptions
    ) {
        if let response = connectionOptions.notificationResponse {
            didReceiveNotificationResponse(response)
        }
    }

    func userNotificationCenter(
        _ notificationCenter: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async { didReceiveNotificationResponse(response) }

    private func didReceiveNotificationResponse(_ response: UNNotificationResponse) {
        guard response.actionIdentifier == UNNotificationDefaultActionIdentifier else { return }

        let entryPath = response.notification.request.content.userInfo["entry"]
        guard let entryPath = entryPath as? String else {
            logger.warning("Received notification without an entry property")
            return
        }

        let spacePathMatch = (try! AppDelegate.spacePathRegex.firstMatch(in: entryPath))!

        let newNotificationRequest = AppNotificationRequest(
            identifier: response.notification.request.identifier,
            spaceId: String(spacePathMatch.1),
            entryPath: entryPath
        )
        if newNotificationRequest != notificationRequest {
            logger.info("Received notification: \(entryPath, privacy: .public)")
            notificationRequest = newNotificationRequest
        }
    }
}
