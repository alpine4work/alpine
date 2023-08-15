import {IncomingHttpHeaders, IncomingMessage, ServerResponse, createServer} from "http";
import {Readable} from "stream";
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
                response => sendStandardizedResponse(res, response),
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

    const init: RequestInit = {
        method: req.method,
        headers: createStandardizedRequestHeaders(req.headers),
    };

    if (req.method !== "GET" && req.method !== "HEAD") {
        const body = Readable.toWeb(req);

        // @ts-expect-error: Global `ReadableStream` type is incompatible with Node.js
        // `ReadableStream` type.
        init.body = body;

        // @ts-expect-error: Expected by the WhatWG fetch API when `body` is a
        // `ReadableStream` but it's not supported in the types yet.
        // https://github.com/nodejs/node/issues/46221
        init.duplex = "half";
    }

    return new Request(url, init);
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

    for (const [key, value] of response.headers.entries()) {
        res.setHeader(key, value);
    }

    if (response.body) {
        Readable.fromWeb(
            // @ts-expect-error: Global `ReadableStream` type is incompatible with Node.js
            // `ReadableStream` type.
            response.body,
        ).pipe(res, {end: true});
    } else {
        res.end();
    }
}
