import {createApiClient, createApiMessage} from "~/server/agents/api/api_client.open_source.js";
import {shouldAgentRespondToApiBotWebhookRequest} from "~/server/agents/api/should_agent_respond_to_bot_webhook_request.js";
import {AgentServiceEnv} from "~/server/agents/bots/internal/agent_service_env.js";
import {AgentUsageDatabase} from "~/server/agents/bots/internal/d1/agent_usage_database.js";
import {refreshAccountEntitlements} from "~/server/agents/bots/internal/refresh_account_entitlements.js";
import {AwsRequestSigner} from "~/server/helpers/aws_request_signer.js";
import {createSimpleErrorResponse} from "~/server/helpers/create_simple_error_response.js";
import {createSimpleOkResponse} from "~/server/helpers/create_simple_ok_response.js";
import {createServerTracer} from "~/server/tracer/server_tracer.js";
import {traceServerResponse} from "~/server/tracer/trace_server_response.js";
import {parseApiContentFromMarkdown} from "~/shared/api/content/parse_api_content_from_markdown.open_source.js";
import {printApiMessageRoomPath} from "~/shared/api/specification/parse_api_path.js";
import {
    ApiBotWebhookRequestBody,
    ApiMessageRoomReferenceRequest,
} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {
    InternalError,
    InvalidArgumentError,
    UnimplementedError,
} from "~/shared/error/error.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {markdown} from "~/shared/helpers/string/markdown.js";
import {quote} from "~/shared/helpers/string/quote.open_source.js";
import {fetchWithTracer} from "~/shared/tracer/fetch_with_tracer.open_source.js";
import {addTracerPropagationContextHeader} from "~/shared/tracer/tracer_propagation_context_header.open_source.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.open_source.js";

type AgentServiceRoute =
    | {type: "ChatGptWebhook"}
    | {type: "ChatGptConversationState"}
    | {type: "ClaudeWebhook"}
    | {type: "ClaudeConversationState"}
    | {type: "CursorWebhook"}
    | {type: "CursorCloudAgentsWebhook"; durableObjectId: string; agentId: string}
    | {type: "MockWebhook"; bot: "ChatGpt" | "Cursor"}
    | {type: "MockRecording"; bot: "ChatGpt" | "Cursor"}
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
            case "/claude/webhook": {
                routeString = "/claude/webhook";
                route = {type: "ClaudeWebhook"};
                break;
            }
            case "/claude/conversation-state": {
                routeString = "/claude/conversation-state";
                route = {type: "ClaudeConversationState"};
                break;
            }
            case "/cursor/webhook": {
                routeString = "/cursor/webhook";
                route = {type: "CursorWebhook"};
                break;
            }
            case "/mock/chat-gpt/webhook": {
                routeString = "/mock/chat-gpt/webhook";
                route = {type: "MockWebhook", bot: "ChatGpt"};
                break;
            }
            case "/mock/chat-gpt/recording": {
                routeString = "/mock/chat-gpt/recording";
                route = {type: "MockRecording", bot: "ChatGpt"};
                break;
            }
            case "/mock/cursor/webhook": {
                routeString = "/mock/cursor/webhook";
                route = {type: "MockWebhook", bot: "Cursor"};
                break;
            }
            case "/mock/cursor/recording": {
                routeString = "/mock/cursor/recording";
                route = {type: "MockRecording", bot: "Cursor"};
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

    return await traceServerResponse(tracer, request, url, routeString, async (span, request) => {
        try {
            switch (route.type) {
                case "NotFound": {
                    return new Response("404 Not Found", {
                        status: 404,
                        headers: {"content-type": "text/plain"},
                    });
                }
                case "ChatGptWebhook": {
                    // TODO: Re-enable `@typescript-eslint/return-await` after deciding
                    // whether this `try`/`catch` should handle durable object failures.
                    // eslint-disable-next-line @typescript-eslint/return-await
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

                    // TODO: Re-enable `@typescript-eslint/return-await` after deciding
                    // whether this `try`/`catch` should handle durable object failures.
                    // eslint-disable-next-line @typescript-eslint/return-await
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
                case "ClaudeWebhook": {
                    if (request.method !== "POST") {
                        return new Response("405 Method Not Allowed", {
                            status: 405,
                            headers: {"content-type": "text/plain"},
                        });
                    }

                    if (process.env.NODE_ENV === "production") {
                        throw new UnimplementedError(
                            quote`We only proxy ${routeString} requests from \`AgentService\` to \`AgentV2Service\` in development`,
                        );
                    }

                    // In development we proxy `/claude/webhook` requests from `AgentService` to
                    // `AgentV2Service`. That's because `AgentService` is always running but sometimes
                    // `AgentV2Service` isn't running. So if `AgentV2Service` isn't running then we'd
                    // like to respond to the webhook with an error message here in `AgentService`.

                    const agentV2ServiceUrl = assertExists(env.AGENT_V2_SERVICE_URL);

                    const requestBodyText = await request.text();

                    try {
                        const response = await fetchWithTracer(
                            span,
                            new URL("/claude/webhook", agentV2ServiceUrl),
                            {
                                serviceName: "AgentV2Service",
                                route: "/claude/webhook",
                                method: request.method,
                                headers: request.headers,
                                body: requestBodyText,
                            },
                            async response => response,
                        );

                        return response;
                    } catch (error) {
                        span.logException("AgentV2Service isn\u2019t available", error);
                    }

                    const requestBody: ApiBotWebhookRequestBody = JSON.parse(requestBodyText);

                    const apiClient = createApiClient({
                        baseUrl: env.API_SERVICE_URL,
                        apiKey: assertExists(env.CLAUDE_API_SERVICE_KEY),
                        accessToken: requestBody.accessToken,
                    });

                    let shouldRespondToRoom: ApiMessageRoomReferenceRequest | null = null;

                    switch (requestBody.event.type) {
                        case "CreatedMessage": {
                            const shouldRespond = await shouldAgentRespondToApiBotWebhookRequest(
                                span,
                                apiClient,
                                requestBody.botAccount.id,
                                requestBody.event,
                            );

                            if (shouldRespond) {
                                shouldRespondToRoom = requestBody.event.room;
                            }
                            break;
                        }
                        case "CreatedPost": {
                            if (requestBody.event.wasMentioned) {
                                shouldRespondToRoom = {type: "Post", id: requestBody.event.room.id};
                            }
                            break;
                        }
                        case "UpdatedMessageStreamExperimentalApprovalsPart": {
                            break;
                        }
                        default:
                            throw exhaustive(requestBody.event);
                    }

                    if (shouldRespondToRoom !== null) {
                        await createApiMessage(span, apiClient, shouldRespondToRoom, {
                            content: parseApiContentFromMarkdown(markdown`
### Dev error: \`AgentV2Service\` isn\u2019t running

Can only message Claude in dev if \`AgentV2Service\` is running (it isn\u2019t run by \`dev\`). To
message Claude, please run:

~~~sh
bazel run //server/agents/bots_v2/dev
~~~
                            `),
                        });
                    }

                    return createSimpleOkResponse();
                }
                case "ClaudeConversationState": {
                    const accountId = url.searchParams.get("accountId");
                    const roomPath = url.searchParams.get("roomPath");

                    if (!accountId)
                        throw new InvalidArgumentError("Missing `accountId` search param");
                    if (!roomPath)
                        throw new InvalidArgumentError("Missing `roomPath` search param");

                    // In development we proxy `/claude/conversation-state` from `AgentService` (always
                    // running) to `AgentV2Service` (sometimes running), the same way we proxy
                    // `/claude/webhook`.
                    const agentV2ServiceUrl = assertExists(env.AGENT_V2_SERVICE_URL);

                    // Point at `AgentV2Service` but keep the original query string \u2014 the whole
                    // request is `?accountId&roomPath&accessToken`. It's a GET with no body, so we
                    // must not forward one (a GET subrequest with a body is rejected).
                    const conversationStateUrl = new URL(
                        "/claude/conversation-state",
                        agentV2ServiceUrl,
                    );
                    conversationStateUrl.search = url.search;

                    const response = await fetchWithTracer(
                        span,
                        conversationStateUrl,
                        {
                            serviceName: "AgentV2Service",
                            route: "/claude/conversation-state",
                            method: request.method,
                            headers: request.headers,
                        },
                        async response => response,
                    );

                    return response;
                }
                case "CursorWebhook": {
                    // TODO: Re-enable `@typescript-eslint/return-await` after deciding
                    // whether this `try`/`catch` should handle durable object failures.
                    // eslint-disable-next-line @typescript-eslint/return-await
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

                    // TODO: Re-enable `@typescript-eslint/return-await` after deciding
                    // whether this `try`/`catch` should handle durable object failures.
                    // eslint-disable-next-line @typescript-eslint/return-await
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
                    let durableObjectNamespace: DurableObjectNamespace;
                    switch (route.bot) {
                        case "ChatGpt":
                            durableObjectNamespace = env.MockChatGptAgentDurableObjectNamespace;
                            break;
                        case "Cursor":
                            durableObjectNamespace = env.MockCursorAgentDurableObjectNamespace;
                            break;
                        default:
                            throw exhaustive(route.bot);
                    }

                    // TODO: Re-enable `@typescript-eslint/return-await` after deciding
                    // whether this `try`/`catch` should handle durable object failures.
                    // eslint-disable-next-line @typescript-eslint/return-await
                    return handleDurableObjectPostRequest(
                        span,
                        durableObjectNamespace,
                        request,
                        "/webhook",
                    );
                }
                case "MockRecording": {
                    let durableObjectNamespace: DurableObjectNamespace;
                    switch (route.bot) {
                        case "ChatGpt":
                            durableObjectNamespace = env.MockChatGptAgentDurableObjectNamespace;
                            break;
                        case "Cursor":
                            durableObjectNamespace = env.MockCursorAgentDurableObjectNamespace;
                            break;
                        default:
                            throw exhaustive(route.bot);
                    }

                    const accountId = url.searchParams.get("accountId");
                    const roomPath = url.searchParams.get("roomPath");

                    if (!accountId)
                        throw new InvalidArgumentError("Missing `accountId` search param");
                    if (!roomPath)
                        throw new InvalidArgumentError("Missing `roomPath` search param");

                    const newUrl = new URL(request.url);
                    newUrl.pathname = "/recording";

                    // TODO: Re-enable `@typescript-eslint/return-await` after deciding
                    // whether this `try`/`catch` should handle durable object failures.
                    // eslint-disable-next-line @typescript-eslint/return-await
                    return fetchFromDurableObject(
                        span,
                        durableObjectNamespace,
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

                    return createSimpleOkResponse();
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

    return await fetchFromDurableObject(
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

async function fetchFromDurableObject(
    span: TracerSpan,
    durableObjectNamespace: DurableObjectNamespace,
    name: string,
    request: Request,
) {
    const id = durableObjectNamespace.idFromName(name);

    return await fetchFromDurableObjectWithId(span, durableObjectNamespace, id, request);
}

async function fetchFromDurableObjectWithId(
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

    return await durableObjectStub.fetch(request);
}

function getDurableObjectIdFromApiBotWebhookEvent(request: ApiBotWebhookRequestBody) {
    return `${request.botAccount.id}:${printApiMessageRoomPath(request.event.room)}`;
}

// eslint-disable-next-line import/no-default-export
export default {fetch: handleFetch};

export {ChatGptAgentDurableObject} from "~/server/agents/bots/deprecated/internal/chat_gpt_agent_durable_object.js";
export {
    MockChatGptAgentDurableObject,
    MockCursorAgentDurableObject,
} from "~/server/agents/bots/internal/mock_agent_durable_object.js";
export {CursorAgentDurableObject} from "~/server/agents/bots/deprecated/internal/cursor/cursor_agent_durable_object.js";
