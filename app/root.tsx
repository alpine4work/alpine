import {
    Links,
    Meta,
    Outlet,
    UNSAFE_RemixContext as RemixContext,
    Scripts,
    ScrollRestoration,
} from "@remix-run/react";
import {LinkDescriptor} from "@remix-run/server-runtime";
import {IconContext} from "phosphor-react";
import {ReactNode, useCallback, useContext, useEffect, useMemo} from "react";
import {
    UNSAFE_DataRouterContext as DataRouterContext,
    UNSAFE_DataRouterStateContext as DataRouterStateContext,
    isRouteErrorResponse,
    useRouteError,
} from "react-router";
import {notFoundErrorDisplayMessage} from "~/app/helpers/not_found_error_display_message.js";
import {AppLiveReload} from "~/app/router/app_live_reload.js";
import {NativeMobileOutlet} from "~/app/router/native_mobile_outlet.js";
import {isNativeMobileRouterState} from "~/app/router/native_mobile_router.js";
import {AccountClientStoreContextProvider} from "~/client/accounts/account_client_store_context_provider.js";
import {AppContextProvider, useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {ErrorBodyRenderer} from "~/client/design/error_body_renderer.js";
import {MobileFullScreenModalContextProvider} from "~/client/design/mobile_full_screen_modal.js";
import {RootOverlayScopeContextProvider} from "~/client/design/overlay.js";
import {BottomBarFrameContextProvider} from "~/client/design/subscribe_to_bottom_bar_frame_change.js";
import {ToastContextProvider} from "~/client/design/toast.js";
import {TooltipCoordinationContextProvider} from "~/client/design/tooltip.js";
import {
    ColorSchemeManager,
    getColorSchemeWithoutListeningIfBrowser,
} from "~/client/helpers/color_scheme.js";
import {GlobalKeyDownRootContextProvider} from "~/client/helpers/global_key_down_event.js";
import {AppInitialRenderContextProvider} from "~/client/helpers/lifecycle/use_is_initial_app_render.js";
import {useStableValue} from "~/client/helpers/use_stable_value.js";
import {ClientInfoContextProvider} from "~/client/remix/client_info_context.js";
import {getLoaderDataWithSchema} from "~/client/remix/get_loader_data_with_schema.js";
import {CurrentTimeContextProvider} from "~/client/remix/use_current_time_rounded_to_hour.js";
import {IsMobileContextProvider} from "~/client/remix/use_is_mobile.js";
import {WaitForNavigationContextProvider} from "~/client/remix/use_navigate.js";
import {UpdateMetaTitleContextProvider} from "~/client/remix/use_update_meta_title.js";
import {SwrCacheContextProvider} from "~/client/rpc/use_swr.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {spacing} from "~/shared/design/spacing.js";
import {NotFoundError, UnknownError} from "~/shared/error/error.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
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
import {TracerEventFullData} from "~/shared/tracer/types/tracer_event_data.js";

export function meta() {
    return [{title: "Cyberworlds"}];
}

export function links(): Array<LinkDescriptor> {
    return [
        // Preload our primary font Inter from our shared styles in parallel with CSS
        // to try and avoid flashes of unstyled text.
        //
        // https://web.dev/articles/codelab-preload-web-fonts
        {
            rel: "preload",
            href: "/fonts/inter.woff2",
            as: "font",
            crossOrigin: "anonymous",
        },
        {rel: "stylesheet", href: sharedStylesHref},
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

const rootNativeMobileOutletParentRouteIds = ["root"] as const;

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
                event.error ?? new UnknownError(event.message),
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
                    displayMessage: notFoundErrorDisplayMessage,
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

    const outletContainerStyle = {
        minHeight: "100svh",
    };

    if (!nativeMobileRouterState) {
        nodes.push(
            // Render a `<div>` around children even when we're not rendering in the
            // context of our native mobile app so that layout is consistent across native
            // mobile and everything else.
            <div key={nodeKey++} style={outletContainerStyle}>
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
        const renderedSpaceIds = new Set<unknown>();

        const primarySpaceRouteMatch = dataRouterStateContext.matches.find(
            match => match.route.id === "routes/s.$spaceId",
        );

        const getPrimaryNode = () =>
            // NOTE(calebmer): There may be a cleaner way to handle errors. Since error
            // handling only happens for the primary route, if an inert route has an error
            // then nothing will be rendered in the inert route? That's probably fine.
            error !== undefined ? (
                <div key={nodeKey++} style={outletContainerStyle}>
                    <RootErrorRenderer
                        error={error}
                        title={
                            isRouteErrorResponse(routeError) && routeError.status === 404
                                ? "Could not find content"
                                : undefined
                        }
                    />
                </div>
            ) : (
                <NativeMobileOutlet
                    key={nodeKey++}
                    parentRouteIds={rootNativeMobileOutletParentRouteIds}
                    tracer={context.tracer.getRoot()}
                    inertRouterState={null}
                    onUpdateMetaTitle={onUpdateMetaTitle}
                    style={outletContainerStyle}
                />
            );

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
        // data, then render a route again with the old loader data. Doing this would
        // reset UI state like scroll position.
        //
        // Not all our inert routes are rendered here in `root.tsx`. Space inert routes
        // are rendered in `s.$spaceId.tsx`. That way we can share space-level context
        // across inert routes. Like the task realtime client.
        //
        // NOCOMMIT: Limit number of inert router states to 7 or so
        for (const inertRouterState of nativeMobileRouterState.inertRouterStates) {
            // Inert space routes that share the same `SpaceId` should be rendered under
            // one `/s/:spaceId` route so they share the same space context components.
            // So render the first `/s/:spaceId` route we see then trust that component to
            // render the remaining inert router states.
            const inertSpaceRouteMatch = inertRouterState.matches.find(
                match => match.route.id === "routes/s.$spaceId",
            );
            if (inertSpaceRouteMatch) {
                if (renderedSpaceIds.has(inertSpaceRouteMatch.params.spaceId)) {
                    continue;
                } else {
                    renderedSpaceIds.add(inertSpaceRouteMatch.params.spaceId);
                }
            }

            // If our primary route is rendered in the same space as this inert route then
            // render the primary route in this position with the current `nodeKey` to
            // preserve the inert route's key path.
            if (
                primarySpaceRouteMatch &&
                inertSpaceRouteMatch &&
                primarySpaceRouteMatch.params.spaceId === inertSpaceRouteMatch.params.spaceId
            ) {
                nodes.push(getPrimaryNode());
            } else {
                nodes.push(
                    <NativeMobileOutlet
                        // Previous rendered routes need to preserve their keys if a new route is
                        // pushed. So the first route in our stack has a key of 1, the second 2, and so
                        // on. Newly pushed routes get new keys.
                        //
                        // We can't use `location.key` because if the URL is replaced then
                        // `location.key` changes but we don't want to fully remount our routes.
                        key={nodeKey++}
                        parentRouteIds={rootNativeMobileOutletParentRouteIds}
                        tracer={context.tracer.getRoot()}
                        inertRouterState={inertRouterState}
                        onUpdateMetaTitle={onUpdateMetaTitle}
                        style={outletContainerStyle}
                    />,
                );
            }
        }

        if (
            !primarySpaceRouteMatch ||
            !renderedSpaceIds.has(primarySpaceRouteMatch.params.spaceId)
        ) {
            nodes.push(getPrimaryNode());
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
                                                <BottomBarFrameContextProvider>
                                                    <RootOverlayScopeContextProvider>
                                                        <MobileFullScreenModalContextProvider>
                                                            <TooltipCoordinationContextProvider>
                                                                <ToastContextProvider>
                                                                    {nodes}
                                                                </ToastContextProvider>
                                                            </TooltipCoordinationContextProvider>
                                                        </MobileFullScreenModalContextProvider>
                                                    </RootOverlayScopeContextProvider>
                                                </BottomBarFrameContextProvider>
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
                <meta
                    // Don't automatically detect format of various text bits on iOS. If we want
                    // format detection we'll manually add it ourselves. Format detection doesn't
                    // play nicely with React server rendering.
                    // https://nextjs.org/docs/messages/react-hydration-error#common-ios-issues
                    name="format-detection"
                    content="telephone=no, date=no, email=no, address=no"
                />
                <Meta />
                <Links />
                <ColorSchemeManager />
            </head>
            <body>
                {wrappedChildren}
                <ScrollRestoration />
                {loaderData?.devServerPort && <AppLiveReload port={loaderData.devServerPort} />}
                <script
                    // Let our native app know we're ready once the server render has finished.
                    // This script intentionally runs before React hydration since we can
                    // immediately show the server rendered HTML to the user.
                    //
                    // Inline implementation of `scheduleAfterNextBrowserPaint()`. We want to let
                    // native know we're ready after the browser paints so we don't have a flash of
                    // unstyled content. Or a flash of the old content in case we're reloading.
                    dangerouslySetInnerHTML={{
                        __html: "if (window.__NativeMobileBridge) { const channel = new MessageChannel(); channel.port1.onmessage = () => window.__NativeMobileBridge.health.ready(); channel.port2.postMessage(undefined) }",
                    }}
                />
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
        <Box
            display="flex"
            justifyContent="center"
            style={{
                paddingTop: "var(--safe-area-inset-top, 0px)",
                paddingBottom: "var(--safe-area-inset-bottom, 0px)",
                paddingLeft: "var(--safe-area-inset-left, 0px)",
                paddingRight: "var(--safe-area-inset-right, 0px)",
            }}
        >
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
