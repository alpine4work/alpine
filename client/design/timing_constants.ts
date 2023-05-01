/**
 * About the limit for having the user feel that the system is reacting
 * instantaneously, meaning that no special feedback is necessary except to
 * display the result.
 *
 * From [RAIL][1] which in turn comes from [UX research][2].
 *
 * [1]: https://web.dev/rail/
 * [2]: https://www.nngroup.com/articles/response-times-3-important-limits/
 */
export const perceivedAsInstantLimitMs = 100;

/**
 * Delay showing the user a loading indicator for this long. If the action
 * completes in less time then we don't flash a loading indicator and the
 * action feels instant.
 *
 * [UX research][1] (and [RAIL][2]) recommend a limit of 1000ms but we find in
 * practice this feels too sluggish. Especially since we're building a product
 * that feels more like an app then a document based website.
 *
 * [1]: https://www.nngroup.com/articles/response-times-3-important-limits/
 * [2]: https://web.dev/rail/
 */
export const delayLoadingIndicatorLimitMs = 500;

/**
 * Delay showing the user a loading indicator for this long when the loading
 * indicator will clear all other content on the page. If the action completes
 * in less time then we don't flash a loading indicator and the action feels
 * instant.
 *
 * We use a longer delay for full page transitions vs
 * `delayLoadingIndicatorLimitMs` for responding to, say, a button press since
 * full page transitions are more disruptive.
 */
export const delayFullPageTransitionLoadingIndicatorLimitMs = 1000;
