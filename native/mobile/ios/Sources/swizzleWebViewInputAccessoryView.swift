import Foundation
import WebKit

private var customInputAccessoryViewAssociatedObjectKey: UInt8 = 0

// NOCOMMIT: We must be prepared to remove any of this after app review

/// Remove the bar with up/down arrows and a "done" button from the
/// `WKWebView`. This uses the Objective-C runtime "swizzling" technique.
///
/// This implementation is adapted from [StackOverflow][1]. The question
/// answerer claims this code is in an app that has passed app review.
///
/// [1]: https://stackoverflow.com/questions/32546394/hiding-keyboard-accessorybar-in-wkwebview/32620344#32620344
func swizzleWebViewInputAccessoryView(_ webView: WKWebView, customInputAccessoryView: UIView? = nil)
{
    var targetView: UIView?

    for view in webView.scrollView.subviews {
        if type(of: view).description() == "WKContentView" { targetView = view }
    }

    guard let targetView = targetView else { return }
    let targetViewClass = type(of: targetView)

    // NOCOMMIT:
    // print(webView.perform(Selector(("_methodDescription")))!)
    // print("")
    // print("")
    // print("")
    // print(targetView.perform(Selector(("_methodDescription")))!)

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

        addOverridingMethod(
            baseClass: targetViewClass,
            stubClass: WKContentView_Custom.self,
            selector: #selector(WKContentView_Custom._updateTextInputTraits),
            newClass: newClass
        )

        objc_registerClassPair(newClass)
    }

    object_setClass(targetView, newClass)

    // NOCOMMIT:
    //
    // print("TEST START")
    // let s = "toggleBoldface:"
    // let obj = webView.perform(
    //     #selector(UIResponder.canPerformAction(_:withSender:)),
    //     with: Selector(s),
    //     with: nil
    // )
    // if let obj = obj as? AnyObject {
    //     let pointer: UnsafeMutableRawPointer = Unmanaged<AnyObject>.passUnretained(obj).toOpaque()
    //     let valueBool: Bool = pointer.load(as: Bool.self)
    //     print("RESULT", valueBool)
    // }
    // print("TEST END")

    // var outCount: UInt32 = 0
    // let protocols = class_copyProtocolList(targetViewClass, &outCount)!

    // for index in 0..<outCount {
    //     print(
    //         "Class \(targetViewClass) implements protocol <\(String(cString: protocol_getName(protocols[Int(index)])))>"
    //     )
    // }

    // let obj = X()
    // let sel = #selector(obj.sayHiTo)
    // let meth = class_getInstanceMethod(object_getClass(obj), sel)!
    // let imp = method_getImplementation(meth)

    // typealias ClosureType = @convention(c) (AnyObject, Selector, String) -> Void
    // let sayHiTo: ClosureType = unsafeBitCast(imp, to: ClosureType.self)
    // sayHiTo(obj, sel, "Fabio")
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
    // NOCOMMIT: Document where this is from
    @objc func canPerformActionForWebView(_ action: Selector, withSender sender: Any?) -> Bool {
        fatalError("Stub implementation")
    }

    // NOCOMMIT: Document where this is from
    @objc func _updateTextInputTraits(_ traits: UITextInputTraits) {
        fatalError("Stub implementation")
    }
}

@objc private class WKContentView_Custom: WKContentViewStub {
    @objc override var inputAccessoryView: UIView? {
        return objc_getAssociatedObject(self, &customInputAccessoryViewAssociatedObjectKey)
            as! UIView?
    }

    @objc override func canPerformActionForWebView(_ action: Selector, withSender sender: Any?)
        -> Bool
    {
        print("CAN PERFORM ACTION FOR WEB VIEW", action)

        if action == #selector(UIResponderStandardEditActions.toggleUnderline(_:)) {
            print("TOGGLING UNDERLINE???")
            return false
        }

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

    @objc override func _updateTextInputTraits(_ traits: UITextInputTraits) {
        // We can't call `super.canPerformActionForWebView()` since we need to call the
        // method implementation of our runtime class (`WKContentView` from WebKit),
        // not our static class (`WKContentViewStub`).
        let superclass: AnyClass = class_getSuperclass(object_getClass(self))!
        let selector = #selector(WKContentView_Custom._updateTextInputTraits)

        let superTextInputTraitsForWebView = unsafeBitCast(
            method_getImplementation(class_getInstanceMethod(superclass, selector)!),
            to: (@convention(c) (AnyObject, Selector, UITextInputTraits) -> Void).self
        )

        superTextInputTraitsForWebView(self, selector, traits)

        let traitsClass: AnyClass = object_getClass(traits)!

        // NOCOMMIT: Document!!!

        do {
            let selector = Selector(("setSmartQuotesType:"))

            let setSmartQuotesType = unsafeBitCast(
                method_getImplementation(class_getInstanceMethod(traitsClass, selector)!),
                to: (@convention(c) (AnyObject, Selector, UITextSmartQuotesType) -> Void).self
            )

            setSmartQuotesType(traits, selector, .no)
        }

        do {
            let selector = Selector(("setSmartDashesType:"))

            let setSmartDashesType = unsafeBitCast(
                method_getImplementation(class_getInstanceMethod(traitsClass, selector)!),
                to: (@convention(c) (AnyObject, Selector, UITextSmartDashesType) -> Void).self
            )

            setSmartDashesType(traits, selector, .no)
        }

        do {
            let selector = Selector(("setSpellCheckingType:"))

            let setSpellCheckingType = unsafeBitCast(
                method_getImplementation(class_getInstanceMethod(traitsClass, selector)!),
                to: (@convention(c) (AnyObject, Selector, UITextSpellCheckingType) -> Void).self
            )

            setSpellCheckingType(traits, selector, .no)
        }

        do {
            let selector = Selector(("setAutocorrectionType:"))

            let setAutocorrectionType = unsafeBitCast(
                method_getImplementation(class_getInstanceMethod(traitsClass, selector)!),
                to: (@convention(c) (AnyObject, Selector, UITextAutocorrectionType) -> Void).self
            )

            setAutocorrectionType(traits, selector, .no)
        }

        print("UPDATING TEXT INPUT TRAITS FOR WEB VIEW", traits)
    }
}
