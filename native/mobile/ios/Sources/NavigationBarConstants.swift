/// The same value as `navigationBarTransitionDebounceScrollTimeoutMs` in
/// `use_navigation_bar.tsx`. So our behavior to automatically hide the tab bar
/// (implemented in native code) is the same as our behavior to automatically
/// hide the navigation bar (implemented in web code).
let navigationBarTransitionDebounceScrollTimeoutSeconds = 1.2

/// The same value as `navigationBarRevealOrHideAnimationSpeed` in
/// `use_navigation_bar.tsx`. So our behavior to automatically hide the tab bar
/// (implemented in native code) is the same as our behavior to automatically
/// hide the navigation bar (implemented in web code).
///
/// Measured in points per second. Not pixels per second. iOS points are the
/// same as web pixels.
let navigationBarRevealOrHideAnimationSpeed = 300.0
