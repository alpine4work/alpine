import {IncomingMessage, ServerResponse, createServer} from "http";
import {Readable as ReadableStream} from "stream";
import {finished} from "stream/promises";
import {isCloudflareR2NoSuchKeyError} from "~/server/cloudflare/r2/cloudflare_r2_client.js";
import {DynamoBatchContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {FileUploadServiceProcessContext} from "~/server/files/upload/file_upload_service_context.js";
import {resizeFile} from "~/server/files/upload/resize_file.js";
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
import {
    FailedPreconditionError,
    InternalError,
    InvalidArgumentError,
} from "~/shared/error/error.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {deserializeDateString, isDateString} from "~/shared/helpers/date/date_string.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {isId} from "~/shared/id/id.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.js";
import {obfuscateSetCookieHeaderString} from "~/shared/tracer/fetch_with_tracer.js";
import {tracerEventHttpHeaderNames} from "~/shared/tracer/helpers/tracer_event_http_header_names.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

// TODO(calebmer, #files): We'll need to make sure the AWS EC2 instance has a
// bunch of popular fonts installed for SVG and PDF documents.
//
// Look at what Gotenberg is doing for fonts:
// https://github.com/gotenberg/gotenberg/blob/da8eeb5d8f98e689b7eaa9276c8847fb7a390994/build/Dockerfile#L67-L117

// TODO(calebmer, #files): Write about resource utilization. Maybe in a
// technical decision log entry.

export type FileUploadServiceRoute =
    | {
          readonly type: "NotFound";
      }
    | {
          readonly type: "Upload";
          readonly spaceId: SpaceId;
      }
    | {
          readonly type: "Resize";
          readonly spaceId: SpaceId;
          readonly fileId: FileId;
      }
    | {
          readonly type: "InternalMiniflareGetObject";
          readonly bucketName: string;
          readonly key: string;
      };

export function createFileUploadService(
    processContext: FileUploadServiceProcessContext,
    {tokenAgent, temporaryDirectoryPath}: {tokenAgent: TokenAgent; temporaryDirectoryPath: string},
) {
    const tracer = processContext.tracer.getRoot();

    function parseRoute(url: URL): [string, FileUploadServiceRoute] {
        const pathnameParts = url.pathname.slice(1).split("/");

        if (
            pathnameParts.length === 5 &&
            pathnameParts[0] === "internal" &&
            pathnameParts[1] === "miniflare" &&
            pathnameParts[2] === "get-object"
        ) {
            const bucketName = pathnameParts[3]!;
            const key = decodeURIComponent(pathnameParts[4]!);

            return [
                "/internal/miniflare/get-object/:bucket/:key",
                {type: "InternalMiniflareGetObject", bucketName, key},
            ];
        }

        if (pathnameParts[0] && isId<SpaceId>(pathnameParts[0])) {
            const spaceId = pathnameParts[0];

            if (pathnameParts.length === 2 && pathnameParts[1] === "upload") {
                return ["/:spaceId/upload", {type: "Upload", spaceId}];
            }

            if (
                pathnameParts.length === 3 &&
                pathnameParts[1] === "resize" &&
                isId<FileId>(pathnameParts[2]!)
            ) {
                return [
                    "/:spaceId/resize/:fileId",
                    {type: "Resize", spaceId, fileId: pathnameParts[2]},
                ];
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
        } else if (route.type === "InternalMiniflareGetObject") {
            await handleInternalMiniflareGetObject(processContext, req, res, {
                url,
                bucketName: route.bucketName,
                key: route.key,
                headers,
            });
            return;
        }

        const {spaceId} = route;

        span.addPropagatedData({context: {spaceId}});

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

        return baseActionContext.with({actor: actorContextModule}, context => {
            switch (route.type) {
                case "Upload":
                    return uploadFile(context, span, req, res, {
                        url,
                        spaceId: route.spaceId,
                        headers,
                        temporaryDirectoryPath,
                    });
                case "Resize":
                    return resizeFile(context, span, req, res, {
                        url,
                        spaceId: route.spaceId,
                        fileId: route.fileId,
                        temporaryDirectoryPath,
                    });
                default:
                    throw exhaustive(route);
            }
        });
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

                if (res.writableEnded) {
                    // Response was already handled, do nothing other than log the error.
                } else if (res.headersSent) {
                    res.end();
                } else {
                    const statusCode = isSystemError(error) ? 500 : 400;
                    const statusMessage =
                        statusCode === 400 ? "Bad Request" : "Internal Server Error";

                    res.writeHead(statusCode, {"content-type": "text/plain"});

                    if (process.env.NODE_ENV !== "development") {
                        res.end(`${statusCode} ${statusMessage}`);
                    } else {
                        res.end(
                            `${statusCode} ${statusMessage}\n\n${
                                error instanceof Error
                                    ? error.stack ?? error.message
                                    : String(error)
                            }`,
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

async function handleInternalMiniflareGetObject(
    processContext: FileUploadServiceProcessContext,
    req: IncomingMessage,
    res: ServerResponse<IncomingMessage>,
    {
        url,
        bucketName,
        key,
        headers,
    }: {
        url: URL;
        bucketName: string;
        key: string;
        headers: Headers;
    },
) {
    if (process.env.NODE_ENV === "production")
        throw new InvalidArgumentError("Can't use Miniflare in production");

    // Double check to make sure we can only use this route with Miniflare.
    assert(processContext.r2.isMiniflare());

    const expirationTimeString = url.searchParams.get("exp");
    if (!expirationTimeString)
        throw new InvalidArgumentError('Missing required "exp" URL search param');

    if (!isDateString(expirationTimeString))
        throw new InvalidArgumentError(
            '"exp" URL search param is not formatted as an ISO 8601 date',
        );

    const expirationTime = deserializeDateString(expirationTimeString);

    if (expirationTime < new Date()) throw new FailedPreconditionError("URL has expired");

    const dateHeader = (dateString: string | null) => {
        if (dateString === null) return undefined;
        return new Date(dateString);
    };

    // Make sure all relevant request headers are passed into `GetObject()`.
    // https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html#API_GetObject_RequestSyntax
    try {
        const object = await processContext.r2.GetObject({
            Bucket: bucketName,
            Key: key,
            IfMatch: headers.get("if-match") ?? undefined,
            IfModifiedSince: dateHeader(headers.get("if-modified-since")),
            IfNoneMatch: headers.get("if-none-match") ?? undefined,
            IfUnmodifiedSince: dateHeader(headers.get("if-unmodified-since")),
            Range: headers.get("range") ?? undefined,
        });

        // Make sure all relevant response headers are passed from `GetObject()`.
        // https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html#API_GetObject_ResponseSyntax
        if (object.AcceptRanges !== undefined) res.setHeader("accept-ranges", object.AcceptRanges);
        if (object.LastModified !== undefined)
            res.setHeader("last-modified", object.LastModified.toUTCString());
        if (object.ContentLength !== undefined)
            res.setHeader("content-length", object.ContentLength);
        if (object.ETag !== undefined) res.setHeader("etag", object.ETag);
        if (object.CacheControl !== undefined) res.setHeader("cache-control", object.CacheControl);
        if (object.ContentDisposition !== undefined)
            res.setHeader("content-disposition", object.ContentDisposition);
        if (object.ContentEncoding !== undefined)
            res.setHeader("content-encoding", object.ContentEncoding);
        if (object.ContentLanguage !== undefined)
            res.setHeader("content-language", object.ContentLanguage);
        if (object.ContentRange !== undefined) res.setHeader("content-range", object.ContentRange);
        if (object.ContentType !== undefined) res.setHeader("content-type", object.ContentType);
        if (object.ExpiresString !== undefined) res.setHeader("expires", object.ExpiresString);

        assert(object.Body instanceof ReadableStream);
        await finished(object.Body.pipe(res));
    } catch (error) {
        if (isCloudflareR2NoSuchKeyError(error)) {
            res.writeHead(404, {"content-type": "text/plain"});
            res.end("404 Not Found");
        } else {
            throw error;
        }
    }
}
