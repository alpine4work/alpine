import {IncomingMessage, ServerResponse, createServer} from "http";
import {DynamoBatchContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {FileUploadServiceProcessContext} from "~/server/files/upload/file_upload_service_context.js";
import {uploadFile} from "~/server/files/upload/upload_file.js";
import {createStandardizedRequestHeaders} from "~/server/node/create_standardized_server.js";
import {createDynamoActorContextModule} from "~/server/spaces/create_dynamo_actor_context_module.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {
    addRequestTracerSpanData,
    startTracerSpanFromPropagationContextHeader,
} from "~/server/tracer/trace_server_response.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {InternalError} from "~/shared/error/error.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {isId} from "~/shared/id/id.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {obfuscateSetCookieHeaderString} from "~/shared/tracer/fetch_with_tracer.js";
import {tracerEventHttpHeaderNames} from "~/shared/tracer/helpers/tracer_event_http_header_names.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

// TODO(calebmer, #files): We'll need to make sure the AWS EC2 instance has a
// bunch of popular fonts installed for SVG and PDF documents.
//
// Look at what Gotenberg is doing for fonts:
// https://github.com/gotenberg/gotenberg/blob/da8eeb5d8f98e689b7eaa9276c8847fb7a390994/build/Dockerfile#L67-L117

export type FileUploadServiceRoute =
    | {readonly type: "NotFound"}
    | {readonly type: "Upload"; readonly spaceId: SpaceId};

export function createFileUploadService(
    processContext: FileUploadServiceProcessContext,
    tokenAgent: TokenAgent,
) {
    const tracer = processContext.tracer.getRoot();

    function parseRoute(url: URL): [string, FileUploadServiceRoute] {
        const pathnameParts = url.pathname.slice(1).split("/");
        const firstPathnamePart = pathnameParts[0];

        if (firstPathnamePart && isId<SpaceId>(firstPathnamePart)) {
            if (pathnameParts.length === 2 && pathnameParts[1] === "upload") {
                return ["/:spaceId/upload", {type: "Upload", spaceId: firstPathnamePart}];
            }
        }

        return ["/*", {type: "NotFound"}];
    }

    async function handleRequest(
        span: TracerSpan,
        route: FileUploadServiceRoute,
        url: URL,
        headers: Headers,
        req: IncomingMessage,
        res: ServerResponse<IncomingMessage>,
    ) {
        if (route.type === "NotFound") {
            res.writeHead(404, {"content-type": "text/plain"});
            res.end("404 Not Found");
            return;
        }

        const {spaceId} = route;

        const baseActionContext = processContext.clone({
            tracer: new TracerContextModule(span),
            cache: new CacheContextModule(),
            dynamoBatchContext: new DynamoBatchContextModule(),
        });

        const actorContextModule = await createDynamoActorContextModule(
            baseActionContext,
            headers,
            tokenAgent,
            spaceId,
        );

        return baseActionContext.with({actor: actorContextModule}, context =>
            uploadFile(context, span, route, url, headers, req, res),
        );
    }

    // We don't use `createStandardizedServer()` for `FileUploadService` because we
    // want direct access to Node.js streams (instead of web streams) for our
    // request and response. This is because we'll be doing a lot of stream
    // processing to implement file uploading with libraries built to work with
    // Node.js streams like `sharp`.
    //
    // This means we do have to reimplement tracing for `FileUploadService`. If you
    // make any change to tracing here, you also probably need to make that change
    // in `traceServerResponse()`.
    const server = createServer((req, res) => {
        const url = new URL(req.url!, `http://${req.headers.host ?? "localhost"}`);
        const headers = createStandardizedRequestHeaders(req.headers);

        const [routeString, route] = parseRoute(url);
        const handleSpanName = `${tracer.serviceName} ${req.method} ${routeString}`;

        const {span, finishSpan} = startTracerSpanFromPropagationContextHeader(
            tracer,
            `Handle: ${handleSpanName}`,
            headers,
        );

        span.addPropagatedDataForChildrenOnly({
            context: {
                handler: handleSpanName,
            },
        });

        // TODO(calebmer, #files): `http.request.uncompressedContentLength` and
        // `http.response.uncompressedContentLength` span data.

        void (async () => {
            try {
                addRequestTracerSpanData({
                    tracer,
                    span,
                    route: routeString,
                    method: req.method!,
                    url,
                    headers,
                });

                await handleRequest(span, route, url, headers, req, res);

                if (!res.writableEnded) {
                    throw new InternalError(
                        "Expected `handleRequest()` to resolve only after it finishes writing the response",
                    );
                }
            } catch (error) {
                span.addException(error);

                if (res.headersSent) {
                    res.end();
                } else {
                    const statusCode = isSystemError(error) ? 500 : 400;
                    const statusMessage =
                        statusCode === 400 ? "Bad Request" : "Internal Server Error";

                    res.writeHead(statusCode, {"content-type": "text/plain"});

                    if (process.env.NODE_ENV !== "development" || !(error instanceof Error)) {
                        res.end(`${statusCode} ${statusMessage}`);
                    } else {
                        res.end(
                            `${statusCode} ${statusMessage}\n\n${error.stack ?? error.message}`,
                        );
                    }
                }
            }

            span.addData({
                http: {
                    statusCode: res.statusCode,
                    response: {
                        header: Object.fromEntries(
                            filterMapIterable(res.getHeaderNames(), headerName => {
                                if (!tracerEventHttpHeaderNames.has(headerName)) return;

                                const headerValue = res.getHeader(headerName);
                                if (headerValue === undefined) return;

                                const headerValueString: string =
                                    typeof headerValue === "number"
                                        ? String(headerValue)
                                        : Array.isArray(headerValue)
                                        ? headerValue.join(",")
                                        : headerValue;

                                return [headerName, headerValueString];
                            }),
                        ),
                        obfuscatedSetCookieHeader: obfuscateSetCookieHeaderString(
                            res.getHeader("set-cookie"),
                        ),
                    },
                },
            });

            finishSpan();
        })();
    });

    server.on("error", error => {
        tracer.logUncaughtException("Uncaught exception from HTTP server", error);
    });

    return server;
}
