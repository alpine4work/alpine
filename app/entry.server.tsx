import type {EntryContext} from "@remix-run/cloudflare";
import {RemixServer} from "@remix-run/react";
import {renderToString} from "react-dom/server";
import {AppContextProvider} from "~/client/helpers/app_context";
import {LoaderContext} from "~/server/remix/loader_context";
import {ErrorSchema} from "~/shared/error/error_schema";
import {assert} from "~/shared/helpers/control/assert";

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

    const markup = renderToString(
        <AppContextProvider value={loadContext}>
            <RemixServer context={remixContext} url={request.url} />
        </AppContextProvider>,
    );

    responseHeaders.set("Content-Type", "text/html");

    return new Response("<!DOCTYPE html>" + markup, {
        status: responseStatusCode,
        headers: responseHeaders,
    });
}
