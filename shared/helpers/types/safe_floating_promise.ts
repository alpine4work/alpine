/**
 * A promise that's allowed to be floating and won't cause an error with the
 * [`@typescript-eslint/no-floating-promises` rule][1].
 *
 * We only recommend using `SafeFloatingPromise` for promises which:
 *
 * - Don't throw errors
 * - Display loading indicators to the user through some other means
 *
 * The `navigate()` function is a good example of this. After ~1s we navigate
 * to the route with a loading shimmer to show the user progress.
 *
 * [1]: https://typescript-eslint.io/rules/no-floating-promises/
 */
export type SafeFloatingPromise<T> = Promise<T> & {readonly _SafeFloatingPromise: never};
