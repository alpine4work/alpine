import {Readable as ReadableStream} from "stream";
import {isCloudflareR2NoSuchKeyError} from "~/server/cloudflare/r2/cloudflare_r2_client.js";
import {DynamoBatchContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {FileProcessorServiceProcessContext} from "~/server/files/processor/file_processor_service_context.js";
import {resizeFile} from "~/server/files/processor/resize_file.js";
import {createStandardizedServer} from "~/server/node/create_standardized_server.js";
import {ShutdownManager} from "~/server/node/shutdown_manager.js";
import {createDynamoActorContextModule} from "~/server/spaces/create_dynamo_actor_context_module.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {FailedPreconditionError, InvalidArgumentError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {deserializeDateString, isDateString} from "~/shared/helpers/date/date_string.js";
import {isId} from "~/shared/id/id.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

export type FileProcessorServiceRoute =
    | {readonly type: "HealthCheck"}
    | {readonly type: "NotFound"}
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

function parseRoute(url: URL): [string, FileProcessorServiceRoute] {
    if (url.pathname === "/healthcheck") {
        return ["/healthcheck", {type: "HealthCheck"}];
    }

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

// NOTE(calebmer, 2024-11-17): When I initially wrote `FileProcessorService` it
// handled uploads as well. There was an `/upload` route we'd stream data into
// and then the stream would be split to 1) a Cloudflare `PutObject` action, 2)
// file processing. However, there were issues deploying this to production.
// And I also had concerns around reliability (what happens if the server
// crashes?). So uploads were moved entirely to our Cloudflare `EdgeService`
// and processing was moved to be performed asynchronously in response to an
// SQS message.
//
// Since in our original architecture this service performed processing through
// an HTTP server it was also easy to add a `/resize` route. Now that we've
// removed the `/upload` route we still need the `/resize` route. If we were
// designing `FileProcessorService` from scratch we might not have given it an
// HTTP server but since `FileProcessorService` inherits the `/resize` route
// from the old upload service here we are.
//
// Ideally the `/resize` route could be implemented as a Rust edge function.
// Cloudflare supports Rust workers. Maybe someday we create a Rust program
// that resizes images and get rid of the HTTP server in
// `FileProcessorService`.
export function createFileProcessorServiceServer(
    processContext: FileProcessorServiceProcessContext,
    {
        shutdownManager,
        tokenAgent,
        temporaryDirectoryPath,
        withFiber,
    }: {
        shutdownManager: ShutdownManager;
        tokenAgent: TokenAgent;
        temporaryDirectoryPath: string;
        withFiber: <Modules extends {tracer: TracerContextModule}, Value>(
            context: Context<Modules>,
            action: () => Promise<Value>,
        ) => Promise<Value>;
    },
) {
    const tracer = processContext.tracer.getRoot();

    async function handleRequest(
        request: Request,
        url: URL,
        route: FileProcessorServiceRoute,
        span: TracerSpan,
    ): Promise<Response> {
        switch (route.type) {
            case "HealthCheck": {
                return new Response("200 OK", {
                    status: 200,
                    headers: {"content-type": "text/plain"},
                });
            }
            case "NotFound": {
                return new Response("404 Not Found", {
                    status: 404,
                    headers: {"content-type": "text/plain"},
                });
            }
            case "InternalMiniflareGetObject": {
                return handleInternalMiniflareGetObject(processContext, {
                    url,
                    request,
                    bucketName: route.bucketName,
                    key: route.key,
                });
            }
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
            request.headers,
            tokenAgent,
            spaceId,
        );

        return baseActionContext.with({actor: actorContextModule}, context => {
            switch (route.type) {
                case "Resize": {
                    return resizeFile(context, span, {
                        url,
                        request,
                        spaceId: route.spaceId,
                        fileId: route.fileId,
                        temporaryDirectoryPath,
                        withFiber,
                    });
                }
                default:
                    throw exhaustive(route);
            }
        });
    }

    return createStandardizedServer(tracer, shutdownManager, parseRoute, handleRequest);
}

async function handleInternalMiniflareGetObject(
    processContext: FileProcessorServiceProcessContext,
    {
        url,
        request,
        bucketName,
        key,
    }: {
        url: URL;
        request: Request;
        bucketName: string;
        key: string;
    },
): Promise<Response> {
    if (process.env.NODE_ENV === "production")
        throw new InvalidArgumentError("Can’t use Miniflare in production");

    // Double check to make sure we can only use this route with Miniflare.
    assert(processContext.r2.isMiniflare());

    const expirationTimeString = url.searchParams.get("exp");
    if (!expirationTimeString)
        throw new InvalidArgumentError("Missing required `exp` URL search param");

    if (!isDateString(expirationTimeString))
        throw new InvalidArgumentError(
            "`exp` URL search param is not formatted as an ISO 8601 date",
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
            IfMatch: request.headers.get("if-match") ?? undefined,
            IfModifiedSince: dateHeader(request.headers.get("if-modified-since")),
            IfNoneMatch: request.headers.get("if-none-match") ?? undefined,
            IfUnmodifiedSince: dateHeader(request.headers.get("if-unmodified-since")),
            Range: request.headers.get("range") ?? undefined,
        });

        const responseHeaders = new Headers();

        // Make sure all relevant response headers are passed from `GetObject()`.
        // https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html#API_GetObject_ResponseSyntax
        if (object.AcceptRanges !== undefined)
            responseHeaders.set("accept-ranges", object.AcceptRanges);
        if (object.LastModified !== undefined)
            responseHeaders.set("last-modified", object.LastModified.toUTCString());
        if (object.ContentLength !== undefined)
            responseHeaders.set("content-length", String(object.ContentLength));
        if (object.ETag !== undefined) responseHeaders.set("etag", object.ETag);
        if (object.CacheControl !== undefined)
            responseHeaders.set("cache-control", object.CacheControl);
        if (object.ContentDisposition !== undefined)
            responseHeaders.set("content-disposition", object.ContentDisposition);
        if (object.ContentEncoding !== undefined)
            responseHeaders.set("content-encoding", object.ContentEncoding);
        if (object.ContentLanguage !== undefined)
            responseHeaders.set("content-language", object.ContentLanguage);
        if (object.ContentRange !== undefined)
            responseHeaders.set("content-range", object.ContentRange);
        if (object.ContentType !== undefined)
            responseHeaders.set("content-type", object.ContentType);
        if (object.ExpiresString !== undefined)
            responseHeaders.set("expires", object.ExpiresString);

        assert(object.Body instanceof ReadableStream);
        return new Response(
            ReadableStream.toWeb(object.Body) as globalThis.ReadableStream<Uint8Array>,
            {
                status: 200,
                headers: responseHeaders,
            },
        );
    } catch (error) {
        if (isCloudflareR2NoSuchKeyError(error)) {
            return new Response("404 Not Found", {
                status: 404,
                headers: {"content-type": "text/plain"},
            });
        } else {
            throw error;
        }
    }
}
