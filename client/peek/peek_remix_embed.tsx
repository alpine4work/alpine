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
import {createContext, useCallback, useContext, useMemo, useRef, useState} from "react";
import {
    DataRouteObject,
    UNSAFE_DataRouterContext as DataRouterContext,
    UNSAFE_RouteContext as RouteContext,
    RouterProvider,
    UNSAFE_mapRouteProperties as mapRouteProperties,
} from "react-router";
import {StaticRouterProvider} from "react-router-dom/server.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {UpdateMetaTitleContextProvider} from "~/client/remix/use_update_meta_title.js";
import {InternalError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {PeekId} from "~/shared/id/types/id_types.js";
import {convertSpacePathToPeekPath, isPeekPath} from "~/shared/remix/peek_path_helpers.js";

export type PeekContext = {
    readonly id: PeekId;
    readonly withMobileLayout: boolean;
    readonly withoutSearchEntityViewAffinityInteraction: boolean;
};

const PeekContext = createContext<PeekContext | null>(null);

/**
 * Get the context of the peek we are rendering in if we are rendering in
 * a peek. If we are not rendering in a peek then this will return null.
 */
export function usePeekContext(): PeekContext | null {
    return useContext(PeekContext);
}

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
    // For peeks we want to create a mini navigation context embedded in our
    // app. We want that navigation context to have the same behaviors as
    // navigating in our app more generally:
    //
    // - Wait to navigate while loader data and route modules load
    // - Use the same `useNavigate()` hooks in component code which automatically
    //   go to the right place
    // - Data load is powered by a Remix loader function
    //
    // However, we want our embedded peek navigation stack to be separate from the
    // browser's navigation stack. You should be able to navigate in the browser
    // and navigate in the peek independently.
    //
    // To accomplish this we reuse Remix's data loading and routing internals to
    // create, effectively, another instance of Remix! This is very undocumented,
    // will be tricky to upgrade, and requires some patching of Remix and React
    // Router. However, the effect it creates is incredible and differentiates
    // us from other productivity tools. You have (multiple) full navigation
    // contexts on the page at once.
    const remixContext = useContext(RemixContext);
    assert(remixContext, "Expected remix context");

    const parentDataRouterContext = useContext(DataRouterContext);
    assert(parentDataRouterContext, "Expected data router context");

    const navigate = useNavigate();

    // We only want to allow peek routes to be rendered from a peek embed. So take
    // the full route tree from our remix context and create a new tree with just
    // the peek routes.
    //
    // A warning will be logged if you try to access a non-peek URL from this
    // instance of React Router.
    const peekRoutes: Array<DataRouteObject> = useMemo(() => {
        try {
            const routes = parentDataRouterContext.router.routes as Array<DataRouteObject>;
            assert(routes.length === 1);
            const rootRoute = routes[0]!;
            assert(rootRoute.id === "root");
            const spaceRoute = assertExists(
                rootRoute.children?.find(route => route.id === "routes/s.$spaceId"),
            ) as DataRouteObject;
            const spacePeekRoute = assertExists(
                spaceRoute.children?.find(route => route.id === "routes/s.$spaceId.peek"),
            ) as DataRouteObject;
            return [
                {
                    id: rootRoute.id,
                    caseSensitive: spaceRoute.caseSensitive,
                    path: spaceRoute.path,
                    children: [spacePeekRoute],
                },
            ];
        } catch (error) {
            throw InternalError.from(error, "Could not find peek Remix client route");
        }
    }, [parentDataRouterContext.router.routes]);

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
                // https://github.com/remix-run/react-router/blob/bc2552840147206716544e5cdcdb54f649f9193f/packages/react-router/index.ts#L258-L282
                const router = createRouter({
                    history: {
                        ...history,

                        // Spreading copies the current value of getters so manually override
                        // the getters.
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

                        // By default, memory history will return a URL with the domain
                        // `http://localhost` (no port). Make sure to use the right domain.
                        createURL: to => new URL(history.createHref(to), window.location.origin),
                    },
                    hydrationData,
                    routes: peekRoutes,
                    mapRouteProperties,
                    future: {
                        v7_normalizeFormMethod: remixContext.future.v2_normalizeFormMethod,
                        v7_prependBasename: true,
                    },
                }).initialize();

                const peekRouter: PeekRemixEmbedRouter = {
                    ...router,

                    // Spreading copies the current value of getters so manually override
                    // the getters.
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

                        // Otherwise, navigate to the URL in the broader product. This should close
                        // all our peeks.
                        return navigate(to, options);
                    },
                };

                return peekRouter;
            },
            [navigate, peekRoutes, remixContext.future.v2_normalizeFormMethod],
        ),
    };
}

/**
 * Embeds an instance of Remix with in-memory navigation that only renders
 * peek routes in our broader app. This gives a much better experience than
 * `<iframe>`s since the embed can still talk to the larger app.
 */
export function PeekRemixEmbed({
    peekId,
    withMobileLayout,
    withoutSearchEntityViewAffinityInteraction = false,
    router: originalRouter,
    onGoBackOverflow,
}: {
    peekId: PeekId;
    withMobileLayout: boolean;
    withoutSearchEntityViewAffinityInteraction?: boolean;
    router: PeekRemixEmbedRouter;
    onGoBackOverflow?: () => void;
}) {
    const onGoBackOverflowRef = useRef(onGoBackOverflow);

    useLayoutEffectWithoutServerSideWarning(() => {
        onGoBackOverflowRef.current = onGoBackOverflow;
    });

    const router: Router = useMemo(() => {
        return {
            ...originalRouter,

            // Spreading copies the current value of getters so manually override
            // the getters.
            // https://github.com/remix-run/react-router/blob/bc2552840147206716544e5cdcdb54f649f9193f/packages/router/router.ts#L2508-L2516
            get basename() {
                return originalRouter.basename;
            },
            get state() {
                return originalRouter.state;
            },
            get routes() {
                return originalRouter.routes;
            },

            // If we are navigating a relative number of steps (e.g. -1) then detect if we
            // are navigating backwards beyond the number of entries in our router. If so
            // we want to call `onGoBackOverflow()`.
            navigate: (to: number | To | null, options?: RouterNavigateOptions): Promise<void> => {
                if (typeof to === "number") {
                    const remainingEntries =
                        originalRouter.getHistoryEntries().length -
                        (originalRouter.getHistoryIndex() + 1);

                    if (to < 0 && -to > remainingEntries) {
                        if (remainingEntries > 0) {
                            const promise = originalRouter.navigate(-remainingEntries);
                            onGoBackOverflowRef.current?.();
                            return promise;
                        } else {
                            onGoBackOverflowRef.current?.();
                            return Promise.resolve();
                        }
                    } else {
                        return originalRouter.navigate(to);
                    }
                }

                return originalRouter.navigate(to, options);
            },
        };
    }, [originalRouter]);

    // We don't currently use `location` but seems useful to have around and
    // `<RemixBrowser>` has it. So useful to maintain parity.
    const [, setLocation] = useState(router.state.location);

    useLayoutEffectWithoutServerSideWarning(() => {
        return router.subscribe(newState => setLocation(newState.location));
    }, [router]);

    return (
        <PeekContext.Provider
            value={useMemo(
                () => ({
                    id: peekId,
                    withMobileLayout,
                    withoutSearchEntityViewAffinityInteraction,
                }),
                [peekId, withMobileLayout, withoutSearchEntityViewAffinityInteraction],
            )}
        >
            <UpdateMetaTitleContextProvider
                // Ignore title updates in a Remix embed. We currently don't render the title
                // of a Remix embed though may in the future when allowing the user to navigate
                // through embeds.
                onUpdateMetaTitle={useCallback(() => {}, [])}
            >
                <RouteContext.Provider
                    // The `<Router>` component does not reset this context but it needs to be reset
                    // or else when we try to render nested routes they think they are within the
                    // context of our parent router. Initial value can be found here:
                    // https://github.com/remix-run/react-router/blob/230d9e5539c410c0c747db8670ec5de1d51558ae/packages/react-router/lib/context.ts#L143-L146
                    //
                    // See our comment below on how rendering nested `<Router>`s is not officially
                    // supported.
                    value={useMemo(
                        () => ({
                            outlet: null,
                            matches: [],
                            isDataRoute: false,
                        }),
                        [],
                    )}
                >
                    {typeof window === "undefined" ? (
                        // When server-rendering use `<StaticRouterProvider>` like `<RemixServer>`.
                        // `<StaticRouterProvider>` is carefully written to have the same DOM structure
                        // as `<RouterProvider>` for hydration.
                        // https://github.com/remix-run/remix/blob/1c416b0b9baadbd75974ee72efb651b8186670cb/packages/remix-react/server.tsx#L27
                        <StaticRouterProvider
                            router={router}
                            context={{
                                basename: router.basename,
                                location: router.state.location,
                                matches: router.state.matches,
                                loaderData: router.state.loaderData,
                                actionData: router.state.actionData,
                                errors: router.state.errors,
                                statusCode: 200,
                                loaderHeaders: {},
                                actionHeaders: {},
                                activeDeferreds: null,
                            }}
                            hydrate={false}
                            // See comment below on `dangerouslyAllowNesting`...
                            dangerouslyAllowNesting={true}
                        />
                    ) : (
                        <RouterProvider
                            router={router}
                            fallbackElement={null}
                            future={{v7_startTransition: true}}
                            // React Router has an assertion which bans you from rendering a `<Router>`
                            // inside of another `<Router>`. Likely to avoid developers making silly
                            // mistakes.
                            //
                            // However, we have a real use case! We want to render a `<Router>` powered by
                            // in-memory history within our Remix `<Router>` powered by browser history.
                            //
                            // So we patch `react-router` to add this prop here that turns off the
                            // assertion. Nested `<Router>`s are therefore not officially supported so we
                            // take all responsibility for making sure it works well.
                            dangerouslyAllowNesting={true}
                        />
                    )}
                </RouteContext.Provider>
            </UpdateMetaTitleContextProvider>
        </PeekContext.Provider>
    );
}
