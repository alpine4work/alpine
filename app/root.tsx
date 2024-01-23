import {
    Links,
    LiveReload,
    Meta,
    Outlet,
    UNSAFE_RemixContext as RemixContext,
    Scripts,
    ScrollRestoration,
} from "@remix-run/react";
import {IDLE_BLOCKER, IDLE_FETCHER, Router, RouterState, stripBasename} from "@remix-run/router";
import {LinkDescriptor} from "@remix-run/server-runtime";
import {IconContext} from "phosphor-react";
import prosemirrorStylesHref from "prosemirror-view/style/prosemirror.css";
import {
    ContextType,
    Memo,
    ReactNode,
    useCallback,
    useContext,
    useEffect,
    useInsertionEffect,
    useMemo,
    useRef,
} from "react";
import {
    UNSAFE_DataRouterContext as DataRouterContext,
    UNSAFE_DataRouterStateContext as DataRouterStateContext,
    UNSAFE_LocationContext as LocationContext,
    UNSAFE_NavigationContext as NavigationContext,
    Navigator,
    UNSAFE_RouteContext as RouteContext,
    isRouteErrorResponse,
    renderMatches,
    useRouteError,
} from "react-router";
import {isNativeMobileRouterState} from "~/app/router/app_remix_browser.js";
import {AccountClientStoreContextProvider} from "~/client/accounts/account_client_store_context_provider.js";
import {AppContextProvider, useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {ErrorBodyRenderer} from "~/client/design/error_body_renderer.js";
import {OverlayScopeContextProvider} from "~/client/design/overlay.js";
import {ToastContextProvider} from "~/client/design/toast.js";
import {TooltipCoordinationContextProvider} from "~/client/design/tooltip.js";
import {
    InitializeColorSchemeScript,
    getColorSchemeWithoutListeningIfBrowser,
} from "~/client/helpers/color_scheme.js";
import {
    GlobalKeyDownEvent,
    GlobalKeyDownRootContextProvider,
} from "~/client/helpers/global_key_down_event.js";
import {AppInitialRenderContextProvider} from "~/client/helpers/lifecycle/use_is_initial_app_render.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useStableValue} from "~/client/helpers/use_stable_value.js";
import {ClientInfoContextProvider} from "~/client/remix/client_info_context.js";
import {getLoaderDataWithSchema} from "~/client/remix/get_loader_data_with_schema.js";
import {NativeMobileBridge} from "~/client/remix/native_mobile_bridge.js";
import {CurrentTimeContextProvider} from "~/client/remix/use_current_time_rounded_to_hour.js";
import {IsMobileContextProvider} from "~/client/remix/use_is_mobile.js";
import {WaitForNavigationContextProvider} from "~/client/remix/use_navigate.js";
import {UpdateMetaTitleContextProvider} from "~/client/remix/use_update_meta_title.js";
import {SwrCacheContextProvider} from "~/client/rpc/use_swr.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {spacing} from "~/shared/design/spacing.js";
import {InternalError, NotFoundError, UnknownError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {hasOwnProperty} from "~/shared/helpers/object/has_own_property.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {getRealmId} from "~/shared/id/realm_id.js";
import {BrowserId} from "~/shared/id/types/id_types.js";
import {ClientInfoSchema, defaultClientInfo} from "~/shared/remix/client_info.js";
import {propagateEventDataKey} from "~/shared/remix/json_with_schema_shared.js";
import {Schema} from "~/shared/schema/schema.js";
import sharedStylesHref from "~/shared/styles/styles.css";
import {sprinkles} from "~/shared/styles/styles.js";
import {mergeTracerEventData} from "~/shared/tracer/helpers/merge_tracer_event_data.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.js";
import {TracerEventFullData} from "~/shared/tracer/types/tracer_event_data.js";

export function meta() {
    return [{title: "Cyberworlds"}];
}

export function links(): Array<LinkDescriptor> {
    return [
        {rel: "stylesheet", href: sharedStylesHref},
        // ProseMirror includes some lightweight styling that's required for it to
        // work correctly.
        {rel: "stylesheet", href: prosemirrorStylesHref},
        // Recommend the SVG favicon so it can render in light and dark mode.
        {rel: "icon", href: "/favicon.svg"},
    ];
}

// The loader returns constants. We don't need to reload on page change.
export const shouldRevalidate = () => false;

const LoaderSchema = Schema.object({
    initialTime: Schema.date,
    browserId: Schema.id<BrowserId>(),
    clientInfo: ClientInfoSchema,
    devServerPort: Schema.integer.optional(),
});

export function loader({context}: LoaderArgs) {
    return jsonWithSchema(LoaderSchema, {
        initialTime: context.loader.getInitialTime(),
        browserId: context.loader.getBrowserId(),
        clientInfo: context.loader.getClientInfo(),
        devServerPort: context.loader.devServerPort ?? undefined,
    });
}

export default function Root() {
    const remixContext = useContext(RemixContext);
    assert(remixContext, "Expected Remix context");

    const dataRouterContext = useContext(DataRouterContext);
    assert(dataRouterContext, "Expected data router context");

    const dataRouterStateContext = useContext(DataRouterStateContext);
    assert(dataRouterStateContext, "Expected data router state context");

    let context = useAppContext();

    // Add propagated event data to our tracer so that child React components
    // log events with the right context.
    context = useMemo(() => {
        const loaderData = Object.values(dataRouterStateContext.loaderData);

        const propagatedEventData = filterMapArray(loaderData, data => {
            if (!data) return null;
            if (!hasOwnProperty(data, propagateEventDataKey)) return null;
            return data[propagateEventDataKey] as TracerEventFullData;
        });

        if (propagatedEventData.length === 0) return context;
        return context.tracer.withPropagatedData(mergeTracerEventData(propagatedEventData));
    }, [dataRouterStateContext.loaderData, context]);

    // If there are any unhandled browser errors then report them with our tracer.
    // We put uncaught error handling here because we want it to include propagated
    // data from loaders.
    //
    // TODO(calebmer): Unhandled errors should display a blocking modal. Generally
    // you should prefer display errors (like a button press error) with a toast
    // since it's lightweight and lets the user try again. We automatically do this
    // in `<Button>` components. If there's an unhandled error, though, show that
    // with a blocking modal since we don't know whether we're left in a good state
    // or not.
    useEffect(() => {
        const handleError = (event: ErrorEvent) => {
            // If some other error event handler called `event.preventDefault()` then the
            // error will be silenced in the browser and we want to silence it here too.
            if (event.defaultPrevented) return;

            // For debugging purposes, errors caught by React are re-thrown as unhandled
            // exceptions so you can use the browser "Pause on uncaught exception" feature.
            //
            // We report these errors through React error boundaries so ignore them here.
            //
            // https://github.com/facebook/react/issues/10474
            if (
                process.env.NODE_ENV !== "production" &&
                // eslint-disable-next-line no-global-error
                new Error().stack?.includes("invokeGuardedCallbackDev")
            ) {
                return;
            }

            context.tracer.getRoot().logUncaughtException(
                "Uncaught exception",
                event.error,
                {},
                {
                    // Uncaught browser errors were already logged. We don't need to do it again.
                    disableConsoleLog: true,
                },
            );
        };

        window.addEventListener("error", handleError);
        return () => {
            window.removeEventListener("error", handleError);
        };
    }, [context.tracer]);

    const lastLocationKeyForInsertionEffectRef = useRef(dataRouterStateContext.location.key);
    const lastLocationKeyForLayoutEffectRef = useRef(dataRouterStateContext.location.key);

    // 1. Prepare navigation animation before we paint our new screen
    useInsertionEffect(() => {
        if (lastLocationKeyForInsertionEffectRef.current === dataRouterStateContext.location.key)
            return;
        lastLocationKeyForInsertionEffectRef.current = dataRouterStateContext.location.key;

        if (dataRouterStateContext.historyAction === "PUSH") {
            // TODO(calebmer): I'd like to add some performance instrumentation to find out
            // how much time we spend synchronously blocked. Ideally add it as a property
            // to a navigation span since the duration may be too small to justify its
            // own span.
            NativeMobileBridge?.preparePushNavigationAnimation();
        }
    }, [dataRouterStateContext.historyAction, dataRouterStateContext.location.key]);

    // 2. Run navigation animation after we paint our new screen
    useLayoutEffectWithoutServerSideWarning(() => {
        if (lastLocationKeyForLayoutEffectRef.current === dataRouterStateContext.location.key)
            return;
        lastLocationKeyForLayoutEffectRef.current = dataRouterStateContext.location.key;

        if (dataRouterStateContext.historyAction === "PUSH") {
            NativeMobileBridge?.runPushNavigationAnimation();
        }
    }, [dataRouterStateContext.historyAction, dataRouterStateContext.location.key]);

    // `useLoaderData()` doesn't work in an error boundary or catch boundary.
    // We use this exact component for error and catch boundaries to avoid
    // remounting when navigating between errors and non-errors. So manually
    // deserialize the data for this route.
    const loaderData = useMemo(
        () =>
            dataRouterStateContext.loaderData.root
                ? getLoaderDataWithSchema(LoaderSchema, dataRouterStateContext.loaderData.root)
                : null,
        [dataRouterStateContext.loaderData.root],
    );

    const routeError = useRouteError();

    const error = useMemo(() => {
        if (!routeError) return undefined;

        if (isRouteErrorResponse(routeError)) {
            if (routeError.status === 404)
                return new NotFoundError("Route not found", {
                    displayMessage: errorDisplayMessage`The page you opened could not be found. If you got here from a broken link let us know at ${errorDisplayMessage.supportLink}`,
                });

            return new UnknownError(
                quote`Response thrown with status ${routeError.status} ${routeError.statusText}`,
            );
        }

        return routeError;
    }, [routeError]);

    // In case we don't have loader data (an error was thrown) fallback to trying
    // to read the current date.
    const initialTime = useMemo(
        () => loaderData?.initialTime ?? new Date(),
        [loaderData?.initialTime],
    );

    const nativeMobileRouterState = isNativeMobileRouterState(dataRouterStateContext)
        ? dataRouterStateContext
        : null;

    const nodes: Array<ReactNode> = [];
    let nodeKey = 1;

    const onUpdateMetaTitle = useCallback((title: string) => {
        document.title = title;
    }, []);

    if (!nativeMobileRouterState) {
        nodes.push(
            // Render a `<div>` around children even when we're not rendering in the
            // context of our native mobile app so that layout is consistent across native
            // mobile and everything else.
            <div key={nodeKey++} style={{width: "100%", height: "100%"}}>
                <UpdateMetaTitleContextProvider onUpdateMetaTitle={onUpdateMetaTitle}>
                    {error !== undefined ? (
                        <RootErrorRenderer
                            error={error}
                            title={
                                isRouteErrorResponse(routeError) && routeError.status === 404
                                    ? "Could not find content"
                                    : undefined
                            }
                        />
                    ) : (
                        <Outlet />
                    )}
                </UpdateMetaTitleContextProvider>
            </div>,
        );
    } else {
        // When in our native mobile app, we render multiple routes to the DOM at once!
        // We render the active route and we render previous routes in an inert state.
        // Inert routes are invisible and the user can't interact with them through
        // keyboard, mouse, anything. The reason we do this is two-fold:
        //
        // 1. Because we end up navigating more frequently on mobile, users expect when
        //    they return to a route for it to be in the exact same state as when they
        //    left it. Same scroll position, same text left in inputs, same everything.
        //
        // 2. If the user is swiping to go back, we render an old snapshot of the view
        //    we took while waiting for the web view to update. If our new web view is
        //    in a different state there will be a flash as we transition from the
        //    snapshot to the actual view.
        //
        // By keeping routes in the navigation stack rendered in the DOM (with their
        // React states and effects all still active) when the user returns to that
        // screen their state is entirely preserved.
        //
        // Keep in mind, it's not enough to unmount a route but preserve its loader
        // data, then render a route again with the old loader data. This resets UI
        // state like scroll position.
        //
        // NOCOMMIT: Limit number of inert router states to 7 or so
        for (const inertRouterState of nativeMobileRouterState.inertRouterStates) {
            nodes.push(
                <NativeMobileRootOutlet
                    // Previous rendered routes need to preserve their keys if a new route is
                    // pushed. So the first route in our stack has a key of 1, the second 2, and so
                    // on. Newly pushed routes get new keys.
                    //
                    // We can't use `location.key` because if the URL is replaced then
                    // `location.key` changes but we don't want to fully remount our routes.
                    key={nodeKey++}
                    tracer={context.tracer.getRoot()}
                    inertRouterState={inertRouterState}
                    onUpdateMetaTitle={onUpdateMetaTitle}
                />,
            );
        }

        if (error !== undefined) {
            // NOTE(calebmer): There's probably a cleaner way to handle errors. I believe
            // what will happen is that if an error is pushed to `inertRouteStates` then
            // `<NativeMobileRootOutlet>` will render nothing (since the error handler is
            // here at the root level). If the route becomes active again then we
            // completely re-render an entirely new `<RootErrorRenderer>` component.
            nodes.push(
                <RootErrorRenderer
                    key={nodeKey++}
                    error={error}
                    title={
                        isRouteErrorResponse(routeError) && routeError.status === 404
                            ? "Could not find content"
                            : undefined
                    }
                />,
            );
        } else {
            nodes.push(
                <NativeMobileRootOutlet
                    key={nodeKey++}
                    tracer={context.tracer.getRoot()}
                    inertRouterState={null}
                    onUpdateMetaTitle={onUpdateMetaTitle}
                />,
            );
        }
    }

    // Put the latest item in the history stack first in the DOM.
    if (nodes.length > 1) {
        nodes.reverse();
    }

    const wrappedChildren = (
        <IconContext.Provider value={{color: "currentColor", size: spacing["5"]}}>
            <AppContextProvider value={context}>
                <AppInitialRenderContextProvider>
                    <ClientInfoContextProvider
                        // If there was an error at our root loader and we couldn't load `BrowserId`
                        // then use the `RealmId` as the `BrowserId`.
                        browserId={loaderData?.browserId ?? (getRealmId() as any as BrowserId)}
                        initialClientInfo={loaderData?.clientInfo ?? defaultClientInfo}
                    >
                        <CurrentTimeContextProvider initialTime={initialTime}>
                            <IsMobileContextProvider>
                                <SwrCacheContextProvider>
                                    <WaitForNavigationContextProvider>
                                        <GlobalKeyDownRootContextProvider>
                                            <AccountClientStoreContextProvider>
                                                <OverlayScopeContextProvider>
                                                    <TooltipCoordinationContextProvider>
                                                        <ToastContextProvider>
                                                            {nodes}
                                                        </ToastContextProvider>
                                                    </TooltipCoordinationContextProvider>
                                                </OverlayScopeContextProvider>
                                            </AccountClientStoreContextProvider>
                                        </GlobalKeyDownRootContextProvider>
                                    </WaitForNavigationContextProvider>
                                </SwrCacheContextProvider>
                            </IsMobileContextProvider>
                        </CurrentTimeContextProvider>
                    </ClientInfoContextProvider>
                </AppInitialRenderContextProvider>
            </AppContextProvider>
        </IconContext.Provider>
    );

    return (
        <html lang="en" data-color-scheme={getColorSchemeWithoutListeningIfBrowser()}>
            <head>
                <meta charSet="utf-8" />
                <meta
                    name="viewport"
                    // - `user-scalable=no`: Don't allow pinch to zoom. This is against
                    //    industry accessibility guidelines. We want our site to feel like an app
                    //    and apps don't allow zooming. Zooming is a very web feeling behavior. To
                    //    help users with accessibility needs we should add support for font
                    //    scaling.
                    //
                    // - `viewport-fit=cover`: Render content under [safe area insets][2]. We use
                    //   `env(safe-area-inset-*)` to make sure we add the appropriate amount of
                    //   padding.
                    //
                    // [1]: https://developer.mozilla.org/en-US/docs/Web/HTML/Viewport_meta_tag
                    // [2]: https://webkit.org/blog/7929/designing-websites-for-iphone-x/
                    content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"
                />
                <meta
                    // Ask Google to not index any of our routes.
                    // https://developers.google.com/search/docs/crawling-indexing/block-indexing
                    //
                    // TODO(calebmer): This should be decided on a route-by-route basis instead of
                    // global configuration that can't be configured.
                    name="robots"
                    content="noindex"
                />
                <Meta />
                <Links />
                <InitializeColorSchemeScript />
            </head>
            <body>
                {wrappedChildren}
                <ScrollRestoration />
                {loaderData?.devServerPort && <LiveReload port={loaderData.devServerPort} />}
                <Scripts />
            </body>
        </html>
    );
}

function RootErrorRenderer({error: _error, title}: {error: unknown; title?: string}) {
    // It appears that Remix does not `useMemo()` its error object. So stabilize
    // the object reference here. Our error rendering components use referential
    // identity to determine whether we need to log the error.
    const error = useStableValue(ErrorSchema, _error);

    return (
        <Box display="flex" justifyContent="center">
            <main
                className={sprinkles({
                    width: "full",
                    maxWidth: "128",
                    paddingX: "8",
                    paddingY: {desktop: "32", mobile: "16"},
                })}
            >
                <ErrorBodyRenderer title={title ?? "Couldn’t show content"} error={error} />
            </main>
        </Box>
    );
}

// We use the same `<Root>` component for the error boundary component so that
// if Remix navigates between root and error boundary we don't remount the
// HTML. (Which appears to cause CSS to flash off.)
export const ErrorBoundary = Root;

// NOCOMMIT: Integration test this router??
function NativeMobileRootOutlet({
    tracer,
    inertRouterState,
    onUpdateMetaTitle,
}: {
    tracer: TracerRoot;
    inertRouterState: RouterState | null;
    onUpdateMetaTitle: Memo<(title: string) => void>;
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

            const router: Router = {
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
                    tracer.logUncaughtException(
                        "Inert route activity",
                        new InternalError("Can't fetch in an inert route"),
                    );
                },
                revalidate: () => {
                    // TODO(calebmer): Maybe there's a use-case for revalidating an inert route?
                    // e.g. Polling? Maybe if revalidate is called we should hold it until the user
                    // pops back.
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
                deleteFetcher: () => {
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
                _internalUnsafelyRestoreNavigation: () => {
                    tracer.logUncaughtException(
                        "Inert route activity",
                        new InternalError(
                            "Can't call `_internalUnsafelyRestoreNavigation` in an inert route",
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

            assert(inertRouterState.matches[0]?.route.id === "root", "First match must be `root`");
            const matches = inertRouterState.matches.slice(1);
            const parentMatches = inertRouterState.matches.slice(0, 1);

            return {
                dataRouterContext,
                dataRouterStateContext: inertRouterState,
                navigationContext,
                locationContext,
                outlet: renderMatches(matches, parentMatches, inertRouterState),
            };
        }, [
            currentDataRouterContext,
            currentDataRouterStateContext,
            currentLocationContext,
            currentNavigationContext,
            currentRouteContext.outlet,
            inertRouterState,
            tracer,
        ]);

    return (
        <div
            style={{
                width: "100%",
                height: "100%",
                // While inert, remove the document from the content flow and make
                // it invisible. `bottom: 0` is so that a tall inert route doesn't grow
                // our `<body>`'s height.
                position: isInert ? "absolute" : undefined,
                bottom: isInert ? "0" : undefined,
                visibility: isInert ? "hidden" : undefined,
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
