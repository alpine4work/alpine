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
import {RemixEntryContext} from "@remix-run/react/dist/esm/components";
import {IconContext} from "phosphor-react";
import prosemirrorStylesHref from "prosemirror-view/style/prosemirror.css";
import {useContext, useMemo} from "react";
import {Box} from "~/client/design/box";
import {
    InitializeColorSchemeScript,
    getColorSchemeWithoutListening,
} from "~/client/design/color_scheme";
import {OverlayScopeContextProvider} from "~/client/design/overlay";
import {TooltipCoordinationContextProvider} from "~/client/design/tooltip";
import {ErrorBodyRenderer} from "~/client/error/error_body_renderer";
import {AppContextProvider, useAppContext} from "~/client/helpers/app_context";
import {AppInitialRenderContextProvider} from "~/client/helpers/lifecycle/use_is_initial_app_render";
import {useStableValue} from "~/client/helpers/use_stable_value";
import {spacing} from "~/shared/design/spacing";
import {NotFoundError, UnknownError} from "~/shared/error/error";
import {errorDisplayMessage} from "~/shared/error/error_display_message";
import {ErrorSchema} from "~/shared/error/error_schema";
import {assert} from "~/shared/helpers/control/assert";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable";
import {hasOwnProperty} from "~/shared/helpers/object/has_own_property";
import {propagatedEventDataKey} from "~/shared/helpers/remix/json_with_schema_shared";
import {quote} from "~/shared/helpers/string/quote";
import {sprinkles} from "~/shared/styles/styles";
import sharedStylesHref from "~/shared/styles/styles.css";
import {mergeTracerEventData} from "~/shared/tracer/helpers/merge_tracer_event_data";
import {TracerEventFullData} from "~/shared/tracer/types/tracer_event_data";

export function meta() {
    return {
        charset: "utf-8",
        title: "Cyberworlds",
        viewport: "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no",
        // Ask Google to not index any of our routes.
        // https://developers.google.com/search/docs/crawling-indexing/block-indexing
        //
        // We should have individual routes opt-in to indexing.
        robots: "noindex",
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

    const caught = useCatch() as ThrownResponse | undefined;

    const caughtResponseError = useMemo(() => {
        if (!caught) return undefined;
        if (caught.status === 404)
            return new NotFoundError("Route not found", {
                displayMessage: errorDisplayMessage`The page you opened could not be found. If you got here from a broken link let us know at ${errorDisplayMessage.supportLink}.`,
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
        <IconContext.Provider value={{color: "currentColor", size: spacing["5"]}}>
            <AppContextProvider value={context}>
                <AppInitialRenderContextProvider>
                    <OverlayScopeContextProvider>
                        <TooltipCoordinationContextProvider>
                            {children}
                        </TooltipCoordinationContextProvider>
                    </OverlayScopeContextProvider>
                </AppInitialRenderContextProvider>
            </AppContextProvider>
        </IconContext.Provider>
    );

    return (
        <html lang="en" data-color-scheme={getColorSchemeWithoutListening()}>
            <head>
                <Meta />
                <Links />
                <InitializeColorSchemeScript />
            </head>
            <body>
                {wrappedChildren}
                <ScrollRestoration />
                <LiveReload port={3001} />
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
