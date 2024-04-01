import {IDLE_BLOCKER, IDLE_FETCHER, Router, RouterState, stripBasename} from "@remix-run/router";
import {CSSProperties, ContextType, Memo, useContext, useMemo} from "react";
import {
    UNSAFE_DataRouterContext as DataRouterContext,
    UNSAFE_DataRouterStateContext as DataRouterStateContext,
    UNSAFE_LocationContext as LocationContext,
    UNSAFE_NavigationContext as NavigationContext,
    Navigator,
    UNSAFE_RouteContext as RouteContext,
    renderMatches,
} from "react-router";
import {GlobalKeyDownEvent} from "~/client/helpers/global_key_down_event.js";
import {UpdateMetaTitleContextProvider} from "~/client/remix/use_update_meta_title.js";
import {InternalError} from "~/shared/error/error.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.js";

// NOCOMMIT: Integration test this router?? All navigation flows from
// `NativeMobileBridge`. Outside of a space and inside of a space.
export function NativeMobileOutlet({
    parentRouteIds,
    tracer,
    inertRouterState,
    onUpdateMetaTitle,
    className,
    style,
}: {
    parentRouteIds: ReadonlyArray<string>;
    tracer: TracerRoot;
    inertRouterState: RouterState | null;
    onUpdateMetaTitle: Memo<(title: string) => void>;
    className?: string;
    style?: CSSProperties;
}) {
    const isInert = inertRouterState !== null;

    const currentDataRouterContext = assertExists(useContext(DataRouterContext));
    const currentDataRouterStateContext = useContext(DataRouterStateContext);
    const currentNavigationContext = useContext(NavigationContext);
    const currentLocationContext = useContext(LocationContext);
    const currentRouteContext = useContext(RouteContext);

    const {dataRouterContext, dataRouterStateContext, navigationContext, locationContext, outlet} =
        useMemo(() => {
            if (!inertRouterState) {
                return {
                    dataRouterContext: currentDataRouterContext,
                    dataRouterStateContext: currentDataRouterStateContext,
                    navigationContext: currentNavigationContext,
                    locationContext: currentLocationContext,
                    outlet: currentRouteContext.outlet,
                };
            }

            const currentRouter = currentDataRouterContext.router;

            const router: Router & {_isInert: boolean} = {
                _isInert: true,

                initialize: () => router,
                dispose: () => {},

                get basename() {
                    return currentRouter.basename;
                },
                get state() {
                    return inertRouterState;
                },
                get routes() {
                    return currentRouter.routes;
                },
                subscribe: () => {
                    // Inert router state never changes.
                    return () => {};
                },
                enableScrollRestoration: () => {
                    return () => {};
                },
                navigate: async () => {
                    tracer.logUncaughtException(
                        "Inert route activity",
                        new InternalError("Can't navigate in an inert route"),
                    );
                },
                fetch: () => {
                    // NOTE(calebmer): Maybe there's a use-case for fetching in an inert route? For
                    // example if we implement something like combobox data loading with fetchers
                    // instead of `useLazyLoadRpc()`. Maybe if revalidate is called we should hold
                    // it until the user pops back. I have no intention of supporting this use case
                    // but we could add in the future.
                    tracer.logUncaughtException(
                        "Inert route activity",
                        new InternalError("Can't fetch in an inert route"),
                    );
                },
                revalidate: () => {
                    // NOTE(calebmer): Maybe there's a use-case for revalidating an inert route?
                    // e.g. Polling? Maybe if revalidate is called we should hold it until the user
                    // pops back. I have no intention of supporting this use case but we could add
                    // in the future.
                    tracer.logUncaughtException(
                        "Inert route activity",
                        new InternalError("Can't revalidate in an inert route"),
                    );
                },
                createHref: currentRouter.createHref.bind(currentRouter),
                encodeLocation: currentRouter.encodeLocation.bind(currentRouter),
                getFetcher: key => {
                    return inertRouterState.fetchers.get(key as any) ?? IDLE_FETCHER;
                },
                deleteFetcher: key => {
                    // If the fetcher is already deleted. This is a noop. This method is called by
                    // an effect in `useFetcher()` when the `router` object changes. Our inert
                    // fetcher does no work so we don't need to garbage collect fetchers.
                    if (!inertRouterState.fetchers.has(key!)) {
                        return;
                    }

                    tracer.logUncaughtException(
                        "Inert route activity",
                        new InternalError("Can't delete fetcher in an inert route"),
                    );
                },
                getBlocker: () => {
                    tracer.logUncaughtException(
                        "Inert route activity",
                        new InternalError("Can't get blocker in an inert route"),
                    );
                    return IDLE_BLOCKER;
                },
                deleteBlocker: () => {
                    tracer.logUncaughtException(
                        "Inert route activity",
                        new InternalError("Can't delete blocker in an inert route"),
                    );
                },
                _internalSetRoutes: () => {
                    tracer.logUncaughtException(
                        "Inert route activity",
                        new InternalError("Can't call `_internalSetRoutes` in an inert route"),
                    );
                },
                _internalFetchControllers: new Map(),
                _internalActiveDeferreds: new Map(),
                unstable_unsafelyRestoreNavigation: async () => {
                    tracer.logUncaughtException(
                        "Inert route activity",
                        new InternalError(
                            "Can't call `unstable_unsafelyRestoreNavigation` in an inert route",
                        ),
                    );
                },
            };

            const navigator: Navigator = {
                createHref: router.createHref.bind(router),
                encodeLocation: router.encodeLocation.bind(router),
                go: n => void router.navigate(n),
                push: (to, state, opts) => {
                    void router.navigate(to, {
                        state,
                        preventScrollReset: opts?.preventScrollReset,
                    });
                },
                replace: (to, state, opts) => {
                    void router.navigate(to, {
                        replace: true,
                        state,
                        preventScrollReset: opts?.preventScrollReset,
                    });
                },
            };

            const basename = router.basename || "/";

            const dataRouterContext: ContextType<typeof DataRouterContext> = {
                router,
                navigator,
                static: false,
                basename,
            };

            // Wow, this is basically the same as `dataRouterContext`. Feels like
            // Remix/`react-router` could consolidate.
            const navigationContext: ContextType<typeof NavigationContext> = {
                basename,
                navigator,
                static: false,
            };

            const {
                pathname = "/",
                search = "",
                hash = "",
                state = null,
                key = "default",
            } = inertRouterState.location;

            const trailingPathname = stripBasename(pathname, basename);

            const locationContext: ContextType<typeof LocationContext> = {
                location: {
                    pathname: assertExists(trailingPathname),
                    search,
                    hash,
                    state,
                    key,
                },
                navigationType: inertRouterState.historyAction,
            };

            let hasErrorInParentRoute = false;

            for (let i = 0; i < parentRouteIds.length; i++) {
                const parentRouteId = parentRouteIds[i]!;

                if (inertRouterState.errors?.[parentRouteId]) {
                    hasErrorInParentRoute = true;
                }

                if (inertRouterState.matches[i]?.route.id !== parentRouteId) {
                    throw new InternalError(quote`Match index ${i} must be ${parentRouteId}`);
                }
            }

            const matches = inertRouterState.matches.slice(parentRouteIds.length);
            const parentMatches = inertRouterState.matches.slice(0, parentRouteIds.length);

            return {
                dataRouterContext,
                dataRouterStateContext: inertRouterState,
                navigationContext,
                locationContext,
                outlet: !hasErrorInParentRoute
                    ? renderMatches(matches, parentMatches, inertRouterState, {
                          disableErrorBoundaryForFirstMatch: true,
                      })
                    : // If there's an error in the parent route, we render nothing for our inert
                      // route. If the inert route becomes the primary route again then the error
                      // component is completely remounted.
                      //
                      // `renderMatches()` throws an error if you try to render with errors in a
                      // parent route.
                      null,
            };
        }, [
            currentDataRouterContext,
            currentDataRouterStateContext,
            currentLocationContext,
            currentNavigationContext,
            currentRouteContext.outlet,
            inertRouterState,
            parentRouteIds,
            tracer,
        ]);

    return (
        <div
            className={className}
            style={{
                ...style,
                // While inert, remove the document from the content flow and make
                // it invisible. `bottom: 0` is so that a tall inert route doesn't grow
                // our `<body>`'s height.
                position: isInert ? "absolute" : undefined,
                bottom: isInert ? "0" : undefined,
                visibility: isInert ? "hidden" : undefined,
                // A `<div>` positioned relatively is implicitly `width: 100%`. Make sure the
                // absolutely positioned inert route gets the same width.
                left: isInert ? "0" : undefined,
                right: isInert ? "0" : undefined,
            }}
            // The [`<Offscreen>` component][1] React claims is coming may be a better
            // fit here so we don't actually render content in the DOM. `inert` has good
            // browser support though!
            //
            // [1]: https://react.dev/blog/2022/03/29/react-v18
            // [2]: https://caniuse.com/?search=inert
            //
            // TypeScript doesn't know about this property yet. True is the [empty string
            // and false is null][3].
            //
            // [3]: https://github.com/WICG/inert/issues/58#issuecomment-618016847
            //
            // @ts-expect-error
            inert={isInert ? "" : null}
            // Make sure inert content is not in the accessibility tree.
            aria-hidden={isInert ? "true" : undefined}
        >
            <DataRouterContext.Provider value={dataRouterContext}>
                <DataRouterStateContext.Provider value={dataRouterStateContext}>
                    <NavigationContext.Provider value={navigationContext}>
                        <LocationContext.Provider value={locationContext}>
                            <GlobalKeyDownEvent
                                // Don't process global `keydown` events when our peek content is hidden. Very
                                // weird if you hit cmd-z and an inert route is updated.
                                isDisabled={isInert}
                            >
                                <UpdateMetaTitleContextProvider
                                    onUpdateMetaTitle={
                                        isInert ? (noop as Memo<() => void>) : onUpdateMetaTitle
                                    }
                                >
                                    {outlet}
                                </UpdateMetaTitleContextProvider>
                            </GlobalKeyDownEvent>
                        </LocationContext.Provider>
                    </NavigationContext.Provider>
                </DataRouterStateContext.Provider>
            </DataRouterContext.Provider>
        </div>
    );
}
