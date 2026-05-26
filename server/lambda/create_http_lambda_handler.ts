import {defaultProvider} from "@aws-sdk/credential-provider-node";
import {APIGatewayProxyEvent, APIGatewayProxyHandler, Context as LambdaContext} from "aws-lambda";
import {ServerSecrets} from "~/server/aws/server_secrets_schema.js";
import {AwsRequestSigner} from "~/server/helpers/aws_request_signer.js";
import {createLambdaTracerAndHoneycombClient} from "~/server/lambda/helpers/create_lambda_tracer_and_honeycomb_client.js";
import {
    LambdaActionContext,
    LambdaActionContextOptions,
    createLambdaActionContext,
    getLambdaActionContextOptions,
} from "~/server/lambda/helpers/lambda_action_context.js";
import {withLambdaTimeout} from "~/server/lambda/helpers/with_lambda_timeout.js";
import {createServiceTokenAgent} from "~/server/node/create_service_token_agent.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {TokenServiceName} from "~/server/tokens/token_service_name.js";
import {
    createTraceServerResponseHandleSpanName,
    startTracerSpanFromPropagationContextHeader,
} from "~/server/tracer/trace_server_response.js";
import {HoneycombDataset, TracerClient} from "~/server/tracer/tracer_client.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {PromiseWaiter} from "~/shared/helpers/async/promise_waiter.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {Schema} from "~/shared/schema/schema.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

const honeycombApiKey =
    process.env.NODE_ENV !== "production"
        ? process.env.HONEYCOMB_API_KEY
        : assertExists(process.env.HONEYCOMB_API_KEY, "HONEYCOMB_API_KEY is required");

const kinesisTracerStreamName =
    process.env.NODE_ENV !== "production"
        ? // TODO(ifitzsimmons, #local-kinesis): We don't have a local Kinesis stream at the
          // moment, but when we do, this will always be required
          (process.env.KINESIS_TRACER_STREAM_NAME ?? "")
        : assertExists(
              process.env.KINESIS_TRACER_STREAM_NAME,
              "KINESIS_TRACER_STREAM_NAME is required",
          );

export function createHttpLambdaHandler({
    handleRequest,
    serviceSecretsSchema,
    route,
    serviceName,
    honeycombDataset,
}: {
    handleRequest: (
        processContext: LambdaActionContext,
        {
            request,
            url,
            lambdaContext,
            span,
            tokenAgent,
        }: {
            request: Request;
            url: URL;
            lambdaContext: LambdaContext;
            span: TracerSpan;
            tokenAgent: TokenAgent;
        },
    ) => Promise<Response>;
    serviceSecretsSchema: Schema<ServerSecrets>;
    route: string;
    serviceName: TokenServiceName;
    honeycombDataset: HoneycombDataset;
}): APIGatewayProxyHandler {
    const awsSigner = new AwsRequestSigner(defaultProvider());
    let tokenAgentAndOptionsPromise: Promise<{
        tokenAgent: TokenAgent;
        options: LambdaActionContextOptions;
    }> | null = null;

    // TODO(ifitzsimmons, #convert-to-lambda-response-streaming): Convert to Lambda
    // Response Streaming so that we can run cleanup processes after sending responses
    // to clients.
    // https://docs.aws.amazon.com/lambda/latest/dg/configuration-response-streaming.html
    return async (event: APIGatewayProxyEvent, lambdaContext: LambdaContext) => {
        const promiseWaiter = new PromiseWaiter();
        let span: TracerSpan | null = null;
        let finishSpan: (() => void) | null = null;
        let honeycombTracerClient: TracerClient | null = null;

        try {
            const url = getUrl(event);

            const abortController = new AbortController();
            const request = new Request(url, {
                method: event.httpMethod,
                headers: new Headers(event.headers as Record<string, string>),
                signal: abortController.signal,
                ...(event.body ? {body: event.body} : {}),
            });

            let tracer: TracerRoot;
            [tracer, honeycombTracerClient] = createLambdaTracerAndHoneycombClient({
                serviceName,
                jsHost: "Node",
                promiseWaiter,
                honeycombApiKey,
                honeycombDataset,
                kinesisTracerStreamName,
                awsSigner,
            });
            ({span, finishSpan} = getSpanForRequest(tracer, request, route));

            tokenAgentAndOptionsPromise ??= span.withSpan(
                "Allocate token agent and context options",
                async childSpan =>
                    await getLambdaActionContextOptions(serviceSecretsSchema, childSpan).then(
                        async options => {
                            const tokenAgent = await childSpan.withSpan(
                                "Creating token agent",
                                async () =>
                                    await createServiceTokenAgent({
                                        serviceName,
                                        options,
                                    }),
                            );
                            return {tokenAgent, options};
                        },
                    ),
            );
            const {tokenAgent, options} = await tokenAgentAndOptionsPromise;

            const actionContext = createLambdaActionContext({
                awsSigner,
                options,
                promiseWaiter,
                span,
                tokenAgent,
                tracer,
            });

            // TODO: Re-enable `@typescript-eslint/return-await` after deciding whether
            // this `try`/`catch` should handle async request failures.
            // eslint-disable-next-line @typescript-eslint/return-await
            return actuallyHandleRequest({
                handleRequest,
                lambdaContext,
                abortController,
                actionContext,
                span,
                tokenAgent,
                request,
                url,
            });
        } catch (error) {
            if (span) {
                span.addException(error);
            } else {
                // NOTE(ifitzsimmons, 2025-09-05): If we failed to handle the request due to
                // resource allocation issues, we want to log an error to Cloudwatch. Theoretically,
                // this should never happen, but this will help us debug the issue.
                // eslint-disable-next-line no-console
                console.error("Error outside of HTTP lambda request handler:", error);
            }
            return intoHttpReponse(error);
        } finally {
            finishSpanAndFlushHoneycombEvents(finishSpan, honeycombTracerClient, promiseWaiter);
        }
    };
}

async function actuallyHandleRequest({
    handleRequest,
    lambdaContext,
    abortController,
    actionContext,
    span,
    tokenAgent,
    request,
    url,
}: {
    handleRequest: (
        processContext: LambdaActionContext,
        {
            request,
            url,
            lambdaContext,
            span,
            tokenAgent,
        }: {
            request: Request;
            url: URL;
            lambdaContext: LambdaContext;
            span: TracerSpan;
            tokenAgent: TokenAgent;
        },
    ) => Promise<Response>;
    lambdaContext: LambdaContext;
    abortController: AbortController;
    actionContext: LambdaActionContext;
    span: TracerSpan;
    tokenAgent: TokenAgent;
    request: Request;
    url: URL;
}) {
    try {
        // TODO: Re-enable `@typescript-eslint/return-await` after deciding whether
        // this `try`/`catch` should handle async timeout failures.
        // eslint-disable-next-line @typescript-eslint/return-await
        return withLambdaTimeout(lambdaContext, abortController, async () => {
            // stream response here, wait for process event after
            const response = await handleRequest(actionContext, {
                request,
                url,
                lambdaContext,
                span,
                tokenAgent,
            });

            // Convert Response to API Gateway format
            const body = await response.arrayBuffer();
            const headers: Record<string, string> = {};

            response.headers.forEach((value, key) => {
                headers[key] = value;
            });

            return {
                statusCode: response.status,
                headers,
                body: Buffer.from(body).toString("base64"),
                isBase64Encoded: true,
            };
        });
    } catch (error) {
        span.addException(error);
        return intoHttpReponse(error);
    }
}

function getUrl(event: APIGatewayProxyEvent) {
    const host = assertExists(event.headers.host || event.headers.Host, "Missing host in request");
    const protocol = "http";
    const baseUrl = `${protocol}://${host}`;

    let queryString = "";
    if (event.queryStringParameters) {
        // Filter out null values and create URLSearchParams
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(event.queryStringParameters)) {
            if (value !== null && value !== undefined) {
                params.append(key, value);
            }
        }
        const paramString = params.toString();
        if (paramString) {
            queryString = "?" + paramString;
        }
    }

    return new URL(event.path + queryString, baseUrl);
}

function intoHttpReponse(error: unknown) {
    return {
        statusCode: isSystemError(error) ? 500 : 400,
        headers: {"content-type": "application/json"},
        body: JSON.stringify({ok: false, error: ErrorSchema.serialize(error)}),
    };
}

function finishSpanAndFlushHoneycombEvents(
    finishSpan: (() => void) | null,
    honeycombTracerClient: TracerClient | null,
    promiseWaiter: PromiseWaiter,
) {
    finishSpan?.();
    // TODO(ifitzsimmons, #convert-to-lambda-response-streaming): Fire and forget
    // request that flushes the batch of honeycomb events.
    promiseWaiter.waitUntil(async () => {
        await honeycombTracerClient?.flushScheduledEventBatch();
    });
    void promiseWaiter.wait();
}

function getSpanForRequest(tracer: TracerRoot, request: Request, route: string) {
    const spanName = createTraceServerResponseHandleSpanName(tracer, request, route);
    return startTracerSpanFromPropagationContextHeader(tracer, spanName, request.headers);
}
