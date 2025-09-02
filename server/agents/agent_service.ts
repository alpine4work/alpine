import {ApiBotWebhookRequestBody} from "~/server/api/specification/types/api_specification_convenience_types.js";
import {createSimpleErrorResponse} from "~/server/helpers/create_simple_error_response.js";
import {createServerTracer} from "~/server/tracer/server_tracer.js";
import {traceServerResponse} from "~/server/tracer/trace_server_response.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {addTracerPropagationContextHeader} from "~/shared/tracer/tracer_propagation_context_header.js";

type AgentServiceEnv = {
    ChatGptAgentDurableObjectNamespace: DurableObjectNamespace;
    HONEYCOMB_API_KEY?: string;
};

type AgentServiceRoute = "ChatGptWebhook" | "NotFound";

async function handleFetch(
    request: Request,
    env: AgentServiceEnv,
    executionContext: ExecutionContext,
) {
    const url = new URL(request.url);

    let routeString: string;
    let route: AgentServiceRoute;

    if (url.pathname === "/chat-gpt/webhook") {
        routeString = "/chat-gpt/webhook";
        route = "ChatGptWebhook";
    } else {
        routeString = "/*";
        route = "NotFound";
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

                    const id = env.ChatGptAgentDurableObjectNamespace.idFromName(
                        `${requestBody.accountId}:${requestBody.event.roomPath}`,
                    );

                    const durableObjectStub = env.ChatGptAgentDurableObjectNamespace.get(id, {
                        // Currently, we only have data in the AWS region `us-east-1`. So place Durable
                        // Objects in the Eastern North America region so Durable Objects get low
                        // latency when making calls to `ApiService` in AWS.
                        //
                        // Long term, ideally we'll put space data in the nearest AWS region to the
                        // customer and our Durable Objects should be created near that data center
                        // as well. Or we'll have DynamoDB replicas in multiple regions.
                        locationHint: "enam",
                    });

                    const newUrl = new URL(request.url);
                    newUrl.pathname = "/webhook";
                    const newRequest = new Request(newUrl.toString(), request);
                    addTracerPropagationContextHeader(newRequest.headers, span);

                    return durableObjectStub.fetch(newRequest);
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

// eslint-disable-next-line import/no-default-export
export default {fetch: handleFetch};

export {ChatGptAgentDurableObject} from "~/server/agents/internal/chat_gpt_agent_durable_object.js";
