import {EntryContext} from "@remix-run/server-runtime";
import {renderToString} from "react-dom/server";
import {ErrorResponse, isRouteErrorResponse} from "react-router";
import {stylesUrl} from "~/app/helpers/styles_url.js";
import {AppRemixServer} from "~/app/router/app_remix_server.js";
import {AppContextProvider} from "~/client/web/context/app_context.js";
import {ReactContextModule} from "~/client/web/context/react_context_module.js";
import {LoaderContext} from "~/server/remix/loader_context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {getErrorCodeForHttpStatusCode} from "~/shared/error/get_error_code_for_http_status_code.js";
import {getErrorConstructorForCode} from "~/shared/error/get_error_constructor_for_code.js";
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

    const appContext = loadContext.clone({
        tracer: new TracerContextModule(span),
        react: new ReactContextModule({
            reportRenderedError: (tracer, error) => span.addException(error),
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

        // IMPORTANT: The difference between `remixContext.staticHandlerContext.errors`
        // and `context.react.reportRenderedError()` is:
        //
        // - `context.react.reportRenderedError()`: Errors rendered by the
        //   `<ErrorDisplayMessageRenderer>` component (or anything else that calls
        //   the function) while server-side rendering. These are errors rendered after
        //   `loader()` functions run.
        //
        //   We report these via our tracer but they don't affect the HTTP status code.
        //
        // - `remixContext.staticHandlerContext.errors`: Errors thrown by Remix
        //   `loader()` functions.
        //
        //   This error will affect the HTTP status code and whether the error is
        //   transient or not (and so whether or not we should retry the request).
        //
        // `remixContext.staticHandlerContext.errors` is the more important of the two.
        // `context.react.reportRenderedError()` is only there to improve our logging.
        const remixContextErrors = remixContext.staticHandlerContext.errors
            ? Object.values(remixContext.staticHandlerContext.errors)
            : [];

        let hasSystemError = false;

        // Reclassify the status code based on our own system conventions. If we have a
        // system error then the status code must be a 5xx code. If we only non-system
        // errors then the status code must be a 4xx code.
        //
        // Remix defaults to a 5xx code for all errors thrown by loaders, which is why
        // we need to downgrade 5xx codes to a 4xx code here if we see only non-system
        // errors.
        for (const error of remixContextErrors) {
            // Ignore Remix error response objects.
            if (isRouteErrorResponse(error)) continue;

            if (isSystemError(error)) {
                hasSystemError = true;

                if (!(responseStatusCode >= 500 && responseStatusCode < 600)) {
                    responseStatusCode = 500;
                }
            } else if (!hasSystemError) {
                if (!(responseStatusCode >= 400 && responseStatusCode < 500)) {
                    responseStatusCode = 400;
                }
            }
        }

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

        // If every loader error is a transient error then set the
        // `cyberworlds-transient-error` header which will cause `EdgeService` to retry
        // the request.
        //
        // Remix error response objects (e.g. Remix throws an error response object for
        // 404s) means the error is NOT transient.
        if (
            remixContextErrors.length > 0 &&
            remixContextErrors.every(
                error => !isRouteErrorResponse(error) && isTransientError(error),
            )
        ) {
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
    const span = context.tracer.getTracer() as TracerSpan;

    span.addException(isRouteErrorResponse(error) ? classifyRouteErrorResponse(error) : error);
}

function classifyRouteErrorResponse(error: ErrorResponse): unknown {
    const message =
        // Remix error responses have a private `error` property that sometimes
        // contains a more detailed error message:
        // https://github.com/remix-run/react-router/blob/aef5c4a617756e6fcc493de17b4be9997a5a19c8/packages/router/utils.ts#L1593-L1616
        "error" in error && error.error instanceof Error
            ? error.error.message
            : // Otherwise, we use the same error message as Remix's
              // `<DefaultErrorComponent>`:
              // https://github.com/remix-run/react-router/blob/aef5c4a617756e6fcc493de17b4be9997a5a19c8/packages/react-router/lib/hooks.tsx#L523-L524
              error.status + " " + error.statusText;

    const errorCode = getErrorCodeForHttpStatusCode(error.status);
    const ErrorConstructor = getErrorConstructorForCode(errorCode);

    return new ErrorConstructor(message, {cause: error});
}
