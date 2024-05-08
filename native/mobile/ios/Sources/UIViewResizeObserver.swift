import UIKit

class UIViewResizeObserver: NSObject {
    let view: UIView
    let action: () -> Void

    var lastWidth: Double
    var lastHeight: Double
    var ignoreFirstUpdate: Bool

    init(view: UIView, action: @escaping () -> Void) {
        self.view = view
        self.action = action

        self.lastWidth = view.layer.bounds.width
        self.lastHeight = view.layer.bounds.height

        // Ignore the first `observeValue()` update if we're resizing from a zero size
        // to the view's proper size.
        self.ignoreFirstUpdate = view.layer.bounds.width == 0 && view.layer.bounds.height == 0

        super.init()

        view.layer.addObserver(self, forKeyPath: "bounds", options: [], context: nil)
    }

    deinit { view.layer.removeObserver(self, forKeyPath: "bounds", context: nil) }

    override func observeValue(
        forKeyPath keyPath: String?,
        of object: Any?,
        change: [NSKeyValueChangeKey: Any]?,
        context: UnsafeMutableRawPointer?
    ) {
        let nextWidth = view.layer.bounds.width
        let nextHeight = view.layer.bounds.height

        if lastHeight != nextHeight || lastWidth != nextWidth {
            if ignoreFirstUpdate {
                ignoreFirstUpdate = false
            } else {
                lastHeight = nextHeight
                lastWidth = nextWidth
                action()
            }
        }
    }
}
