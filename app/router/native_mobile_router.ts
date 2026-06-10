import {
    Action,
    History,
    HydrationState,
    Location,
    Path,
    Router,
    FutureConfig as RouterFutureConfig,
    RouterState,
    StaticHandlerContext,
    To,
    createPath,
    createRouter,
    parsePath,
} from "@remix-run/router";
import {FutureConfig, UNSAFE_mapRouteProperties as mapRouteProperties} from "react-router";
import {RouteObject} from "react-router-dom";
import {createStaticRouter} from "react-router-dom/server.js";
import {isTextInputElement} from "~/client/web/helpers/elements/is_text_input_element.js";
import {
    NativeMobileBridge,
    NativeMobileTab,
    isNativeMobileTab,
} from "~/client/web/remix/native_mobile_bridge.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {getObjectEntriesWithKeyofType} from "~/shared/helpers/object/get_object_entries_with_keyof_type.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";

/**
 * The native mobile router keeps track of inert routes so we can keep those routes
 * rendered in the DOM. That way when the user pops back to an inert route it can
 * be revived with the same state it had when it left the view.
 */
export type NativeMobileRouter = Router & {
    get state(): NativeMobileRouterState;
    subscribe(fn: (state: NativeMobileRouterState) => void): () => void;
};

const isNativeMobileRouterStateSymbol = Symbol("isNativeMobileRouterState");

export type NativeMobileRouterState = RouterState & {
    readonly [isNativeMobileRouterStateSymbol]: true;
    readonly entryKey: string;
    readonly inertRouterStates: ReadonlyArray<{
        readonly entryKey: string;
        readonly routerState: RouterState;
    }>;
};

/**
 * Is the provided Remix router a native mobile router?
 */
export function isNativeMobileRouterState(
    router:
        | (RouterState & {[isNativeMobileRouterStateSymbol]?: undefined})
        | NativeMobileRouterState,
): router is NativeMobileRouterState {
    return !!router[isNativeMobileRouterStateSymbol];
}

/**
 * Create a router for our native mobile apps. The difference between a native
 * mobile app router and `@remix-run/router`'s router is that we remember old
 * router states on navigation and include them in a `inertRouterStates` property
 * so they can be rendered to the DOM.
 */
export function createNativeMobileRouterWithoutInitialization(
    routes: Array<RouteObject>,
    opts?: {
        basename?: string;
        future?: Partial<Omit<FutureConfig, "v7_prependBasename">>;
        hydrationData?: HydrationState;
        window?: Window;
    },
): NativeMobileRouter {
    assert(NativeMobileBridge);

    const history = new NativeMobileMemoryHistory();
    let waitForKeyboardAnimationPromise: Promise<void> | undefined;

    const routerBase = createRouter({
        basename: opts?.basename,
        future: {
            ...opts?.future,
            v7_prependBasename: true,
        },
        history,
        hydrationData: opts?.hydrationData,
        routes,
        mapRouteProperties,
        // Wait for the keyboard animation to finish before completing our navigation.
        unstable_onWillCompleteNavigation: () => waitForKeyboardAnimationPromise,
    });

    history.initializeRouter(routerBase);

    let unsubscribeFromBridge1: (() => void) | undefined;
    let unsubscribeFromBridge2: (() => void) | undefined;

    let stateEntryKey = history.getEntryKey();
    let stateInertRouterStates = history.getInertRouterStates();

    const router: NativeMobileRouter = {
        get basename() {
            return routerBase.basename;
        },
        get future() {
            return routerBase.future;
        },
        get state() {
            const state: any = routerBase.state;

            if (!state[isNativeMobileRouterStateSymbol]) {
                // Should be non-enumerable so that a spread doesn't copy the property.
                Object.defineProperty(state, isNativeMobileRouterStateSymbol, {
                    value: true,
                    enumerable: false,
                });

                // Only update `inertRouterStates` once the router is done loading.
                //
                // History may start a tab switch or pop navigation that requires us to load a new
                // page. When this happens the router state will enter a loading state. We don't
                // want to set the `inertRouterStates` for the new location while it's loading.
                // Otherwise we end up rendering the same route twice!
                if (
                    state.navigation.state !== "loading" ||
                    state.navigation.location.key !== history.location.key
                ) {
                    stateEntryKey = history.getEntryKey();
                    stateInertRouterStates = history.getInertRouterStates();
                }

                state.entryKey = stateEntryKey;
                state.inertRouterStates = stateInertRouterStates;
            }

            return state as NativeMobileRouterState;
        },
        get routes() {
            return routerBase.routes;
        },
        get window() {
            return routerBase.window;
        },
        subscribe: fn => {
            return routerBase.subscribe((state: any, opts) => {
                if (!state[isNativeMobileRouterStateSymbol]) {
                    // Should be non-enumerable so that a spread doesn't copy the property.
                    Object.defineProperty(state, isNativeMobileRouterStateSymbol, {
                        value: true,
                        enumerable: false,
                    });

                    // Only update `inertRouterStates` once the router is done loading.
                    //
                    // History may start a tab switch or pop navigation that requires us to load a new
                    // page. When this happens the router state will enter a loading state. We don't
                    // want to set the `inertRouterStates` for the new location while it's loading.
                    // Otherwise we end up rendering the same route twice!
                    if (
                        state.navigation.state !== "loading" ||
                        state.navigation.location.key !== history.location.key
                    ) {
                        stateEntryKey = history.getEntryKey();
                        stateInertRouterStates = history.getInertRouterStates();
                    }

                    state.entryKey = stateEntryKey;
                    state.inertRouterStates = stateInertRouterStates;
                }

                return fn(state as NativeMobileRouterState, opts);
            });
        },
        enableScrollRestoration: routerBase.enableScrollRestoration.bind(routerBase),
        navigate: (...args) => {
            // If no `tab` is provided in state, then use the current `tab` from
            // `router.state.location` since that's the location the user currently sees.
            //
            // The location the user currently sees may be different from `history.location`
            // while the router is loading a new route (the loading location is in
            // `router.state.navigation.location` when `router.state.navigation.state` is
            // `"loading"` and should be the same as `history.location`).
            if (typeof args[0] !== "number") {
                args[1] ??= {};

                const oldTab = getLocationNativeMobileTab(routerBase.state.location);
                const newTab = getLocationStateNativeMobileTab((args[1] as any).state, oldTab);

                (args[1] as any).state = {
                    ...(args[1] as any).state,
                    tab: newTab,
                    // If the user is switching tabs, mark that in state.
                    ...(oldTab !== newTab ? {isTabSwitch: true} : {}),
                };
            }

            // Close keyboard before navigating if we're about to animate. We don't animate the
            // navigation on replace.
            if (
                typeof args[0] === "number" ||
                !(args[1] as any)?.replace ||
                // Make sure to wait until the keyboard closes if we're navigating with
                // `replace: true` but also `withPushAnimation: true`.
                (args[1] as any)?.state?.withPushAnimation
            ) {
                // When a navigation is performed and we have a focused text input element, blur
                // it. We want to wait for the virtual keyboard to close before navigating so we
                // don't end up with snapshots of partially animated bottom bar elements.
                if (isTextInputElement(document.activeElement)) {
                    document.activeElement.blur();
                }

                if (!waitForKeyboardAnimationPromise) {
                    waitForKeyboardAnimationPromise = new Promise<void>(resolve =>
                        NativeMobileBridge!.keyboard.scheduleAfterAnimation(resolve),
                    );
                    void waitForKeyboardAnimationPromise.finally(() => {
                        waitForKeyboardAnimationPromise = undefined;
                    });
                }
            }

            return (routerBase as any).navigate(...args);
        },
        fetch: (key, routeId, href, options) => {
            // If this is a fetch from a form, close the keyboard.
            if (options && ("formData" in options || "body" in options)) {
                // When a navigation is performed and we have a focused text input element, blur
                // it. We want to wait for the virtual keyboard to close before navigating so we
                // don't end up with snapshots of partially animated bottom bar elements.
                if (isTextInputElement(document.activeElement)) {
                    document.activeElement.blur();
                }

                if (!waitForKeyboardAnimationPromise) {
                    waitForKeyboardAnimationPromise = new Promise<void>(resolve =>
                        NativeMobileBridge!.keyboard.scheduleAfterAnimation(resolve),
                    );
                    void waitForKeyboardAnimationPromise.finally(() => {
                        waitForKeyboardAnimationPromise = undefined;
                    });
                }
            }

            return routerBase.fetch(key, routeId, href, options);
        },
        revalidate: routerBase.revalidate.bind(routerBase),
        createHref: routerBase.createHref.bind(routerBase),
        encodeLocation: routerBase.encodeLocation.bind(routerBase),
        getFetcher: routerBase.getFetcher.bind(routerBase),
        deleteFetcher: routerBase.deleteFetcher.bind(routerBase),
        getBlocker: routerBase.getBlocker.bind(routerBase),
        deleteBlocker: routerBase.deleteBlocker.bind(routerBase),
        _internalSetRoutes: routerBase._internalSetRoutes.bind(routerBase),
        _internalFetchControllers: routerBase._internalFetchControllers,
        _internalActiveDeferreds: routerBase._internalActiveDeferreds,
        unstable_unsafelyRestoreNavigation:
            routerBase.unstable_unsafelyRestoreNavigation.bind(routerBase),

        initialize: () => {
            // When native initiates a pop navigation, we need to execute the pop navigation on
            // the web side.
            unsubscribeFromBridge1 = NativeMobileBridge!.navigation.subscribeToExternalPop(
                (delta, url) => {
                    history.goFromExternal(-delta, url);
                },
            );

            unsubscribeFromBridge2 = NativeMobileBridge!.navigation.subscribeToExternalSwitchTab(
                (tab, url) => {
                    history.switchTabFromExternal(tab, url).catch(scheduleUncaughtError);
                },
            );

            return routerBase.initialize();
        },

        dispose: () => {
            routerBase.dispose();
            unsubscribeFromBridge1?.();
            unsubscribeFromBridge2?.();
        },
    };

    return router;
}

/**
 * `createNativeMobileRouterWithoutInitialization()` but for use in server-side
 * rendering.
 */
export function createNativeMobileStaticRouter(
    routes: Array<RouteObject>,
    context: StaticHandlerContext,
    options?: {
        future?: Partial<Pick<RouterFutureConfig, "v7_partialHydration" | "v7_relativeSplatPath">>;
    },
) {
    const routerBase = createStaticRouter(routes, context, options);

    const router: NativeMobileRouter = {
        get basename() {
            return routerBase.basename;
        },
        get future() {
            return routerBase.future;
        },
        get state() {
            const state: any = routerBase.state;

            if (!state[isNativeMobileRouterStateSymbol]) {
                // Should be non-enumerable so that a spread doesn't copy the property.
                Object.defineProperty(state, isNativeMobileRouterStateSymbol, {
                    value: true,
                    enumerable: false,
                });

                state.inertRouterStates = [];

                // When hydrating, React only needs identical HTML output. It's ok if JSX `key`s
                // are different on the client and on the server as long as they're not included in
                // the DOM.
                //
                // Typically the initial entry key used on the client will be `Home-0`. However, if
                // our initial tab is not `Home` then it'll be something else. Instead of trying to
                // communicate the correct tab to the server we always use the string `Static`.
                state.entryKey = "Static";
            }

            return state as NativeMobileRouterState;
        },
        get routes() {
            return routerBase.routes;
        },
        get window() {
            return routerBase.window;
        },
        subscribe: fn => {
            return routerBase.subscribe((state: any, opts) => {
                if (!state[isNativeMobileRouterStateSymbol]) {
                    // Should be non-enumerable so that a spread doesn't copy the property.
                    Object.defineProperty(state, isNativeMobileRouterStateSymbol, {
                        value: true,
                        enumerable: false,
                    });

                    state.inertRouterStates = [];

                    // When hydrating, React only needs identical HTML output. It's ok if JSX `key`s
                    // are different on the client and on the server as long as they're not included in
                    // the DOM.
                    //
                    // Typically the initial entry key used on the client will be `Home-0`. However, if
                    // our initial tab is not `Home` then it'll be something else. Instead of trying to
                    // communicate the correct tab to the server we always use the string `Static`.
                    state.entryKey = "Static";
                }

                return fn(state as NativeMobileRouterState, opts);
            });
        },
        enableScrollRestoration: routerBase.enableScrollRestoration.bind(routerBase),
        navigate: routerBase.navigate.bind(routerBase),
        fetch: routerBase.fetch.bind(routerBase),
        revalidate: routerBase.revalidate.bind(routerBase),
        createHref: routerBase.createHref.bind(routerBase),
        encodeLocation: routerBase.encodeLocation.bind(routerBase),
        getFetcher: routerBase.getFetcher.bind(routerBase),
        deleteFetcher: routerBase.deleteFetcher.bind(routerBase),
        getBlocker: routerBase.getBlocker.bind(routerBase),
        deleteBlocker: routerBase.deleteBlocker.bind(routerBase),
        _internalSetRoutes: routerBase._internalSetRoutes.bind(routerBase),
        _internalFetchControllers: routerBase._internalFetchControllers,
        _internalActiveDeferreds: routerBase._internalActiveDeferreds,
        unstable_unsafelyRestoreNavigation:
            // NOTE(calebmer): Optional because we don't patch `react-router-dom` to implement
            // a throwing version of `_internalUnsafelyRestoreNavigation`.
            routerBase.unstable_unsafelyRestoreNavigation?.bind(routerBase),

        initialize: routerBase.initialize.bind(routerBase),
        dispose: routerBase.dispose.bind(routerBase),
    };

    return router;
}

/**
 * Maximum number of inert routes we'll keep rendered at a time. The total number
 * of routes we want to render is 8 so the number of inert routes we'll keep is one
 * less than that, 7.
 */
const maxNativeMobileMemoryHistoryInertRouterStateCount = 7;

/**
 * Custom in-memory history for our native mobile apps. Differs from
 * [`@remix-run/router`'s `createMemoryHistory()`][1] in that we remember old
 * router states such that calls like `go(-1)` can restore the state without
 * needing to send then wait on a network request.
 *
 * [1]:
 *     https://github.com/remix-run/react-router/blob/09b6cbeabb02ffaccc3d5a6ca751b9f5221b0d5b/packages/router/history.ts#L227
 */
export class NativeMobileMemoryHistory implements History {
    private _router: Router | undefined;

    private _action = Action.Pop;
    private _currentEntryLocation: Location;

    /**
     * History stack by tab. Each tab has its own history stack, much like a browser
     * tab.
     *
     * In our native mobile app we keep rendering previous routes (up to a limit) so
     * that if the user returns to the route we can immediately render it without
     * needing to make a network request. Routes we're preserving have a non-null
     * `inertRouterState`. If the user has navigated past our limit then we start
     * setting old history entries `inertRouterState` to null to free resources.
     *
     * `inertRouterStateTabOrder` maintains the order in which the user has navigated
     * across tabs. When we need to drop an old inert route we drop the last route the
     * user navigated to in this array. Each time a tab appears in
     * `inertRouterStateTabOrder` there will be 1 non-null `inertRouterState` in this
     * map for the same tab at the end of the tab's entries array. For example, if the
     * `Home` tab appears in `inertRouterStateTabOrder` 5 times then the last 5 `Home`
     * entries in this map will have a non-null `inertRouterState` and if the `Inbox`
     * tab appears in `inertRouterStateTabOrder` 2 times then the last 2 `Inbox`
     * entries in this map will have a non-null `inertRouterState`.
     *
     * The `getInertRouterStates()` function has some assertions to make sure these two
     * properties are consistent with one another. Its implementation may help you
     * understand the relationship between these two properties.
     */
    private _pastEntriesByTab: Record<
        NativeMobileTab,
        Array<{location: Location; inertRouterState: RouterState | null}>
    >;

    private _inertRouterStateTabOrder: Array<NativeMobileTab> = [];

    private _listener:
        | ((update: {action: Action; location: Location; delta: number | null}) => void)
        | null = null;

    constructor() {
        const historyState = (history.state && history.state.usr) || null;
        const historyTab = getLocationStateNativeMobileTab(
            historyState,
            NativeMobileBridge!.tabBar.initialTab,
        );

        // Use initial browser history:
        // https://github.com/remix-run/react-router/blob/09b6cbeabb02ffaccc3d5a6ca751b9f5221b0d5b/packages/router/history.ts#L365-L371
        this._currentEntryLocation = createLocation(
            "",
            {
                pathname: window.location.pathname,
                search: window.location.search,
                hash: window.location.hash,
            },
            {...historyState, tab: historyTab},
            (history.state && history.state.key) || "default",
        );

        this._pastEntriesByTab = {
            Home: [],
            Search: [],
            Create: [],
            Inbox: [],
            More: [],
        };
    }

    public initializeRouter(router: Router) {
        assert(!this._router);
        this._router = router;
    }

    public get action(): Action {
        return this._action;
    }

    public get location(): Location {
        return this._currentEntryLocation;
    }

    public getEntryKey(): string {
        const tab = getLocationNativeMobileTab(this._currentEntryLocation);

        // As a convenience we print numbers as `001`, `002`, `003`, etc. That way they're
        // lexicographically orderable. When we render inert routes we sort them
        // lexicographically by key. Numbers over 4 digits aren't lexicographically
        // orderable but that's ok. It's not required for these keys to be orderable it's
        // merely a quality of life thing for developers so they can more easily find
        // routes in the DOM.
        return `${tab}-${this._pastEntriesByTab[tab].length.toString().padStart(3, "0")}`;
    }

    public getInertRouterStates(): Array<{entryKey: string; routerState: RouterState}> {
        const inertRouterStates: Array<{entryKey: string; routerState: RouterState}> = [];

        const countByTab: Record<NativeMobileTab, number> = {
            Home: 0,
            Search: 0,
            Create: 0,
            Inbox: 0,
            More: 0,
        };

        for (
            let inertRouterStateTabIndex = this._inertRouterStateTabOrder.length - 1;
            inertRouterStateTabIndex >= 0;
            inertRouterStateTabIndex--
        ) {
            const tab = this._inertRouterStateTabOrder[inertRouterStateTabIndex]!;
            const pastEntries = this._pastEntriesByTab[tab];
            const count = countByTab[tab];
            countByTab[tab] += 1;
            const pastEntryIndex = pastEntries.length - 1 - count;

            inertRouterStates.push({
                entryKey: `${tab}-${pastEntryIndex.toString().padStart(3, "0")}`,
                routerState: assertExists(pastEntries[pastEntryIndex]!.inertRouterState),
            });
        }

        inertRouterStates.reverse();

        // Assert that:
        //
        // 1. We don't have more inert routes than our maximum
        // 2. All past entries that aren't inert routes have a `null` router state
        if (process.env.NODE_ENV !== "production") {
            assert(inertRouterStates.length <= maxNativeMobileMemoryHistoryInertRouterStateCount);

            for (const [tab, count] of getObjectEntriesWithKeyofType(countByTab)) {
                const pastEntries = this._pastEntriesByTab[tab];

                for (let i = 0; i < pastEntries.length - count; i++) {
                    assert(pastEntries[i]!.inertRouterState === null);
                }
            }
        }

        return inertRouterStates;
    }

    public createHref(to: To): string {
        return typeof to === "string" ? to : createPath(to);
    }

    public createURL(to: To): URL {
        // The built-in memory router creates URLs to `http://localhost`. Instead create
        // URLs to the domain our app is loaded under.
        // https://github.com/remix-run/react-router/blob/09b6cbeabb02ffaccc3d5a6ca751b9f5221b0d5b/packages/router/history.ts#L287
        return new URL(this.createHref(to), window.location.origin);
    }

    public encodeLocation(to: To): Path {
        const path = typeof to === "string" ? parsePath(to) : to;

        return {
            pathname: path.pathname ?? "",
            search: path.search ?? "",
            hash: path.hash ?? "",
        };
    }

    /**
     * Updates our internal state after a push navigation. The `router` calls this
     * function when the `router` has finished updating its internal state and now
     * needs to update the browser's history.
     *
     * This function must be called by `router`. It does not report a URL change to
     * `router` so `router` must initiate the push state transition then call this
     * function to update the browser.
     */
    public push(to: To, state?: any) {
        const oldTab = getLocationNativeMobileTab(this._currentEntryLocation);
        const newTab = getLocationStateNativeMobileTab(state, oldTab);

        this._pastEntriesByTab[oldTab].push({
            location: this._currentEntryLocation,
            inertRouterState: this._router!.state,
        });

        // If the tab changed then `isTabSwitch` should be true. If the tab didn't change
        // `isTabSwitch` should be false (or shouldn't exist). `switchTabFromExternal()`
        // and `router.navigate()` should take care of this.
        //
        // If this is throwing an error the most likely explanation is some race condition
        // involving Remix cancelling a navigation. This assert might not be necessary but
        // wanted to write down my expectation for this code.
        //
        // We can't set `isTabSwitch` in this function since `push()` is called after
        // `router.navigate()` updates Remix's state. `isTabSwitch` is important since it
        // controls how our native mobile app interprets the navigation.
        assert(!!state?.isTabSwitch === (oldTab !== newTab));

        if (oldTab === newTab) {
            this._inertRouterStateTabOrder.push(oldTab);
        }
        // Move the inert router states of the tab we're switching to into the front of the
        // inert router state tab order. So we lose these tabs last as the user pushes new
        // routes.
        else {
            const oldInertRouterStateTabOrder = this._inertRouterStateTabOrder;
            this._inertRouterStateTabOrder = [];
            let inertRouterStateTabCount = 0;

            for (const inertRouterStateTab of oldInertRouterStateTabOrder) {
                if (inertRouterStateTab === newTab) {
                    inertRouterStateTabCount += 1;
                } else {
                    this._inertRouterStateTabOrder.push(inertRouterStateTab);
                }
            }

            this._inertRouterStateTabOrder.push(oldTab);

            for (let i = 0; i < inertRouterStateTabCount; i++) {
                this._inertRouterStateTabOrder.push(newTab);
            }
        }
        this._truncateInertRouterStateTabOrder();

        this._action = Action.Push;
        this._currentEntryLocation = createLocation(this._currentEntryLocation.pathname, to, {
            ...state,
            tab: newTab,
        });

        // Make sure browser URL reflects history object. We don't respect changes to
        // browser history.
        window.history.replaceState(
            {key: this._currentEntryLocation.key, usr: this._currentEntryLocation.state},
            "",
            this.createHref(this._currentEntryLocation),
        );
    }

    /**
     * Updates our internal state after a replace navigation. The `router` calls this
     * function when the `router` has finished updating its internal state and now
     * needs to update the browser's history.
     */
    public replace(to: To, state?: any) {
        this._action = Action.Replace;

        const currentTab = getLocationNativeMobileTab(this._currentEntryLocation);

        assert(
            currentTab === getLocationStateNativeMobileTab(state, currentTab),
            "Can\u2019t change tabs with `history.replace()`",
        );

        this._currentEntryLocation = createLocation(this._currentEntryLocation.pathname, to, {
            ...state,
            // We're in the same tab as our current location.
            tab: currentTab,
        });

        // Make sure browser URL reflects history object. We don't respect changes to
        // browser history.
        window.history.replaceState(
            {key: this._currentEntryLocation.key, usr: this._currentEntryLocation.state},
            "",
            this.createHref(this._currentEntryLocation),
        );
    }

    public go(delta: number) {
        this._go(delta, null);
    }

    /**
     * A native interaction is causing us to go backwards in history. (e.g. User swiped
     * back from the left edge of their screen.) Since what native code believes the
     * history stack to be may differ from what web code thinks, native provides a
     * `url` to reconcile the difference.
     */
    public goFromExternal(delta: number, url: URL) {
        this._go(delta, url);
    }

    /**
     * Initiates a navigation backwards through the history stack. We don't support
     * "forward" navigations in our native mobile app (unlike mobile web). Only back
     * navigations.
     *
     * This function notifies `router` that the URL changed then `router` will update
     * its internal state. `router` does not keep track of the app's browser history so
     * can't know what the previous URL is until history tells it. This is unlike how
     * `push()` works since `router` calls `push()` _after_ `router` has updated its
     * own internal state.
     *
     * If we're navigating back to an inert route then we'll tell `router` to replace
     * its state with an inert router state instead of making a network request.
     */
    private _go(delta: number, urlFromExternal: URL | null) {
        // We don't support "forward" navigations in our native mobile app. If you go back,
        // it destroys the state for the route you were looking at.
        //
        // In native iOS navigation there is no "forward" action. You can only push/pop
        // onto the navigation stack.
        if (delta >= 0) return;

        const currentTab = getLocationNativeMobileTab(this._currentEntryLocation);
        let pastEntries = this._pastEntriesByTab[currentTab];

        if (-delta > pastEntries.length) {
            // If this is not a navigation from native, clamp `delta`.
            if (urlFromExternal === null) {
                // If web code doesn't know about any past entries we can't perform a pop. Request
                // native code to perform a pop since it may know about previous navigation entries
                // if our web view reloaded.
                if (pastEntries.length === 0) {
                    NativeMobileBridge!.navigation.requestEventualExternalPop();
                    return;
                }

                delta = -pastEntries.length;
            }
            // If native is asking us to go back further than the entries we have in memory,
            // reset our history. We'll need to reload the URL from scratch.
            //
            // This can happen when the web view reloads while the app is open. Native code
            // will remember the navigation stack but web code won't. So navigating back will
            // take longer.
            else {
                this._pastEntriesByTab[currentTab] = pastEntries = [];
                this._inertRouterStateTabOrder = this._inertRouterStateTabOrder.filter(
                    tab => tab !== currentTab,
                );

                this._action = Action.Pop;
                this._currentEntryLocation = createLocation(
                    this._currentEntryLocation.pathname,
                    {
                        pathname: urlFromExternal.pathname,
                        search: urlFromExternal.search,
                        hash: urlFromExternal.hash,
                    },
                    {tab: currentTab},
                );

                // Make sure browser URL reflects history object. We don't respect changes to
                // browser history.
                window.history.replaceState(
                    {key: this._currentEntryLocation.key, usr: this._currentEntryLocation.state},
                    "",
                    this.createHref(this._currentEntryLocation),
                );

                // Make sure `@remix-run/router` kicks off a new navigation.
                this._listener?.({
                    action: this._action,
                    location: this._currentEntryLocation,
                    delta: null,
                });
                return;
            }
        }

        this._action = Action.Pop;

        let inertRouterState: RouterState | null = null;
        for (let i = 0; i < -delta; i++) {
            const pastEntry = pastEntries.pop()!;

            // Location from `pastEntriesByTab` should have `tab` state correctly set.
            assert(pastEntry.location.state?.tab === currentTab);

            this._currentEntryLocation = pastEntry.location;
            inertRouterState = pastEntry.inertRouterState;

            const inertRouterStateTabIndex = this._inertRouterStateTabOrder.lastIndexOf(currentTab);
            if (inertRouterStateTabIndex !== -1) {
                this._inertRouterStateTabOrder.splice(inertRouterStateTabIndex, 1);
            }
        }

        this._currentEntryLocation = {
            ...this._currentEntryLocation,
            // When navigating back to a location, remove flags that configured the navigation.
            state: omitObject(this._currentEntryLocation.state, [
                "isNotFromExternal",
                "isTabSwitch",
            ]),
        };

        // If our location is NOT from an external pop, `isNotFromExternal` should be set
        // to true.
        if (urlFromExternal === null) {
            this._currentEntryLocation = {
                ...this._currentEntryLocation,
                state: {
                    ...this._currentEntryLocation.state,
                    isNotFromExternal: true,
                },
            };
        }

        // If native expects going back `delta` entries to be a different URL than what we
        // actually have in memory, then web code and native code are out of sync! Prefer
        // the URL from native code (since it initiated this navigation) and reset our
        // history state.
        if (
            urlFromExternal !== null &&
            this.createHref(this._currentEntryLocation) !== this.createHref(urlFromExternal)
        ) {
            this._pastEntriesByTab[currentTab] = pastEntries = [];
            this._inertRouterStateTabOrder = this._inertRouterStateTabOrder.filter(
                tab => tab !== currentTab,
            );

            this._action = Action.Pop;
            this._currentEntryLocation = createLocation(
                this._currentEntryLocation.pathname,
                {
                    pathname: urlFromExternal.pathname,
                    search: urlFromExternal.search,
                    hash: urlFromExternal.hash,
                },
                {tab: currentTab},
            );

            // Make sure browser URL reflects history object. We don't respect changes to
            // browser history.
            window.history.replaceState(
                {key: this._currentEntryLocation.key, usr: this._currentEntryLocation.state},
                "",
                this.createHref(this._currentEntryLocation),
            );

            // Make sure `@remix-run/router` kicks off a new navigation.
            this._listener?.({
                action: this._action,
                location: this._currentEntryLocation,
                delta: null,
            });
            return;
        }

        // Make sure browser URL reflects history object with a replace. This means the
        // browser won't have the right history stack but that's ok. The native mobile
        // router manages history state.
        window.history.replaceState(
            {key: this._currentEntryLocation.key, usr: this._currentEntryLocation.state},
            "",
            this.createHref(this._currentEntryLocation),
        );

        // If the entry we're navigating back to was inert we should be able to unsafely
        // restore the route. Otherwise we need to fully mount the route from scratch.
        if (inertRouterState === null) {
            // Make sure `@remix-run/router` kicks off a new navigation.
            this._listener?.({
                action: this._action,
                location: this._currentEntryLocation,
                delta: null,
            });
        } else {
            // Instead of calling `_listener` which [`createMemoryHistory()` does][1], directly
            // initiate a navigation in our router. This is a special kind of navigation,
            // though, that restores a previous router state without triggering asynchronous
            // navigations.
            //
            // [1]:
            //     https://github.com/remix-run/react-router/blob/09b6cbeabb02ffaccc3d5a6ca751b9f5221b0d5b/packages/router/history.ts#L319-L321
            void this._router!.unstable_unsafelyRestoreNavigation({
                historyAction: Action.Pop,
                // Use `this._currentEntryLocation` instead of `routerState.location` since we may
                // modify the state of `this._currentEntryLocation`. They should be the same.
                location: this._currentEntryLocation,
                matches: inertRouterState.matches,
                // Leave scroll position alone. We'll have kept the route mounted so it should have
                // the right scroll position still stored in its DOM.
                restoreScrollPosition: false,
                preventScrollReset: true,
                // Reuse previous loader data and such.
                loaderData: inertRouterState.loaderData,
                actionData: inertRouterState.actionData,
                errors: inertRouterState.errors,
                fetchers: inertRouterState.fetchers,
            });
        }
    }

    public listen(
        listener: (update: {action: Action; location: Location; delta: number | null}) => void,
    ): () => void {
        assert(this._listener === null);
        this._listener = listener;
        return () => {
            assert(this._listener === listener);
            this._listener = null;
        };
    }

    /**
     * Switch from one tab to another. If we haven't navigated to the tab before we
     * push a new history entry based on the initial paths provided when constructing
     * this object. If we have navigated to the tab before then we'll go to the last
     * URL from that tab.
     *
     * This function kicks off a navigation in `router`. If we have an inert router
     * state for the tab we're switching to then we'll kick off a pop action that
     * revives the inert route. Otherwise we'll start a push navigation in our router
     * that first loads the new route's data, then calls `push()` to update our history
     * state once data has loaded.
     */
    public async switchTabFromExternal(tab: NativeMobileTab, urlFromExternal: URL) {
        const oldTab = getLocationNativeMobileTab(this._currentEntryLocation);

        if (tab === oldTab) return;

        if (this._pastEntriesByTab[tab].length === 0) {
            await this._router!.navigate(
                {
                    pathname: urlFromExternal.pathname,
                    search: urlFromExternal.search,
                    hash: urlFromExternal.hash,
                },
                {
                    state: {
                        tab,
                        isTabSwitch: true,
                    },
                },
            );
        } else {
            const restoreEntry = this._pastEntriesByTab[tab].pop()!;

            // If native expects switching to a tab to have a different URL than what we
            // actually have in memory, then web code and native code are out of sync! Prefer
            // the URL from native code (since it initiated this navigation) and reset our
            // history state.
            //
            // We copy this logic from `_go()`. We need to immediately clear past entries from
            // our internal state which is why we don't call `router.navigate()` which only
            // updates our internal state after the navigation network request has finished.
            if (this.createHref(restoreEntry.location) !== this.createHref(urlFromExternal)) {
                this._pastEntriesByTab[oldTab].push({
                    location: this._currentEntryLocation,
                    inertRouterState: this._router!.state,
                });

                this._pastEntriesByTab[tab] = [];
                this._inertRouterStateTabOrder = this._inertRouterStateTabOrder.filter(
                    otherTab => otherTab !== tab,
                );

                this._inertRouterStateTabOrder.push(oldTab);
                this._truncateInertRouterStateTabOrder();

                this._action = Action.Pop;
                this._currentEntryLocation = createLocation(
                    this._currentEntryLocation.pathname,
                    {
                        pathname: urlFromExternal.pathname,
                        search: urlFromExternal.search,
                        hash: urlFromExternal.hash,
                    },
                    {tab, isTabSwitch: true},
                );

                // Make sure browser URL reflects history object. We don't respect changes to
                // browser history.
                window.history.replaceState(
                    {key: this._currentEntryLocation.key, usr: this._currentEntryLocation.state},
                    "",
                    this.createHref(this._currentEntryLocation),
                );

                // Make sure `@remix-run/router` kicks off a new navigation.
                this._listener?.({
                    action: this._action,
                    location: this._currentEntryLocation,
                    delta: null,
                });
            } else if (restoreEntry.inertRouterState === null) {
                await this._router!.navigate(restoreEntry.location, {
                    state: {
                        ...restoreEntry.location.state,
                        tab,
                        isTabSwitch: true,
                    },
                });
            } else {
                this._pastEntriesByTab[oldTab].push({
                    location: this._currentEntryLocation,
                    inertRouterState: this._router!.state,
                });

                // Move the inert router states of the tab we're switching to into the front of the
                // inert router state tab order. So we lose these tabs last as the user pushes new
                // routes.
                {
                    const oldInertRouterStateTabOrder = this._inertRouterStateTabOrder;
                    this._inertRouterStateTabOrder = [];
                    let inertRouterStateTabCount = 0;

                    for (const inertRouterStateTab of oldInertRouterStateTabOrder) {
                        if (inertRouterStateTab === tab) {
                            inertRouterStateTabCount += 1;
                        } else {
                            this._inertRouterStateTabOrder.push(inertRouterStateTab);
                        }
                    }

                    this._inertRouterStateTabOrder.push(oldTab);

                    // Minus one since the latest inert router state is removed from the tab order
                    // array as it becomes the active router state.
                    for (let i = 0; i < inertRouterStateTabCount - 1; i++) {
                        this._inertRouterStateTabOrder.push(tab);
                    }
                }
                this._truncateInertRouterStateTabOrder();

                // We use a pop action when switching tabs since, like the pop action, this
                // function is responsible for updating the URL. Also, in many cases we're
                // returning to a route when switching tabs so thematically pop makes sense.
                //
                // https://github.com/remix-run/react-router/blob/09b6cbeabb02ffaccc3d5a6ca751b9f5221b0d5b/packages/router/router.ts#L1047-L1049
                this._action = Action.Pop;

                // Location from `pastEntriesByTab` should have `tab` state correctly set.
                assert(restoreEntry.location.state?.tab === tab);

                this._currentEntryLocation = {
                    ...restoreEntry.location,
                    state: {
                        ...restoreEntry.location.state,
                        isTabSwitch: true,
                    },
                };

                // Make sure browser URL reflects history object. We don't respect changes to
                // browser history.
                window.history.replaceState(
                    {key: this._currentEntryLocation.key, usr: this._currentEntryLocation.state},
                    "",
                    this.createHref(this._currentEntryLocation),
                );

                const {inertRouterState} = restoreEntry;

                // Instead of calling `_listener` which [`createMemoryHistory()` does][1], directly
                // initiate a navigation in our router. This is a special kind of navigation,
                // though, that restores a previous router state without triggering asynchronous
                // navigations.
                //
                // [1]:
                //     https://github.com/remix-run/react-router/blob/09b6cbeabb02ffaccc3d5a6ca751b9f5221b0d5b/packages/router/history.ts#L319-L321
                void this._router!.unstable_unsafelyRestoreNavigation({
                    historyAction: Action.Pop,
                    // Use `this._currentEntryLocation` instead of `routerState.location` since we may
                    // modify the state of `this._currentEntryLocation`. They should be the same.
                    location: this._currentEntryLocation,
                    matches: inertRouterState.matches,
                    // Leave scroll position alone. We'll have kept the route mounted so it should have
                    // the right scroll position still stored in its DOM.
                    restoreScrollPosition: false,
                    preventScrollReset: true,
                    // Reuse previous loader data and such.
                    loaderData: inertRouterState.loaderData,
                    actionData: inertRouterState.actionData,
                    errors: inertRouterState.errors,
                    fetchers: inertRouterState.fetchers,
                });
            }
        }
    }

    /**
     * Truncate `inertRouterStateTabOrder` to fit our maximum number of inert router
     * states.
     */
    private _truncateInertRouterStateTabOrder() {
        const oldInertRouterStateTabOrder = this._inertRouterStateTabOrder.slice(
            0,
            -maxNativeMobileMemoryHistoryInertRouterStateCount,
        );
        this._inertRouterStateTabOrder = this._inertRouterStateTabOrder.slice(
            -maxNativeMobileMemoryHistoryInertRouterStateCount,
        );

        // `null` out the router states of any entries that were removed from
        // `inertRouterStateTabOrder` so the objects can be garbage collected.
        for (const oldInertRouterStateTab of oldInertRouterStateTabOrder) {
            this._pastEntriesByTab[oldInertRouterStateTab][
                this._pastEntriesByTab[oldInertRouterStateTab].findLastIndex(
                    ({inertRouterState}) => inertRouterState === null,
                ) + 1
            ]!.inertRouterState = null;
        }
    }
}

// Forked from:
// https://github.com/remix-run/react-router/blob/09b6cbeabb02ffaccc3d5a6ca751b9f5221b0d5b/packages/router/history.ts#L501-L503
function createKey() {
    return Math.random().toString(36).substr(2, 8);
}

// Forked from:
// https://github.com/remix-run/react-router/blob/09b6cbeabb02ffaccc3d5a6ca751b9f5221b0d5b/packages/router/history.ts#L516-L538
function createLocation(
    current: string | Location,
    to: To,
    state: any = null,
    key?: string,
): Readonly<Location> {
    const location: Readonly<Location> = {
        pathname: typeof current === "string" ? current : current.pathname,
        search: "",
        hash: "",
        ...(typeof to === "string" ? parsePath(to) : to),
        state,
        // TODO: This could be cleaned up. push/replace should probably just take full
        // Locations now and avoid the need to run through this flow at all But that's a
        // pretty big refactor to the current test suite so going to keep as is for the
        // time being and just let any incoming keys take precedence
        key: (to && (to as Location).key) || key || createKey(),
    };

    return location;
}

export function getLocationNativeMobileTab(
    location: Location,
    defaultTab: NativeMobileTab = "Home",
): NativeMobileTab {
    return getLocationStateNativeMobileTab(location.state, defaultTab);
}

function getLocationStateNativeMobileTab(
    state?: any,
    defaultTab: NativeMobileTab = "Home",
): NativeMobileTab {
    // NOTE(calebmer): Assertion to prevent future accidents which I made while coding
    // this file.
    if (process.env.NODE_ENV !== "production") {
        assert(
            !state || !("pathname" in state),
            "Did you accidentally pass `location` to `getLocationStateNativeMobileTab()` instead of `location.state`?",
        );
    }

    if (typeof state?.tab !== "string") return defaultTab;
    if (!isNativeMobileTab(state.tab)) return defaultTab;
    return state.tab;
}
