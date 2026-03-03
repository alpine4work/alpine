import {LocalRedirectServiceEnv} from "~/admin/local_redirect/local_redirect_service_env.js";
import {AwsRequestSigner} from "~/server/helpers/aws_request_signer.js";
import {createSimpleErrorResponse} from "~/server/helpers/create_simple_error_response.js";
import {createServerTracer} from "~/server/tracer/server_tracer.js";
import {traceServerResponse} from "~/server/tracer/trace_server_response.js";
import {InternalError} from "~/shared/error/error.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

async function fetch(
    request: Request,
    env: LocalRedirectServiceEnv,
    executionContext: ExecutionContext,
) {
    if (request.method !== "GET") {
        return new Response("Method not allowed", {status: 405});
    }

    // TODO(ifitzsimmons, #local-kinesis): This will eventually be required. For now,
    // there is no local Kinesis stream so we don't need to pass in a stream name.
    const streamName = env.KINESIS_TRACER_STREAM_NAME;
    if (!streamName && process.env.NODE_ENV === "production")
        throw new InternalError("Must provide `KINESIS_TRACER_STREAM_NAME` in production");

    // Create a new tracer for every request because we need a Honeycomb client and the
    // Honeycomb client needs `executionContext.waitUntil()` which is request scoped.
    // Tracers are cheap to construct so this is fine.
    const tracer = createServerTracer({
        serviceName: "LocalRedirectService",
        jsHost: "CloudflareWorker",
        honeycombApiKey: env.HONEYCOMB_API_KEY,
        honeycombDataset: "local-redirect-service",
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

    const url = new URL(request.url);

    return traceServerResponse(tracer, request, url, "/*", async () => {
        let redirectUrl: URL;
        try {
            const redirectUrlString = request.url.substring(url.origin.length + 1);
            redirectUrl = new URL(redirectUrlString);
        } catch (error) {
            tracer.logException("Error parsing redirect URL", error);
            return createSimpleErrorResponse(error);
        }

        const isAllowedDestination = env.ALLOWABLE_DESTINATION_ORIGINS.some(allowedOrigin => {
            const allowed = new URL(allowedOrigin);
            return (
                redirectUrl.protocol === allowed.protocol &&
                redirectUrl.hostname === allowed.hostname
            );
        });

        if (!isAllowedDestination) {
            return new Response("Bad request", {
                status: 400,
                headers: {"content-type": "text/plain"},
            });
        }

        return Response.redirect(redirectUrl, 307);
    });
}

// eslint-disable-next-line import/no-default-export
export default {fetch};
