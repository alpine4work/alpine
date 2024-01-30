/// The same value as `navigationBarHeight` in `use_navigation_bar.tsx`. So our
/// behavior to automatically hide the tab bar (implemented in native code) is
/// the same as our behavior to automatically hide the navigation bar
/// (implemented in web code).
///
/// This is measured in points. Whereas `navigationBarHeight` in
/// `use_navigation_bar.tsx` is a `Spacing` value. We use mobile sizes for
/// `Spacing` since this is the code for our native mobile app.
let navigationBarHeight = 45.0

/// The same value as `navigationBarTransitionDebounceScrollTimeoutMs` in
/// `use_navigation_bar.tsx`. So our behavior to automatically hide the tab bar
/// (implemented in native code) is the same as our behavior to automatically
/// hide the navigation bar (implemented in web code).
let navigationBarTransitionDebounceScrollTimeoutSeconds = 1.2

/// The same value as `navigationBarVisibleHeightThresholdForReveal` in
/// `use_navigation_bar.tsx`. So our behavior to automatically hide the tab
/// bar (implemented in native code) is the same as our behavior to
/// automatically hide the navigation bar (implemented in web code).
///
/// This is measured in points. Whereas `navigationBarHeight` in
/// `use_navigation_bar.tsx` is a `Spacing` value. We use mobile sizes for
/// `Spacing` since this is the code for our native mobile app.
let navigationBarVisibleHeightThresholdForReveal = 25.0

/// The same value as `navigationBarRevealOrHideAnimationSpeed` in
/// `use_navigation_bar.tsx`. So our behavior to automatically hide the tab bar
/// (implemented in native code) is the same as our behavior to automatically
/// hide the navigation bar (implemented in web code).
///
/// Measured in points per second. Not pixels per second. iOS points are the
/// same as web pixels.
let navigationBarRevealOrHideAnimationSpeed = 300.0
