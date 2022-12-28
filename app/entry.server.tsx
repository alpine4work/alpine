import type {EntryContext} from "@remix-run/cloudflare";
import {RemixServer} from "@remix-run/react";
import {renderToString} from "react-dom/server";
import {AppContextProvider} from "~/client/context/app_context";
import {ReactContextModule} from "~/client/context/react_context_module";
import {LoaderContext} from "~/server/remix/loader_context";
import {TracerContextModule} from "~/shared/context/tracer_context_module";
import {ErrorSchema} from "~/shared/error/error_schema";
import {assert} from "~/shared/helpers/control/assert";
import {getExceptionTracerEventData} from "~/shared/tracer/helpers/get_exception_tracer_event_data";

// We've patched Remix so that when it serializes and deserializes errors it
// looks for this global and uses it.
(globalThis as any).__remixErrorSchema = ErrorSchema;

export default function handleRequest(
    request: Request,
    responseStatusCode: number,
    responseHeaders: Headers,
    remixContext: EntryContext,
    loadContext: LoaderContext,
) {
    // We patched Remix to get the `loadContext` parameter here so make sure the
    // patch worked.
    assert(loadContext);

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

        responseHeaders.set("Content-Type", "text/html");

        const response = new Response("<!DOCTYPE html>" + markup, {
            status: responseStatusCode,
            headers: responseHeaders,
        });

        // It's a shame we can't measure CPU time in Cloudflare Workers. Would really
        // like to know what the CPU cost of server-side rendering is.
        finishSpan();
        return response;
    } catch (error) {
        span.addException(error);
        finishSpan();
        throw error;
    }
}
