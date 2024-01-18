/**
 * When we are running in a native mobile app, the global `NativeMobileBridge`
 * is injected. This object allows you to communicate with the native app shell
 * whether we're on iOS or Android.
 */
// NOTE(calebmer): Putting this file in `client/remix` instead of
// `client/helpers` since files in `client/remix` understand the architecture
// of our app whereas `client/helpers` should be more generic.
export const NativeMobileBridge: {
    /**
     * Prepare a navigation animation. You must call this immediately before
     * painting the new screen. That way our native shell can capture an image of
     * the current UI and render it alongside the new UI as it animates in.
     *
     * This function synchronously blocks until the native shell is done preparing
     * the animation. If the native platform's web view is architected in such a
     * way that our native shell code and web code run in different processes, this
     * may block for a non-trivial amount of time since process communication is
     * required! On iOS, there isn't an official API for synchronous communication
     * between native code and web code so we [hack in synchronous communication
     * using the `prompt()` web API][1].
     *
     * [1]: https://stackoverflow.com/a/49474323/1568890
     */
    preparePushNavigationAnimation(): void;

    /**
     * Runs a prepared navigation animation. On iOS the new screen will slide in
     * from the right on top of the old screen.
     */
    runPushNavigationAnimation(): void;

    /**
     * Prepare the native pop animation. Same as `preparePushNavigationAnimation()`
     * except instead of pushing we're popping.
     */
    preparePopNavigationAnimation(): void;

    /**
     * Run the native pop animation. Same as `runPushNavigationAnimation()` except
     * instead of pushing we're popping.
     */
    runPopNavigationAnimation(): void;

    /**
     * If a pop navigation was initiated by our native shell (e.g. the user pressed
     * the back button in a navbar) then our web process needs to kick off data
     * loading. We can't actually perform the animation until data loading has
     * finished.
     */
    subscribeToPopNavigation(listener: (delta: number) => void): () => void;
} | null = typeof window !== "undefined" ? (window as any).__NativeMobileBridge ?? null : null;
