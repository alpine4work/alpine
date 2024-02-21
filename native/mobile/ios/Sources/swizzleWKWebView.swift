import Foundation
import WebKit

private var customInputAccessoryViewAssociatedObjectKey: UInt8 = 0

/// Swizzle `WKWebView` to modify WebKit functionality. Swizzling changes the
/// class of the provided object with a custom class we've built that
/// reimplements some instance methods.
///
/// Swizzling may cause problems in app review! Be ready to remove any
/// swizzling related functionality. We believe it's ok since all of WebKit is
/// public. So we're not acutally relying on internal APIs. WebKit is open
/// source after all.
///
/// A helpful resource for understanding WebKit internals is the
/// [BrowserEngineKit][1] documentation. (This [text interaction article][2] is
/// useful if you care about...text interaction.) BrowserEngineKit is the
/// framework Apple provides to comply with the EU mandate that alternative
/// browser engines should be supported on iOS.
///
/// [1]: https://developer.apple.com/documentation/browserenginekit
/// [2]: https://developer.apple.com/documentation/browserenginekit/integrating-custom-browser-text-views-with-uikit
func swizzleWKWebView(_ webView: WKWebView, customInputAccessoryView: UIView? = nil) {
    var targetView: UIView?

    for view in webView.scrollView.subviews {
        if type(of: view).description() == "WKContentView" { targetView = view }
    }

    guard let targetView = targetView else { return }
    let targetViewClass = type(of: targetView)

    let newClassName = "WKContentView_Custom"

    let newClass: AnyClass
    if let existingClass = NSClassFromString(newClassName) {
        newClass = existingClass
    } else {
        newClass = objc_allocateClassPair(targetViewClass, newClassName.cString(using: .ascii)!, 0)!

        addOverridingMethod(
            baseClass: targetViewClass,
            stubClass: WKContentView_Custom.self,
            selector: #selector(getter: WKContentView_Custom.inputAccessoryView),
            newClass: newClass
        )

        if let customInputAccessoryView = customInputAccessoryView {
            objc_setAssociatedObject(
                targetView,
                // The `&` is important. We want a unique pointer. We don't care about the
                // variable's value.
                &customInputAccessoryViewAssociatedObjectKey,
                customInputAccessoryView,
                objc_AssociationPolicy.OBJC_ASSOCIATION_RETAIN_NONATOMIC
            )
        }

        addOverridingMethod(
            baseClass: targetViewClass,
            stubClass: WKContentView_Custom.self,
            selector: #selector(WKContentView_Custom.canPerformActionForWebView),
            newClass: newClass
        )

        objc_registerClassPair(newClass)
    }

    object_setClass(targetView, newClass)
}

private func addOverridingMethod(
    baseClass: AnyClass,
    stubClass: AnyClass,
    selector: Selector,
    newClass: AnyClass
) {
    let baseMethod = class_getInstanceMethod(baseClass, selector)
    guard let baseMethod = baseMethod else {
        fatalError("Selector `\(selector)` doesn't exist in base class")
    }

    let stubMethod = class_getInstanceMethod(stubClass, selector)
    guard let stubMethod = stubMethod else {
        fatalError("Selector `\(selector)` doesn't exist in stub class")
    }

    let baseMethodTypeEncoding = method_getTypeEncoding(baseMethod)!
    let stubMethodTypeEncoding = method_getTypeEncoding(stubMethod)!

    let baseMethodTypeEncodingString = String(cString: baseMethodTypeEncoding)
    let stubMethodTypeEncodingString = String(cString: stubMethodTypeEncoding)
    guard baseMethodTypeEncodingString == stubMethodTypeEncodingString else {
        fatalError(
            "Selector `\(selector)`'s stub method type encoding `\(stubMethodTypeEncodingString)` doesn't equal base method type encoding `\(baseMethodTypeEncodingString)`"
        )
    }

    class_addMethod(
        newClass,
        selector,
        method_getImplementation(stubMethod),
        stubMethodTypeEncoding
    )
}

/// An interface that mimics WebKit's [`WKContentView`][1]. Allows us to write
/// our custom superclass stub as if it actually inherited from
/// `WKContentView`.
///
/// - [`WKContentView` extends `WKApplicationStateTrackingView`][1]
/// - [`WKApplicationStateTrackingView` extends `UIView`][2]
///
/// [1]: https://github.com/WebKit/WebKit/blob/a9c33a2b496aeadd33e500d7e474710f4abfbf8a/Source/WebKit/UIProcess/ios/WKContentView.h#L56
/// [2]: https://github.com/WebKit/WebKit/blob/a9c33a2b496aeadd33e500d7e474710f4abfbf8a/Source/WebKit/UIProcess/ios/WKApplicationStateTrackingView.h#L32
@objc private class WKContentViewStub: UIView {
    /// In Objective-C the [signature][1] is:
    ///
    /// ```
    /// (BOOL)canPerformActionForWebView:(SEL)action withSender:(id)sender
    /// ```
    ///
    /// [1]: https://github.com/WebKit/WebKit/blob/ce47267f2d5ecaa5aefd2346a8cfa59b7aaeb08a/Source/WebKit/UIProcess/ios/WKContentViewInteraction.mm#L4410
    @objc func canPerformActionForWebView(_ action: Selector, withSender sender: Any?) -> Bool {
        fatalError("Stub implementation")
    }
}

@objc private class WKContentView_Custom: WKContentViewStub {
    @objc override var inputAccessoryView: UIView? {
        // Remove the bar with up/down arrows and a "done" button from the
        // `WKWebView`. Potentially replace it with a custom accessory view.
        //
        // This implementation is adapted from [StackOverflow][1]. The question
        // answerer claims this code is in an app that has passed app review.
        //
        // [1]: https://stackoverflow.com/questions/32546394/hiding-keyboard-accessorybar-in-wkwebview/32620344#32620344
        return objc_getAssociatedObject(self, &customInputAccessoryViewAssociatedObjectKey)
            as! UIView?
    }

    @objc override func canPerformActionForWebView(_ action: Selector, withSender sender: Any?)
        -> Bool
    {
        // Hide the "Underline" option from the "Format" sub-menu in the edit menu.
        // Since clicking the "Underline" option will do nothing.
        if action == #selector(UIResponderStandardEditActions.toggleUnderline(_:)) { return false }

        // We can't call `super.canPerformActionForWebView()` since we need to call the
        // method implementation of our runtime class (`WKContentView` from WebKit),
        // not our static class (`WKContentViewStub`).
        let superclass: AnyClass = class_getSuperclass(object_getClass(self))!
        let selector = #selector(WKContentView_Custom.canPerformActionForWebView)

        let superCanPerformActionForWebView = unsafeBitCast(
            method_getImplementation(class_getInstanceMethod(superclass, selector)!),
            to: (@convention(c) (AnyObject, Selector, Selector, Any?) -> Bool).self
        )

        return superCanPerformActionForWebView(self, selector, action, sender)
    }
}
