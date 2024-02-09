import UIKit

/// Implementation of `requestAnimationFrame()` for iOS using `CADisplayLink`.
/// When you call the `request()` function the block you provide should be
/// called before the next screen paint.
func requestAnimationFrame(_ action: @escaping () -> Void) {
    animationFrameRequester.request(action)
}

private let animationFrameRequester = AnimationFrameRequester()

private class AnimationFrameRequester {
    private var displayLink: CADisplayLink!
    private var actions = [() -> Void]()

    init() {
        displayLink = CADisplayLink(target: self, selector: #selector(step))
        displayLink.isPaused = true

        displayLink.add(to: .current, forMode: .common)
    }

    deinit { displayLink.remove(from: .current, forMode: .common) }

    @objc private func step(displayLink: CADisplayLink) {
        let currentActions = actions
        actions = []
        displayLink.isPaused = true

        for action in currentActions { action() }
    }

    func request(_ action: @escaping () -> Void) {
        actions.append(action)
        if displayLink.isPaused { displayLink.isPaused = false }
    }
}
