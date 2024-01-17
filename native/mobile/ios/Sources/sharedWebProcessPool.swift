import WebKit

/// All the `WKWebView`s we construct can [share the same process pool][1] for
/// efficiency. The main reason to not share process pools is security. But our
/// `WKWebView`s should only be rendering content from domains we own.
///
/// [1]: https://developer.apple.com/documentation/webkit/wkprocesspool
let sharedWebProcessPool = WKProcessPool()
