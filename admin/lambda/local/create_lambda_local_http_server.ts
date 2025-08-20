import {Context as LambdaContext} from "aws-lambda";
import {randomUUID} from "crypto";
import {IncomingMessage, ServerResponse, createServer} from "http";
import {createLambdaLocalEventContext} from "~/admin/lambda/local/internal/create_lambda_local_event_context.js";
import {LambdaActionContext} from "~/server/lambda/helpers/lambda_action_context.js";
import {
    createStandardizedRequest,
    sendStandardizedResponse,
} from "~/server/node/create_standardized_server.js";
import {registerGracefulServerShutdown} from "~/server/node/register_graceful_server_shutdown.js";
import {ShutdownManager} from "~/server/node/shutdown_manager.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {InternalError} from "~/shared/error/error.js";
import {escapeRegExp} from "~/shared/helpers/string/escape_reg_exp.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

export type LambdaLocalRoute = {
    /**
     * URL path pattern with parameters in curly braces
     * Example: "/resize/{spaceId}/{fileId}" or "/process-file"
     */
    path: string;

    /**
     * The Lambda handler function for this route
     */
    handler: (
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
    processContext: LambdaActionContext,
    {
        port,
        shutdownManager,
        routes,
        tokenAgent,
    }: {
        port: number;
        shutdownManager: ShutdownManager;
        routes: Array<LambdaLocalRoute>;
        tokenAgent: TokenAgent;
    },
) {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
        handleRequest(processContext, {
            req,
            res,
            routes,
            tokenAgent,
        }).catch(error => {
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
    processContext: LambdaActionContext,
    {
        req,
        res,
        routes,
        tokenAgent,
    }: {
        req: IncomingMessage;
        res: ServerResponse;
        routes: Array<LambdaLocalRoute>;
        tokenAgent: TokenAgent;
    },
) {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const route = findMatchingRoute(url.pathname, routes);
    if (!route) {
        res.statusCode = 404;
        res.setHeader("content-type", "text/plain");
        res.end("404 Not Found: Lambda route not found");
        return;
    }

    const functionName = route.functionName;
    const timeoutMs = route.timeoutMs ?? 30000;

    const requestId = randomUUID();

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

    const {span} = processContext.tracer.startSpan(route.path);
    // Call the Lambda handler with timeout
    const response = await Promise.race([
        // NOTE(ifitzsimmons, #unimplemented-lambda-handler-callback)
        route.handler(processContext, {
            request: createStandardizedRequest(req),
            url,
            lambdaContext,
            span,
            tokenAgent,
        }),
        timeoutPromise,
    ]);

    if (!response) {
        throw new InternalError("Lambda handler returned undefined");
    }

    sendStandardizedResponse(res, response);
}

/**
 * Find a route that matches the given path and extract path parameters
 */
function findMatchingRoute(
    requestPath: string,
    routes: Array<LambdaLocalRoute>,
): LambdaLocalRoute | null {
    for (const route of routes) {
        if (matchPathPattern(requestPath, route.path)) {
            return route;
        }
    }
    return null;
}

/**
 * Check if a request path matches a route pattern and extract parameters
 * Pattern: "/resize/{spaceId}/{fileId}"
 * Path: "/resize/abc123/def456"
 */
function matchPathPattern(requestPath: string, pattern: string): boolean {
    // Convert pattern to regex, replacing {param} with capture groups
    const paramNames: Array<string> = [];
    const escapedPattern = escapeRegExp(pattern);
    const regexPattern = escapedPattern.replace(/\\{([^}]+)\\}/g, (_, paramName) => {
        paramNames.push(paramName);
        return "([^/]+)";
    });

    const regex = new RegExp(`^${regexPattern}$`);
    const match = requestPath.match(regex);

    return match !== null;
}
