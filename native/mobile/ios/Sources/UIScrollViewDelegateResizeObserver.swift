import UIKit

/// We've observed that `UIScrollViewDelegate.scrollViewDidScroll(_:)` is not
/// called after the `UIScrollView` has resized. This is not documented
/// anywhere. So watch when `bounds` changes and call
/// `UIScrollViewDelegate.scrollViewDidScroll(_:)` whenever the width or height
/// changes even if the content offset didn't change. The delegate's
/// `UIScrollViewDelegate.scrollViewDidScroll(_:)` implementation must be
/// idempotent since there may not have actually been a scroll when it's
/// called.
///
/// We ask you to manually providing the `delegate` object you want to call
/// instead of calling `scrollView.delegate` since `scrollView.delegate` may
/// have been set by WebKit. (Or `UIScrollViewDelegateForwarder`.)
class UIScrollViewDelegateResizeObserver: NSObject {
    let scrollView: UIScrollView
    let delegate: UIScrollViewDelegate

    init(scrollView: UIScrollView, delegate: UIScrollViewDelegate) {
        self.scrollView = scrollView
        self.delegate = delegate

        super.init()

        scrollView.layer.addObserver(
            self,
            forKeyPath: "bounds",
            options: [.new, .old],
            context: nil
        )
    }

    deinit { scrollView.layer.removeObserver(self, forKeyPath: "bounds", context: nil) }

    override func observeValue(
        forKeyPath keyPath: String?,
        of object: Any?,
        change: [NSKeyValueChangeKey: Any]?,
        context: UnsafeMutableRawPointer?
    ) {
        let oldBounds = change![.oldKey] as! CGRect
        let newBounds = change![.newKey] as! CGRect

        if oldBounds.height != newBounds.height || oldBounds.width != newBounds.width {
            delegate.scrollViewDidScroll?(scrollView)
        }
    }
}
