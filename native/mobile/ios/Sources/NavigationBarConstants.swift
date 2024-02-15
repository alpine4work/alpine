/// The same value as `mobileNavigationBarHeight` in `navigation_bar.css.ts`.
/// So our behavior to automatically hide the tab bar (implemented in native
/// code) is the same as our behavior to automatically hide the navigation bar
/// (implemented in web code).
///
/// This is measured in points. Whereas `mobileNavigationBarHeight` in
/// `navigation_bar.css.ts` is a `Spacing` value. We use mobile sizes for
/// `Spacing` since this is the code for our native mobile app.
let navigationBarHeight = 70.0

/// The same value as `navigationBarTransitionDebounceScrollTimeoutMs` in
/// `navigation_bar.tsx`. So our behavior to automatically hide the tab bar
/// (implemented in native code) is the same as our behavior to automatically
/// hide the navigation bar (implemented in web code).
let navigationBarTransitionDebounceScrollTimeoutSeconds = 1.2

/// The same value as `navigationBarVisibleHeightThresholdForReveal` in
/// `navigation_bar.tsx`. So our behavior to automatically hide the tab
/// bar (implemented in native code) is the same as our behavior to
/// automatically hide the navigation bar (implemented in web code).
///
/// This is measured in points. Whereas
/// `navigationBarVisibleHeightThresholdForReveal` in `navigation_bar.tsx`
/// is a `Spacing` value. We use mobile sizes for `Spacing` since this is the
/// code for our native mobile app.
let navigationBarVisibleHeightThresholdForReveal = 30.0

/// The same value as `navigationBarRevealOrHideAnimationSpeed` in
/// `navigation_bar.tsx`. So our behavior to automatically hide the tab bar
/// (implemented in native code) is the same as our behavior to automatically
/// hide the navigation bar (implemented in web code).
let navigationBarRevealOrHideAnimationDurationSeconds = 0.2
