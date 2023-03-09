import type {EntryContext} from "@remix-run/cloudflare";
import {RemixServer} from "@remix-run/react";
import {renderToString} from "react-dom/server";
import {AppContextProvider} from "~/client/context/app_context";
import {ReactContextModule} from "~/client/context/react_context_module";
import {LoaderContext} from "~/server/remix/loader_context";
import {TracerContextModule} from "~/shared/context/tracer_context_module";
import {isErrorCode} from "~/shared/error/error_code";
import {ErrorSchema} from "~/shared/error/error_schema";
import {isSystemErrorCode} from "~/shared/error/is_system_error_code";
import {assert} from "~/shared/helpers/control/assert";
import {getExceptionTracerEventData} from "~/shared/tracer/helpers/get_exception_tracer_event_data";

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

        // Manually override the status code if an error with our codebase's
        // `ErrorCode` was thrown.
        const error: {[key: string]: unknown} | undefined = remixContext.appState.error;
        responseStatusCode =
            typeof error?.code === "number" && isErrorCode(error.code)
                ? isSystemErrorCode(error.code)
                    ? 500
                    : 400
                : responseStatusCode;

        responseHeaders.set("Content-Type", "text/html");

        const response = new Response("<!DOCTYPE html>" + markup, {
            status: responseStatusCode,
            headers: responseHeaders,
        });

        await updateCloudflareWorkerTime();
        finishSpan();
        return response;
    } catch (error) {
        span.addException(error);

        await updateCloudflareWorkerTime();
        finishSpan();
        throw error;
    }
}

/**
 * This is a hack! Cloudflare Workers do not update the time (accessible via
 * `Date.now()`) during CPU time as part of the [Cloudflare Workers security
 * model][1]. They will only update the time on IO. This function does a little
 * noop IO which should be resolvable at the edge to let us measure React
 * render time.
 *
 * The IO we do is to write a fake URL to the HTTP cache. We never read that
 * URL back. We're ok paying <10ms here to get an accurate time for our React
 * server render.
 *
 * This cache write will count against our sub-request limit! Which is 50 on
 * bundled Cloudflare Workers plan. That's why we only use the technique here
 * for React renders where we care about measuring performance.
 *
 * Got this idea from the [Cloudflare Honeycomb reference module][2]. It
 * doesn't write to the cache to update the time but it does use the fake cache
 * technique to store some state.
 *
 * [1]: https://developers.cloudflare.com/workers/learning/security-model/
 * [2]: https://github.com/cloudflare/workers-honeycomb-logger/blob/80a04131f31bc5b6e9c3076b7da1f25db7749b15/src/modules.ts#L40-L55
 */
async function updateCloudflareWorkerTime() {
    await ((caches as any).default as Cache).put(
        "https://fake-cache.cyberworlds.dev/progress-time",
        new Response("ok", {headers: {"cache-control": "max-age=90"}}),
    );
}
