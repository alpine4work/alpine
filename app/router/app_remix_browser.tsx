import {
    RemixBrowserProps,
    UNSAFE_RemixContext as RemixContext,
    createClientRoutes,
    deserializeErrors,
} from "@remix-run/react";
import {
    Action,
    History,
    HydrationState,
    Router,
    RouterState,
    createBrowserHistory,
    createRouter,
} from "@remix-run/router";
import {ReactElement} from "react";
import {FutureConfig, UNSAFE_mapRouteProperties as mapRouteProperties} from "react-router";
import {RouteObject, createBrowserRouter} from "react-router-dom";
import {AppRouterProvider} from "~/app/router/app_router_provider.js";
import {getClientInfoWithoutListening} from "~/client/remix/client_info_context.js";
import {NativeMobileBridge} from "~/client/remix/native_mobile_bridge.js";
import {assert} from "~/shared/helpers/control/assert.js";

// `isNativeMobile` is a constant throughout our application's lifetime.
const isNativeMobile =
    typeof window !== "undefined" && getClientInfoWithoutListening().isNativeMobile;

let router: Router | undefined;

// NOCOMMIT: Document that this is a fork of:
// https://github.com/remix-run/remix/blob/d8f403490baef9b2814f7c2b984294bf08fc09df/packages/remix-react/browser.tsx#L150-L234
export function AppRemixBrowser(_props: RemixBrowserProps): ReactElement {
    if (!router) {
        const routes = createClientRoutes(
            window.__remixManifest.routes,
            window.__remixRouteModules,
            window.__remixContext.future,
        );

        let hydrationData = window.__remixContext.state;
        if (hydrationData && hydrationData.errors) {
            hydrationData = {
                ...hydrationData,
                errors: deserializeErrors(hydrationData.errors),
            };
        }

        router = (isNativeMobile ? createNativeMobileRouter : createBrowserRouter)(routes, {
            hydrationData,
            future: {
                // Pass through the Remix future flag to avoid a v1 breaking change in
                // useNavigation() - users can control the casing via the flag in v1.
                // useFetcher still always uppercases in the back-compat layer in v1.
                // In v2 we can just always pass true here and remove the back-compat
                // layer
                v7_normalizeFormMethod: window.__remixContext.future.v2_normalizeFormMethod,
            },
        });

        // Hard reload if the URL we tried to load is not the current URL.
        // This is usually the result of 2 rapid backwards/forward clicks from an
        // external site into a Remix app, where we initially start the load for
        // one URL and while the JS chunks are loading a second forward click moves
        // us to a new URL
        const initialUrl = window.__remixContext.url;
        const hydratedUrl = window.location.pathname + window.location.search;
        if (initialUrl !== hydratedUrl) {
            const errorMessage =
                `Initial URL (${initialUrl}) does not match URL at time of hydration ` +
                `(${hydratedUrl}), reloading page...`;
            // eslint-disable-next-line no-console
            console.error(errorMessage);
            window.location.reload();
        }
    }

    return (
        <RemixContext.Provider
            value={{
                manifest: window.__remixManifest,
                routeModules: window.__remixRouteModules,
                future: window.__remixContext.future,
            }}
        >
            <AppRouterProvider
                router={router}
                fallbackElement={null}
                future={{v7_startTransition: true}}
            />
        </RemixContext.Provider>
    );
}

const isNativeMobileRouterStateSymbol = Symbol("isNativeMobileRouterState");

export type NativeMobileRouterState = RouterState & {
    readonly [isNativeMobileRouterStateSymbol]: true;
    readonly inertRouterStates: ReadonlyArray<RouterState>;
};

type MutableNativeMobileRouterState = RouterState & {
    [isNativeMobileRouterStateSymbol]?: true;
    inertRouterStates?: ReadonlyArray<RouterState>;
};

/**
 * The native mobile router keeps track of inert routes so we can keep those
 * routes rendered in the DOM. That way when the user pops back to an inert
 * route it can be revived with the same state it had when it left the view.
 */
export type NativeMobileRouter = Router & {
    get state(): NativeMobileRouterState;
    subscribe(fn: (state: NativeMobileRouterState) => void): () => void;
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

function createNativeMobileRouter(
    routes: Array<RouteObject>,
    opts?: {
        basename?: string;
        future?: Partial<Omit<FutureConfig, "v7_prependBasename">>;
        hydrationData?: HydrationState;
        window?: Window;
    },
): NativeMobileRouter {
    assert(isNativeMobile);
    assert(NativeMobileBridge);

    const historyBase = createBrowserHistory({window: opts?.window});

    const history: History = {
        get action() {
            return historyBase.action;
        },
        get location() {
            return historyBase.location;
        },
        createHref: historyBase.createHref.bind(historyBase),
        createURL: historyBase.createURL.bind(historyBase),
        encodeLocation: historyBase.encodeLocation.bind(historyBase),
        listen: historyBase.listen.bind(historyBase),
        push: (to, state) => {
            routerStateStack.push(routerBase.state);

            historyBase.push(to, state);
        },
        replace: (to, state) => {
            historyBase.replace(to, state);
        },
        go: delta => {
            // In our native app, you can only go back as far as our app has seen. Unlike a
            // web browser where you may have been linked from some other page on the
            // internet.
            //
            // NOCOMMIT: Page reload should be able to re-initialize our stack? We should
            // be able to go back but all state is reset.
            delta = Math.max(delta, -(routerStateStack.length - 1));

            // We don't support "forward" navigations in our native mobile app. If you go
            // back, it destroys the state for the route you were looking at.
            //
            // In native iOS navigation there is no "forward" action. You can only push/pop
            // onto the navigation stack.
            //
            // NOCOMMIT: Early return should still do something or native will be frozen
            // forever?
            if (delta >= 0) return;

            for (let i = 0; i < delta * -1; i++) routerStateStack.pop();

            const routerState = routerStateStack[routerStateStack.length - 1]!;

            // Push instead of calling `historyBase.go()`. Because our native mobile app
            // has multiple history stacks (one for each tab) we can't use browser history.
            //
            // This has the added bonus of not firing the listener passed to
            // `history.listen()`. Instead we can update router state ourselves!
            historyBase.push(routerState.location, routerState.location.state);

            // `router.navigate()` directly calls `history.go()` without changing
            // router state. So it's up to us to update router state.
            routerBase._internalUnsafelyRestoreNavigation({
                historyAction: Action.Pop,
                location: routerState.location,
                matches: routerState.matches,
                // Leave scroll position alone. We'll have kept the route mounted so it should
                // have the right scroll position still stored in its DOM.
                restoreScrollPosition: false,
                preventScrollReset: true,
                // Reuse previous loader data and such.
                loaderData: routerState.loaderData,
                actionData: routerState.actionData,
                errors: routerState.errors,
                fetchers: routerState.fetchers,
            });
        },
    };

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

    const routerStateStack = [routerBase.state];

    let unsubscribeFromRouter: (() => void) | undefined;
    let unsubscribeFromBridge: (() => void) | undefined;

    const router: NativeMobileRouter = {
        get basename() {
            return routerBase.basename;
        },
        get state() {
            const state: MutableNativeMobileRouterState = routerBase.state;

            if (!state[isNativeMobileRouterStateSymbol]) {
                // Should be non-enumerable so that a spread doesn't copy the property.
                Object.defineProperty(state, isNativeMobileRouterStateSymbol, {
                    value: true,
                    enumerable: false,
                });

                // Immutable since slicing creates a copy so we don't see updates
                // to `routerStateStack`.
                state.inertRouterStates = routerStateStack.slice(0, -1);
            }

            return state as NativeMobileRouterState;
        },
        get routes() {
            return routerBase.routes;
        },
        subscribe: fn => {
            return routerBase.subscribe((state: MutableNativeMobileRouterState) => {
                if (!state[isNativeMobileRouterStateSymbol]) {
                    // Should be non-enumerable so that a spread doesn't copy the property.
                    Object.defineProperty(state, isNativeMobileRouterStateSymbol, {
                        value: true,
                        enumerable: false,
                    });

                    // Immutable since slicing creates a copy so we don't see updates
                    // to `routerStateStack`.
                    state.inertRouterStates = routerStateStack.slice(0, -1);
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
            unsubscribeFromRouter = routerBase.subscribe(routerState => {
                routerStateStack[routerStateStack.length - 1] = routerState;
            });

            // When native initiates a pop navigation, we need to execute the pop
            // navigation on the web side.
            unsubscribeFromBridge = NativeMobileBridge!.subscribeToPopNavigation(delta => {
                history.go(-delta);
            });

            return routerBase.initialize();
        },

        dispose: () => {
            routerBase.dispose();
            unsubscribeFromRouter?.();
            unsubscribeFromBridge?.();
        },
    };

    router.initialize();
    return router;
}
