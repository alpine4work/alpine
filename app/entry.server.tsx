import {EntryContext} from "@remix-run/server-runtime";
import {renderToString} from "react-dom/server";
import {stylesUrl} from "~/app/helpers/styles_url.js";
import {AppRemixServer} from "~/app/router/app_remix_server.js";
import {AppContextProvider} from "~/client/context/app_context.js";
import {ReactContextModule} from "~/client/context/react_context_module.js";
import {LoaderContext} from "~/server/remix/loader_context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {createAggregateError} from "~/shared/error/aggregate_error.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {isTransientError} from "~/shared/error/is_transient_error.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

// We've patched Remix so that when it serializes and deserializes errors it
// looks for this global and uses it.
(globalThis as any).__remixErrorSchema = ErrorSchema;

export default async function handleRequest(
    request: Request,
    responseStatusCode: number,
    responseHeaders: Headers,
    remixContext: EntryContext,
    loadContext: LoaderContext,
) {
    const {span, finishSpan} = loadContext.tracer.startSpan("React server render");
    const renderedErrors: Array<unknown> = [];

    const appContext = loadContext.clone({
        tracer: new TracerContextModule(span),
        react: new ReactContextModule({
            reportRenderedError: (tracer, error) => renderedErrors.push(error),
        }),
    });

    const resourceServiceUrl = __RESOURCE_SERVICE_URL__;

    try {
        const markup = renderToString(
            <AppContextProvider value={appContext}>
                <AppRemixServer
                    context={remixContext}
                    url={request.url}
                    isNativeMobile={loadContext.loader.getClientInfo().isNativeMobile}
                />
            </AppContextProvider>,
        );

        const renderedAggregateError =
            renderedErrors.length > 0 ? createAggregateError(renderedErrors) : null;

        // Report any React errors while rendering. The first error we saw while
        // rendering will go on our React server-side render span. If we rendered other
        // errors then we will add them as logs.
        if (renderedAggregateError) {
            span.addException(renderedAggregateError);
        }

        let remixContextAggregateError: unknown = null;

        if (remixContext.staticHandlerContext.errors) {
            const errors = Object.values(remixContext.staticHandlerContext.errors);
            if (errors.length > 0) {
                remixContextAggregateError = createAggregateError(errors);
            }
        }

        // Manually override the status code if an error with our codebase's
        // `ErrorCode` was thrown.
        responseStatusCode = remixContextAggregateError
            ? isSystemError(remixContextAggregateError)
                ? responseStatusCode >= 500 && responseStatusCode < 600
                    ? responseStatusCode
                    : 500
                : responseStatusCode >= 400 && responseStatusCode < 500
                ? responseStatusCode
                : 400
            : responseStatusCode;

        responseHeaders.set("content-type", "text/html");

        // Don't cache 404 responses. During deploys we may try to access `.js` bundles
        // that don't currently exist. Cloudflare shouldn't cache a 404 response for
        // those bundles.
        //
        // https://developers.cloudflare.com/cache/concepts/default-cache-behavior
        if (responseStatusCode === 404 && !responseHeaders.has("cache-control")) {
            responseHeaders.set("cache-control", "no-store");
        }

        // Use Early Hints with Cloudflare Workers to speed up content delivery. We
        // always will need the main stylesheet and Inter so deliver those as quickly
        // as possible.
        //
        // https://developers.cloudflare.com/cache/advanced-configuration/early-hints
        // https://developers.cloudflare.com/workers/examples/103-early-hints
        responseHeaders.set(
            "link",
            `<${stylesUrl}>; rel=preload; as=style, <${resourceServiceUrl}/fonts/inter.v1.woff2>; rel=preload; as=font; crossorigin=anonymous`,
        );

        // `EdgeService` will check this header and retry if present.
        if (remixContextAggregateError && isTransientError(remixContextAggregateError)) {
            responseHeaders.set("cyberworlds-transient-error", "yes");
        }

        const response = new Response("<!DOCTYPE html>" + markup, {
            status: responseStatusCode,
            headers: responseHeaders,
        });
        finishSpan();
        return response;
    } catch (error) {
        // Log unexpected errors here to the console in development environments.
        // Generally errors by loaders or in React render should be caught and rendered
        // to the user. Something has really gone wrong if we end up here.
        if (process.env.NODE_ENV !== "production") {
            // eslint-disable-next-line no-console
            console.error(quote`Uncaught exception while handling ${request.url}:`, error);
        }

        span.addException(error);
        finishSpan();
        throw error;
    }
}

// If there's an error then we need to add it to our request span. This handles
// both errors generated by our Remix code (e.g. in `loader()`s or React
// components) and errors generated by Remix outside our code.
export function handleError(error: unknown, {context}: {context: LoaderContext}) {
    const span = context.tracer.getTracer();

    // We assume `span` is a `TracerSpan`. `assert(span instanceof TracerSpan)`
    // doesn't work in development environments here since the span may come from a
    // different instantiation of our JavaScript code due to our hot reloading
    // setup.
    (span as TracerSpan).addException(error);
}
