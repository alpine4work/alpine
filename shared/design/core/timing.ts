/**
 * About the limit for having the user feel that the system is reacting
 * instantaneously, meaning that no special feedback is necessary except to display
 * the result.
 *
 * From [RAIL][1] which in turn comes from [UX research][2].
 *
 * [1]: https://web.dev/rail/
 * [2]: https://www.nngroup.com/articles/response-times-3-important-limits/
 */
export const perceivedAsInstantLimitMs = 100;

/**
 * Delay showing the user a loading indicator for this long. If the action
 * completes in less time then we don't flash a loading indicator and the action
 * feels instant.
 *
 * [UX research][1] (and [RAIL][2]) recommend a limit of 1000ms but we find in
 * practice this feels too sluggish. Especially since we're building a product that
 * feels more like an app then a document based website.
 *
 * [1]: https://www.nngroup.com/articles/response-times-3-important-limits/
 * [2]: https://web.dev/rail/
 */
export const delayLoadingIndicatorLimitMs = 500;

/**
 * Delay showing the user a loading indicator for this long when the loading
 * indicator will clear all other content on the page. If the action completes in
 * less time then we don't flash a loading indicator and the action feels instant.
 *
 * We use a longer delay for full page transitions vs
 * `delayLoadingIndicatorLimitMs` for responding to, say, a button press since full
 * page transitions are more disruptive.
 *
 * 1000ms since according to [UX Research][1] 1000ms is "about the limit for the
 * user's flow of thought to stay uninterrupted, even though the user will notice
 * the delay".
 *
 * [1]: https://www.nngroup.com/articles/response-times-3-important-limits/
 */
// IMPORTANT: If you update this constant, you should also update the same constant
// in `TimingConstants.swift`.
export const delayScreenTransitionLoadingIndicatorLimitMs = 1000;

/**
 * The delay between clicks for registering a click event as a double click. Useful
 * for manually implementing double click in our product.
 *
 * When we manually implement double click it means we aren't using the operating
 * system double click timer! This is bad for accessibility since users with motor
 * skill issues struggle to double click fast enough.
 *
 * Double-click can be configured up to [5s on Windows][1] and defaults to [500ms
 * on Windows][2]. Mobile browsers used a delay of [300ms to detect a double tap or
 * pinch zoom][3]. [500ms appears to be the industry standard default][4].
 *
 * [1]:
 *     https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getdoubleclicktime
 * [2]: https://en.wikipedia.org/wiki/Double-click
 * [3]: https://developer.chrome.com/blog/300ms-tap-delay-gone-away/
 * [4]:
 *     https://ux.stackexchange.com/questions/40364/what-is-the-expected-timeframe-of-a-double-click
 */
// We manually implement double-click support instead of using the operating system
// double click. This means we aren't using the operating system double click
// timer! This is bad for accessibility since users with motor skill issues
// struggle to double click fast enough.
//
// The reason we need to manually implement double clicking is we need to delay
// closing the peek overlay for some amount of time to detect a double click. If we
// waited the max operating system double click timeout ([5s on Windows][1])
// without responding to a single click that would be ridiculous. (We also can't
// get the double click time from JavaScript.)
//
// So we pick a reasonable delay that balances wanting to immediately respond to
// users in the single click case and allowing users who can to double click as a
// convenience. Users who can not double click in our chosen delay may use the
// shift keyboard shortcut. The [default double click time on Windows is 500ms][2].
// We pick a delay of [300ms which is the delay mobile browsers used][3] to apply
// to all taps to try and detect a double tap or pinch zoom. That makes 300ms an
// industry standard delay for detecting double taps/clicks. Though to be fair the
// mobile delay was for taps and our delay is for clicks.
//
// [1]:
//     https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getdoubleclicktime
// [2]: https://en.wikipedia.org/wiki/Double-click
// [3]: https://developer.chrome.com/blog/300ms-tap-delay-gone-away/
export const doubleClickDelayMs = 500;

/**
 * If the time between two text updates is less than this number then we merge the
 * updates into one item on the undo stack. 500ms is [copied from
 * `prosemirror-history`][1].
 *
 * [1]:
 *     https://github.com/ProseMirror/prosemirror-history/blob/4e1e8982b57b9fc5d1b27213b9b3a76416e3903e/src/history.ts#L378-L381
 */
export const undoMergeTextUpdatesDelayMs = 500;
