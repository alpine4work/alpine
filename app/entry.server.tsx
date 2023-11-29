import {RemixServer} from "@remix-run/react";
import {EntryContext} from "@remix-run/server-runtime";
import {renderToString} from "react-dom/server";
import {AppContextProvider} from "~/client/context/app_context.js";
import {ReactContextModule} from "~/client/context/react_context_module.js";
import {LoaderContext} from "~/server/remix/loader_context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {isErrorCode} from "~/shared/error/error_code.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {isSystemErrorCode} from "~/shared/error/is_system_error_code.js";
import {getExceptionTracerEventData} from "~/shared/tracer/helpers/get_exception_tracer_event_data.js";

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
            reportRenderedError: error => renderedErrors.push(error),
        }),
    });

    try {
        const markup = renderToString(
            <AppContextProvider value={appContext}>
                <RemixServer context={remixContext} url={request.url} />
            </AppContextProvider>,
        );

        // Report any React errors while rendering. The first error we saw while
        // rendering will go on our React server-side render span. If we rendered other
        // errors then we will add them as logs.
        if (renderedErrors.length > 0) {
            span.addException(renderedErrors[0]);

            for (const renderedError of renderedErrors.slice(1)) {
                span.log("React server rendered error", {
                    exception: getExceptionTracerEventData(renderedError),
                });
            }
        }

        // Manually override the status code if an error with our codebase's
        // `ErrorCode` was thrown.
        responseStatusCode = remixContext.staticHandlerContext.errors
            ? Object.values(remixContext.staticHandlerContext.errors).some(
                  error =>
                      typeof error.code === "number" &&
                      isErrorCode(error.code) &&
                      isSystemErrorCode(error.code),
              )
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
            console.error(error);
        }

        span.addException(error);
        finishSpan();
        throw error;
    }
}

export function handleError(error: unknown) {
    // Errors are already logged by our tracer. We add them to any span which
    // contains the error, then `ErrorBoundary` may choose to display the error to
    // the user which will report the error to our tracer again.
}
