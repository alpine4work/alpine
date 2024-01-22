import {
    Action,
    History,
    HydrationState,
    Location,
    Path,
    Router,
    RouterState,
    To,
    createPath,
    createRouter,
    parsePath,
} from "@remix-run/router";
import {FutureConfig, UNSAFE_mapRouteProperties as mapRouteProperties} from "react-router";
import {RouteObject} from "react-router-dom";
import {NativeMobileBridge} from "~/client/remix/native_mobile_bridge.js";
import {assert} from "~/shared/helpers/control/assert.js";

/**
 * The native mobile router keeps track of inert routes so we can keep those
 * routes rendered in the DOM. That way when the user pops back to an inert
 * route it can be revived with the same state it had when it left the view.
 */
export type NativeMobileRouter = Router & {
    get state(): NativeMobileRouterState;
    subscribe(fn: (state: NativeMobileRouterState) => void): () => void;
};

const isNativeMobileRouterStateSymbol = Symbol("isNativeMobileRouterState");

export type NativeMobileRouterState = RouterState & {
    readonly [isNativeMobileRouterStateSymbol]: true;
    readonly inertRouterStates: ReadonlyArray<RouterState>;
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
 * router states on navigation and include them in a `inertRouterStates`
 * property so they can be rendered to the DOM.
 */
export function createNativeMobileRouter(
    routes: Array<RouteObject>,
    opts?: {
        basename?: string;
        future?: Partial<Omit<FutureConfig, "v7_prependBasename">>;
        hydrationData?: HydrationState;
        window?: Window;
    },
): NativeMobileRouter {
    assert(NativeMobileBridge);

    const history = new NativeMobileMemoryHistory(window.location);

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
    });

    history.initializeRouter(routerBase);

    let unsubscribeFromBridge: (() => void) | undefined;

    const router: NativeMobileRouter = {
        get basename() {
            return routerBase.basename;
        },
        get state() {
            const state: any = routerBase.state;

            if (!state[isNativeMobileRouterStateSymbol]) {
                // Should be non-enumerable so that a spread doesn't copy the property.
                Object.defineProperty(state, isNativeMobileRouterStateSymbol, {
                    value: true,
                    enumerable: false,
                });

                state.inertRouterStates = history.getPastRouterStates();
            }

            return state as NativeMobileRouterState;
        },
        get routes() {
            return routerBase.routes;
        },
        subscribe: fn => {
            return routerBase.subscribe((state: any) => {
                if (!state[isNativeMobileRouterStateSymbol]) {
                    // Should be non-enumerable so that a spread doesn't copy the property.
                    Object.defineProperty(state, isNativeMobileRouterStateSymbol, {
                        value: true,
                        enumerable: false,
                    });

                    state.inertRouterStates = history.getPastRouterStates();
                }

                return fn(state as NativeMobileRouterState);
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
        _internalUnsafelyRestoreNavigation:
            routerBase._internalUnsafelyRestoreNavigation.bind(routerBase),

        initialize: () => {
            // When native initiates a pop navigation, we need to execute the pop
            // navigation on the web side.
            unsubscribeFromBridge = NativeMobileBridge!.subscribeToPopNavigation(delta => {
                history.go(-delta);
            });

            return routerBase.initialize();
        },

        dispose: () => {
            routerBase.dispose();
            unsubscribeFromBridge?.();
        },
    };

    router.initialize();
    return router;
}

/**
 * Custom in-memory history for our native mobile apps. Differs from
 * [`@remix-run/router`'s `createMemoryHistory()`][1] in that we remember old
 * router states such that calls like `go(-1)` can restore the state without
 * needing to send then wait on a network request.
 *
 * [1]: https://github.com/remix-run/react-router/blob/09b6cbeabb02ffaccc3d5a6ca751b9f5221b0d5b/packages/router/history.ts#L227
 */
class NativeMobileMemoryHistory implements History {
    private _router: Router | undefined;

    private _action = Action.Pop;
    private _currentEntryLocation: Location;
    private _pastEntries: Array<{location: Location; routerState: RouterState}>;

    private _listener:
        | ((update: {action: Action; location: Location; delta: number | null}) => void)
        | null = null;

    constructor(initialTo: To, initialState?: any) {
        this._currentEntryLocation = createLocation(
            window.location.pathname,
            initialTo,
            initialState,
        );
        this._pastEntries = [];
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

    public getPastRouterStates() {
        return this._pastEntries.map(({routerState}) => routerState);
    }

    public createHref(to: To): string {
        return typeof to === "string" ? to : createPath(to);
    }

    public createURL(to: To): URL {
        // The built-in memory router creates URLs to `http://localhost`. Instead
        // create URLs to the domain our app is loaded under.
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

    public push(to: To, state?: any) {
        this._action = Action.Push;

        const nextEntryLocation = createLocation(this._currentEntryLocation.pathname, to, state);

        this._pastEntries.push({
            location: this._currentEntryLocation,
            routerState: this._router!.state,
        });

        this._currentEntryLocation = nextEntryLocation;
    }

    public replace(to: To, state?: any) {
        this._action = Action.Replace;

        const nextEntryLocation = createLocation(this._currentEntryLocation.pathname, to, state);

        this._currentEntryLocation = nextEntryLocation;
    }

    public go(delta: number) {
        // In our native app, you can only go back as far as our app has seen. Unlike a
        // web browser where you may have been linked from some other page on the
        // internet.
        //
        // NOCOMMIT: Page reload should be able to re-initialize our stack? We should
        // be able to go back but all state is reset.
        delta = Math.max(delta, -this._pastEntries.length);

        // We don't support "forward" navigations in our native mobile app. If you go
        // back, it destroys the state for the route you were looking at.
        //
        // In native iOS navigation there is no "forward" action. You can only push/pop
        // onto the navigation stack.
        //
        // NOCOMMIT: Early return should still do something or native will be frozen
        // forever?
        if (delta >= 0) return;

        let routerState: RouterState | undefined;
        for (let i = 0; i < delta * -1; i++) {
            const pastEntry = this._pastEntries.pop()!;

            this._currentEntryLocation = pastEntry.location;
            routerState = pastEntry.routerState;
        }

        // Instead of calling `_listener` which [`createMemoryHistory()` does][1],
        // directly initiate a navigation in our router. This is a special kind of
        // navigation, though, that restores a previous router state without triggering
        // asynchronous navigations.
        //
        // [1]: https://github.com/remix-run/react-router/blob/09b6cbeabb02ffaccc3d5a6ca751b9f5221b0d5b/packages/router/history.ts#L319-L321
        this._router!._internalUnsafelyRestoreNavigation({
            historyAction: Action.Pop,
            location: routerState!.location,
            matches: routerState!.matches,
            // Leave scroll position alone. We'll have kept the route mounted so it should
            // have the right scroll position still stored in its DOM.
            restoreScrollPosition: false,
            preventScrollReset: true,
            // Reuse previous loader data and such.
            loaderData: routerState!.loaderData,
            actionData: routerState!.actionData,
            errors: routerState!.errors,
            fetchers: routerState!.fetchers,
        });
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
        // TODO: This could be cleaned up.  push/replace should probably just take
        // full Locations now and avoid the need to run through this flow at all
        // But that's a pretty big refactor to the current test suite so going to
        // keep as is for the time being and just let any incoming keys take precedence
        key: (to && (to as Location).key) || key || createKey(),
    };

    return location;
}
