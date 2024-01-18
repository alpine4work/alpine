import UIKit
import WebKit

class RootAnonymousController: WebNavigationController {
    override func getInitialPath() -> String { return "/sign-in" }
}
