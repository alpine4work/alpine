import {createRequestHandler, handleAsset} from "@remix-run/cloudflare-workers";
import * as build from "@remix-run/dev/server-build";
import {DocumentCollaborationDurableObjectNamespace} from "~/app/cloudflare_bindings";
import {logger} from "~/shared/logger";
import {Schema} from "~/shared/schema/schema";

const handleRequest = createRequestHandler({build});

const handleFetch = async (event: FetchEvent) => {
    const url = new URL(event.request.url);

    // In development we have middleware on our HTTP server that serves static
    // files from the file system instead of a Cloudflare KV namespace.
    if (process.env.NODE_ENV !== "development") {
        const response = await handleAsset(event, build);
        if (response) return response;
    }

    if (url.pathname.startsWith("/durable-objects/")) {
        const path = url.pathname.slice("/durable-objects/".length).split("/");
        switch (path[0]) {
            case "documents": {
                const documentId = Schema.id.deserialize(path[1] ?? null);

                const durableObjectId =
                    DocumentCollaborationDurableObjectNamespace.idFromName(documentId);
                const durableObjectStub =
                    DocumentCollaborationDurableObjectNamespace.get(durableObjectId);

                const newUrl = new URL(event.request.url);
                newUrl.pathname = `/${path.slice(2).join("/")}`;
                const newRequest = new Request(newUrl.toString(), event.request);
                newRequest.headers.set("x-document-id", documentId);

                return durableObjectStub.fetch(newRequest);
            }
            default:
                return new Response("route not found", {status: 404});
        }
    }

    return handleRequest(event);
};

addEventListener("fetch", (event: FetchEvent) => {
    logger.info(`request to ${event.request.url}`);
    event.respondWith(
        handleFetch(event).catch(error => {
            logger.error(`error handling ${event.request.url}:`, error);
            throw error;
        }),
    );
});

// Export the durable object so Cloudflare can pick it up. in the future, we
// should maybe use separate bundles for each durable object.
export {DocumentCollaborationDurableObject} from "~/server/document/document_collaboration_durable_object";
