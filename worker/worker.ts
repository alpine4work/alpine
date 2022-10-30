import {logger} from "~/shared/logger";
import {Schema} from "~/shared/schema/schema";

const appOrigin = Schema.string.deserialize(process.env.NEXT_PUBLIC_APP_ORIGIN ?? null);

interface Env {
    DocumentCollaborationDurableObject: DurableObjectNamespace;
}

const worker = {
    async fetch(request: Request, env: Env, ctx: ExecutionContext) {
        try {
            logger.info(`request to ${request.url}`);
            const originalResponse = await handleRequest(request, env);
            const response = new Response(originalResponse.body, originalResponse);
            response.headers.set("access-control-allow-origin", appOrigin);
            return response;
        } catch (err) {
            logger.warn(`error handling ${request.method} ${request.url}:`, err);
            throw err;
        }
    },
};

// eslint-disable-next-line import/no-default-export -- cloudflare wants a default export
export default worker;

async function handleRequest(request: Request, env: Env) {
    const url = new URL(request.url);
    const path = url.pathname.slice(1).split("/");

    switch (path[0]) {
        case "documents": {
            const documentId = Schema.id.deserialize(path[1] ?? null);
            const objectId = env.DocumentCollaborationDurableObject.idFromName(documentId);
            const collaborationSession = env.DocumentCollaborationDurableObject.get(objectId);

            const newUrl = new URL(request.url);
            newUrl.pathname = `/${path.slice(2).join("/")}`;
            const newRequest = new Request(newUrl.toString(), request);
            newRequest.headers.set("x-document-id", documentId);
            return collaborationSession.fetch(newRequest);
        }
        default:
            return new Response("route not found", {status: 404});
    }
}

// export the durable object so cloudflare can pick it up. in the future, we should maybe use
// separate bundles for each DO
export {DocumentCollaborationDurableObject} from "~/worker/document-collaboration/document-collaboration-durable-object";
