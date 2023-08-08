import {
    Request as NodeRequest,
    RequestInit as NodeRequestInit,
    Response as NodeResponse,
    writeReadableStreamToWritable,
} from "@remix-run/node";
import {IncomingHttpHeaders, IncomingMessage, ServerResponse, createServer} from "http";
import {PassThrough} from "stream";
import {traceStandardizedRequest} from "~/server/tracer/trace_standardized_request.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

/**
 * Create a Node.js HTTP server using a request handler following WhatWG
 * conventions.
 */
export function createStandardizedServer(
    tracer: TracerRoot,
    handleRequest: (request: Request, url: URL, span: TracerSpan) => Promise<Response>,
) {
    return createServer(createStandardizedRequestListener(tracer, handleRequest));
}

/**
 * Create a request listener for a Node.js HTTP server that follows WhatWG
 * conventions.
 */
export function createStandardizedRequestListener(
    tracer: TracerRoot,
    handleRequest: (request: Request, url: URL, span: TracerSpan) => Promise<Response>,
) {
    return (req: IncomingMessage, res: ServerResponse): void => {
        const handleUnhandledError = (error: unknown) => {
            // The server should try its best to handle errors and provide a relevant error
            // response. However, as a fallback treat any errors as uncaught exceptions.
            tracer.logUncaughtException("Unhandled error during request", error);

            if (res.headersSent) {
                res.end();
            } else {
                res.writeHead(500, {"Content-Type": "text/plain"});
                res.end("500 Internal Server Error");
            }
        };

        try {
            const request = createStandardizedRequest(req);
            const url = new URL(request.url);

            const responsePromise = traceStandardizedRequest(
                tracer,
                request,
                url,
                (span, request) => handleRequest(request, url, span),
            );

            responsePromise.then(
                response => sendStandardizedResponse(res, response as NodeResponse),
                handleUnhandledError,
            );
        } catch (error) {
            handleUnhandledError(error);
        }
    };
}

/**
 * Convert a Node.js request object to a WhatWG fetch request object.
 */
export function createStandardizedRequest(req: IncomingMessage): Request {
    const protocol = "http";
    const host = req.headers.host;
    const url = `${protocol}://${host!}${req.url!}`;

    const init: NodeRequestInit = {
        method: req.method,
        headers: createStandardizedRequestHeaders(req.headers),
    };

    if (req.method !== "GET" && req.method !== "HEAD") {
        // Derived from the following. Unclear to me how the `highWaterMark` number
        // was picked.
        // https://github.com/mcansh/remix-node-http-server/blob/230a8b5f270231011466c6b9452c543224588603/packages/remix-raw-http/src/server.ts#L90
        init.body = req.pipe(new PassThrough({highWaterMark: 16384}));
    }

    return new NodeRequest(url, init);
}

/**
 * Convert a Node.js request headers object to a WhatWG fetch request
 * headers object.
 */
export function createStandardizedRequestHeaders(reqHeaders: IncomingHttpHeaders): Headers {
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
export async function sendStandardizedResponse(res: ServerResponse, response: Response) {
    res.statusCode = response.status;

    for (const [key, values] of Object.entries((response as NodeResponse).headers.raw())) {
        res.setHeader(key, values);
    }

    if (response.body) {
        await writeReadableStreamToWritable(response.body, res);
    } else {
        res.end();
    }
}
