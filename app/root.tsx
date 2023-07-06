import {
    Links,
    LiveReload,
    Meta,
    Outlet,
    UNSAFE_RemixContext as RemixContext,
    Scripts,
    ScrollRestoration,
    loadRouteModuleWithBlockingLinks,
} from "@remix-run/react";
import {LinkDescriptor} from "@remix-run/server-runtime";
import {IconContext} from "phosphor-react";
import prosemirrorStylesHref from "prosemirror-view/style/prosemirror.css";
import {Context, useCallback, useContext, useEffect, useMemo, useState} from "react";
import {
    DataRouteObject,
    UNSAFE_DataRouterContext as DataRouterContext,
    UNSAFE_DataRouterStateContext as DataRouterStateContext,
    isRouteErrorResponse,
    matchRoutes,
    useRouteError,
} from "react-router";
import type {LoaderData as InboxLoaderData} from "~/app/routes/s.$spaceId.inbox.js";
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
import {GlobalKeyDownRootContextProvider} from "~/client/helpers/global_key_down_event.js";
import {AppInitialRenderContextProvider} from "~/client/helpers/lifecycle/use_is_initial_app_render.js";
import {useStableValue} from "~/client/helpers/use_stable_value.js";
import {ClientInfoContextProvider, defaultClientInfo} from "~/client/remix/client_info_context.js";
import {getLoaderDataWithSchema} from "~/client/remix/get_loader_data_with_schema.js";
import {CurrentTimeContextProvider} from "~/client/remix/use_current_time_rounded_to_hour.js";
import {IsMobileContextProvider} from "~/client/remix/use_is_mobile.js";
import {
    RootNavigationContextProvider,
    WaitForNavigationContextProvider,
} from "~/client/remix/use_navigate.js";
import {UpdateMetaTitleContextProvider} from "~/client/remix/use_update_meta_title.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {spacing} from "~/shared/design/spacing.js";
import {NotFoundError, UnknownError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {hasOwnProperty} from "~/shared/helpers/object/has_own_property.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {generateId} from "~/shared/id/id.js";
import {ClientInfoSchema} from "~/shared/remix/client_info.js";
import {propagatedEventDataKey} from "~/shared/remix/json_with_schema_shared.js";
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
        {rel: "stylesheet", href: sharedStylesHref},
        // ProseMirror includes some lightweight styling that's required for it to
        // work correctly.
        {rel: "stylesheet", href: prosemirrorStylesHref},
    ];
}

// The loader returns constants. We don't need to reload on page change.
export const shouldRevalidate = () => false;

const LoaderSchema = Schema.object({
    initialTime: Schema.date,
    clientInfo: ClientInfoSchema,
    devServerPort: Schema.integer.optional(),
});

export function loader({context}: LoaderArgs) {
    return jsonWithSchema(LoaderSchema, {
        initialTime: new Date(),
        clientInfo: context.loader.clientInfo,
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

    // Monkey patch the Remix entry context. In a `useMemo()` so it only happens if
    // the context object changes.
    useMemo(
        () => patchRemixContext(remixContext, dataRouterContext),
        [dataRouterContext, remixContext],
    );

    let context = useAppContext();

    // Add propagated event data to our tracer so that child React components
    // log events with the right context.
    context = useMemo(() => {
        const loaderData = Object.values(dataRouterStateContext.loaderData);

        const propagatedEventData = Array.from(
            filterMapIterable(loaderData, data => {
                if (!data) return null;
                if (!hasOwnProperty(data, propagatedEventDataKey)) return null;
                return data[propagatedEventDataKey] as TracerEventFullData;
            }),
        );

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
            context.tracer.getRoot().logUncaughtException("Uncaught error", event.error);
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
                    displayMessage: errorDisplayMessage`The page you opened could not be found. If you got here from a broken link let us know at ${errorDisplayMessage.supportLink}`,
                });

            return new UnknownError(
                quote`Response thrown with status ${routeError.status} ${routeError.statusText}`,
            );
        }

        return routeError;
    }, [routeError]);

    const children =
        error !== undefined ? (
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
        );

    // In case we don't have loader data (an error was thrown) fallback to trying
    // to read the current date.
    const initialTime = useMemo(
        () => loaderData?.initialTime ?? new Date(),
        [loaderData?.initialTime],
    );

    const wrappedChildren = (
        <UpdateMetaTitleContextProvider
            onUpdateMetaTitle={useCallback(title => {
                document.title = title;
            }, [])}
        >
            <IconContext.Provider value={{color: "currentColor", size: spacing["5"]}}>
                <AppContextProvider value={context}>
                    <AppInitialRenderContextProvider>
                        <ClientInfoContextProvider
                            initialClientInfo={loaderData?.clientInfo ?? defaultClientInfo}
                        >
                            <CurrentTimeContextProvider initialTime={initialTime}>
                                <IsMobileContextProvider>
                                    <WaitForNavigationContextProvider>
                                        <RootNavigationContextProvider>
                                            <GlobalKeyDownRootContextProvider>
                                                <OverlayScopeContextProvider>
                                                    <TooltipCoordinationContextProvider>
                                                        <ToastContextProvider>
                                                            {children}
                                                        </ToastContextProvider>
                                                    </TooltipCoordinationContextProvider>
                                                </OverlayScopeContextProvider>
                                            </GlobalKeyDownRootContextProvider>
                                        </RootNavigationContextProvider>
                                    </WaitForNavigationContextProvider>
                                </IsMobileContextProvider>
                            </CurrentTimeContextProvider>
                        </ClientInfoContextProvider>
                    </AppInitialRenderContextProvider>
                </AppContextProvider>
            </IconContext.Provider>
        </UpdateMetaTitleContextProvider>
    );

    return (
        <html lang="en" data-color-scheme={getColorSchemeWithoutListeningIfBrowser()}>
            <head>
                <meta charSet="utf-8" />
                <meta
                    name="viewport"
                    content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"
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
                    paddingX: "4",
                    paddingY: {desktop: "32", mobile: "16"},
                })}
            >
                <ErrorBodyRenderer title={title ?? "Could not show content"} error={error} />
            </main>
        </Box>
    );
}

// We use the same `<Root>` component for the error boundary component so that
// if Remix navigates between root and error boundary we don't remount the
// HTML. (Which appears to cause CSS to flash off.)
export const ErrorBoundary = Root;

const wasPatchedSymbol = Symbol("wasPatched");

function patchRemixContext(
    remixContext: typeof RemixContext extends Context<infer T> ? NonNullable<T> : never,
    dataRouterContext: typeof DataRouterContext extends Context<infer T> ? NonNullable<T> : never,
) {
    const routeMatches = matchRoutes(
        dataRouterContext.router.routes,
        // A URL that will match the inbox route object. The string we put in the place
        // of `$spaceId` shouldn't matter.
        "/s/$spaceId/inbox",
    );

    const inboxRoute: DataRouteObject & {[wasPatchedSymbol]?: boolean} = assertExists(
        routeMatches?.find(match => match.route.id === "routes/s.$spaceId.inbox")?.route,
        "Couldn't find inbox client route",
    );

    // Only patch the loader once on the client. (Loader property is not available
    // on the server.)
    if (typeof window !== "undefined" && !inboxRoute[wasPatchedSymbol]) {
        inboxRoute[wasPatchedSymbol] = true;

        const originalLoader = assertExists(inboxRoute.loader, "Inbox route should have a loader");
        inboxRoute.loader = async options => {
            const result = await originalLoader(options);

            const data = (
                result instanceof Response ? await result.json() : result
            ) as InboxLoaderData;

            // Load any extra modules we need for opening the inbox.
            //
            // This will create a request waterfall, unfortunately. If `selected` is in
            // search params we should be able to load route modules in parallel with the
            // original loader. Should implement that someday?
            //
            // IMPORTANT: This only works for client-side navigation! For server-side
            // rendering we need to inject scripts into the page to load these route
            // modules. This happens in the `<InboxRoute>` component.
            if (data.peekData) {
                await runAllPromises(
                    data.peekData.loadExtraRouteIds.map(routeId =>
                        loadRouteModuleWithBlockingLinks(
                            remixContext.manifest.routes[routeId]!,
                            remixContext.routeModules,
                        ),
                    ),
                );
            }

            return data;
        };
    }
}
