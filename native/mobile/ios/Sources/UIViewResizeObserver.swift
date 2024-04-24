import UIKit

class UIViewResizeObserver: NSObject {
    let view: UIView
    let action: () -> Void

    init(view: UIView, action: @escaping () -> Void) {
        self.view = view
        self.action = action

        super.init()

        view.layer.addObserver(self, forKeyPath: "bounds", options: [.new, .old], context: nil)
    }

    deinit { view.layer.removeObserver(self, forKeyPath: "bounds", context: nil) }

    override func observeValue(
        forKeyPath keyPath: String?,
        of object: Any?,
        change: [NSKeyValueChangeKey: Any]?,
        context: UnsafeMutableRawPointer?
    ) {
        let oldBounds = change![.oldKey] as! CGRect
        let newBounds = change![.newKey] as! CGRect

        if oldBounds.height != newBounds.height || oldBounds.width != newBounds.width { action() }
    }
}
