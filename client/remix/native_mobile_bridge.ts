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
     * Properly managing navigation for our native mobile apps is a challenging
     * problem. Since navigation responsibilities are shared between web code and
     * native code. Native code is responsible for animating between routes and
     * supporting gestures like swipe from left on iOS or the back button on
     * Android. Web code is responsible for presenting the correct content on
     * screen.
     *
     * Without considering the native mobile app, web code has three brains it
     * needs to keep in sync:
     *
     * 1. Web browser history: The web browser is the ultimate authority on
     *    navigation state. The web browser has back/forward buttons our web code
     *    must respect.
     *
     * 2. JavaScript router: The bridge between web browser history and JavaScript
     *    is the `@remix-run/router` package (see its [history module][1]). This
     *    provides a nice interface to JavaScript for manipulating browser history
     *    and reacting to browser history. `@remix-run/router` also manages
     *    asynchronous requests necessary to facilitate page transitions. It must
     *    do the hard work of keeping UI in sync with browser history in the face
     *    of network requests. Sometimes browser history is a little behind
     *    JavaScript router state (when navigating to a new page), sometimes
     *    browser history is a little ahead of JavaScript router state (when the
     *    user presses the back button on their browser).
     *
     * 3. React router: React must then respond to route changes to present new
     *    content to the screen. This is done through the `react-router` package
     *    (see its [router module][2]). It adds another level of asynchronous
     *    execution since renders are made within a [`startTransition()` call][3]
     *    which allows renders to happen without blocking the UI.
     *
     * When we add in the native mobile app, there's a fourth brain we need to keep
     * in sync:
     *
     * 4. Native mobile app history: Let's talk in the context of iOS. On iOS we
     *    have a [`UINavigationController`][4] and [`UITabBarController`][5] which
     *    both have their own idea of what the active screen is. When navigating to
     *    a new screen these views tell web code to start navigating, once
     *    web code is ready it tells native which actually performs the navigation.
     *
     * Though in our native mobile app we do build our own in-memory history
     * instead of depending on web browser history to eliminate brain 1 from the
     * equation.
     *
     * This is all a very carefully coordinated dance. Brains 1, 2, and 3 are
     * managed by code from the `react-router` project which is a well written,
     * carefully tested, industry standard router. Brain 4, and related
     * coordination code, we need to implement all on our own.
     *
     * [1]: https://github.com/remix-run/react-router/blob/09b6cbeabb02ffaccc3d5a6ca751b9f5221b0d5b/packages/router/history.ts#L357
     * [2]: https://github.com/remix-run/react-router/blob/09b6cbeabb02ffaccc3d5a6ca751b9f5221b0d5b/packages/react-router/lib/components.tsx#L96-L106
     * [3]: https://react.dev/reference/react/startTransition
     * [4]: https://developer.apple.com/documentation/uikit/uinavigationcontroller
     * [5]: https://developer.apple.com/documentation/uikit/uitabbarcontroller
     */
    readonly navigation: {};

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
     * If you call this function you must make sure to call `runPushNavigation()`
     * afterwards! Otherwise the app will appear frozen as we only show a snapshot
     * view and not the underlying web view.
     *
     * [1]: https://stackoverflow.com/a/49474323/1568890
     */
    preparePushNavigationAnimation(): void;

    /**
     * Runs a prepared navigation animation. On iOS the new screen will slide in
     * from the right on top of the old screen.
     *
     * Needs the URL so native can remember the URL of this position in the
     * navigation stack even if JavaScript forgets. (e.g. Because the web browser
     * reloaded.)
     */
    runPushNavigationAnimation(url: URL): void;

    /**
     * If a pop navigation was initiated by our native shell (e.g. the user swiped
     * from the left) then our web process needs to navigate to the previous page.
     */
    // NOCOMMIT: Document why `URL` is there
    subscribeToPopNavigation(listener: (delta: number, url: URL) => void): () => void;

    // NOCOMMIT: Document
    finishPopNavigationAnimation(): void;
} | null = typeof window !== "undefined" ? (window as any).__NativeMobileBridge ?? null : null;
