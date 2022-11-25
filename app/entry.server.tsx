import type {EntryContext} from "@remix-run/cloudflare";
import {RemixServer} from "@remix-run/react";
import {renderToString} from "react-dom/server";
import {ErrorSchema} from "~/shared/error/error_schema";

// We've patched Remix so that when it serializes and deserializes errors it
// looks for this global and uses it.
(globalThis as any).__remixErrorSchema = ErrorSchema;

export default function handleRequest(
    request: Request,
    responseStatusCode: number,
    responseHeaders: Headers,
    remixContext: EntryContext,
) {
    const markup = renderToString(<RemixServer context={remixContext} url={request.url} />);

    responseHeaders.set("Content-Type", "text/html");

    return new Response("<!DOCTYPE html>" + markup, {
        status: responseStatusCode,
        headers: responseHeaders,
    });
}
