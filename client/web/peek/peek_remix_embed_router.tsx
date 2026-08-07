import {UNSAFE_RemixContext as RemixContext} from "@remix-run/react";
import {
    HydrationState,
    Location,
    MemoryHistory,
    Router,
    RouterNavigateOptions,
    To,
    createRouter,
    matchRoutes,
    resolvePath,
} from "@remix-run/router";
import {useCallback, useContext, useMemo} from "react";
import {
    DataRouteObject,
    UNSAFE_DataRouterContext as DataRouterContext,
    UNSAFE_mapRouteProperties as mapRouteProperties,
} from "react-router";
import {PeekErrorBoundary} from "~/client/web/peek/peek_error_boundary.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {InternalError} from "~/shared/error/error.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {convertSpacePathToPeekPath, isPeekPath} from "~/shared/remix/peek_path_helpers.js";

export type PeekRemixEmbedRouter = Router & {
    getHistoryIndex(): number;
    getHistoryEntries(): ReadonlyArray<Location>;
};

/**
 * Hook that allows us to construct router for use with `<PeekRemixEmbed>`.
 */
export function usePeekRemixEmbedRouter() {
    // Oh look! Remix internals.
    //
    // For peeks we want to create a mini navigation context embedded in our app. We
    // want that navigation context to have the same behaviors as navigating in our app
    // more generally:
    //
    // - Wait to navigate while loader data and route modules load
    // - Use the same `useNavigate()` hooks in component code which automatically go to
    //   the right place
    // - Data load is powered by a Remix loader function
    //
    // However, we want our embedded peek navigation stack to be separate from the
    // browser's navigation stack. You should be able to navigate in the browser and
    // navigate in the peek independently.
    //
    // To accomplish this we reuse Remix's data loading and routing internals to
    // create, effectively, another instance of Remix! This is very undocumented, will
    // be tricky to upgrade, and requires some patching of Remix and React Router.
    // However, the effect it creates is incredible and differentiates us from other
    // productivity tools. You have (multiple) full navigation contexts on the page at
    // once.
    const remixContext = useContext(RemixContext);
    assert(remixContext, "Expected remix context");

    const parentDataRouterContext = useContext(DataRouterContext);
    assert(parentDataRouterContext, "Expected data router context");

    const navigate = useNavigate();

    const remixOriginalRoutesForPeek: Array<DataRouteObject> = (remixContext as any)
        .originalRoutesForPeek;

    // We only want to allow peek routes to be rendered from a peek embed. So take the
    // full route tree from our remix context and create a new tree with just the peek
    // routes.
    //
    // A warning will be logged if you try to access a non-peek URL from this instance
    // of React Router.
    const peekRoutes: Array<DataRouteObject> = useMemo(() => {
        try {
            // It's important that we use the original routes object since it'll update after
            // `route.lazy()` is called thanks to `makeLazyDataRouteSelfUpdating()`.
            const routes = remixOriginalRoutesForPeek;
            assert(routes.length === 1);
            const rootRoute = routes[0]!;
            assert(rootRoute.id === "root");
            const spaceRoute = assertExists(
                rootRoute.children?.find(route => route.id === "routes/_space"),
            ) as DataRouteObject;
            const spacePeekRoute = assertExists(
                spaceRoute.children?.find(route => route.id === "routes/_space.peek"),
            ) as DataRouteObject;
            return [
                {
                    id: rootRoute.id,
                    caseSensitive: spaceRoute.caseSensitive,
                    path: spaceRoute.path,
                    errorElement: <PeekErrorBoundary />,
                    children: [spacePeekRoute],
                },
            ];
        } catch (error) {
            throw InternalError.from(error, "Could not find peek Remix client route");
        }
    }, [remixOriginalRoutesForPeek]);

    return {
        peekRoutes,
        createPeekRouter: useCallback(
            ({
                history,
                hydrationData,
            }: {
                history: MemoryHistory;
                hydrationData?: HydrationState;
            }): PeekRemixEmbedRouter => {
                // Derived from:
                // https://github.com/remix-run/react-router/blob/7759e8e2912eb69f6dd63b2906490831a2154cfd/packages/react-router/index.ts#L291-L317
                const router = createRouter({
                    history: {
                        ...history,

                        // Spreading copies the current value of getters so manually override the getters.
                        // https://github.com/remix-run/react-router/blob/bc2552840147206716544e5cdcdb54f649f9193f/packages/router/history.ts#L276-L284
                        get index() {
                            return history.index;
                        },
                        get entries() {
                            return history.entries;
                        },
                        get action() {
                            return history.action;
                        },
                        get location() {
                            return history.location;
                        },

                        // By default, memory history will return a URL with the domain `http://localhost`
                        // (no port). Make sure to use the right domain.
                        createURL: to => new URL(history.createHref(to), window.location.origin),
                    },
                    hydrationData,
                    routes: peekRoutes,
                    mapRouteProperties,
                    future: {
                        ...remixContext.future,
                        v7_prependBasename: true,
                    },
                }).initialize();

                const peekRouter: PeekRemixEmbedRouter = {
                    ...router,

                    // Spreading copies the current value of getters so manually override the getters.
                    // https://github.com/remix-run/react-router/blob/bc2552840147206716544e5cdcdb54f649f9193f/packages/router/router.ts#L2508-L2516
                    get basename() {
                        return router.basename;
                    },
                    get state() {
                        return router.state;
                    },
                    get routes() {
                        return router.routes;
                    },

                    getHistoryIndex: () => history.index,
                    getHistoryEntries: () => history.entries,

                    navigate: (
                        to: number | To | null,
                        options?: RouterNavigateOptions,
                    ): Promise<void> => {
                        if (to === null) return router.navigate(to);
                        if (typeof to === "number") return router.navigate(to);

                        const path = resolvePath(to, router.state.location.pathname);

                        // If we are navigating to a peek path, great! No change necessary.
                        if (isPeekPath(path)) return router.navigate(to, options);

                        // If the URL we are navigating to is a space path but the space path has a
                        // corresponding peek route then use the corresponding peek path instead.
                        const peekPath = convertSpacePathToPeekPath(path);
                        if (peekPath) {
                            const routeMatches = matchRoutes(peekRoutes, peekPath.pathname);
                            if (routeMatches) {
                                return router.navigate(peekPath, options);
                            }
                        }

                        // Otherwise, navigate to the URL in the broader product. This should close all our
                        // peeks.
                        return navigate(to, options);
                    },
                };

                return peekRouter;
            },
            [navigate, peekRoutes, remixContext.future],
        ),
    };
}
