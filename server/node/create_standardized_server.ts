import "~/server/node/install_response_with_web_socket_support.js";

import {IncomingHttpHeaders, IncomingMessage, ServerResponse, createServer} from "http";
import {Socket} from "net";
import {Readable as ReadableStream} from "stream";
import {WebSocketServer} from "ws";
import {createSimpleErrorResponse} from "~/server/helpers/create_simple_error_response.js";
import {registerGracefulServerShutdown} from "~/server/node/register_graceful_server_shutdown.js";
import {ShutdownManager} from "~/server/node/shutdown_manager.js";
import {traceServerResponse} from "~/server/tracer/trace_server_response.js";
import {coupleWebSocket} from "~/server/web_socket/couple_web_socket.js";
import {AbortedError, InternalError} from "~/shared/error/error.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {getSetCookieHeaders} from "~/shared/helpers/http/get_set_cookie_headers.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

/**
 * Create a request listener for a Node.js HTTP server that follows WhatWG
 * conventions.
 */
export function createStandardizedRequestListener<Route>(
    tracer: TracerRoot,
    parseRoute: (url: URL) => [string, Route],
    handleRequest: (
        request: Request,
        url: URL,
        route: Route,
        span: TracerSpan,
    ) => Promise<Response>,
) {
    const actuallyHandleRequest = wrapWithTraceServerResponse(tracer, parseRoute, handleRequest);

    return (req: IncomingMessage, res: ServerResponse<IncomingMessage>) => {
        standardizedRequestListener(tracer, req, res, actuallyHandleRequest);
    };
}

function wrapWithTraceServerResponse<Route>(
    tracer: TracerRoot,
    parseRoute: (url: URL) => [string, Route],
    handleRequest: (
        request: Request,
        url: URL,
        route: Route,
        span: TracerSpan,
    ) => Promise<Response>,
): (request: Request) => Promise<Response> {
    return request => {
        const url = new URL(request.url);

        const [route, routeObject] = parseRoute(url);

        return traceServerResponse(tracer, request, url, route, async (span, request) => {
            try {
                const response = await handleRequest(request, url, routeObject, span);
                return response;
            } catch (error) {
                span.addException(error);
                return createSimpleErrorResponse(error);
            }
        });
    };
}

export function standardizedRequestListener(
    tracer: TracerRoot,
    req: IncomingMessage,
    res: ServerResponse<IncomingMessage>,
    handleRequest: (request: Request) => Promise<Response>,
): void {
    try {
        const abortController = new AbortController();

        const request = createStandardizedRequest(req, abortController.signal);
        const responsePromise = handleRequest(request);

        const handleClose = () => {
            abortController.abort(new AbortedError("Request was closed by client"));
        };

        res.on("close", handleClose);

        responsePromise.then(
            response => {
                res.off("close", handleClose);
                sendStandardizedResponse(res, response);
            },
            error => {
                res.off("close", handleClose);
                handleStandardizedRequestListenerError(res, error);
            },
        );
    } catch (error) {
        // The server should try its best to handle errors and provide a relevant error
        // response. However, as a fallback treat any errors as uncaught exceptions.
        tracer.logException("Unhandled error during request", error);

        handleStandardizedRequestListenerError(res, error);
    }
}

function handleStandardizedRequestListenerError(
    res: ServerResponse<IncomingMessage>,
    error: unknown,
) {
    // `error` should have already been logged by our request handler which is wrapped
    // in a span. We don't need to log it again.

    if (res.headersSent) {
        res.end();
    } else {
        let statusCode;
        let statusMessage;
        if (isSystemError(error)) {
            statusCode = 500;
            statusMessage = "Internal Server Error";
        } else {
            statusCode = 400;
            statusMessage = "Bad Request";
        }

        res.writeHead(statusCode, {"content-type": "text/plain"});

        if (process.env.NODE_ENV === "production" || !(error instanceof Error)) {
            res.end(`${statusCode} ${statusMessage}`);
        } else {
            res.end(`${statusCode} ${statusMessage}\n\n${error.stack ?? error.message}`);
        }
    }
}

/**
 * Convert a Node.js request object to a WhatWG fetch request object.
 */
export function createStandardizedRequest(req: IncomingMessage, signal?: AbortSignal): Request {
    const protocol = "http";
    const host = req.headers.host;
    const url = `${protocol}://${host!}${req.url!}`;

    const init: RequestInit = {
        method: req.method,
        headers: createStandardizedHeaders(req.headers),
        signal,
    };

    if (req.method !== "GET" && req.method !== "HEAD") {
        const body = ReadableStream.toWeb(req);

        // @ts-expect-error: Global `ReadableStream` type is incompatible with Node.js
        // `ReadableStream` type.
        init.body = body;

        // eslint-disable-next-line @typescript-eslint/prefer-ts-expect-error
        // @ts-ignore: Expected by the WhatWG fetch API when `body` is a
        // `ReadableStream` but it's not supported in the types yet.
        // https://github.com/nodejs/node/issues/46221
        init.duplex = "half";
    }

    return new Request(url, init);
}

/**
 * Convert a Node.js request headers object to a WhatWG fetch request headers
 * object.
 */
export function createStandardizedHeaders(reqHeaders: IncomingHttpHeaders): Headers {
    const headers = new Headers();

    for (const [key, values] of Object.entries(reqHeaders)) {
        if (values) {
            if (Array.isArray(values)) {
                for (const value of values) {
                    headers.append(key, value);
                }
            } else {
                headers.set(key, values);
            }
        }
    }

    return headers;
}

/**
 * Convert a WhatWG response object to a Node.js response.
 */
export function sendStandardizedResponse(res: ServerResponse, response: Response) {
    for (const [key, value] of response.headers.entries()) {
        // The [`Set-Cookie` header][1] can be sent multiple times however the `Headers`
        // object acts as a simple key/value store. We need to use our
        // `getSetCookieHeaders()` to get the right value for this header.
        //
        // [1]:
        //     https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie#see_also
        if (/^set-cookie$/i.test(key)) {
            res.setHeader(key, getSetCookieHeaders(response.headers));
        } else {
            res.setHeader(key, value);
        }
    }

    res.writeHead(response.status);

    if (response.body) {
        ReadableStream.fromWeb(
            // @ts-expect-error: Global `ReadableStream` type is incompatible with Node.js
            // `ReadableStream` type.
            response.body,
        ).pipe(res, {end: true});
    } else {
        res.end();
    }
}

/**
 * Create a Node.js HTTP server using a request handler following WhatWG
 * conventions.
 */
export function createStandardizedServer<Route>(
    tracer: TracerRoot,
    shutdownManager: ShutdownManager,
    parseRoute: (url: URL) => [string, Route],
    handleRequest: (
        request: Request,
        url: URL,
        route: Route,
        span: TracerSpan,
    ) => Promise<Response>,
) {
    const actuallyHandleRequest = wrapWithTraceServerResponse(tracer, parseRoute, handleRequest);

    return createStandardizedServerBase(tracer, shutdownManager, (req, res) => {
        standardizedRequestListener(tracer, req, res, actuallyHandleRequest);
    });
}

export function createStandardizedServerBase(
    tracer: TracerRoot,
    shutdownManager: ShutdownManager,
    requestListener: (req: IncomingMessage, res: ServerResponse<IncomingMessage>) => void,
) {
    const server = createServer(requestListener);

    server.on("error", error => {
        tracer.logException("Uncaught exception from HTTP server", error);
    });

    registerGracefulServerShutdown(shutdownManager, server);

    return server;
}

/**
 * Create a Node.js HTTP server using a request handler following WhatWG
 * conventions.
 *
 * Includes support for WebSockets using the same API as [Cloudflare Worker's
 * WebSocket API][1] though the WebSocket server runs in Node.js, not in
 * Cloudflare.
 *
 * [1]:
 *     https://developers.cloudflare.com/workers/runtime-apis/websockets/use-websockets/
 */
export function createStandardizedServerWithWebSockets<Route>(
    tracer: TracerRoot,
    shutdownManager: ShutdownManager,
    parseRoute: (url: URL) => [string, Route],
    handleRequest: (
        request: Request,
        url: URL,
        route: Route,
        span: TracerSpan,
    ) => Promise<Response>,
) {
    const server = createStandardizedServer(tracer, shutdownManager, parseRoute, handleRequest);

    // WebSocket server implementation is adapted from Miniflare. Cloudflare's Node.js
    // implementation of their runtime.
    // https://github.com/cloudflare/miniflare/blob/7e4d906e19cc69cd3446512bfeb7f8aee3a2bda7/packages/http-server/src/index.ts#L358-L463

    const actuallyHandleWebSocketRequest = wrapWithTraceServerResponse(
        tracer,
        parseRoute,
        async (request, url, route, span) => {
            const response = await handleRequest(request, url, route, span);

            // "ok" responses are errors if the user is trying to upgrade.
            if (
                !(response.status === 101 && response.webSocket) &&
                200 <= response.status &&
                response.status < 300
            ) {
                throw new InternalError(
                    "WebSocket request did not return status 101 Switching Protocols response with WebSocket",
                );
            }

            return response;
        },
    );

    const webSocketServer = new WebSocketServer({
        noServer: true,
        // Disable automatic handling of `Sec-WebSocket-Protocol` header, to match
        // Cloudflare's behavior:
        // https://github.com/cloudflare/miniflare/blob/7e4d906e19cc69cd3446512bfeb7f8aee3a2bda7/packages/http-server/src/index.ts#L380-L383
        handleProtocols: () => false,
    });

    webSocketServer.on("error", error => {
        tracer.logException("Uncaught exception from WebSocket server", error);
    });

    const restrictedWebSocketUpgradeHeaders = ["upgrade", "connection", "sec-websocket-accept"];

    // Add custom headers included in response to WebSocket upgrade requests
    const extraHeaders = new WeakMap<IncomingMessage, Headers>();
    webSocketServer.on("headers", (headers, req) => {
        const extra = extraHeaders.get(req);
        extraHeaders.delete(req);
        if (extra) {
            for (const [key, value] of extra) {
                if (!restrictedWebSocketUpgradeHeaders.includes(key.toLowerCase())) {
                    headers.push(`${key}: ${value}`);
                }
            }
        }
    });

    server.on("upgrade", (req, socket, head) => {
        socket.on("error", error => {
            // Thrown when the other side of the socket closes. This is normal. Ignore the
            // error.
            // https://stackoverflow.com/questions/2974021/what-does-econnreset-mean-in-the-context-of-an-af-local-socket
            if ("code" in error && (error.code === "ECONNRESET" || error.code === "EPIPE")) return;

            scheduleUncaughtError(error);
        });

        const request = createStandardizedRequest(req);

        actuallyHandleWebSocketRequest(request).then(
            response => {
                // Check web socket response was returned
                const webSocket = response.webSocket;
                if (response.status === 101 && webSocket) {
                    // Accept and couple the Web Socket
                    extraHeaders.set(req, response.headers);
                    webSocketServer.handleUpgrade(req, socket, head, ws => {
                        void coupleWebSocket(ws, webSocket as any);
                        webSocketServer.emit("connection", ws, req);
                    });
                    return;
                }

                // Otherwise, we'll be returning a regular HTTP response
                const res = new ServerResponse(req);
                // `socket` is guaranteed to be an instance of `net.Socket`:
                // https://nodejs.org/api/http.html#event-upgrade_1
                assert(socket instanceof Socket);
                res.assignSocket(socket);

                // Otherwise, send the response as is (e.g. unauthorized), always disabling
                // live-reload as this is a WebSocket upgrade
                sendStandardizedResponse(res, response);
            },
            error => {
                // `error` should have already been logged by our request handler which is wrapped
                // in a span. We don't need to log it again.

                const res = new ServerResponse(req);
                // `socket` is guaranteed to be an instance of `net.Socket`:
                // https://nodejs.org/api/http.html#event-upgrade_1
                assert(socket instanceof Socket);
                res.assignSocket(socket);

                res.writeHead(500, {"content-type": "text/plain"});

                if (process.env.NODE_ENV === "production" || !(error instanceof Error)) {
                    res.end("500 Internal Server Error");
                } else {
                    res.end(`500 Internal Server Error\n\n${error.stack ?? error.message}`);
                }
            },
        );
    });

    return server;
}
