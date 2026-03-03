import {
    RemixBrowserProps,
    UNSAFE_RemixContext as RemixContext,
    deserializeErrors,
    shouldHydrateRouteLoader,
} from "@remix-run/react";
import {
    HydrationState,
    Router,
    FutureConfig as RouterFutureConfig,
    createBrowserHistory,
    createRouter,
    unstable_DataStrategyFunction,
} from "@remix-run/router";
import {ReactElement, useState} from "react";
import {DataRouteObject, UNSAFE_mapRouteProperties as mapRouteProperties} from "react-router";
import {RouteObject, matchRoutes} from "react-router-dom";
import {
    createAppClientRoutes,
    createAppClientRoutesWithHmrRevalidationOptOut,
} from "~/app/router/app_client_routes.js";
import {AppRouterProvider} from "~/app/router/app_router_provider.js";
import {createNativeMobileRouterWithoutInitialization} from "~/app/router/native_mobile_router.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {UnimplementedError} from "~/shared/error/error.js";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting.js";
import {isNonNullable} from "~/shared/helpers/control/is_non_nullable.js";

let router: Router | undefined;
let routes: Array<DataRouteObject> | undefined;
let routerInitialized = false;
let hmrAbortController: AbortController | undefined;
let hmrRouterReadyResolve: ((router: Router) => void) | undefined;
// There's a race condition with HMR where the remix:manifest is signaled before
// the router is assigned in the RemixBrowser component. This promise gates the HMR
// handler until the router is ready
const hmrRouterReadyPromise = new Promise<Router>(resolve => {
    // body of a promise is executed immediately, so this can be resolved outside of
    // the promise body
    hmrRouterReadyResolve = resolve;
}).catch(() => {
    // This is a noop catch handler to avoid unhandled promise rejection warnings in
    // the console. The promise is never rejected.
    return undefined;
});

// Forked from (along with the rest of this component):
// https://github.com/remix-run/remix/blob/a94303c7f812fdb9118d8dad065837c4a825efb8/packages/remix-react/browser.tsx#L78-L187
if (import.meta && import.meta.hot) {
    import.meta.hot.accept("remix:manifest", module => {
        runPromiseWithoutAwaiting(async () => {
            const {
                assetsManifest,
                needsRevalidation,
            }: {
                assetsManifest: typeof window.__remixManifest;
                needsRevalidation: Set<string>;
            } = module as any;

            const router = await hmrRouterReadyPromise;
            // This should never happen, but just in case...
            if (!router) {
                // eslint-disable-next-line no-console
                console.error("Failed to accept HMR update because the router was not ready.");
                return;
            }

            const routeIds = [
                ...new Set(
                    router.state.matches
                        .map(m => m.route.id)
                        .concat(Object.keys(window.__remixRouteModules)),
                ),
            ];

            if (hmrAbortController) {
                hmrAbortController.abort();
            }
            hmrAbortController = new AbortController();
            const signal = hmrAbortController.signal;

            // Load new route modules that we've seen.
            const newRouteModules = Object.assign(
                {},
                window.__remixRouteModules,
                Object.fromEntries(
                    (
                        await Promise.all(
                            routeIds.map(async id => {
                                if (!assetsManifest.routes[id]) {
                                    return null;
                                }
                                const imported = await import(
                                    /* @vite-ignore */
                                    assetsManifest.routes[id].module +
                                        `?t=${assetsManifest.hmr?.timestamp}`
                                );
                                return [
                                    id,
                                    {
                                        ...imported,
                                        // react-refresh takes care of updating these in-place, if we don't preserve
                                        // existing values we'll loose state.
                                        default: imported.default
                                            ? (window.__remixRouteModules[id]?.default ??
                                              imported.default)
                                            : imported.default,
                                        ErrorBoundary: imported.ErrorBoundary
                                            ? (window.__remixRouteModules[id]?.ErrorBoundary ??
                                              imported.ErrorBoundary)
                                            : imported.ErrorBoundary,
                                        HydrateFallback: imported.HydrateFallback
                                            ? (window.__remixRouteModules[id]?.HydrateFallback ??
                                              imported.HydrateFallback)
                                            : imported.HydrateFallback,
                                    },
                                ];
                            }),
                        )
                    ).filter(isNonNullable),
                ),
            );

            Object.assign(window.__remixRouteModules, newRouteModules);
            // Create new routes
            const routes = createAppClientRoutesWithHmrRevalidationOptOut(
                needsRevalidation,
                assetsManifest.routes,
                window.__remixRouteModules,
                window.__remixContext.state,
                window.__remixContext.future,
                window.__remixContext.isSpaMode,
            );

            // This is temporary API and will be more granular before release
            router._internalSetRoutes(routes);

            // Wait for router to be idle before updating the manifest and route modules and
            // triggering a react-refresh
            const unsubscribe = router.subscribe(state => {
                if (state.revalidation === "idle") {
                    unsubscribe();
                    // Abort if a new update comes in while we're waiting for the router to be idle.
                    if (signal.aborted) return;
                    // Ensure RouterProvider setState has flushed before re-rendering
                    setTimeout(() => {
                        Object.assign(window.__remixManifest, assetsManifest);
                        window.$RefreshRuntime$.performReactRefresh();
                    }, 1);
                }
            });
            window.__remixRevalidation = (window.__remixRevalidation || 0) + 1;
            router.revalidate();
        });
    });
}

/**
 * This is a fork of the [`<RemixBrowser>` component in `@remix-run/react`][1].
 *
 * We forked this component to add support for our native mobile router. We've also
 * simplified some some bits we don't need.
 *
 * [1]:
 *     https://github.com/remix-run/remix/blob/a94303c7f812fdb9118d8dad065837c4a825efb8/packages/remix-react/browser.tsx#L189-L416
 */
export function AppRemixBrowser({
    isNativeMobile,
}: RemixBrowserProps & {isNativeMobile: boolean}): ReactElement {
    if (!router) {
        // Hard reload if the path we tried to load is not the current path. This is
        // usually the result of 2 rapid back/forward clicks from an external site into a
        // Remix app, where we initially start the load for one URL and while the JS chunks
        // are loading a second forward click moves us to a new URL. Avoid comparing search
        // params because of CDNs which can be configured to ignore certain params and only
        // pathname is relevant towards determining the route matches.
        const initialPathname = window.__remixContext.url;
        const hydratedPathname = window.location.pathname;
        if (initialPathname !== hydratedPathname && !window.__remixContext.isSpaMode) {
            const errorMsg =
                `Initial URL (${initialPathname}) does not match URL at time of hydration ` +
                `(${hydratedPathname}), reloading page...`;
            // eslint-disable-next-line no-console
            console.error(errorMsg);
            window.location.reload();
            // Get out of here so the reload can happen - don't create the router since it'll
            // then kick off unnecessary route.lazy() loads
            return <></>;
        }

        // When single fetch is enabled, we need to suspend until the initial state
        // snapshot is decoded into window.\_\_remixContext.state
        if (window.__remixContext.future.unstable_singleFetch) {
            // NOTE(calebmer): We don't currently use `unstable_singleFetch`.
            throw new UnimplementedError("`unstable_singleFetch` not supported");
        }

        routes = createAppClientRoutes(
            window.__remixManifest.routes,
            window.__remixRouteModules,
            window.__remixContext.state,
            window.__remixContext.future,
            window.__remixContext.isSpaMode,
        );

        if (window.__remixContext.isSpaMode) {
            throw new UnimplementedError("`isSpaMode` not supported");
        }

        // Create a shallow clone of `loaderData` we can mutate for partial hydration. When
        // a route exports a `clientLoader` and a `HydrateFallback`, the SSR will render
        // the fallback so we need the client to do the same for hydration. The server
        // loader data has already been exposed to these route `clientLoader`'s in
        // `createClientRoutes` above, so we need to clear out the version we pass to
        // `createBrowserRouter` so it initializes and runs the client loaders.
        const hydrationData = {
            ...window.__remixContext.state,
            loaderData: {...window.__remixContext.state.loaderData},
        };
        const initialMatches = matchRoutes(routes, window.location);
        if (initialMatches) {
            for (const match of initialMatches) {
                const routeId = match.route.id;
                const route = window.__remixRouteModules[routeId];
                const manifestRoute = window.__remixManifest.routes[routeId];
                // Clear out the loaderData to avoid rendering the route component when the route
                // opted into clientLoader hydration and either:
                //
                // - gave us a HydrateFallback
                // - or doesn't have a server loader and we have no data to render
                if (
                    route &&
                    shouldHydrateRouteLoader(
                        manifestRoute!,
                        route,
                        window.__remixContext.isSpaMode,
                    ) &&
                    (route.HydrateFallback || !manifestRoute!.hasLoader)
                ) {
                    hydrationData.loaderData[routeId] = undefined;
                } else if (manifestRoute && !manifestRoute.hasLoader) {
                    // Since every Remix route gets a `loader` on the client side to load the route JS
                    // module, we need to add a `null` value to `loaderData` for any routes that don't
                    // have server loaders so our partial hydration logic doesn't kick off the route
                    // module loaders during hydration
                    hydrationData.loaderData[routeId] = null;
                }
            }
        }

        if (hydrationData && hydrationData.errors) {
            hydrationData.errors = deserializeErrors(hydrationData.errors);
        }

        router = (
            isNativeMobile
                ? createNativeMobileRouterWithoutInitialization
                : createBrowserRouterWithoutInitialization
        )(routes, {
            basename: window.__remixContext.basename,
            future: {
                v7_normalizeFormMethod: true,
                v7_fetcherPersist: window.__remixContext.future.v3_fetcherPersist,
                v7_partialHydration: true,
                v7_relativeSplatPath: window.__remixContext.future.v3_relativeSplatPath,
                unstable_skipActionErrorRevalidation: false,
            },
            hydrationData,
        });

        // We can call initialize() immediately if the router doesn't have any loaders to
        // run on hydration
        if (router.state.initialized) {
            routerInitialized = true;
            router.initialize();
        }

        (router as any).createRoutesForHMR = createAppClientRoutesWithHmrRevalidationOptOut;
        window.__remixRouter = router;

        // Notify that the router is ready for HMR
        if (hmrRouterReadyResolve) {
            hmrRouterReadyResolve(router);
        }
    }

    // Critical CSS can become stale after code changes, e.g. styles might be
    // removed from a component, but the styles will still be present in the
    // server HTML. This allows our HMR logic to clear the critical CSS state.
    // eslint-disable-next-line react-compiler/react-compiler
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [criticalCss, setCriticalCss] = useState(
        process.env.NODE_ENV === "development" ? window.__remixContext.criticalCss : undefined,
    );
    if (process.env.NODE_ENV === "development") {
        window.__remixClearCriticalCss = () => setCriticalCss(undefined);
    }

    // eslint-disable-next-line react-compiler/react-compiler
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useLayoutEffectWithoutServerSideWarning(() => {
        // If we had to run clientLoaders on hydration, we delay initialization until after
        // we've hydrated to avoid hydration issues from synchronous client loaders
        if (!routerInitialized) {
            routerInitialized = true;
            router!.initialize();
        }
    }, []);

    return (
        <RemixContext.Provider
            value={{
                manifest: window.__remixManifest,
                routeModules: window.__remixRouteModules,
                future: window.__remixContext.future,
                criticalCss,
                isSpaMode: window.__remixContext.isSpaMode,
                // @ts-expect-error: This doesn't exist in the Remix TypeScript types.
                originalRoutesForPeek: routes!,
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

function createBrowserRouterWithoutInitialization(
    routes: Array<RouteObject>,
    options: {
        basename?: string;
        future?: Partial<Omit<RouterFutureConfig, "v7_prependBasename">>;
        hydrationData: HydrationState;
        unstable_dataStrategy?: unstable_DataStrategyFunction;
        window?: Window;
    },
): Router {
    return createRouter({
        basename: options?.basename,
        future: {
            ...options?.future,
            v7_prependBasename: true,
        },
        history: createBrowserHistory({window: options?.window}),
        hydrationData: options.hydrationData,
        routes,
        mapRouteProperties,
        unstable_dataStrategy: options?.unstable_dataStrategy,
        window: options?.window,
    });
}
