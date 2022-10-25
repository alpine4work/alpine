import {Schema} from "~/shared/schema/schema";

const APP_ORIGIN = Schema.string.deserialize(process.env.NEXT_PUBLIC_APP_ORIGIN ?? null);

interface Env {
    DocumentCollaborationDurableObject: DurableObjectNamespace;
}

const worker = {
    async fetch(request: Request, env: Env, ctx: ExecutionContext) {
        try {
            const originalResponse = await handleRequest(request, env);
            const response = new Response(originalResponse.body, originalResponse);
            response.headers.set("access-control-allow-origin", APP_ORIGIN);
            return response;
        } catch (err) {
            console.log(`error handling ${request.method} ${request.url}:`, err);
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

// export the durable object so cloudflare can pick it up
export {DocumentCollaborationDurableObject} from "~/collaboration-worker/document-collaboration-durable-object";
