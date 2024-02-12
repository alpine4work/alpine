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
     * Our native mobile app requires careful coordination between native code and
     * web code to create an app that feels native. For that coordination to work
     * web code has to actually be running. Given web code has many failure states
     * (from server 500s to infinite `while` loops) these health methods allow web
     * code to report everything's normal to native code. If native code detects
     * that web code has become unhealthy it will show the user an error message.
     */
    readonly health: {
        /**
         * Once all HTML has finished loading from this server, web code calls
         * this method so native code can remove any spinners and paint to the
         * screen.
         *
         * We call this function before React hydration to immediately present
         * server rendered HTML to the user.
         */
        ready(): void;

        /**
         * Web code is expected to send a ping to native code every 500ms. If native
         * code detects no ping for over 1s it shows an error to the user and hard
         * reloads the web view. Assuming the web view has entered a bad state
         * (e.g. an infinite while loop).
         *
         * This is worst case, unexpected, error handling. If web code and native code
         * are out-of-sync then all kinds of things can get wonky. That break the
         * illusion our app is built with platform technologies. Like navigation bars
         * not properly sticking to the top of the view. So instead of letting that
         * happen we eagerly show an error to the user.
         */
        ping(): void;
    };

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
    readonly navigation: {
        /**
         * The way a push navigation in our native mobile app works is:
         *
         * 1. Web code initiates the push
         * 2. `NativeMobileMemoryHistory` saves the current router state (with
         *    `loaderData`) so we can keep rendering the old route offscreen
         * 3. React begins rendering the new route
         * 4. Right before React commits the new route to the DOM, it runs
         *    `useInsertionEffect()` hooks
         * 5. `preparePushAnimation()` is called which blocks the web main thread while
         *    native takes a snapshot of the web view and swaps the web view for that
         *    snapshot
         * 6. Once React has finished committing the new route to the DOM, it runs
         *    `useLayoutEffect()` hooks
         * 7. `push()` is called so native creates a new view, renders the web view in
         *    it, and animates that new view on top of the old snapshot
         *
         * This is an asynchronous process. Our code has to take care to make sure
         * everything stays in sync.
         *
         * This function is step 5. Note that calling this function synchronously
         * blocks the web browser's main thread! The native platform's web view may be
         * architected to run native shell code and web code in different processes
         * which means we're blocked on process communication which may be a
         * non-trivial amount of time. On iOS, there isn't an official API for
         * synchronous communication between native code and web code so we [hack in
         * synchronous communication using the `prompt()` web API][1].
         *
         * If you call this function you must make sure to call `push()` afterwards!
         * Otherwise the app will appear frozen as we only show a snapshot view and not
         * the underlying web view.
         *
         * [1]: https://stackoverflow.com/a/49474323/1568890
         */
        preparePush(): void;

        /**
         * Actually performs the push navigation animation. Step 7 in the
         * `preparePush()` comment. Some edge cases to consider:
         *
         * - If you call this function without calling `preparePush()` first then the
         *   view will immediately blank out as the new view is pushed on top
         *
         * - If you call this function when there wasn't a corresponding push in web
         *   code then native code's navigation stack will be out-of-sync with web
         *   code's navigation stack. Native initiated navigations will end up resetting
         *   our web history state.
         *
         * Needs the URL so native can remember the URL of this position in the
         * navigation stack even if JavaScript forgets. (e.g. Because the web browser
         * reloaded.) If a native initiated navigation goes back to this screen we'll
         * make sure this URL is rendered regardless of our current web code navigation
         * state.
         */
        push(url: URL): void;

        /**
         * There are two kinds of pop navigations that may happen in our native mobile
         * app:
         *
         * 1. Navigations initiated by native code
         * 2. Navigations initiated by web code
         *
         * We call 1 "external" pops which is what this function addresses.
         *
         * The way an external pop in our native mobile app works is:
         *
         * 1. Native code takes a snapshot of the web view and swaps the web view for
         *    that snapshot
         * 2. Native code calls listeners in web code who subscribed with
         *    `subscribeToExternalPop()` with how many stack frames (`delta`) to pop
         *    and the expected URL
         * 3. `NativeMobileMemoryHistory` finds the new route based on its internal
         *    history stack. One of two things may happen from here:
         *    - If we have more than `delta` stack frames and the new route has the
         *      same URL as the expected URL from native
         *          1. `NativeMobileMemoryHistory` unsafely restores the old route
         *             state in our web code router. We should have continued to render
         *             this route with React so all our state is preserved (React
         *             state, DOM scroll state, etc.). If we haven't continued to
         *             render this route we need to refetch data from the server
         *          2. Once React has finished committing the new route to the DOM, it
         *             runs `useLayoutEffect()` hooks
         *          3. `finishExternalPop()` is called and native removes the snapshot
         *             on the popped view (created during the push animation) and adds
         *             the web view (which is rendering the correct route) back to the
         *             popped view
         *    - Otherwise
         *          1. `NativeMobileMemoryHistory`'s history state is out of sync with
         *             native!
         *          2. `NativeMobileMemoryHistory` resets its history state and sets
         *             the URL from native as the current location
         *          3. `NativeMobileMemoryHistory` tells `react-router` to start a
         *             navigation (so we need to load new data from the server)
         *          4. Once React has finished committing the new route to the DOM, it
         *             runs `useLayoutEffect()` hooks
         *          5. `finishExternalPop()` is called and native removes the snapshot
         *             on the popped view (created during the push animation) and adds
         *             the web view (which is rendering the correct route) back to the
         *             popped view
         *
         * If you don't promptly call `finishExternalPop()` after this function is
         * called then the app will appear frozen! As we only show a snapshot view and
         * not the underlying web view.
         */
        subscribeToExternalPop(listener: (delta: number, url: URL) => void): () => void;

        /**
         * See `subscribeToExternalPop()` for documentation on what this function does.
         * In short, web code uses this to tell native code we've finished rendering a
         * native initiated pop navigation.
         */
        finishExternalPop(): void;

        /**
         * A pop navigation initiated from web code (vs a pop navigation initiated by
         * native code, see `subscribeToExternalPop()`) follows basically the same code
         * path as a push navigation initiated from web code.
         *
         * See the documentation on `preparePush()` for an overview of how this
         * works.
         *
         * If you call this function you must make sure to call `pop()` afterwards!
         * Otherwise the app will appear frozen as we only show a snapshot view and not
         * the underlying web view.
         */
        preparePop(): void;

        /**
         * Actually performs the pop navigation animation. Follows basically the same
         * code path as a push navigation initiated from web code.
         *
         * See the documentation on `push()` for an overview of how this works.
         *
         * Needs the URL for native to find precisely where to return in the navigation
         * stack. If native can't find a view with the same URL in its navigation stack
         * that's most likely a bug! For now native chooses to update the route
         * in-place instead of animating anywhere.
         */
        pop(url: URL): void;

        /**
         * When web code performs a replace navigation, we need to update native code's
         * navigation state to match the new URL. Otherwise native code's navigation
         * state and web code's navigation state will be incompatible.
         */
        replace(url: URL): void;
    };

    /**
     * Functions for synchronizing the web code navigation bar with the native code
     * tab bar.
     */
    readonly navigationBar: {
        /**
         * When the user is done scrolling, after about a second if the navigation bar
         * (and tab bar) are partially occluded we run an animation to completely hide
         * the navigation bar (and tab bar) or completely hide the navigation bar (and
         * tab bar).
         *
         * Both native code and web code setup a timeout with the same time interval
         * constant. However, in practice we've observed native code and web code
         * timers sometimes firing at different times. Since their timers may be
         * implemented in different environments. So as a safeguard, web code will
         * call this function when its timer fires to force native code's timer to be
         * fired near the same time if it's slow.
         *
         * We could also have native code call web code when native's timer fires to
         * handle the case where native is faster than web. However, in practice we've
         * not yet seen the native tab bar visually animate before the web navigation
         * bar. So reduce cross process chatter by only having web call native.
         */
        runScrollDebounceTimeout(): void;
    };

    /**
     * Functions for dealing with the software keyboard on mobile devices that
     * occludes content on our screen.
     */
    readonly keyboard: {
        /**
         * When the keyboard opens/closes we call subscribed listener functions. The
         * listener may then scroll content to make sure it's still in view now that
         * the keyboard is open. For example, in chat we scroll so that messages at the
         * bottom of the screen are still at the bottom of the screen. Whereas for
         * documents we want to scroll such that the cursor is visible and not occluded
         * by the keyboard.
         */
        subscribeToScrollMainContent(listener: (scrollOffsetDelta: number) => void): void;
    };
} | null = typeof window !== "undefined" ? (window as any).__NativeMobileBridge ?? null : null;
