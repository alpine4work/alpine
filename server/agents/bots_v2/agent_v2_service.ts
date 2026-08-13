import {AgentV2ServiceEnv} from "~/server/agents/bots_v2/internal/agent_v2_service_env.js";
import {
    runClaudeAgentWebhookFast,
    runClaudeAgentWebhookSlow,
} from "~/server/agents/bots_v2/internal/run_claude_agent_webhook.js";
import {AwsRequestSigner} from "~/server/helpers/aws_request_signer.js";
import {createSimpleErrorResponse} from "~/server/helpers/create_simple_error_response.js";
import {createServerTracer} from "~/server/tracer/server_tracer.js";
import {traceServerResponse} from "~/server/tracer/trace_server_response.js";
import {InternalError} from "~/shared/error/error.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";

type AgentV2ServiceRoute =
    | {type: "ClaudeWebhook"}
    | {type: "ClaudeWebhookSlow"}
    | {type: "NotFound"};

function createTracer(env: AgentV2ServiceEnv, executionContext: ExecutionContext) {
    const streamName = env.KINESIS_TRACER_STREAM_NAME;
    if (!streamName && process.env.NODE_ENV === "production")
        throw new InternalError("Must provide `KINESIS_TRACER_STREAM_NAME` in production");

    // Create a new tracer for every request because we need a Honeycomb client and the
    // Honeycomb client needs `executionContext.waitUntil()` which is request scoped.
    // Tracers are cheap to construct so this is fine.
    const tracer = createServerTracer({
        serviceName: "AgentV2Service",
        jsHost: "CloudflareWorker",
        honeycombApiKey: env.HONEYCOMB_API_KEY,
        honeycombDataset: "tracer",
        // TODO: Log tracer events in dev somehow while using `wrangler`. Not quite sure
        // how to do it yet since we're running in workerd and don't have file system
        // access. For now we turn it off since because we've enabled Node.js compatibility
        // `writeTracerEventToFileInDev()` tries to import an `fs` module and actually
        // write to a file.
        withoutWriteToFileInDev: true,
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

    return tracer;
}

async function handleFetch(
    request: Request,
    env: AgentV2ServiceEnv,
    executionContext: ExecutionContext,
) {
    const url = new URL(request.url);

    let routeString: string;
    let route: AgentV2ServiceRoute;

    switch (url.pathname) {
        case "/claude/webhook": {
            routeString = "/claude/webhook";
            route = {type: "ClaudeWebhook"};
            break;
        }
        case "/claude/webhook-slow": {
            routeString = "/claude/webhook-slow";
            route = {type: "ClaudeWebhookSlow"};
            break;
        }
        default: {
            routeString = "/*";
            route = {type: "NotFound"};
            break;
        }
    }

    const tracer = createTracer(env, executionContext);

    return await traceServerResponse(tracer, request, url, routeString, async (span, request) => {
        try {
            switch (route.type) {
                case "NotFound": {
                    return new Response("404 Not Found", {
                        status: 404,
                        headers: {"content-type": "text/plain"},
                    });
                }
                case "ClaudeWebhook": {
                    try {
                        return await runClaudeAgentWebhookFast(
                            span,
                            request,
                            env,
                            executionContext,
                        );
                    } catch (error) {
                        if (process.env.NODE_ENV !== "production") {
                            // In dev, log to the console if the webhook fails to make debugging easier.
                            //
                            // eslint-disable-next-line no-console
                            console.error("Claude agent webhook failed:", error);
                        }
                        throw error;
                    }
                }
                case "ClaudeWebhookSlow": {
                    try {
                        return await runClaudeAgentWebhookSlow(span, request, env);
                    } catch (error) {
                        if (process.env.NODE_ENV !== "production") {
                            // In dev, log to the console if the webhook fails to make debugging easier.
                            //
                            // eslint-disable-next-line no-console
                            console.error("Claude agent webhook failed:", error);
                        }
                        throw error;
                    }
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
export default {
    fetch: handleFetch,
} satisfies ExportedHandler<AgentV2ServiceEnv>;

// `ContainerProxy` is required for `sandbox.mountBucket()` according to:
// https://developers.cloudflare.com/sandbox/guides/mount-buckets/#production-prerequisites-for-r2-binding-mounts
export {ContainerProxy} from "@cloudflare/sandbox";

export {ClaudeAgentSandbox} from "~/server/agents/bots_v2/internal/claude_agent_sandbox.js";
