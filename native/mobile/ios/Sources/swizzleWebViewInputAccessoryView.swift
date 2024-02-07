import Foundation
import WebKit

/// Remove the bar with up/down arrows and a "done" button from the
/// `WKWebView`. This uses the Objective-C runtime "swizzling" technique.
///
/// This implementation is adapted from [StackOverflow][1]. The question
/// answerer claims this code is in an app that has passed app review.
///
/// [1]: https://stackoverflow.com/questions/32546394/hiding-keyboard-accessorybar-in-wkwebview/32620344#32620344
func swizzleWebViewInputAccessoryView(_ webView: WKWebView) {
    var targetView: UIView?

    for view in webView.scrollView.subviews {
        if type(of: view).description() == "WKContentView" { targetView = view }
    }

    guard let targetView = targetView else { return }
    let targetViewClass = type(of: targetView)

    let noInputAccessoryViewClassName = "\(targetViewClass.superclass()!)_NoInputAccessoryView"

    let newClass: AnyClass
    if let existingClass = NSClassFromString(noInputAccessoryViewClassName) {
        newClass = existingClass
    } else {
        newClass = objc_allocateClassPair(
            targetViewClass,
            noInputAccessoryViewClassName.cString(using: .ascii)!,
            0
        )!

        let method = class_getInstanceMethod(
            NoInputAccessoryView.self,
            #selector(NoInputAccessoryView.inputAccessoryView)
        )!

        class_addMethod(
            newClass,
            #selector(NoInputAccessoryView.inputAccessoryView),
            method_getImplementation(method),
            method_getTypeEncoding(method)
        )

        objc_registerClassPair(newClass)
    }

    object_setClass(targetView, newClass)
}

@objc private class NoInputAccessoryView: NSObject {
    @objc func inputAccessoryView() -> Any? { return nil }
}
