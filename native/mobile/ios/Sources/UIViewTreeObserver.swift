import UIKit

protocol UIViewTreeObserverDelegate: AnyObject {
    func viewTreeObserver(_ viewTreeObserver: UIViewTreeObserver, didAdd view: UIView)
    func viewTreeObserver(_ viewTreeObserver: UIViewTreeObserver, didRemove view: UIView)
}

/// Observes the `UIView` hierarchy of the root view provided on
/// initialization. When views are added or removed we report to our delegate.
/// Useful when using `WKWebView` or some other UIKit library you don't
/// control and you need to make some modifications to the views it creates.
///
/// The way it works is by observing `CALayer`'s `sublayers` property. Since
/// `UIView`'s `subviews` property is not observable using [KVO][1]. We depend
/// on `CALayer`'s `delegate` property being the corresponding `UIView` which
/// created it. If the `CALayer` tree and `UIView` tree don't match up you may
/// get undefined behavior.
///
/// [1]: https://nalexn.github.io/kvo-guide-for-key-value-observing/
class UIViewTreeObserver: NSObject {
    weak var delegate: UIViewTreeObserverDelegate?

    private var layers = [CALayer: [CALayer]]()

    // Initialize with `delegate` so it sees views added by the initial
    // `addObservers()` call.
    init(delegate: UIViewTreeObserverDelegate, rootView: UIView) {
        self.delegate = delegate
        super.init()
        addObservers(rootView.layer)
    }

    deinit { for layer in layers.keys { layer.removeObserver(self, forKeyPath: "sublayers") } }

    private func addObservers(_ layer: CALayer) {
        let sublayers = layer.sublayers ?? []

        layer.addObserver(self, forKeyPath: "sublayers", options: .init(), context: nil)
        layers[layer] = sublayers

        // Report when a new view is added to the tree:
        if let view = layer.delegate as? UIView { delegate?.viewTreeObserver(self, didAdd: view) }

        for sublayer in sublayers { addObservers(sublayer) }
    }

    private func removeObservers(_ layer: CALayer) {
        let sublayers = layers[layer]
        guard let sublayers = sublayers else { return }

        layers.removeValue(forKey: layer)
        layer.removeObserver(self, forKeyPath: "sublayers")

        // Report when a view is removed from the tree:
        for sublayer in sublayers { removeObservers(sublayer) }

        if let view = layer.delegate as? UIView {
            delegate?.viewTreeObserver(self, didRemove: view)
        }
    }

    override func observeValue(
        forKeyPath keyPath: String?,
        of object: Any?,
        change: [NSKeyValueChangeKey: Any]?,
        context: UnsafeMutableRawPointer?
    ) {
        if keyPath != "sublayers" { return }

        let layer = object as! CALayer
        let newSublayers = layer.sublayers ?? []
        let oldSublayersArray = layers[layer]!
        var oldSublayers = Set(oldSublayersArray)

        layers[layer] = newSublayers

        for newSublayer in newSublayers {
            if oldSublayers.contains(newSublayer) {
                oldSublayers.remove(newSublayer)
                continue
            }

            addObservers(newSublayer)
        }

        for oldSublayer in oldSublayers { removeObservers(oldSublayer) }
    }
}
