import {APIGatewayProxyEvent, APIGatewayProxyHandler, Context as LambdaContext} from "aws-lambda";
import {ServerSecrets} from "~/server/aws/server_secrets_schema.js";
import {AwsRequestSigner} from "~/server/helpers/node/aws_request_signer.js";
import {createLambdaTracerAndHoneycombClient} from "~/server/lambda/helpers/create_lambda_tracer_and_honeycomb_client.js";
import {
    LambdaActionContext,
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
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {PromiseWaiter} from "~/shared/helpers/async/promise_waiter.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {Schema} from "~/shared/schema/schema.js";
import {TracerServiceName} from "~/shared/tracer/tracer_root.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

export function createHttpLambdaHandler({
    handleRequest,
    serviceSecretsSchema,
    route,
    serviceName,
    tokenServiceName,
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
    serviceName: TracerServiceName;
    tokenServiceName: TokenServiceName;
}): APIGatewayProxyHandler {
    const tokenAgentAndOptionsPromise = getLambdaActionContextOptions(serviceSecretsSchema).then(
        options => {
            return createServiceTokenAgent({
                serviceName: tokenServiceName,
                options,
            }).then(tokenAgent => {
                return {tokenAgent, options};
            });
        },
    );
    const awsSigner = new AwsRequestSigner();

    // TODO(ifitzsimmons, #convert-to-lambda-response-streaming): Convert to Lambda Response
    // Streaming so that we can run cleanup processes after sending responses to clients.
    // https://docs.aws.amazon.com/lambda/latest/dg/configuration-response-streaming.html
    return async (event: APIGatewayProxyEvent, lambdaContext: LambdaContext) => {
        const {tokenAgent, options} = await tokenAgentAndOptionsPromise;

        const promiseWaiter = new PromiseWaiter();
        const [tracer, honeycombTracerClient] = createLambdaTracerAndHoneycombClient({
            serviceName,
            jsHost: "Node",
            promiseWaiter,
            honeycombApiKey: options.honeycombApiKey,
        });

        const url = getUrl(event);

        const abortController = new AbortController();
        const request = new Request(url, {
            method: event.httpMethod,
            headers: new Headers(event.headers as Record<string, string>),
            signal: abortController.signal,
            ...(event.body ? {body: event.body} : {}),
        });
        const spanName = createTraceServerResponseHandleSpanName(tracer, request, route);
        const {span, finishSpan} = startTracerSpanFromPropagationContextHeader(
            tracer,
            spanName,
            request.headers,
        );
        const actionContext = createLambdaActionContext({
            awsSigner,
            options,
            promiseWaiter,
            span,
            tokenAgent,
            tracer,
        });

        try {
            return await withLambdaTimeout(lambdaContext, abortController, async () => {
                // stream response here, wait for process event after
                const response = await handleRequest(actionContext, {
                    request,
                    url,
                    lambdaContext,
                    span,
                    tokenAgent: tokenAgent,
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

            return {
                statusCode: isSystemError(error) ? 500 : 400,
                headers: {"content-type": "application/json"},
                body: JSON.stringify(
                    ErrorSchema.serialize({
                        ok: false,
                        error,
                    }),
                ),
            };
        } finally {
            finishSpan();
            // TODO(ifitzsimmons, #convert-to-lambda-response-streaming): Fire and forget request
            // that flushes the batch of honeycomb events.
            promiseWaiter.waitUntil(async () => {
                await honeycombTracerClient?.flushScheduledEventBatch();
            });
            void promiseWaiter.wait();
        }
    };
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
