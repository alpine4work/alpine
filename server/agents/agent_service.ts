import {AgentServiceEnv} from "~/server/agents/internal/agent_service_env.js";
import {AgentUsageDatabase} from "~/server/agents/internal/d1/agent_usage_database.js";
import {refreshAccountEntitlements} from "~/server/agents/internal/refresh_account_entitlements.js";
import {createSimpleErrorResponse} from "~/server/helpers/create_simple_error_response.js";
import {createServerTracer} from "~/server/tracer/server_tracer.js";
import {traceServerResponse} from "~/server/tracer/trace_server_response.js";
import {ApiBotWebhookRequestBody} from "~/shared/api/types/api_specification_convenience_types.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {addTracerPropagationContextHeader} from "~/shared/tracer/tracer_propagation_context_header.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

type AgentServiceRoute =
    | "ChatGptWebhook"
    | "ChatGptConversationState"
    | "RefreshAccountEntitlements"
    | "MockWebhook"
    | "MockRecording"
    | "NotFound";

async function handleFetch(
    request: Request,
    env: AgentServiceEnv,
    executionContext: ExecutionContext,
) {
    const url = new URL(request.url);

    let routeString: string;
    let route: AgentServiceRoute;

    switch (url.pathname) {
        case "/chat-gpt/webhook": {
            routeString = "/chat-gpt/webhook";
            route = "ChatGptWebhook";
            break;
        }
        case "/chat-gpt/conversation-state": {
            routeString = "/chat-gpt/conversation-state";
            route = "ChatGptConversationState";
            break;
        }
        case "/refresh-account-entitlements": {
            routeString = "/refresh-account-entitlements";
            route = "RefreshAccountEntitlements";
            break;
        }
        case "/mock/webhook": {
            routeString = "/mock/webhook";
            route = "MockWebhook";
            break;
        }
        case "/mock/recording": {
            routeString = "/mock/recording";
            route = "MockRecording";
            break;
        }
        default: {
            routeString = "/*";
            route = "NotFound";
            break;
        }
    }

    // Create a new tracer for every request because we need a Honeycomb client and
    // the Honeycomb client needs `executionContext.waitUntil()` which is request
    // scoped. Tracers are cheap to construct so this is fine.
    const tracer = createServerTracer({
        serviceName: "AgentService",
        jsHost: "CloudflareWorker",
        honeycombApiKey: env.HONEYCOMB_API_KEY,
        waitUntil: promise => executionContext.waitUntil(promise),
    });

    return traceServerResponse(tracer, request, url, routeString, async (span, request) => {
        try {
            switch (route) {
                case "NotFound": {
                    return new Response("404 Not Found", {
                        status: 404,
                        headers: {"content-type": "text/plain"},
                    });
                }
                case "ChatGptWebhook": {
                    const requestBody: ApiBotWebhookRequestBody = await request.json();

                    const newUrl = new URL(request.url);
                    newUrl.pathname = "/webhook";

                    return fetchFromDurableObject(
                        span,
                        env.ChatGptAgentDurableObjectNamespace,
                        `${requestBody.accountId}:${requestBody.event.roomPath}`,
                        new Request(newUrl, {
                            method: request.method,
                            headers: request.headers,
                            body: JSON.stringify(requestBody),
                        }),
                    );
                }
                case "ChatGptConversationState": {
                    const accountId = url.searchParams.get("accountId");
                    const roomPath = url.searchParams.get("roomPath");

                    if (!accountId)
                        throw new InvalidArgumentError("Missing `accountId` search param");
                    if (!roomPath)
                        throw new InvalidArgumentError("Missing `roomPath` search param");

                    const newUrl = new URL(request.url);
                    newUrl.pathname = "/conversation-state";

                    return fetchFromDurableObject(
                        span,
                        env.ChatGptAgentDurableObjectNamespace,
                        `${accountId}:${roomPath}`,
                        new Request(newUrl, {
                            method: request.method,
                            headers: request.headers,
                        }),
                    );
                }
                case "RefreshAccountEntitlements": {
                    if (request.method !== "POST") {
                        return new Response("405 Method Not Allowed", {
                            status: 405,
                            headers: {"content-type": "text/plain"},
                        });
                    }

                    const {accountId} = await request.json();

                    if (!accountId) throw new InvalidArgumentError("Missing `accountId`");

                    await refreshAccountEntitlements(
                        tracer,
                        env,
                        new AgentUsageDatabase(env.AgentUsageDatabase),
                        accountId,
                    );

                    return new Response("200 OK", {
                        status: 200,
                        headers: {"content-type": "text/plain"},
                    });
                }
                case "MockWebhook": {
                    const requestBody: ApiBotWebhookRequestBody = await request.json();

                    const newUrl = new URL(request.url);
                    newUrl.pathname = "/webhook";

                    return fetchFromDurableObject(
                        span,
                        env.MockAgentDurableObjectNamespace,
                        `${requestBody.accountId}:${requestBody.event.roomPath}`,
                        new Request(newUrl, {
                            method: request.method,
                            headers: request.headers,
                            body: JSON.stringify(requestBody),
                        }),
                    );
                }
                case "MockRecording": {
                    const accountId = url.searchParams.get("accountId");
                    const roomPath = url.searchParams.get("roomPath");

                    if (!accountId)
                        throw new InvalidArgumentError("Missing `accountId` search param");
                    if (!roomPath)
                        throw new InvalidArgumentError("Missing `roomPath` search param");

                    const newUrl = new URL(request.url);
                    newUrl.pathname = "/recording";

                    return fetchFromDurableObject(
                        span,
                        env.MockAgentDurableObjectNamespace,
                        `${accountId}:${roomPath}`,
                        new Request(newUrl, {
                            method: request.method,
                            headers: request.headers,
                            body: request.body,
                        }),
                    );
                }
                default:
                    throw exhaustive(route);
            }
        } catch (error) {
            span.addException(error);
            return createSimpleErrorResponse(error);
        }
    });
}

function fetchFromDurableObject(
    span: TracerSpan,
    durableObjectNamespace: DurableObjectNamespace,
    name: string,
    request: Request,
) {
    const id = durableObjectNamespace.idFromName(name);

    return fetchFromDurableObjectWithId(span, durableObjectNamespace, id, request);
}

function fetchFromDurableObjectWithId(
    span: TracerSpan,
    durableObjectNamespace: DurableObjectNamespace,
    id: DurableObjectId,
    request: Request,
) {
    const durableObjectStub = durableObjectNamespace.get(id, {
        // Currently, we only have data in the AWS region `us-east-1`. So place Durable
        // Objects in the Eastern North America region so Durable Objects get low
        // latency when making calls to `ApiService` in AWS.
        //
        // Long term, ideally we'll put space data in the nearest AWS region to the
        // customer and our Durable Objects should be created near that data center
        // as well. Or we'll have DynamoDB replicas in multiple regions.
        locationHint: "enam",
    });

    addTracerPropagationContextHeader(request.headers, span);

    return durableObjectStub.fetch(request);
}

// eslint-disable-next-line import/no-default-export
export default {fetch: handleFetch};

export {ChatGptAgentDurableObject} from "~/server/agents/internal/chat_gpt_agent_durable_object.js";
export {MockAgentDurableObject} from "~/server/agents/internal/mock_agent_durable_object.js";
