import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Each of the tabs in our mobile app's tab bar.
 */
export type NativeMobileTab = "Home" | "Search" | "Create" | "Inbox" | "More";

export function isNativeMobileTab(tab: unknown): tab is NativeMobileTab {
    switch (tab) {
        case "Home":
        case "Search":
        case "Create":
        case "Inbox":
        case "More":
            return true;
        default:
            return false;
    }
}

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
     * Functions for updating dynamic colors (like the theme color) in our
     * native code.
     */
    // TODO(calebmer): If your app is set to light mode but the system is set to
    // dark mode we should coordinate that through this namespace.
    readonly colors: {
        /**
         * Set the theme color in our native app. On iOS this is used as the
         * `tintColor`. Which is in turn used as the caret and selection color.
         */
        setThemeColors(options: {
            "theme-10": string;
            "theme-20": string;
            "theme-30": string;
            "theme-40": string;
            "theme-50": string;
            "theme-60": string;
            "theme-70": string;
            "theme-80": string;
            "theme-90": string;
        }): void;
    };

    /**
     * Methods for managing the native mobile app session.
     */
    readonly session: {
        /**
         * Sign out the stored session in the native mobile app. If the user is signed
         * in, this function destroys the current web browsing context and replaces it
         * with a new one.
         */
        signOut(): void;

        /**
         * Switch to a different space in the native mobile app. This function destroys
         * the current web browsing context and replaces it with a new one.
         */
        switchSpace(spaceId: SpaceId): void;
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
         * There are two kinds of external pops. Immediate external pops and eventual
         * external pops. Immediate external pops immediately run the pop animation. We
         * run an immediate external pop when the user swipes from the left of their
         * screen to go back. Eventual external pops load data in the background and
         * only animate once the data is ready. If you call
         * `requestEventualExternalPop()` you get an eventual external pop.
         *
         * Eventual external pops work a lot like our other navigations
         * (e.g. `preparePush()`/`push()` or `prepareSwitchTab()`/`switchTab()`) in
         * that they freeze the app on `useInsertionEffect()` to take a screenshot and
         * run the animation once rendering is done in a `useEffect()`.
         *
         * Immediate external pops work differently. Here's how an immediate external
         * pop (which you can trigger by swiping back on the screen of an iOS device)
         * works:
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
         *          2. Once React begins building the new route's DOM, it runs
         *             `useInsertionEffect()` hooks
         *          3. `prepareExternalPop()` is called but does nothing,
         *             `prepareExternalPop()` only contributes to eventual external
         *             pops
         *          4. Once React has finished committing the new route to the DOM, it
         *             runs `useLayoutEffect()` hooks
         *          5. `externalPop()` is called and native removes the snapshot
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
         *          4. Once React begins building the new route's DOM, it runs
         *             `useInsertionEffect()` hooks
         *          5. `prepareExternalPop()` is called but does nothing,
         *             `prepareExternalPop()` only contributes to eventual external
         *             pops
         *          6. Once React has finished committing the new route to the DOM, it
         *             runs `useLayoutEffect()` hooks
         *          7. `externalPop()` is called and native removes the snapshot
         *             on the popped view (created during the push animation) and adds
         *             the web view (which is rendering the correct route) back to the
         *             popped view
         *
         * For immediate external pops, if you don't promptly call `externalPop()`
         * after this function is called then the app will appear frozen! As we only
         * show a snapshot view and not the underlying web view.
         */
        subscribeToExternalPop(listener: (delta: number, url: URL) => void): () => void;

        /**
         * See `subscribeToExternalPop()` for documentation on what this function does.
         * In short, web code uses this to tell native code we've about to render a
         * native initiated pop navigation.
         */
        prepareExternalPop(): void;

        /**
         * See `subscribeToExternalPop()` for documentation on what this function does.
         * In short, web code uses this to tell native code we've finished rendering a
         * native initiated pop navigation.
         */
        externalPop(): void;

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
        preparePop(url: URL): void;

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
         * Ask native to perform a pop navigation if it can. We call this when a pop
         * navigation is initiated in web code but web code doesn't have a previous
         * route state. Native likely has a previous route state then.
         *
         * This happens when the page reloads so web code loses its previous navigation
         * states but native remembers.
         */
        requestEventualExternalPop(): void;

        /**
         * When web code performs a replace navigation, we need to update native code's
         * navigation state to match the new URL. Otherwise native code's navigation
         * state and web code's navigation state will be incompatible.
         */
        replace(url: URL): void;

        /**
         * Prepares a replace with push animation. Does almost the exact same thing as
         * `preparePush()` except we don't push a new entry to the navigation stack.
         * Instead we reuse the current entry.
         *
         * So if you go pop back, you don't go back to the replaced route. You go to
         * the route before.
         */
        prepareReplaceWithPushAnimation(): void;

        /**
         * Runs a replace with push animation. Does almost the exact same thing as
         * `push()` except we don't push a new entry to the navigation stack.
         * Instead we reuse the current entry.
         *
         * So if you go pop back, you don't go back to the replaced route. You go to
         * the route before.
         */
        replaceWithPushAnimation(url: URL): void;

        /**
         * Works similar to `preparePush()` and `push()` except a modal is displayed
         * from the bottom of the screen and the navigation stack is unchanged.
         */
        preparePresentModal(): void;

        /**
         * Works similar to `preparePush()` and `push()` except a modal is displayed
         * from the bottom of the screen and the navigation stack is unchanged.
         */
        presentModal(): void;

        /**
         * Works similar to `preparePush()` and `push()` except a presented modal is
         * animated offscreen and the navigation stack is unchanged.
         */
        prepareDismissModal(): void;

        /**
         * Works similar to `preparePush()` and `push()` except a presented modal is
         * animated offscreen and the navigation stack is unchanged.
         */
        dismissModal(): void;

        /**
         * Works similar to `preparePush()` and `push()` except no animation occurs
         * when switching tabs but we do need to swap the active navigation stack to
         * the new tab's navigation stack.
         */
        prepareSwitchTab(tab: NativeMobileTab): void;

        /**
         * Works similar to `preparePush()` and `push()` except no animation occurs
         * when switching tabs but we do need to swap the active navigation stack to
         * the new tab's navigation stack.
         */
        switchTab(tab: NativeMobileTab, url: URL): void;

        /**
         * When the user taps on a tab in the native mobile app we call all subscribed
         * listeners to this function with the tab the user tapped on and the URL the
         * native navigation stack thinks should be rendered in the tab. From there,
         * web should start rendering the new tab and perform a navigation with
         * `prepareSwitchTab()`/`switchTab()` when it's done.
         *
         * This flow is similar to `subscribeToExternalPop()`'s eventual external pops.
         * It's different from `subscribeToExternalPop()`'s immediate external pops.
         *
         * With `subscribeToExternalSwitchTab()` while the native tab bar UI
         * will have updated the app stays responsive while the navigation happens.
         * Unlike immediate external pops.
         *
         * Some cases to consider:
         *
         * - Switching to a tab for the first time: This function will be called with
         *   the initial URL as determined by the native app. This may also happen if
         *   the web view reloaded but the native app didn't restart. So web has lost
         *   its navigation stack so native will tell it what the URL should be.
         *
         * - Switching back to a tab...
         *
         *   - ...when the last route in the tab is still rendered by web: We continue
         *     rendering the last ~7 routes in the web app as inert so if the user
         *     switches back to them we can immediately show the route without a
         *     network request.
         *
         *   - ...when the last route in the tab was unmounted by web: If the route is
         *     outside of the ~7 route window then we'll need to send a network request
         *     to fully load the route from scratch.
         *
         *   - ...when native code and web code disagree about what the last route in
         *     the tab was: Both native code and web code maintain a navigation stack
         *     for each tab. If native code sends a URL that's different than what web
         *     has, web will accept native's URL and reset its navigation stack for the
         *     tab. This is likely the sign of a bug! Ideally we want native code and
         *     web code to have the same navigation stacks.
         */
        subscribeToExternalSwitchTab(
            listener: (tab: NativeMobileTab, url: URL) => void,
        ): () => void;

        /**
         * Schedule a callback to run after a push animation completes. The push
         * animation starts when `preparePush()` (or another prepare function) is
         * called and ends when native code calls the animation completion handler.
         *
         * Does not work for external pop navigations.
         */
        scheduleAfterAnimation(action: () => void): void;
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
     * Functions for synchronizing the native code tab bar with web code.
     */
    readonly tabBar: {
        /**
         * The initial tab to use when launching the app. When initializing the native
         * mobile router, first look in `history.state` for the tab. If it doesn't
         * exist there then you may use the initial tab property from here. This way we
         * maintain the proper tab when the app reloads.
         */
        readonly initialTab: NativeMobileTab;

        /**
         * The height of the tab bar in pixels. The tab bar is implemented to animate
         * at the same rate as the navigation bar.
         */
        readonly height: number;

        /**
         * That tab bar's current scroll offset. This is not updated synchronously with
         * the tab bar but rather reconciled every ~100ms or so. Which is why
         * "deferred" is in the name (name comes from [React's
         * `useDeferredValue()`][1]). Useful if you need to know whether the tab bar is
         * visible for some layout calculation just beware that you might get a stale
         * value.
         *
         * [1]: https://react.dev/reference/react/useDeferredValue
         */
        getDeferredScrollOffset(): number;

        /**
         * Is the tab bar hidden by web code? So either `tabBar.hide()`
         * was called or `keyboard.prepareForSubstitute()` was called.
         *
         * Will return true otherwise. So the tab bar may be hidden if the user has
         * scrolled down but this function won't report that.
         */
        isHidden(): boolean;

        /**
         * Hide the tab bar. The tab bar will only be show again once `unhide()`
         * is called. If there are multiple calls to `hide()` you need that
         * many calls to `unhide()` to reveal the tab bar again.
         *
         * This function is dangerous! You must remember to call `unhide()` or
         * else the app will feel broken as the user won't be able to access the tab
         * bar.
         */
        hide(options?: {isAnimated: boolean}): void;

        /**
         * Show the tab bar after it was hidden by `hide()`.
         */
        unhide(options?: {isAnimated: boolean}): void;

        /**
         * Clears any notification badge on the inbox tab in the native mobile app. If
         * a tab bar is visible for this web process.
         */
        clearInboxNotificationBadge(): void;

        /**
         * Sets the notification badge on our inbox tab to the provided loud
         * notification count. If a tab bar is visible for this web process.
         */
        setInboxLoudNotificationBadge(loudNotificationCount: number): void;

        /**
         * Sets a subtle notification badge on our inbox tab. If a tab bar is visible
         * for this web process.
         */
        setInboxSubtleNotificationBadge(): void;
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
         *
         * This function is also called if the keyboard height changes. For example
         * when you switch keyboard layout (like when you switch to the emoji picker).
         *
         * - `coveredHeightDelta` is the difference between the new keyboard height and
         *   the old keyboard height excluding the space occupied by the tab bar. When
         *   you need to scroll content at the bottom of the screen out of the way of
         *   the keyboard (like in chats), you only want to scroll the space newly
         *   covered by the keyboard. The tab bar already covers some content so the
         *   keyboard space that now covers the tab bar doesn't make a difference on
         *   visible content.
         *
         * - `newHeight` is the keyboard's current height.
         *
         * - `oldHeight` is the keyboard's height before the frame change.
         *   `newHeight - oldHeight` will give you the height delta including tab bar
         *   space.
         *
         * IMPORTANT: Most of the time you shouldn't subscribe with this function and
         * should instead use `subscribeToMobileKeyboardFrameChange()`. Since you may
         * want to scroll in response to the keyboard opening when not in our native
         * mobile app environment.
         */
        subscribeToFrameChange(
            listener: (event: {
                oldKeyboardHeight: number;
                newKeyboardHeight: number;
                shouldScroll: boolean;
                isAnimated: boolean;
            }) => void,
        ): () => void;

        /**
         * Is a keyboard substitute open? True if `prepareForSubstitute()` was called
         * and `cleanupAfterSubstitute()` has not been called yet.
         */
        isSubstituteOpen(): boolean;

        /**
         * Web code may choose to substitute out the native keyboard with some custom
         * UI if useful. This is used in content editors to provide advanced formatting
         * options to the user.
         *
         * Calling this function will close the keyboard while maintaining focus and
         * will resolve once the keyboard has finished closing. Once this function
         * resolves web code may display the substitute keyboard.
         *
         * You MUST call `cleanupAfterSubstitute()` when done with your substitute
         * keyboard. Either after the user hits a close button or the editor unfocuses
         * or your component unmounts. If you don't the user will be stuck in a state
         * where they can never see the native keyboard! This is very bad.
         */
        prepareForSubstitute(): Promise<void>;

        /**
         * After the user is done with your web code substitute keyboard, call this
         * function and the native keyboard will reappear if the editor still has
         * focus. If the editor doesn't have focus then the native keyboard will appear
         * next time you focus a text input.
         *
         * You MUST call this function after `prepareForSubstitute()` otherwise the
         * user will be stuck in a very bad state where they can't open the native text
         * input keyboard.
         */
        cleanupAfterSubstitute(): Promise<void>;

        /**
         * Schedule a callback to run after keyboard show/hide animations complete. If
         * no keyboard animation is running then the callback will be fired
         * immediately.
         */
        scheduleAfterAnimation(action: () => void): void;
    };

    /**
     * Functions for interacting with native rendered scrollbars.
     */
    readonly scrollbar: {
        /**
         * Update all scrollbar insets. Native automatically updates scrollbar insets
         * after many events but not every possible update. Notably we don't
         * automatically adjust scrollbar insets after the scroll view itself moves.
         * Which can cause problems for components like `<DocumentContentEditor>` which
         * animate their comment thread scroll views up and down.
         */
        updateAllInsets(): void;
    };

    /**
     * Functions for rendering modals in native code. It's useful to render modals
     * in native code because they can cover the tab bar (which is rendered in
     * native code).
     *
     * If you want to render a fullscreen modal sheet with web rendering you use
     * `navigation.preparePresentModal()` instead.
     */
    readonly modal: {
        /**
         * Present a confirmation dialog using native UI. Used by the `<ModalDialog>`
         * component in native mobile apps to render using platform conventions. It has
         * very similar props to `<ModalDialog>`.
         */
        presentDialog(options: {
            title: string;
            description: string;
            primaryButtonLabel: string;
            isPrimaryButtonDisabled?: boolean;
            onPrimaryButtonPress: () => MaybePromise<void>;
            cancelButtonLabel?: string;
            onCancelButtonPress?: () => MaybePromise<void>;
            shouldHideCancelButton?: boolean;
        }): void;
    };

    /**
     * When the user makes a text selection, native platforms like iOS show a menu
     * of options above the selection including options like "Copy" and "Paste".
     * This is called the edit menu.
     *
     * You may use these functions to configure the edit menu.
     */
    readonly editMenu: {
        /**
         * Enable an "Add comment" option in the edit menu. Used by documents to
         * provide convenient access to commenting even when the document isn't
         * editable.
         *
         * If the option is already enabled, this is a noop.
         */
        enableAddCommentAction(): void;

        /**
         * Disable the "Add comment" option. If the option is already disabled, this is
         * a noop.
         */
        disableAddCommentAction(): void;

        /**
         * If the user selects the "Add comment" option from the edit menu this
         * function is fired.
         */
        subscribeToAddCommentAction(listener: () => void): () => void;
    };

    /**
     * Methods related to registering and handling push notifications from the
     * native platform's push notification service. There may be methods that only
     * work on one platform or another.
     */
    readonly notifications: {
        /**
         * Take any Apple device tokens needed for sending push notifications from our
         * server. To watch for when new device tokens become available call
         * `subscribeToAppleDeviceTokensUpdate()`. When you call this function, it'll
         * only return each device token once. So you may get a device token in a first
         * call and in subsequent calls you will never receive another device token.
         *
         * To learn more about this process from the native iOS code side read
         * "[Registering your app with APNs][1]."
         *
         * We call these "Apple device tokens" instead of "iOS device tokens" because
         * MacOS native apps use the same format.
         *
         * [1]: https://developer.apple.com/documentation/usernotifications/registering-your-app-with-apns
         */
        takeAppleDeviceTokens(): Promise<ReadonlyArray<Uint8Array>>;

        /**
         * Calls any subscribed listeners whenever there are new Apple device tokens.
         * Call `takeAppleDeviceTokens()` to get those tokens.
         * `takeAppleDeviceTokens()` will only return new device tokens the first time
         * it's called.
         */
        subscribeToAppleDeviceTokensUpdate(listener: () => void): () => void;
    };

    /**
     * Helpers for playing haptic feedback using the mobile device's haptic
     * feedback engine. Haptic feedback effect names use the names from iOS.
     * For other operating system's, find equivalent haptic feedback effects for
     * the task.
     */
    readonly haptic: {
        /**
         * Play a light impact haptic feedback effect.
         *
         * Corresponds to [`UIImpactFeedbackGenerator`'s][1] `light` style.
         *
         * [1]: https://developer.apple.com/documentation/uikit/uiimpactfeedbackgenerator
         */
        playLightImpact(): void;

        /**
         * Play a medium impact haptic feedback effect.
         *
         * Corresponds to [`UIImpactFeedbackGenerator`'s][1] `medium` style.
         *
         * [1]: https://developer.apple.com/documentation/uikit/uiimpactfeedbackgenerator
         */
        playMediumImpact(): void;

        /**
         * Play a heavy impact haptic feedback effect.
         *
         * Corresponds to [`UIImpactFeedbackGenerator`'s][1] `heavy` style.
         *
         * [1]: https://developer.apple.com/documentation/uikit/uiimpactfeedbackgenerator
         */
        playHeavyImpact(): void;

        /**
         * Play a haptic feedback effect for when the selection changes.
         *
         * Corresponds to [`UISelectionFeedbackGenerator`][1].
         *
         * [1]: https://developer.apple.com/documentation/uikit/uiselectionfeedbackgenerator
         */
        playSelectionChanged(): void;
    };
} | null = typeof window !== "undefined" ? ((window as any).__NativeMobileBridge ?? null) : null;
