import UIKit

/// Allows setting a delegate on a `UIScrollView` that may co-exist with a
/// delegate set by some other code.
///
/// If, when initialized, a delegate already exists on the `UIScrollView` then
/// we setup a "forwarding" delegate which calls both the delegate you provided
/// and the existing delegate. We also add a [KVO][1] observer so if some other
/// code sets a delegate, we can replace that delegate with a forwarding
/// delegate that calls both the new delegate and our provided delegate.
///
/// Once the forwarder instance deallocates we remove our delegate leaving the
/// other, external, delegate.
///
/// This class must implement all [`UIScrollViewDelegate` methods][2]! There
/// may be a more future-proof approach that uses [`forwardInvocation` like
/// similar code in WebKit][3] but I (@calebmer) couldn't figure out how to
/// make it work.
///
/// [1]: https://nalexn.github.io/kvo-guide-for-key-value-observing/
/// [2]: https://developer.apple.com/documentation/uikit/uiscrollviewdelegate
/// [3]: https://github.com/WebKit/WebKit/blob/fa2c367bb671ef080a5f898e119892dc004addc0/Source/WebKit/UIProcess/ios/WKScrollView.mm#L95-L115
class UIScrollViewDelegateForwarder: NSObject, UIScrollViewDelegate {
    let scrollView: UIScrollView
    weak var ourDelegate: UIScrollViewDelegate?
    weak var otherDelegate: UIScrollViewDelegate?

    init(scrollView: UIScrollView, delegate ourDelegate: UIScrollViewDelegate) {
        self.scrollView = scrollView
        self.ourDelegate = ourDelegate

        super.init()

        if let otherDelegate = scrollView.delegate {
            self.otherDelegate = otherDelegate
            scrollView.delegate = self
        } else {
            scrollView.delegate = ourDelegate
        }

        scrollView.addObserver(self, forKeyPath: "delegate", options: [], context: nil)
    }

    override func observeValue(
        forKeyPath keyPath: String?,
        of object: Any?,
        change: [NSKeyValueChangeKey: Any]?,
        context: UnsafeMutableRawPointer?
    ) {
        if scrollView.delegate === self || scrollView.delegate === ourDelegate {
            // All is well
        } else if let otherDelegate = scrollView.delegate {
            self.otherDelegate = otherDelegate
            scrollView.delegate = self
        } else {
            scrollView.delegate = ourDelegate
        }
    }

    deinit {
        scrollView.removeObserver(self, forKeyPath: "delegate")
        scrollView.delegate = otherDelegate
    }

    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        ourDelegate?.scrollViewDidScroll?(scrollView)
        otherDelegate?.scrollViewDidScroll?(scrollView)
    }

    func scrollViewWillBeginDragging(_ scrollView: UIScrollView) {
        ourDelegate?.scrollViewWillBeginDragging?(scrollView)
        otherDelegate?.scrollViewWillBeginDragging?(scrollView)
    }

    func scrollViewWillEndDragging(
        _ scrollView: UIScrollView,
        withVelocity velocity: CGPoint,
        targetContentOffset: UnsafeMutablePointer<CGPoint>
    ) {
        ourDelegate?.scrollViewWillEndDragging?(
            scrollView,
            withVelocity: velocity,
            targetContentOffset: targetContentOffset
        )
        otherDelegate?.scrollViewWillEndDragging?(
            scrollView,
            withVelocity: velocity,
            targetContentOffset: targetContentOffset
        )
    }

    func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) {
        ourDelegate?.scrollViewDidEndDragging?(scrollView, willDecelerate: decelerate)
        otherDelegate?.scrollViewDidEndDragging?(scrollView, willDecelerate: decelerate)
    }

    func scrollViewShouldScrollToTop(_ scrollView: UIScrollView) -> Bool {
        return (ourDelegate?.scrollViewShouldScrollToTop?(scrollView) ?? true)
            && (otherDelegate?.scrollViewShouldScrollToTop?(scrollView) ?? true)
    }

    func scrollViewDidScrollToTop(_ scrollView: UIScrollView) {
        ourDelegate?.scrollViewDidScrollToTop?(scrollView)
        otherDelegate?.scrollViewDidScrollToTop?(scrollView)
    }

    func scrollViewWillBeginDecelerating(_ scrollView: UIScrollView) {
        ourDelegate?.scrollViewWillBeginDecelerating?(scrollView)
        otherDelegate?.scrollViewWillBeginDecelerating?(scrollView)
    }

    func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) {
        ourDelegate?.scrollViewDidEndDecelerating?(scrollView)
        otherDelegate?.scrollViewDidEndDecelerating?(scrollView)
    }

    func viewForZooming(in scrollView: UIScrollView) -> UIView? {
        return ourDelegate?.viewForZooming?(in: scrollView)
            ?? otherDelegate?.viewForZooming?(in: scrollView)
    }

    func scrollViewWillBeginZooming(_ scrollView: UIScrollView, with view: UIView?) {
        ourDelegate?.scrollViewWillBeginZooming?(scrollView, with: view)
        otherDelegate?.scrollViewWillBeginZooming?(scrollView, with: view)
    }

    func scrollViewDidEndZooming(
        _ scrollView: UIScrollView,
        with view: UIView?,
        atScale scale: CGFloat
    ) {
        ourDelegate?.scrollViewDidEndZooming?(scrollView, with: view, atScale: scale)
        otherDelegate?.scrollViewDidEndZooming?(scrollView, with: view, atScale: scale)
    }

    func scrollViewDidZoom(_ scrollView: UIScrollView) {
        ourDelegate?.scrollViewDidZoom?(scrollView)
        otherDelegate?.scrollViewDidZoom?(scrollView)
    }

    func scrollViewDidEndScrollingAnimation(_ scrollView: UIScrollView) {
        ourDelegate?.scrollViewDidEndScrollingAnimation?(scrollView)
        otherDelegate?.scrollViewDidEndScrollingAnimation?(scrollView)
    }

    func scrollViewDidChangeAdjustedContentInset(_ scrollView: UIScrollView) {
        ourDelegate?.scrollViewDidChangeAdjustedContentInset?(scrollView)
        otherDelegate?.scrollViewDidChangeAdjustedContentInset?(scrollView)
    }
}
