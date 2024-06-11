import OSLog
import Security
import UIKit

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier!, category: "Session")

struct Session {
    let token: String
    let spaceId: String

    private init(token: String, spaceId: String) {
        self.token = token
        self.spaceId = spaceId
    }

    static func get() -> Session? {
        guard let spaceId = UserDefaults.standard.string(forKey: "spaceId"), let token = getToken()
        else {
            logger.info("Couldn't find session")
            return nil
        }

        logger.info("Found session for space \(spaceId, privacy: .public)")
        return Session(token: token, spaceId: spaceId)
    }

    static func set(token: String, spaceId: String) -> Session {
        logger.info("Saving session for space \(spaceId, privacy: .public)")

        setToken(token)
        UserDefaults.standard.set(spaceId, forKey: "spaceId")

        return Session(token: token, spaceId: spaceId)
    }

    static func delete() {
        logger.info("Deleting session")

        // When the user signs out, we should also unregister their device token. If
        // the user signs in again that should generate a new device token. This way we
        // don't send notifications for the signed out user!
        UIApplication.shared.unregisterForRemoteNotifications()

        deleteToken()
        UserDefaults.standard.removeObject(forKey: "spaceId")
    }

    private static func getToken() -> String? {
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

    private static func setToken(_ token: String) {
        let tokenData = token.data(using: .utf8)!

        // Save the session token to iOS keychain.
        var status = SecItemAdd(
            [
                kSecValueData: tokenData, kSecClass: kSecClassGenericPassword,
                kSecAttrService: "cyberworlds.dev", kSecAttrAccount: "primary",
                kSecAttrSynchronizable: false,
                kSecAttrAccessible: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
                kSecAttrDescription: "Alpine session token",
            ] as CFDictionary,
            nil
        )

        // If we already had a session token then instead update our keychain with the
        // new session token.
        if status == errSecDuplicateItem {
            status = SecItemUpdate(
                [
                    kSecClass: kSecClassGenericPassword, kSecAttrService: "cyberworlds.dev",
                    kSecAttrAccount: "primary", kSecAttrSynchronizable: false,
                ] as CFDictionary,
                [kSecValueData: tokenData] as CFDictionary
            )
        }

        guard status == errSecSuccess else {
            fatalError(
                "Failed to set session secret in keychain: \(SecCopyErrorMessageString(status, nil) ?? "unknown status \(status)" as CFString)"
            )
        }
    }

    private static func deleteToken() {
        let status = SecItemDelete(
            [
                kSecClass: kSecClassGenericPassword, kSecAttrService: "cyberworlds.dev",
                kSecAttrAccount: "primary", kSecAttrSynchronizable: false,
            ] as CFDictionary
        )

        guard status == errSecSuccess else {
            fatalError(
                "Failed to delete session secret in keychain: \(SecCopyErrorMessageString(status, nil) ?? "unknown status \(status)" as CFString)"
            )
        }
    }
}
