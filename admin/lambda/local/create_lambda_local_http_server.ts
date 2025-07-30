import {
    APIGatewayEventRequestContext,
    APIGatewayProxyEvent,
    APIGatewayProxyHandler,
} from "aws-lambda";
import {randomUUID} from "crypto";
import {IncomingMessage, ServerResponse, createServer} from "http";
import {createLambdaEventMockWithUnimplementedErrors} from "~/admin/lambda/local/internal/create_lambda_event_mock_with_unimplemented_errors.js";
import {createLambdaLocalEventContext} from "~/admin/lambda/local/internal/create_lambda_local_event_context.js";
import {unimplementedLambdaHandlerCallback} from "~/admin/lambda/local/internal/unimplemented_lambda_handler_callback.js";
import {registerGracefulServerShutdown} from "~/server/node/register_graceful_server_shutdown.js";
import {ShutdownManager} from "~/server/node/shutdown_manager.js";
import {InternalError, UnimplementedError} from "~/shared/error/error.js";
import {escapeRegExp} from "~/shared/helpers/string/escape_reg_exp.js";
import {quote} from "~/shared/helpers/string/quote.js";

export type LambdaLocalRoute = {
    /**
     * URL path pattern with parameters in curly braces
     * Example: "/resize/{spaceId}/{fileId}" or "/process-file"
     */
    path: string;

    /**
     * The Lambda handler function for this route
     */
    handler: APIGatewayProxyHandler;

    /**
     * Function name for logging/identification
     */
    functionName: string;

    /**
     * Optional timeout in milliseconds (defaults to 30000ms)
     */
    timeoutMs?: number;
};

/**
 * Single Lambda runtime server that can handle multiple Lambda functions with routing.
 * Routes requests to appropriate Lambda handlers based on URL path patterns.
 */
export function createLambdaLocalHttpServer(
    port: number,
    shutdownManager: ShutdownManager,
    routes: Array<LambdaLocalRoute>,
) {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
        handleRequest(req, res, {routes}).catch(error => {
            // eslint-disable-next-line no-console
            console.error("Lambda runtime server error:", error);
            res.statusCode = 500;
            res.setHeader("content-type", "text/plain");
            res.end("Internal server error");
        });
    });

    server.listen(port, () => {
        // eslint-disable-next-line no-console
        console.log(`Lambda runtime server listening on port ${port}`);
    });

    return registerGracefulServerShutdown(shutdownManager, server);
}

async function handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
    {routes}: {routes: Array<LambdaLocalRoute>},
) {
    const url = new URL(req.url!, `http://${req.headers.host}`);

    // Read request body if present
    let body: string | null = null;
    if (req.method && ["POST", "PUT", "PATCH"].includes(req.method)) {
        const chunks: Array<Buffer> = [];
        for await (const chunk of req) {
            chunks.push(chunk);
        }
        body = Buffer.concat(chunks).toString();
    }

    // Find matching route
    const matchedRoute = findMatchingRoute(url.pathname, routes);
    if (!matchedRoute) {
        res.statusCode = 404;
        res.setHeader("content-type", "text/plain");
        res.end("404 Nout Found: Lambda route not found");
        return;
    }

    const {route, pathParameters} = matchedRoute;
    const functionName = route.functionName;
    const timeoutMs = route.timeoutMs ?? 30000;

    const requestId = randomUUID();

    // Convert HTTP request to Lambda event format
    const event = createApiGatewayProxyEvent(req, {
        body,
        requestId,
        route,
        pathParameters,
        url,
    });

    const lambdaContext = createLambdaLocalEventContext({
        functionName,
        requestId,
        timeoutMs,
    });

    // Set up timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
            reject(
                new InternalError(
                    quote`Lambda function ${functionName} timed out after ${timeoutMs}ms`,
                ),
            );
        }, timeoutMs);
    });

    // Call the Lambda handler with timeout
    const result = await Promise.race([
        // NOTE(ifitzsimmons, #unimplemented-lambda-handler-callback)
        route.handler(event, lambdaContext, unimplementedLambdaHandlerCallback),
        timeoutPromise,
    ]);

    if (!result) {
        throw new InternalError("Lambda handler returned undefined");
    }

    // Convert Lambda response back to HTTP response
    res.statusCode = result.statusCode;
    res.setHeader("content-type", "application/json");
    // Set response headers
    if (result.headers) {
        for (const [key, value] of Object.entries(result.headers)) {
            if (typeof value === "string") {
                res.setHeader(key, value);
            }
        }
    }

    if (result.multiValueHeaders) {
        const isStringArray = (anyArray: Array<any>): anyArray is Array<string> => {
            return anyArray.every(item => typeof item === "string");
        };

        for (const [key, value] of Object.entries(result.multiValueHeaders)) {
            if (isStringArray(value)) {
                res.setHeader(key, value);
            }
        }
    }

    // Handle response body
    if (result.body) {
        if (result.isBase64Encoded) {
            res.end(Buffer.from(result.body, "base64"));
        } else {
            res.end(result.body);
        }
    } else {
        res.end();
    }
}

/**
 * Find a route that matches the given path and extract path parameters
 */
function findMatchingRoute(
    requestPath: string,
    routes: Array<LambdaLocalRoute>,
): {route: LambdaLocalRoute; pathParameters: Record<string, string> | null} | null {
    for (const route of routes) {
        const pathParameters = matchPathPattern(requestPath, route.path);
        if (pathParameters !== null) {
            return {route, pathParameters};
        }
    }
    return null;
}

/**
 * Check if a request path matches a route pattern and extract parameters
 * Pattern: "/resize/{spaceId}/{fileId}"
 * Path: "/resize/abc123/def456"
 * Returns: {spaceId: "abc123", fileId: "def456"}
 */
function matchPathPattern(requestPath: string, pattern: string): Record<string, string> | null {
    // Convert pattern to regex, replacing {param} with capture groups
    const paramNames: Array<string> = [];
    const escapedPattern = escapeRegExp(pattern);
    const regexPattern = escapedPattern.replace(/\\{([^}]+)\\}/g, (_, paramName) => {
        paramNames.push(paramName);
        return "([^/]+)";
    });

    const regex = new RegExp(`^${regexPattern}$`);
    const match = requestPath.match(regex);

    if (!match) {
        return null;
    }

    // Extract parameters
    const pathParameters: Record<string, string> = {};
    paramNames.forEach((paramName, index) => {
        pathParameters[paramName] = match[index + 1]!;
    });

    return pathParameters;
}

function createApiGatewayProxyEvent(
    req: IncomingMessage,
    {
        body,
        pathParameters,
        requestId,
        route,
        url,
    }: {
        body: string | null;
        pathParameters: Record<string, string> | null;
        requestId: string;
        route: LambdaLocalRoute;
        url: URL;
    },
) {
    const awsAccountId = "local";
    const requestTime = new Date();

    // Check for multi-value headers and throw error if found
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
        if (Array.isArray(value)) {
            throw new UnimplementedError(
                quote`Multi-value header ${key} is not supported. If you need this capability, please implement multiValueHeaders support.`,
            );
        }
        if (value !== undefined) {
            headers[key] = value;
        }
    }

    const requestContextBase: Partial<APIGatewayEventRequestContext> = {
        accountId: awsAccountId,
        path: url.pathname,
        httpMethod: req.method || "GET",
        requestId,
        requestTime: requestTime.toISOString(),
        requestTimeEpoch: requestTime.getTime(),
    };
    const requestContext = createLambdaEventMockWithUnimplementedErrors(
        requestContextBase,
        "ApiGatewayProxyEventRequestContext",
    );
    const apiGatewayProxyEventBase: Partial<APIGatewayProxyEvent> = {
        httpMethod: req.method || "GET",
        path: url.pathname,
        pathParameters,
        queryStringParameters: Object.fromEntries(url.searchParams.entries()),
        headers,
        body,
        requestContext,
        resource: route.path,
    };
    return createLambdaEventMockWithUnimplementedErrors(
        apiGatewayProxyEventBase,
        "ApiGatewayProxyEvent",
    );
}
