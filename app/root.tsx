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
import {IconContext, Warning} from "phosphor-react";
import prosemirrorStylesHref from "prosemirror-view/style/prosemirror.css";
import {useMemo} from "react";
import {Box} from "~/client/design/box";
import {
    InitializeColorSchemeScript,
    getColorSchemeWithoutListening,
} from "~/client/design/color_scheme";
import {OverlayScopeContextProvider} from "~/client/design/overlay";
import {TooltipCoordinationContextProvider} from "~/client/design/tooltip";
import {ErrorDisplayMessageRenderer} from "~/client/error/error_display_message_renderer";
import {AppInitialRenderContextProvider} from "~/client/helpers/lifecycle/use_is_initial_app_render";
import {useStableValue} from "~/client/helpers/use_stable_value";
import {spacing} from "~/shared/design/spacing";
import {NotFoundError, UnknownError} from "~/shared/error/error";
import {errorDisplayMessage} from "~/shared/error/error_display_message";
import {ErrorSchema} from "~/shared/error/error_schema";
import {quote} from "~/shared/helpers/string/quote";
import {sprinkles, typographySize} from "~/shared/styles/styles";
import sharedStylesHref from "~/shared/styles/styles.css";

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
            <AppInitialRenderContextProvider>
                <OverlayScopeContextProvider>
                    <TooltipCoordinationContextProvider>
                        {children}
                    </TooltipCoordinationContextProvider>
                </OverlayScopeContextProvider>
            </AppInitialRenderContextProvider>
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
                <Box display="flex" gap="2" paddingBottom="2">
                    <Box
                        flexShrink="0"
                        color="red-40"
                        display="flex"
                        justifyContent="center"
                        alignItems="center"
                        style={{
                            fontSize: typographySize.heading4.fontSize,
                            height: typographySize.heading4.lineHeight,
                        }}
                    >
                        <Warning weight="fill" size={typographySize.heading4.fontSize} />
                    </Box>
                    <h1
                        className={sprinkles({
                            flexGrow: "1",
                            typographySize: "heading4",
                            typographyStyle: "primaryMedium",
                        })}
                    >
                        {title ?? "Could not show content"}
                    </h1>
                </Box>
                <ErrorDisplayMessageRenderer error={error} size="body" />
            </main>
        </Box>
    );
}

// We use the same `<Root>` component for the error boundary component so that
// if Remix navigates between root and error boundary we don't remount the
// HTML. (Which appears to cause CSS to flash off.)
export const ErrorBoundary = Root;
export const CatchBoundary = Root;
