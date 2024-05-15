import OSLog
import UIKit

private let logger = Logger(subsystem: Bundle.main.bundleIdentifier!, category: "CALayerMasker")

/// Maintains a mask on a `CALayer` that's a rect in the `CALayer`'s superlayer
/// coordinate space. If the `CALayer`'s frame changes then the mask does as
/// well.
class CALayerMasker: NSObject {
    private let layer: CALayer
    private var maskSuperlayerRect: CGRect
    private var maskLayer: CAShapeLayer

    private var maskRect: CGRect {
        if let superlayer = layer.superlayer {
            superlayer.convert(maskSuperlayerRect, to: layer)
        } else {
            maskSuperlayerRect
        }
    }

    init(layer: CALayer, maskSuperlayerRect: CGRect) {
        self.layer = layer
        self.maskSuperlayerRect = maskSuperlayerRect
        self.maskLayer = CAShapeLayer()

        print("maskSuperlayerRect", maskSuperlayerRect)

        super.init()

        maskLayer.frame = layer.bounds
        maskLayer.path = CGPath(rect: maskRect, transform: nil)

        // NOTE(calebmer): At some point in the future we may need to implement mask
        // merging. Our observer will need to listen for `mask` changes and set a new
        // merged mask if that happens.
        if layer.mask != nil {
            logger.warning("Layer \(layer) already has a mask, merging masks is not supported")
        }
        layer.mask = maskLayer

        layer.addObserver(self, forKeyPath: "bounds", context: nil)
        layer.addObserver(self, forKeyPath: "position", context: nil)
    }

    deinit {
        layer.removeObserver(self, forKeyPath: "bounds")
        layer.removeObserver(self, forKeyPath: "position")
    }

    func updateMaskSuperlayerRect(_ maskSuperlayerRect: CGRect) {
        self.maskSuperlayerRect = maskSuperlayerRect

        maskLayer.path = CGPath(rect: maskRect, transform: nil)
    }

    override func observeValue(
        forKeyPath keyPath: String?,
        of object: Any?,
        change: [NSKeyValueChangeKey: Any]?,
        context: UnsafeMutableRawPointer?
    ) {
        // Whenever the layer `bounds` or `position` changes, its coordinate space also
        // changes so we need to update our mask path.
        maskLayer.path = CGPath(rect: maskRect, transform: nil)
    }
}
