import {fetchFromDurableObjectStub} from "~/server/cloudflare/fetch_from_durable_object_stub.js";
import {EdgeServiceFamilyTokenAgent} from "~/server/tokens/token_agent.js";
import {createServerTracer} from "~/server/tracer/server_tracer.js";
import {traceStandardizedRequest} from "~/server/tracer/trace_standardized_request.js";
import {InternalError} from "~/shared/error/error.js";
import {Schema} from "~/shared/schema/schema.js";

type EdgeServiceEnv = {
    DocumentCollaborationDurableObjectNamespace: DurableObjectNamespace;
    PostRealtimeDurableObjectNamespace: DurableObjectNamespace;
    ChatRealtimeDurableObjectNamespace: DurableObjectNamespace;
    MyAccountDurableObjectNamespace: DurableObjectNamespace;
    APP_SERVICE_PUBLIC_KEY?: string;
    EDGE_SERVICE_FAMILY_PUBLIC_KEY?: string;
    EDGE_SERVICE_FAMILY_PRIVATE_KEY?: string;
    HONEYCOMB_API_KEY?: string;
};

// Cache some shared resources across requests.
let sharedResources: {
    env: EdgeServiceEnv;
    tokenAgent: EdgeServiceFamilyTokenAgent | Promise<EdgeServiceFamilyTokenAgent>;
} | null = null;

async function handleFetch(
    request: Request,
    env: EdgeServiceEnv,
    executionContext: ExecutionContext,
) {
    const startTime = Date.now();

    const url = new URL(request.url);

    // We implement the time API route directly in our Cloudflare Worker body and
    // put it before all other work.
    //
    // We use this route to implement [clock synchronization with NTP][1].
    //
    // Normally, NTP needs the time of both server packet reception and server
    // packet transmission to work. But Cloudflare only updates the clock during IO
    // (not synchronous CPU work, see [security model][2]) so we only have the time
    // at which our worker received the request. That's fine, that time can be both
    // the server start time and server end time and we pretend like the server
    // response was less than 1ms.
    //
    // So we want to respond to this route the absolute fastest Cloudflare Workers
    // can allow so that the route time is as close to under 1ms as possible. Which
    // is why we put this route handler first before all other processing.
    //
    // Used by `synchronized_system_clock.ts`.
    //
    // [1]: https://en.wikipedia.org/wiki/Network_Time_Protocol
    // [2]: https://developers.cloudflare.com/workers/learning/security-model/
    if (url.pathname === "/api/time") {
        return new Response(`{"startTime":${startTime},"endTime":${Date.now()}}`, {
            status: 200,
            headers: {"content-type": "application/json"},
        });
    }

    // Route durable object requests to the appropriate object.
    if (url.pathname.startsWith("/api/durable-objects/")) {
        // Create a new tracer for every request because we need a Honeycomb client and
        // the Honeycomb client needs `executionContext.waitUntil()` which is request
        // scoped. Tracers are cheap to construct so this is fine.
        const tracer = createServerTracer({
            serviceName: "EdgeService",
            jsHost: "CloudflareWorker",
            honeycombApiKey: env.HONEYCOMB_API_KEY,
            waitUntil: promise => executionContext.waitUntil(promise),
        });

        // We wrap edge durable object routing in a span because our edge is running
        // meaningful logic here. We don't add spans when we send requests to
        // `AppService` since request simply falls through.
        return traceStandardizedRequest(tracer, request, url, async (span, request) => {
            // An env object that is referentially equal will be passed in as long as
            // environment variables remain the same.
            // https://developers.cloudflare.com/workers/runtime-apis/fetch-event/#parameters
            if (sharedResources === null || sharedResources.env !== env) {
                const appServicePublicKey = env.APP_SERVICE_PUBLIC_KEY;
                if (!appServicePublicKey)
                    throw new InternalError("Missing `APP_SERVICE_PUBLIC_KEY` env variable");

                const edgeServiceFamilyPublicKey = env.EDGE_SERVICE_FAMILY_PUBLIC_KEY;
                if (!edgeServiceFamilyPublicKey)
                    throw new InternalError(
                        "Missing `EDGE_SERVICE_FAMILY_PUBLIC_KEY` env variable",
                    );

                const edgeServiceFamilyPrivateKey = env.EDGE_SERVICE_FAMILY_PRIVATE_KEY;
                if (!edgeServiceFamilyPrivateKey)
                    throw new InternalError(
                        "Missing `EDGE_SERVICE_FAMILY_PRIVATE_KEY` env variable",
                    );

                const tokenAgentPromise = EdgeServiceFamilyTokenAgent.new({
                    serviceName: "EdgeService",
                    appServicePublicKey,
                    edgeServiceFamilyPublicKey,
                    edgeServiceFamilyPrivateKey,
                });

                const ourSharedResources: typeof sharedResources = {
                    env,
                    tokenAgent: tokenAgentPromise,
                };

                // When the token agent has resolved, we don't need to await it anymore.
                void tokenAgentPromise.then(
                    tokenAgent => (ourSharedResources.tokenAgent = tokenAgent),
                );

                sharedResources = ourSharedResources;
            }

            const tokenAgent =
                sharedResources.tokenAgent instanceof Promise
                    ? await sharedResources.tokenAgent
                    : sharedResources.tokenAgent;

            const path = url.pathname.slice("/api/durable-objects/".length).split("/");
            switch (path[0]) {
                case "documents": {
                    const documentId = Schema.id().deserialize(path[1] ?? null);
                    const pathname = `/${path.slice(2).join("/")}`;

                    return fetchFromDurableObjectStub({
                        durableObjectNamespace: env.DocumentCollaborationDurableObjectNamespace,
                        serviceName: "DocumentCollaborationService",
                        tokenAgent,
                        request,
                        pathname,
                        idName: documentId,
                        span,
                    });
                }
                case "posts": {
                    const postId = Schema.id().deserialize(path[1] ?? null);
                    const pathname = `/${path.slice(2).join("/")}`;

                    return fetchFromDurableObjectStub({
                        durableObjectNamespace: env.PostRealtimeDurableObjectNamespace,
                        serviceName: "PostRealtimeService",
                        tokenAgent,
                        request,
                        pathname,
                        idName: postId,
                        span,
                    });
                }
                case "chat": {
                    const chatId = Schema.id().deserialize(path[1] ?? null);
                    const pathname = `/${path.slice(2).join("/")}`;

                    return fetchFromDurableObjectStub({
                        durableObjectNamespace: env.ChatRealtimeDurableObjectNamespace,
                        serviceName: "ChatRealtimeService",
                        tokenAgent,
                        request,
                        pathname,
                        idName: chatId,
                        span,
                    });
                }
                case "my-account": {
                    const accountId = Schema.id().deserialize(path[1] ?? null);
                    const pathname = `/${path.slice(2).join("/")}`;

                    return fetchFromDurableObjectStub({
                        durableObjectNamespace: env.MyAccountDurableObjectNamespace,
                        serviceName: "MyAccountService",
                        tokenAgent,
                        request,
                        pathname,
                        idName: accountId,
                        span,
                    });
                }
                default:
                    return new Response("404 Not Found: Durable object not found", {
                        status: 404,
                        headers: {"content-type": "text/plain"},
                    });
            }
        });
    }

    // Can't forward a request to upgrade to a WebSocket connection. All WebSocket
    // connections are handled by Cloudflare Durable Objects.
    if (request.headers.has("upgrade")) {
        return new Response("400 Bad Request: Can't upgrade to WebSocket connection", {
            status: 400,
            headers: {"content-type": "text/plain"},
        });
    }

    const startTimeString = new Date(startTime).toISOString();

    // This forwards the request from `EdgeService` to `AppService` completely
    // untouched. To `AppService` it will look like the request is coming from a
    // web browser.
    //
    // eslint-disable-next-line no-global-fetch
    const response = await fetch(request);

    // For HTML requests, include edge server timing information. We use this on
    // the client to synchronize our client time with the server time. See
    // `synchronized_system_clock.ts`.
    if (response.headers.get("content-type")?.includes("text/html")) {
        // `fetch()` responses are immutable so we need to clone to add a new header...
        const newResponse = new Response(response.body, response);

        const endTime = Date.now();
        const durationMs = endTime - startTime;

        newResponse.headers.append(
            "server-timing",
            `edge;dur=${durationMs};desc="Edge server wait (start time: ${startTimeString})"`,
        );

        return newResponse;
    }

    return response;
}

// eslint-disable-next-line import/no-default-export
export default {fetch: handleFetch};

// We deploy our durable objects with our edge service but we think of our
// durable objects as logically different services. We could choose in the
// future to deploy them as separate Cloudflare Workers.
//
// We refer to the Cloudflare Worker which proxies our `AppService` as
// `EdgeService`. We refer to the broader collection of services owned by
// `EdgeService` as `EdgeServiceFamily`.
export {DocumentCollaborationDurableObject} from "~/server/documents/document_collaboration_durable_object.js";
export {PostRealtimeDurableObject} from "~/server/forum/post_realtime_durable_object.js";
export {ChatRealtimeDurableObject} from "~/server/chat/chat_realtime_durable_object.js";
export {MyAccountDurableObject} from "~/server/notifications/my_account_durable_object.js";
