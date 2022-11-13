import {createRequestHandler, handleAsset} from "@remix-run/cloudflare-workers";
import * as build from "@remix-run/dev/server-build";
import {InternalError} from "~/shared/error/error";
import {Schema} from "~/shared/schema/schema";

type CloudflareEnv = {
    DocumentCollaborationDurableObjectNamespace: DurableObjectNamespace;
};

const handleRequest = createRequestHandler({build});

export default {
    async fetch(
        request: Request,
        env: CloudflareEnv,
        context: ExecutionContext,
    ): Promise<Response> {
        const url = new URL(request.url);

        // Backwards compatibility with Cloudflare service worker syntax. (Instead of
        // Cloudflare module syntax.)
        // https://developers.cloudflare.com/workers/runtime-apis/fetch-event
        const event: FetchEvent = Object.assign(new Event("fetch"), {
            request,
            waitUntil: (promise: Promise<any>) => context.waitUntil(promise),
            passThroughOnException: () => context.passThroughOnException(),
            respondWith: () => {
                throw new InternalError("Can not respond through fetch event stub");
            },
        });

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
                        env.DocumentCollaborationDurableObjectNamespace.idFromName(documentId);
                    const durableObjectStub =
                        env.DocumentCollaborationDurableObjectNamespace.get(durableObjectId);

                    const newUrl = new URL(event.request.url);
                    newUrl.pathname = `/${path.slice(2).join("/")}`;
                    const newRequest = new Request(newUrl.toString(), event.request);
                    newRequest.headers.set("x-document-id", documentId);

                    return durableObjectStub.fetch(newRequest);
                }
                default:
                    return new Response("Durable object not found", {status: 404});
            }
        }

        return handleRequest(event);
    },
};

// Export the durable object so Cloudflare can pick it up. in the future, we
// should maybe use separate bundles for each durable object.
export {DocumentCollaborationDurableObject} from "~/server/documents/document_collaboration_durable_object";
