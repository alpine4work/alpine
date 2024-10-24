/// Should be the same as `perceivedAsInstantLimitMs` in `timing.ts`.
/// See that file for why we picked this constant.
let perceivedAsInstantLimitSeconds = 0.1

/// Should be the same as `delayScreenTransitionLoadingIndicatorLimitMs` in
/// `timing.ts`. See that file for why we picked this constant.
let delayScreenTransitionLoadingIndicatorLimitSeconds = 1.0

/// `delayScreenTransitionLoadingIndicatorLimitSeconds` but longer. Useful in
/// cases where the user expects our app to be loading and we'd really like to
/// avoid loading spinners.
///
/// Ideally we'd like this to cover p95 of page navigations.
let extraLongDelayScreenTransitionLoadingIndicatorLimitSeconds = 3.0
