import {AgentServiceEnv} from "~/server/agents/internal/agent_service_env.js";
import {AgentUsageDatabase} from "~/server/agents/internal/d1/agent_usage_database.js";
import {refreshAccountEntitlements} from "~/server/agents/internal/refresh_account_entitlements.js";
import {AwsRequestSigner} from "~/server/helpers/aws_request_signer.js";
import {createSimpleErrorResponse} from "~/server/helpers/create_simple_error_response.js";
import {createServerTracer} from "~/server/tracer/server_tracer.js";
import {traceServerResponse} from "~/server/tracer/trace_server_response.js";
import {printApiMessageRoomPath} from "~/shared/api/specification/parse_api_path.js";
import {ApiBotWebhookRequestBody} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {InternalError, InvalidArgumentError} from "~/shared/error/error.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {addTracerPropagationContextHeader} from "~/shared/tracer/tracer_propagation_context_header.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

type AgentServiceRoute =
    | {type: "ChatGptWebhook"}
    | {type: "ChatGptConversationState"}
    | {type: "CursorWebhook"}
    | {type: "CursorCloudAgentsWebhook"; durableObjectId: string; agentId: string}
    | {type: "MockWebhook"}
    | {type: "MockRecording"}
    | {type: "RefreshAccountEntitlements"}
    | {type: "NotFound"};

async function handleFetch(
    request: Request,
    env: AgentServiceEnv,
    executionContext: ExecutionContext,
) {
    const url = new URL(request.url);

    let routeString: string;
    let route: AgentServiceRoute;

    if (url.pathname.startsWith("/cursor/cloud-agents-webhook/")) {
        const pathnameParts = url.pathname.slice("/cursor/cloud-agents-webhook/".length).split("/");

        if (pathnameParts.length === 2) {
            routeString = "/cursor/cloud-agents-webhook/:durableObjectId/:agentId";
            route = {
                type: "CursorCloudAgentsWebhook",
                durableObjectId: pathnameParts[0]!,
                agentId: pathnameParts[1]!,
            };
        } else {
            routeString = "/*";
            route = {type: "NotFound"};
        }
    } else {
        switch (url.pathname) {
            case "/chat-gpt/webhook": {
                routeString = "/chat-gpt/webhook";
                route = {type: "ChatGptWebhook"};
                break;
            }
            case "/chat-gpt/conversation-state": {
                routeString = "/chat-gpt/conversation-state";
                route = {type: "ChatGptConversationState"};
                break;
            }
            case "/cursor/webhook": {
                routeString = "/cursor/webhook";
                route = {type: "CursorWebhook"};
                break;
            }
            case "/mock/webhook": {
                routeString = "/mock/webhook";
                route = {type: "MockWebhook"};
                break;
            }
            case "/mock/recording": {
                routeString = "/mock/recording";
                route = {type: "MockRecording"};
                break;
            }
            case "/refresh-account-entitlements": {
                routeString = "/refresh-account-entitlements";
                route = {type: "RefreshAccountEntitlements"};
                break;
            }
            default: {
                routeString = "/*";
                route = {type: "NotFound"};
                break;
            }
        }
    }

    const streamName = env.KINESIS_TRACER_STREAM_NAME;
    if (!streamName && process.env.NODE_ENV === "production")
        throw new InternalError("Must provide `KINESIS_TRACER_STREAM_NAME` in production");

    // Create a new tracer for every request because we need a Honeycomb client and the
    // Honeycomb client needs `executionContext.waitUntil()` which is request scoped.
    // Tracers are cheap to construct so this is fine.
    const tracer = createServerTracer({
        serviceName: "AgentService",
        jsHost: "CloudflareWorker",
        honeycombApiKey: env.HONEYCOMB_API_KEY,
        honeycombDataset: "tracer",
        waitUntil: promise => executionContext.waitUntil(promise),
        kinesisTracerStreamOptions: streamName
            ? {
                  streamName,
                  awsSigner: new AwsRequestSigner({
                      accessKeyId: assertExists(
                          env.KINESIS_AWS_ACCESS_KEY_ID,
                          "`KINESIS_AWS_ACCESS_KEY_ID` is required",
                      ),
                      secretAccessKey: assertExists(
                          env.KINESIS_AWS_SECRET_ACCESS_KEY,
                          "`KINESIS_AWS_SECRET_ACCESS_KEY` is required",
                      ),
                  }),
              }
            : undefined,
    });

    return traceServerResponse(tracer, request, url, routeString, async (span, request) => {
        try {
            switch (route.type) {
                case "NotFound": {
                    return new Response("404 Not Found", {
                        status: 404,
                        headers: {"content-type": "text/plain"},
                    });
                }
                case "ChatGptWebhook": {
                    return handleDurableObjectPostRequest(
                        span,
                        env.ChatGptAgentDurableObjectNamespace,
                        request,
                        "/webhook",
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
                case "CursorWebhook": {
                    return handleDurableObjectPostRequest(
                        span,
                        env.CursorAgentDurableObjectNamespace,
                        request,
                        "/webhook",
                    );
                }
                case "CursorCloudAgentsWebhook": {
                    const newUrl = new URL(request.url);
                    newUrl.pathname = `/cloud-agents-webhook/${route.agentId}`;

                    return fetchFromDurableObjectWithId(
                        span,
                        env.CursorAgentDurableObjectNamespace,
                        env.CursorAgentDurableObjectNamespace.idFromString(route.durableObjectId),
                        new Request(newUrl, {
                            method: request.method,
                            headers: request.headers,
                            body: request.body,
                        }),
                    );
                }
                case "MockWebhook": {
                    return handleDurableObjectPostRequest(
                        span,
                        env.MockAgentDurableObjectNamespace,
                        request,
                        "/webhook",
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
                default:
                    throw exhaustive(route);
            }
        } catch (error) {
            span.addException(error);
            return createSimpleErrorResponse(error);
        }
    });
}

async function handleDurableObjectPostRequest(
    span: TracerSpan,
    durableObjectNamespace: DurableObjectNamespace,
    request: Request,
    newUrlPath: string,
) {
    if (request.method !== "POST") {
        return new Response("405 Method Not Allowed", {
            status: 405,
            headers: {"content-type": "text/plain"},
        });
    }

    const requestBody: ApiBotWebhookRequestBody = await request.json();

    const newUrl = new URL(request.url);
    newUrl.pathname = newUrlPath;

    return fetchFromDurableObject(
        span,
        durableObjectNamespace,
        getDurableObjectIdFromApiBotWebhookEvent(requestBody),
        new Request(newUrl, {
            method: request.method,
            headers: request.headers,
            body: JSON.stringify(requestBody),
        }),
    );
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
        // Objects in the Eastern North America region so Durable Objects get low latency
        // when making calls to `ApiService` in AWS.
        //
        // Long term, ideally we'll put space data in the nearest AWS region to the
        // customer and our Durable Objects should be created near that data center as
        // well. Or we'll have DynamoDB replicas in multiple regions.
        locationHint: "enam",
    });

    addTracerPropagationContextHeader(request.headers, span);

    return durableObjectStub.fetch(request);
}

function getDurableObjectIdFromApiBotWebhookEvent(request: ApiBotWebhookRequestBody) {
    switch (request.event.type) {
        case "NewMessage":
            return `${request.botAccountId}:${printApiMessageRoomPath(request.event.room)}`;
        case "NewPost":
            return `${request.botAccountId}:${request.event.postId}`;
    }
}

// eslint-disable-next-line import/no-default-export
export default {fetch: handleFetch};

export {ChatGptAgentDurableObject} from "~/server/agents/internal/chat_gpt_agent_durable_object.js";
export {MockAgentDurableObject} from "~/server/agents/internal/mock_agent_durable_object.js";
export {CursorAgentDurableObject} from "~/server/agents/internal/cursor/cursor_agent_durable_object.js";
