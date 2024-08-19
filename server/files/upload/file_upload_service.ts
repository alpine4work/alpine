import {IncomingMessage, ServerResponse, createServer} from "http";
import {uploadFile} from "~/server/files/upload/internal/upload_file.js";
import {createServerProcessContextModule} from "~/server/node/create_server_process_context_module.js";
import {createStandardizedRequestHeaders} from "~/server/node/create_standardized_server.js";
import {registerGracefulServerShutdown} from "~/server/node/register_graceful_server_shutdown.js";
import {runService} from "~/server/node/run_service.js";
import {
    addRequestTracerSpanData,
    startTracerSpanFromPropagationContextHeader,
} from "~/server/tracer/trace_server_response.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {InternalError} from "~/shared/error/error.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {obfuscateSetCookieHeaderString} from "~/shared/tracer/fetch_with_tracer.js";
import {tracerEventHttpHeaderNames} from "~/shared/tracer/helpers/tracer_event_http_header_names.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

export type FileUploadServiceRoute = {readonly type: "NotFound"} | {readonly type: "Upload"};

runService({
    serviceName: "FileUploadService",
    options: {
        port: {type: "string"},
    },
    run: async ({options, tracer, shutdownManager}) => {
        const port = options.port ? parseInt(options.port, 10) : null;
        if (!port || !Number.isInteger(port)) throw new InternalError("Missing integer `port` arg");

        const processContext = Context.new({
            process: createServerProcessContextModule(tracer),
            tracer: new TracerContextModule(tracer),
        });

        function parseRoute(url: URL): [string, FileUploadServiceRoute] {
            if (url.pathname === "/upload") {
                return [url.pathname, {type: "Upload"}];
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
            switch (route.type) {
                case "NotFound": {
                    res.writeHead(404, {"content-type": "text/plain"});
                    res.end("404 Not Found");
                    break;
                }
                case "Upload": {
                    return uploadFile(
                        processContext.clone({tracer: new TracerContextModule(span)}),
                        span,
                        url,
                        headers,
                        req,
                        res,
                    );
                }
                default:
                    throw exhaustive(route);
            }
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
                        res.writeHead(500, {"content-type": "text/plain"});

                        if (process.env.NODE_ENV === "production" || !(error instanceof Error)) {
                            res.end("500 Internal Server Error");
                        } else {
                            res.end(`500 Internal Server Error\n\n${error.stack ?? error.message}`);
                        }
                    }
                }

                span.addData({
                    http: {
                        statusCode: res.statusCode,
                        response: {
                            header: Object.fromEntries(
                                filterMapIterable(res.getHeaderNames(), headerName => {
                                    if (!tracerEventHttpHeaderNames.has(headerName)) return null;

                                    const headerValue = res.getHeader(headerName);
                                    if (headerValue === undefined) return null;

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

        registerGracefulServerShutdown(shutdownManager, server);

        server.listen(port, () => {
            // Log when ready in production to help when debugging container startup.
            if (process.env.NODE_ENV === "production") {
                // eslint-disable-next-line no-console
                console.log(`Listening on port ${port} (pid ${process.pid})`);
            }
        });
    },
});
