import UIKit

@UIApplicationMain class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        let x = MainViewController()

        print("Hello, world!")

        return true
    }
}
