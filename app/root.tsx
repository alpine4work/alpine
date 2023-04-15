import {LinkDescriptor} from "@remix-run/cloudflare";
import {
    Links,
    LiveReload,
    Meta,
    Outlet,
    Scripts,
    ScrollRestoration,
    ThrownResponse,
    useCatch,
} from "@remix-run/react";
import {RemixEntryContext} from "@remix-run/react";
import {IconContext} from "phosphor-react";
import prosemirrorStylesHref from "prosemirror-view/style/prosemirror.css";
import {useCallback, useContext, useEffect, useMemo} from "react";
import {AppContextProvider, useAppContext} from "~/client/context/app_context";
import {Box} from "~/client/design/box";
import {ErrorBodyRenderer} from "~/client/design/error_body_renderer";
import {OverlayScopeContextProvider} from "~/client/design/overlay";
import {ToastContextProvider} from "~/client/design/toast";
import {TooltipCoordinationContextProvider} from "~/client/design/tooltip";
import {
    InitializeColorSchemeScript,
    getColorSchemeWithoutListeningIfBrowser,
} from "~/client/helpers/color_scheme";
import {GlobalKeyDownRootContextProvider} from "~/client/helpers/global_key_down_event";
import {AppInitialRenderContextProvider} from "~/client/helpers/lifecycle/use_is_initial_app_render";
import {useStableValue} from "~/client/helpers/use_stable_value";
import {ClientInfoContextProvider, defaultClientInfo} from "~/client/remix/client_info_context";
import {getLoaderDataWithSchema} from "~/client/remix/get_loader_data_with_schema";
import {IsMobileContextProvider} from "~/client/remix/use_is_mobile";
import {WaitForNavigationContextProvider} from "~/client/remix/use_navigate";
import {UpdateMetaTitleContextProvider} from "~/client/remix/use_update_meta_title";
import {jsonWithSchema} from "~/server/remix/json_with_schema";
import {LoaderArgs} from "~/server/remix/loader_context";
import {spacing} from "~/shared/design/spacing";
import {NotFoundError, UnknownError} from "~/shared/error/error";
import {errorDisplayMessage} from "~/shared/error/error_display_message";
import {ErrorSchema} from "~/shared/error/error_schema";
import {assert} from "~/shared/helpers/control/assert";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable";
import {hasOwnProperty} from "~/shared/helpers/object/has_own_property";
import {quote} from "~/shared/helpers/string/quote";
import {ClientInfoSchema} from "~/shared/remix/client_info";
import {propagatedEventDataKey} from "~/shared/remix/json_with_schema_shared";
import {Schema} from "~/shared/schema/schema";
import {sprinkles} from "~/shared/styles/styles";
import sharedStylesHref from "~/shared/styles/styles.css";
import {mergeTracerEventData} from "~/shared/tracer/helpers/merge_tracer_event_data";
import {TracerEventFullData} from "~/shared/tracer/types/tracer_event_data";

export function meta() {
    return {
        title: "Cyberworlds",
    };
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
export const unstable_shouldReload = () => false;

const LoaderSchema = Schema.object({
    clientInfo: ClientInfoSchema,
    devServerPort: Schema.integer.optional(),
});

export function loader({context}: LoaderArgs) {
    return jsonWithSchema(LoaderSchema, {
        clientInfo: context.loader.clientInfo,
        devServerPort: context.loader.devServerPort ?? undefined,
    });
}

export default function Root({error}: {error?: unknown}) {
    const remixEntryContext = useContext(RemixEntryContext);
    assert(remixEntryContext, "Expected Remix entry context");

    let context = useAppContext();

    // Add propagated event data to our tracer so that child React components
    // log events with the right context.
    context = useMemo(() => {
        const routeData = Object.values(remixEntryContext.routeData);

        const propagatedEventData = Array.from(
            filterMapIterable(routeData, data => {
                if (!hasOwnProperty(data, propagatedEventDataKey)) return null;
                return data[propagatedEventDataKey] as TracerEventFullData;
            }),
        );

        if (propagatedEventData.length === 0) return context;
        return context.tracer.withPropagatedData(mergeTracerEventData(propagatedEventData));
    }, [remixEntryContext.routeData, context]);

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
            remixEntryContext.routeData.root
                ? getLoaderDataWithSchema(LoaderSchema, remixEntryContext.routeData.root)
                : null,
        [remixEntryContext.routeData.root],
    );

    const caught = useCatch() as ThrownResponse | undefined;

    const caughtResponseError = useMemo(() => {
        if (!caught) return undefined;
        if (caught.status === 404)
            return new NotFoundError("Route not found", {
                displayMessage: errorDisplayMessage`The page you opened could not be found. If you got here from a broken link let us know at ${errorDisplayMessage.supportLink}`,
            });
        return new UnknownError(
            quote`Response thrown with status ${caught.status} ${caught.statusText}`,
        );
    }, [caught]);

    const children =
        error !== undefined ? (
            <RootErrorRenderer error={error} />
        ) : caughtResponseError !== undefined ? (
            <RootErrorRenderer
                error={caughtResponseError}
                title={caught?.status === 404 ? "Could not find content" : undefined}
            />
        ) : (
            <Outlet />
        );

    const wrappedChildren = (
        <UpdateMetaTitleContextProvider
            onUpdateMetaTitle={useCallback(title => {
                document.title = title;
            }, [])}
        >
            <IconContext.Provider value={{color: "currentColor", size: spacing["5"]}}>
                <AppContextProvider value={context}>
                    <ClientInfoContextProvider
                        initialClientInfo={loaderData?.clientInfo ?? defaultClientInfo}
                    >
                        <AppInitialRenderContextProvider>
                            <IsMobileContextProvider>
                                <WaitForNavigationContextProvider>
                                    <GlobalKeyDownRootContextProvider>
                                        <OverlayScopeContextProvider>
                                            <TooltipCoordinationContextProvider>
                                                <ToastContextProvider>
                                                    {children}
                                                </ToastContextProvider>
                                            </TooltipCoordinationContextProvider>
                                        </OverlayScopeContextProvider>
                                    </GlobalKeyDownRootContextProvider>
                                </WaitForNavigationContextProvider>
                            </IsMobileContextProvider>
                        </AppInitialRenderContextProvider>
                    </ClientInfoContextProvider>
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
export const CatchBoundary = Root;
