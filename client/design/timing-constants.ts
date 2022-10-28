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
 * About the limit for the user's flow of thought to stay uninterrupted, even
 * though the user will notice the delay. Normally, no special feedback is
 * necessary during delays of more than 0.1 but less than 1.0 second, but the
 * user does lose the feeling of operating directly on the data.
 *
 * From [RAIL][1] which in turn comes from [UX research][2].
 *
 * [1]: https://web.dev/rail/
 * [2]: https://www.nngroup.com/articles/response-times-3-important-limits/
 */
export const uninterruptedThoughtLimitMs = 1000;

/**
 * Time it takes before we present extra context to the user if the user has
 * not taken another action.
 *
 * This delay is used for tooltips among other things. If the user hovers over
 * a button for this amount of time, we present a tooltip. If the user's mouse
 * is quickly moving around then we don't present a tooltip because the user is
 * taking quick action and doesn't appear to need extra context.
 */
export const presentExtraContextAfterDelayMs = 500;
