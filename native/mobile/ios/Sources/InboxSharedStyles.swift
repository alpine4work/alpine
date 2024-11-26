/// The same value as `inboxBannerHeight` in
/// `inbox_shared_styles.ts`. So measurements which need the inbox banner
/// height are the same across web code and native code.
///
/// This is measured in points. Whereas `inboxBannerHeight` in
/// `inbox_shared_styles.ts` is a `Spacing` value. We use mobile sizes for
/// `Spacing` since this is the code for our native mobile app.
let inboxBannerHeight = 50.0
