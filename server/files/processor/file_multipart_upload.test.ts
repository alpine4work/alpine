import {FixedLengthStream} from "@miniflare/core";
import {R2Bucket} from "@miniflare/r2";
import {FileStorage} from "@miniflare/storage-file";
import getPort from "get-port";
import {join as joinPath} from "path";
import {Readable} from "stream";
import {CloudflareR2ContextModule} from "~/server/cloudflare/r2/cloudflare_r2_context_module.js";
import {MiniflareR2Client} from "~/server/cloudflare/r2/miniflare_r2_client.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createTestTokenAgents} from "~/server/dynamo/test_helpers/create_test_token_agent.js";
import {
    completeFileMultipartUpload,
    createFileMultipartUpload,
    putFileMultipartUploadPart,
} from "~/server/edge/file_multipart_upload.js";
import {processFile} from "~/server/files/processor/process_file.js";
import {TestUploadFileRpcContextModule} from "~/server/files/processor/test_helpers/test_upload_file_rpc_context_module.js";
import {
    filesBindingName,
    filesBucketName,
} from "~/server/helpers/files_cloudflare_r2_bucket_name.js";
import {createStandardizedServer} from "~/server/node/create_standardized_server.js";
import {ShutdownManager} from "~/server/node/shutdown_manager.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {
    FailedPreconditionError,
    InvalidArgumentError,
    PermissionDeniedError,
} from "~/shared/error/error.js";
import {FileModel} from "~/shared/files/file_model.js";
import {
    CompleteFileMultipartUploadRequestSchema,
    CreateFileMultipartUploadRequestSchema,
    CreateFileMultipartUploadResponseSchema,
    PutFileMultipartUploadPartResponseSchema,
    UploadFileResponseSchema,
} from "~/shared/files/upload_file_protocol.js";
import {runAllPromiseThunks} from "~/shared/helpers/async/run_all_promises.js";
import {waitForReadableStreamUint8Array} from "~/shared/helpers/binary/wait_for_readable_stream_uint8_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isId} from "~/shared/id/id.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const {shutdownManager, shutdown} = ShutdownManager.new({
    tracer: testTracer,
    isClusterPrimary: true,
});

let r2Client: MiniflareR2Client;
let appTokenAgent: TokenAgent;
let edgeTokenAgent: TokenAgent;
let port: number;

const context = createTestContext({
    processJob: async (actionContext, job, jobStartTime, span) => {
        if (job.type === "ProcessFile") {
            await processFile(
                actionContext.clone({r2: new CloudflareR2ContextModule(r2Client)}),
                span,
                {
                    spaceId: job.spaceId,
                    fileId: job.fileId,
                    contentType: job.contentType,
                    temporaryDirectoryPath: context.getTemporaryDirectoryPath(),
                },
            );
        }
    },
});

beforeAll(async () => {
    port = await getPort();
    const fileProcessorServicePort = await getPort();

    const r2Storage = new FileStorage(
        joinPath(context.getTemporaryDirectoryPath(), "r2", filesBindingName),
    );
    const r2Bucket = new R2Bucket(r2Storage);

    r2Client = new MiniflareR2Client({
        fileProcessorServiceUrl: `http://localhost:${fileProcessorServicePort}`,
        bucketByName: new Map([[filesBucketName, r2Bucket]]),
    });

    [appTokenAgent, edgeTokenAgent] = await createTestTokenAgents(context, [
        "AppService",
        "EdgeService",
    ]);

    type FileMultipartUploadRoute =
        | {type: "CreateFileMultipartUpload"; spaceId: SpaceId}
        | {type: "PutFileMultipartUploadPart"; spaceId: SpaceId; fileId: FileId; partNumber: string}
        | {type: "CompleteFileMultipartUpload"; spaceId: SpaceId; fileId: FileId}
        | {type: "NotFound"};

    const server = createStandardizedServer<FileMultipartUploadRoute>(
        testTracer,
        shutdownManager,
        url => {
            let routeString = "/*";
            let route: FileMultipartUploadRoute = {type: "NotFound"};

            const pathSegments = url.pathname.split("/").slice(1);
            if (isId<SpaceId>(pathSegments[0]!) && pathSegments[1] === "multipart-upload") {
                if (pathSegments.length === 2) {
                    routeString = "/:spaceId/multipart-upload";
                    route = {type: "CreateFileMultipartUpload", spaceId: pathSegments[0]};
                } else if (pathSegments.length > 2 && isId<FileId>(pathSegments[2]!)) {
                    if (pathSegments.length === 4 && pathSegments[3] === "complete") {
                        routeString = "/:spaceId/multipart-upload/:fileId/complete";
                        route = {
                            type: "CompleteFileMultipartUpload",
                            spaceId: pathSegments[0],
                            fileId: pathSegments[2],
                        };
                    } else if (pathSegments.length === 5 && pathSegments[3] === "part") {
                        routeString = "/:spaceId/multipart-upload/:fileId/part/:partNumber";
                        route = {
                            type: "PutFileMultipartUploadPart",
                            spaceId: pathSegments[0],
                            fileId: pathSegments[2],
                            partNumber: pathSegments[4]!,
                        };
                    }
                }
            }

            return [routeString, route];
        },
        async (request, url, route, span) => {
            switch (route.type) {
                case "NotFound": {
                    return new Response("404 Not Found", {
                        status: 404,
                        headers: {connection: "close", "content-type": "text/plain"},
                    });
                }
                case "CreateFileMultipartUpload": {
                    return createFileMultipartUpload(
                        ({sessionId, accountId}) =>
                            context.action({sessionId, accountId}).clone({
                                tracer: new TracerContextModule(span),
                                rpc: new TestUploadFileRpcContextModule(),
                            }),
                        {},
                        {FilesBucket: r2Bucket},
                        edgeTokenAgent,
                        request,
                        url,
                        span,
                        route,
                    );
                }
                case "PutFileMultipartUploadPart": {
                    const fixedLengthStream = new FixedLengthStream(
                        parseInt(assertExists(request.headers.get("content-length")), 10),
                    );
                    void assertExists(request.body).pipeTo(fixedLengthStream.writable);

                    request = new Request(request.url, {
                        method: request.method,
                        headers: request.headers,
                        // eslint-disable-next-line @typescript-eslint/prefer-ts-expect-error
                        // @ts-ignore: This property is added by `@remix-run/node` which isn't
                        // available when type checking tests but is available when type checking the
                        // whole workspace.
                        duplex: "half",
                        body: fixedLengthStream.readable as ReadableStream<any>,
                    });

                    return putFileMultipartUploadPart(
                        ({sessionId, accountId}) =>
                            context.action({sessionId, accountId}).clone({
                                tracer: new TracerContextModule(span),
                                rpc: new TestUploadFileRpcContextModule(),
                            }),
                        {},
                        {FilesBucket: r2Bucket},
                        edgeTokenAgent,
                        request,
                        url,
                        span,
                        route,
                    );
                }
                case "CompleteFileMultipartUpload": {
                    return completeFileMultipartUpload(
                        ({sessionId, accountId}) =>
                            context.action({sessionId, accountId}).clone({
                                tracer: new TracerContextModule(span),
                                rpc: new TestUploadFileRpcContextModule(),
                            }),
                        {},
                        {FilesBucket: r2Bucket},
                        edgeTokenAgent,
                        request,
                        url,
                        span,
                        route,
                    );
                }
                default:
                    throw exhaustive(route);
            }
        },
    );

    await new Promise<void>(resolve => {
        server.listen(port, resolve);
    });
});

afterAll(async () => {
    await shutdown({type: "Signal", signal: "SIGINT"}, null);
});

async function sessionCookie(
    session: TestSession | TestSpace,
    authorizationTokenAgent: TokenAgent = appTokenAgent,
) {
    const token = await authorizationTokenAgent.privateSide.dangerouslySignShortLivedToken(
        "EdgeService",
        session.getTokenPayload(),
    );

    return `session=${token}`;
}

test("can perform a multipart upload", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const createMultipartUploadResponse = await fetch(
        `http://localhost:${port}/${space.id}/multipart-upload`,
        {
            method: "POST",
            headers: {
                connection: "close",
                cookie: await sessionCookie(session),
                "content-type": "application/json",
            },
            body: JSON.stringify(
                CreateFileMultipartUploadRequestSchema.serialize({
                    fileId: null,
                    contentType: "application/octet-stream",
                    contentLength: 2.5e8,
                    attachTarget: null,
                }),
            ),
        },
    );

    const createMultipartUploadResponseBody = CreateFileMultipartUploadResponseSchema.deserialize(
        await createMultipartUploadResponse.json(),
    );
    if (!createMultipartUploadResponseBody.ok) throw createMultipartUploadResponseBody.error;

    expect(createMultipartUploadResponseBody).toEqual({
        ok: true,
        fileId: expect.any(String),
        uploadId: expect.any(String),
    });

    const {fileId, uploadId} = createMultipartUploadResponseBody;

    const putMultipartUploadPart1Response = await fetch(
        `http://localhost:${port}/${space.id}/multipart-upload/${fileId}/part/1?upload=${uploadId}`,
        {
            method: `PUT`,
            headers: {
                connection: "close",
                cookie: await sessionCookie(session),
                "content-type": "application/octet-stream",
            },
            body: new Uint8Array(1e8).fill(1),
        },
    );

    const putMultipartUploadPart1ResponseBody =
        PutFileMultipartUploadPartResponseSchema.deserialize(
            await putMultipartUploadPart1Response.json(),
        );
    if (!putMultipartUploadPart1ResponseBody.ok) throw putMultipartUploadPart1ResponseBody.error;

    const putMultipartUploadPart2Response = await fetch(
        `http://localhost:${port}/${space.id}/multipart-upload/${fileId}/part/2?upload=${uploadId}`,
        {
            method: `PUT`,
            headers: {
                connection: "close",
                cookie: await sessionCookie(session),
                "content-type": "application/octet-stream",
            },
            body: new Uint8Array(1e8).fill(2),
        },
    );

    const putMultipartUploadPart2ResponseBody =
        PutFileMultipartUploadPartResponseSchema.deserialize(
            await putMultipartUploadPart2Response.json(),
        );
    if (!putMultipartUploadPart2ResponseBody.ok) throw putMultipartUploadPart2ResponseBody.error;

    const putMultipartUploadPart3Response = await fetch(
        `http://localhost:${port}/${space.id}/multipart-upload/${fileId}/part/3?upload=${uploadId}`,
        {
            method: `PUT`,
            headers: {
                connection: "close",
                cookie: await sessionCookie(session),
                "content-type": "application/octet-stream",
            },
            body: new Uint8Array(0.5e8).fill(3),
        },
    );

    const putMultipartUploadPart3ResponseBody =
        PutFileMultipartUploadPartResponseSchema.deserialize(
            await putMultipartUploadPart3Response.json(),
        );
    if (!putMultipartUploadPart3ResponseBody.ok) throw putMultipartUploadPart3ResponseBody.error;

    const completeMultipartUploadResponse = await fetch(
        `http://localhost:${port}/${space.id}/multipart-upload/${fileId}/complete?upload=${uploadId}`,
        {
            method: "POST",
            headers: {
                connection: "close",
                cookie: await sessionCookie(session),
                "content-type": "application/json",
            },
            body: JSON.stringify(
                CompleteFileMultipartUploadRequestSchema.serialize({
                    parts: [
                        putMultipartUploadPart1ResponseBody,
                        putMultipartUploadPart2ResponseBody,
                        putMultipartUploadPart3ResponseBody,
                    ],
                }),
            ),
        },
    );

    const completeMultipartUploadResponseBody = UploadFileResponseSchema.deserialize(
        await completeMultipartUploadResponse.json(),
    );
    if (!completeMultipartUploadResponseBody.ok) throw completeMultipartUploadResponseBody.error;

    expect(completeMultipartUploadResponseBody).toEqual({
        ok: true,
        signedUrlSearch: "?sig=test",
        file: new FileModel({
            id: fileId,
            contentType: "application/octet-stream",
            contentLength: 2.5e8,
            isUploading: false,
            alternative: null,
            preview: null,
        }),
    });

    const object = await r2Client.GetObject(testTracer, {
        Bucket: filesBucketName,
        Key: `${space.id}/${fileId}`,
    });

    assert(object.Body instanceof Readable);

    const actualData = await waitForReadableStreamUint8Array(
        Readable.toWeb(object.Body) as ReadableStream<Uint8Array>,
    );

    const expectedData = new Uint8Array(2.5e8);
    expectedData.fill(1, 0, 1e8);
    expectedData.fill(2, 1e8, 2e8);
    expectedData.fill(3, 2e8);

    expect(
        Buffer.from(actualData).compare(
            // TODO(calebmer, #typescript-5.9.2): Discovered after TS version upgrade, not
            // fixing for now.
            // @ts-expect-error
            Buffer.from(expectedData),
        ),
    ).toBe(0);
});

test("can perform a multipart upload where parts are uploaded in parallel", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const createMultipartUploadResponse = await fetch(
        `http://localhost:${port}/${space.id}/multipart-upload`,
        {
            method: "POST",
            headers: {
                connection: "close",
                cookie: await sessionCookie(session),
                "content-type": "application/json",
            },
            body: JSON.stringify(
                CreateFileMultipartUploadRequestSchema.serialize({
                    fileId: null,
                    contentType: "application/octet-stream",
                    contentLength: 2.5e8,
                    attachTarget: null,
                }),
            ),
        },
    );

    const createMultipartUploadResponseBody = CreateFileMultipartUploadResponseSchema.deserialize(
        await createMultipartUploadResponse.json(),
    );
    if (!createMultipartUploadResponseBody.ok) throw createMultipartUploadResponseBody.error;

    expect(createMultipartUploadResponseBody).toEqual({
        ok: true,
        fileId: expect.any(String),
        uploadId: expect.any(String),
    });

    const {fileId, uploadId} = createMultipartUploadResponseBody;

    const [
        putMultipartUploadPart1ResponseBody,
        putMultipartUploadPart2ResponseBody,
        putMultipartUploadPart3ResponseBody,
    ] = await runAllPromiseThunks(
        async () => {
            const putMultipartUploadPart1Response = await fetch(
                `http://localhost:${port}/${space.id}/multipart-upload/${fileId}/part/1?upload=${uploadId}`,
                {
                    method: `PUT`,
                    headers: {
                        connection: "close",
                        cookie: await sessionCookie(session),
                        "content-type": "application/octet-stream",
                    },
                    body: new Uint8Array(1e8).fill(1),
                },
            );

            const putMultipartUploadPart1ResponseBody =
                PutFileMultipartUploadPartResponseSchema.deserialize(
                    await putMultipartUploadPart1Response.json(),
                );
            if (!putMultipartUploadPart1ResponseBody.ok)
                throw putMultipartUploadPart1ResponseBody.error;

            return putMultipartUploadPart1ResponseBody;
        },
        async () => {
            const putMultipartUploadPart2Response = await fetch(
                `http://localhost:${port}/${space.id}/multipart-upload/${fileId}/part/2?upload=${uploadId}`,
                {
                    method: `PUT`,
                    headers: {
                        connection: "close",
                        cookie: await sessionCookie(session),
                        "content-type": "application/octet-stream",
                    },
                    body: new Uint8Array(1e8).fill(2),
                },
            );

            const putMultipartUploadPart2ResponseBody =
                PutFileMultipartUploadPartResponseSchema.deserialize(
                    await putMultipartUploadPart2Response.json(),
                );
            if (!putMultipartUploadPart2ResponseBody.ok)
                throw putMultipartUploadPart2ResponseBody.error;

            return putMultipartUploadPart2ResponseBody;
        },
        async () => {
            const putMultipartUploadPart3Response = await fetch(
                `http://localhost:${port}/${space.id}/multipart-upload/${fileId}/part/3?upload=${uploadId}`,
                {
                    method: `PUT`,
                    headers: {
                        connection: "close",
                        cookie: await sessionCookie(session),
                        "content-type": "application/octet-stream",
                    },
                    body: new Uint8Array(0.5e8).fill(3),
                },
            );

            const putMultipartUploadPart3ResponseBody =
                PutFileMultipartUploadPartResponseSchema.deserialize(
                    await putMultipartUploadPart3Response.json(),
                );
            if (!putMultipartUploadPart3ResponseBody.ok)
                throw putMultipartUploadPart3ResponseBody.error;

            return putMultipartUploadPart3ResponseBody;
        },
    );

    const completeMultipartUploadResponse = await fetch(
        `http://localhost:${port}/${space.id}/multipart-upload/${fileId}/complete?upload=${uploadId}`,
        {
            method: "POST",
            headers: {
                connection: "close",
                cookie: await sessionCookie(session),
                "content-type": "application/json",
            },
            body: JSON.stringify(
                CompleteFileMultipartUploadRequestSchema.serialize({
                    parts: [
                        putMultipartUploadPart1ResponseBody,
                        putMultipartUploadPart2ResponseBody,
                        putMultipartUploadPart3ResponseBody,
                    ],
                }),
            ),
        },
    );

    const completeMultipartUploadResponseBody = UploadFileResponseSchema.deserialize(
        await completeMultipartUploadResponse.json(),
    );
    if (!completeMultipartUploadResponseBody.ok) throw completeMultipartUploadResponseBody.error;

    expect(completeMultipartUploadResponseBody).toEqual({
        ok: true,
        signedUrlSearch: "?sig=test",
        file: new FileModel({
            id: fileId,
            contentType: "application/octet-stream",
            contentLength: 2.5e8,
            isUploading: false,
            alternative: null,
            preview: null,
        }),
    });

    const object = await r2Client.GetObject(testTracer, {
        Bucket: filesBucketName,
        Key: `${space.id}/${fileId}`,
    });

    assert(object.Body instanceof Readable);

    const actualData = await waitForReadableStreamUint8Array(
        Readable.toWeb(object.Body) as ReadableStream<Uint8Array>,
    );

    const expectedData = new Uint8Array(2.5e8);
    expectedData.fill(1, 0, 1e8);
    expectedData.fill(2, 1e8, 2e8);
    expectedData.fill(3, 2e8);

    expect(
        Buffer.from(actualData).compare(
            // TODO(calebmer, #typescript-5.9.2): Discovered after TS version upgrade, not
            // fixing for now.
            // @ts-expect-error
            Buffer.from(expectedData),
        ),
    ).toBe(0);
});

test("can perform a multipart upload where parts are out of order", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const createMultipartUploadResponse = await fetch(
        `http://localhost:${port}/${space.id}/multipart-upload`,
        {
            method: "POST",
            headers: {
                connection: "close",
                cookie: await sessionCookie(session),
                "content-type": "application/json",
            },
            body: JSON.stringify(
                CreateFileMultipartUploadRequestSchema.serialize({
                    fileId: null,
                    contentType: "application/octet-stream",
                    contentLength: 2.5e8,
                    attachTarget: null,
                }),
            ),
        },
    );

    const createMultipartUploadResponseBody = CreateFileMultipartUploadResponseSchema.deserialize(
        await createMultipartUploadResponse.json(),
    );
    if (!createMultipartUploadResponseBody.ok) throw createMultipartUploadResponseBody.error;

    expect(createMultipartUploadResponseBody).toEqual({
        ok: true,
        fileId: expect.any(String),
        uploadId: expect.any(String),
    });

    const {fileId, uploadId} = createMultipartUploadResponseBody;

    const putMultipartUploadPart2Response = await fetch(
        `http://localhost:${port}/${space.id}/multipart-upload/${fileId}/part/2?upload=${uploadId}`,
        {
            method: `PUT`,
            headers: {
                connection: "close",
                cookie: await sessionCookie(session),
                "content-type": "application/octet-stream",
            },
            body: new Uint8Array(1e8).fill(2),
        },
    );

    const putMultipartUploadPart2ResponseBody =
        PutFileMultipartUploadPartResponseSchema.deserialize(
            await putMultipartUploadPart2Response.json(),
        );
    if (!putMultipartUploadPart2ResponseBody.ok) throw putMultipartUploadPart2ResponseBody.error;

    const putMultipartUploadPart3Response = await fetch(
        `http://localhost:${port}/${space.id}/multipart-upload/${fileId}/part/3?upload=${uploadId}`,
        {
            method: `PUT`,
            headers: {
                connection: "close",
                cookie: await sessionCookie(session),
                "content-type": "application/octet-stream",
            },
            body: new Uint8Array(0.5e8).fill(3),
        },
    );

    const putMultipartUploadPart3ResponseBody =
        PutFileMultipartUploadPartResponseSchema.deserialize(
            await putMultipartUploadPart3Response.json(),
        );
    if (!putMultipartUploadPart3ResponseBody.ok) throw putMultipartUploadPart3ResponseBody.error;

    const putMultipartUploadPart1Response = await fetch(
        `http://localhost:${port}/${space.id}/multipart-upload/${fileId}/part/1?upload=${uploadId}`,
        {
            method: `PUT`,
            headers: {
                connection: "close",
                cookie: await sessionCookie(session),
                "content-type": "application/octet-stream",
            },
            body: new Uint8Array(1e8).fill(1),
        },
    );

    const putMultipartUploadPart1ResponseBody =
        PutFileMultipartUploadPartResponseSchema.deserialize(
            await putMultipartUploadPart1Response.json(),
        );
    if (!putMultipartUploadPart1ResponseBody.ok) throw putMultipartUploadPart1ResponseBody.error;

    const completeMultipartUploadResponse = await fetch(
        `http://localhost:${port}/${space.id}/multipart-upload/${fileId}/complete?upload=${uploadId}`,
        {
            method: "POST",
            headers: {
                connection: "close",
                cookie: await sessionCookie(session),
                "content-type": "application/json",
            },
            body: JSON.stringify(
                CompleteFileMultipartUploadRequestSchema.serialize({
                    parts: [
                        putMultipartUploadPart1ResponseBody,
                        putMultipartUploadPart2ResponseBody,
                        putMultipartUploadPart3ResponseBody,
                    ],
                }),
            ),
        },
    );

    const completeMultipartUploadResponseBody = UploadFileResponseSchema.deserialize(
        await completeMultipartUploadResponse.json(),
    );
    if (!completeMultipartUploadResponseBody.ok) throw completeMultipartUploadResponseBody.error;

    expect(completeMultipartUploadResponseBody).toEqual({
        ok: true,
        signedUrlSearch: "?sig=test",
        file: new FileModel({
            id: fileId,
            contentType: "application/octet-stream",
            contentLength: 2.5e8,
            isUploading: false,
            alternative: null,
            preview: null,
        }),
    });

    const object = await r2Client.GetObject(testTracer, {
        Bucket: filesBucketName,
        Key: `${space.id}/${fileId}`,
    });

    assert(object.Body instanceof Readable);

    const actualData = await waitForReadableStreamUint8Array(
        Readable.toWeb(object.Body) as ReadableStream<Uint8Array>,
    );

    const expectedData = new Uint8Array(2.5e8);
    expectedData.fill(1, 0, 1e8);
    expectedData.fill(2, 1e8, 2e8);
    expectedData.fill(3, 2e8);

    expect(
        Buffer.from(actualData).compare(
            // TODO(calebmer, #typescript-5.9.2): Discovered after TS version upgrade, not
            // fixing for now.
            // @ts-expect-error
            Buffer.from(expectedData),
        ),
    ).toBe(0);
});

test("can’t perform a multipart upload with an invalid content type", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const createMultipartUploadResponse = await fetch(
        `http://localhost:${port}/${space.id}/multipart-upload`,
        {
            method: "POST",
            headers: {
                connection: "close",
                cookie: await sessionCookie(session),
                "content-type": "application/json",
            },
            body: JSON.stringify(
                CreateFileMultipartUploadRequestSchema.serialize({
                    fileId: null,
                    contentType: "application/does-not-exist",
                    contentLength: 2.5e8,
                    attachTarget: null,
                }),
            ),
        },
    );

    const createMultipartUploadResponseBody = CreateFileMultipartUploadResponseSchema.deserialize(
        await createMultipartUploadResponse.json(),
    );

    expect(createMultipartUploadResponseBody).toEqual({
        ok: false,
        error: new InvalidArgumentError(
            "Unsupported `Content-Type` option `application/does-not-exist`",
        ),
    });
});

test("can’t perform a multipart upload with a content length of 0", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const createMultipartUploadResponse = await fetch(
        `http://localhost:${port}/${space.id}/multipart-upload`,
        {
            method: "POST",
            headers: {
                connection: "close",
                cookie: await sessionCookie(session),
                "content-type": "application/json",
            },
            body: JSON.stringify(
                CreateFileMultipartUploadRequestSchema.serialize({
                    fileId: null,
                    contentType: "application/octet-stream",
                    contentLength: 0,
                    attachTarget: null,
                }),
            ),
        },
    );

    const createMultipartUploadResponseBody = CreateFileMultipartUploadResponseSchema.deserialize(
        await createMultipartUploadResponse.json(),
    );

    expect(createMultipartUploadResponseBody).toEqual({
        ok: false,
        error: new InvalidArgumentError("Can’t upload file with `Content-Length` of 0 B"),
    });
});

test("can’t perform a multipart upload with a content length larger than our max length", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const createMultipartUploadResponse = await fetch(
        `http://localhost:${port}/${space.id}/multipart-upload`,
        {
            method: "POST",
            headers: {
                connection: "close",
                cookie: await sessionCookie(session),
                "content-type": "application/json",
            },
            body: JSON.stringify(
                CreateFileMultipartUploadRequestSchema.serialize({
                    fileId: null,
                    contentType: "application/octet-stream",
                    contentLength: 2e9,
                    attachTarget: null,
                }),
            ),
        },
    );

    const createMultipartUploadResponseBody = CreateFileMultipartUploadResponseSchema.deserialize(
        await createMultipartUploadResponse.json(),
    );

    expect(createMultipartUploadResponseBody).toEqual({
        ok: false,
        error: new InvalidArgumentError(
            "`Content-Length` of 2 GB is more than our maximum file size of 1 GB",
        ),
    });
});

test("can’t perform a multipart upload with a space actor", async () => {
    const space = await TestSpace.create(context);

    const createMultipartUploadResponse = await fetch(
        `http://localhost:${port}/${space.id}/multipart-upload`,
        {
            method: "POST",
            headers: {
                connection: "close",
                cookie: await sessionCookie(space),
                "content-type": "application/json",
            },
            body: JSON.stringify(
                CreateFileMultipartUploadRequestSchema.serialize({
                    fileId: null,
                    contentType: "application/octet-stream",
                    contentLength: 2.5e8,
                    attachTarget: null,
                }),
            ),
        },
    );

    const createMultipartUploadResponseBody = CreateFileMultipartUploadResponseSchema.deserialize(
        await createMultipartUploadResponse.json(),
    );

    expect(createMultipartUploadResponseBody).toEqual({
        ok: false,
        error: new PermissionDeniedError("Unexpected token payload type in session cookie"),
    });
});

test("can’t put a multipart upload part with POST method", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const createMultipartUploadResponse = await fetch(
        `http://localhost:${port}/${space.id}/multipart-upload`,
        {
            method: "POST",
            headers: {
                connection: "close",
                cookie: await sessionCookie(session),
                "content-type": "application/json",
            },
            body: JSON.stringify(
                CreateFileMultipartUploadRequestSchema.serialize({
                    fileId: null,
                    contentType: "application/octet-stream",
                    contentLength: 2.5e8,
                    attachTarget: null,
                }),
            ),
        },
    );

    const createMultipartUploadResponseBody = CreateFileMultipartUploadResponseSchema.deserialize(
        await createMultipartUploadResponse.json(),
    );
    if (!createMultipartUploadResponseBody.ok) throw createMultipartUploadResponseBody.error;

    expect(createMultipartUploadResponseBody).toEqual({
        ok: true,
        fileId: expect.any(String),
        uploadId: expect.any(String),
    });

    const {fileId, uploadId} = createMultipartUploadResponseBody;

    const putMultipartUploadPart1Response = await fetch(
        `http://localhost:${port}/${space.id}/multipart-upload/${fileId}/part/1?upload=${uploadId}`,
        {
            method: "POST",
            headers: {
                connection: "close",
                cookie: await sessionCookie(session),
                "content-type": "application/octet-stream",
            },
            body: new Uint8Array(1e8).fill(1),
        },
    );

    const putMultipartUploadPart1ResponseBody =
        PutFileMultipartUploadPartResponseSchema.deserialize(
            await putMultipartUploadPart1Response.json(),
        );

    expect(putMultipartUploadPart1ResponseBody).toEqual({
        ok: false,
        error: new PermissionDeniedError("Must use `PUT` method"),
    });
});

test("can’t put a multipart upload part without upload search param", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const createMultipartUploadResponse = await fetch(
        `http://localhost:${port}/${space.id}/multipart-upload`,
        {
            method: "POST",
            headers: {
                connection: "close",
                cookie: await sessionCookie(session),
                "content-type": "application/json",
            },
            body: JSON.stringify(
                CreateFileMultipartUploadRequestSchema.serialize({
                    fileId: null,
                    contentType: "application/octet-stream",
                    contentLength: 2.5e8,
                    attachTarget: null,
                }),
            ),
        },
    );

    const createMultipartUploadResponseBody = CreateFileMultipartUploadResponseSchema.deserialize(
        await createMultipartUploadResponse.json(),
    );
    if (!createMultipartUploadResponseBody.ok) throw createMultipartUploadResponseBody.error;

    expect(createMultipartUploadResponseBody).toEqual({
        ok: true,
        fileId: expect.any(String),
        uploadId: expect.any(String),
    });

    const {fileId} = createMultipartUploadResponseBody;

    const putMultipartUploadPart1Response = await fetch(
        `http://localhost:${port}/${space.id}/multipart-upload/${fileId}/part/1`,
        {
            method: `PUT`,
            headers: {
                connection: "close",
                cookie: await sessionCookie(session),
                "content-type": "application/octet-stream",
            },
            body: new Uint8Array(1e8).fill(1),
        },
    );

    const putMultipartUploadPart1ResponseBody =
        PutFileMultipartUploadPartResponseSchema.deserialize(
            await putMultipartUploadPart1Response.json(),
        );

    expect(putMultipartUploadPart1ResponseBody).toEqual({
        ok: false,
        error: new InvalidArgumentError("`upload` search param is required"),
    });
});

test("can’t put a multipart upload part with non-integer part number", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const createMultipartUploadResponse = await fetch(
        `http://localhost:${port}/${space.id}/multipart-upload`,
        {
            method: "POST",
            headers: {
                connection: "close",
                cookie: await sessionCookie(session),
                "content-type": "application/json",
            },
            body: JSON.stringify(
                CreateFileMultipartUploadRequestSchema.serialize({
                    fileId: null,
                    contentType: "application/octet-stream",
                    contentLength: 2.5e8,
                    attachTarget: null,
                }),
            ),
        },
    );

    const createMultipartUploadResponseBody = CreateFileMultipartUploadResponseSchema.deserialize(
        await createMultipartUploadResponse.json(),
    );
    if (!createMultipartUploadResponseBody.ok) throw createMultipartUploadResponseBody.error;

    expect(createMultipartUploadResponseBody).toEqual({
        ok: true,
        fileId: expect.any(String),
        uploadId: expect.any(String),
    });

    const {fileId, uploadId} = createMultipartUploadResponseBody;

    const putMultipartUploadPart1Response = await fetch(
        `http://localhost:${port}/${space.id}/multipart-upload/${fileId}/part/abc?upload=${uploadId}`,
        {
            method: `PUT`,
            headers: {
                connection: "close",
                cookie: await sessionCookie(session),
                "content-type": "application/octet-stream",
            },
            body: new Uint8Array(1e8).fill(1),
        },
    );

    const putMultipartUploadPart1ResponseBody =
        PutFileMultipartUploadPartResponseSchema.deserialize(
            await putMultipartUploadPart1Response.json(),
        );

    expect(putMultipartUploadPart1ResponseBody).toEqual({
        ok: false,
        error: new PermissionDeniedError("Part number must be an integer"),
    });
});

test("can’t put a multipart upload part with size larger than our max upload part size", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const createMultipartUploadResponse = await fetch(
        `http://localhost:${port}/${space.id}/multipart-upload`,
        {
            method: "POST",
            headers: {
                connection: "close",
                cookie: await sessionCookie(session),
                "content-type": "application/json",
            },
            body: JSON.stringify(
                CreateFileMultipartUploadRequestSchema.serialize({
                    fileId: null,
                    contentType: "application/octet-stream",
                    contentLength: 2.5e8,
                    attachTarget: null,
                }),
            ),
        },
    );

    const createMultipartUploadResponseBody = CreateFileMultipartUploadResponseSchema.deserialize(
        await createMultipartUploadResponse.json(),
    );
    if (!createMultipartUploadResponseBody.ok) throw createMultipartUploadResponseBody.error;

    expect(createMultipartUploadResponseBody).toEqual({
        ok: true,
        fileId: expect.any(String),
        uploadId: expect.any(String),
    });

    const {fileId, uploadId} = createMultipartUploadResponseBody;

    const putMultipartUploadPart1Response = await fetch(
        `http://localhost:${port}/${space.id}/multipart-upload/${fileId}/part/1?upload=${uploadId}`,
        {
            method: `PUT`,
            headers: {
                connection: "close",
                cookie: await sessionCookie(session),
                "content-type": "application/octet-stream",
            },
            body: new Uint8Array(2e8).fill(1),
        },
    );

    const putMultipartUploadPart1ResponseBody =
        PutFileMultipartUploadPartResponseSchema.deserialize(
            await putMultipartUploadPart1Response.json(),
        );

    expect(putMultipartUploadPart1ResponseBody).toEqual({
        ok: false,
        error: new InvalidArgumentError(
            "`Content-Length` of 200 MB is more than our maximum file multipart upload size of 100 MB",
        ),
    });
});

test("can’t put a multipart upload part with space actor", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const createMultipartUploadResponse = await fetch(
        `http://localhost:${port}/${space.id}/multipart-upload`,
        {
            method: "POST",
            headers: {
                connection: "close",
                cookie: await sessionCookie(session),
                "content-type": "application/json",
            },
            body: JSON.stringify(
                CreateFileMultipartUploadRequestSchema.serialize({
                    fileId: null,
                    contentType: "application/octet-stream",
                    contentLength: 2.5e8,
                    attachTarget: null,
                }),
            ),
        },
    );

    const createMultipartUploadResponseBody = CreateFileMultipartUploadResponseSchema.deserialize(
        await createMultipartUploadResponse.json(),
    );
    if (!createMultipartUploadResponseBody.ok) throw createMultipartUploadResponseBody.error;

    expect(createMultipartUploadResponseBody).toEqual({
        ok: true,
        fileId: expect.any(String),
        uploadId: expect.any(String),
    });

    const {fileId, uploadId} = createMultipartUploadResponseBody;

    const putMultipartUploadPart1Response = await fetch(
        `http://localhost:${port}/${space.id}/multipart-upload/${fileId}/part/1?upload=${uploadId}`,
        {
            method: `PUT`,
            headers: {
                connection: "close",
                cookie: await sessionCookie(space),
                "content-type": "application/octet-stream",
            },
            body: new Uint8Array(1e8).fill(1),
        },
    );

    const putMultipartUploadPart1ResponseBody =
        PutFileMultipartUploadPartResponseSchema.deserialize(
            await putMultipartUploadPart1Response.json(),
        );

    expect(putMultipartUploadPart1ResponseBody).toEqual({
        ok: false,
        error: new PermissionDeniedError("Unexpected token payload type in session cookie"),
    });
});

test("can’t put a multipart upload part with greater part number than the file allows", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const createMultipartUploadResponse = await fetch(
        `http://localhost:${port}/${space.id}/multipart-upload`,
        {
            method: "POST",
            headers: {
                connection: "close",
                cookie: await sessionCookie(session),
                "content-type": "application/json",
            },
            body: JSON.stringify(
                CreateFileMultipartUploadRequestSchema.serialize({
                    fileId: null,
                    contentType: "application/octet-stream",
                    contentLength: 2.5e8,
                    attachTarget: null,
                }),
            ),
        },
    );

    const createMultipartUploadResponseBody = CreateFileMultipartUploadResponseSchema.deserialize(
        await createMultipartUploadResponse.json(),
    );
    if (!createMultipartUploadResponseBody.ok) throw createMultipartUploadResponseBody.error;

    expect(createMultipartUploadResponseBody).toEqual({
        ok: true,
        fileId: expect.any(String),
        uploadId: expect.any(String),
    });

    const {fileId, uploadId} = createMultipartUploadResponseBody;

    const putMultipartUploadPart1Response = await fetch(
        `http://localhost:${port}/${space.id}/multipart-upload/${fileId}/part/4?upload=${uploadId}`,
        {
            method: `PUT`,
            headers: {
                connection: "close",
                cookie: await sessionCookie(session),
                "content-type": "application/octet-stream",
            },
            body: new Uint8Array(1e8).fill(4),
        },
    );

    const putMultipartUploadPart1ResponseBody =
        PutFileMultipartUploadPartResponseSchema.deserialize(
            await putMultipartUploadPart1Response.json(),
        );

    expect(putMultipartUploadPart1ResponseBody).toEqual({
        ok: false,
        error: new PermissionDeniedError("Part number must be less than or equal to 3"),
    });
});

test("can’t complete a multipart upload without the upload search param", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const createMultipartUploadResponse = await fetch(
        `http://localhost:${port}/${space.id}/multipart-upload`,
        {
            method: "POST",
            headers: {
                connection: "close",
                cookie: await sessionCookie(session),
                "content-type": "application/json",
            },
            body: JSON.stringify(
                CreateFileMultipartUploadRequestSchema.serialize({
                    fileId: null,
                    contentType: "application/octet-stream",
                    contentLength: 2.5e8,
                    attachTarget: null,
                }),
            ),
        },
    );

    const createMultipartUploadResponseBody = CreateFileMultipartUploadResponseSchema.deserialize(
        await createMultipartUploadResponse.json(),
    );
    if (!createMultipartUploadResponseBody.ok) throw createMultipartUploadResponseBody.error;

    expect(createMultipartUploadResponseBody).toEqual({
        ok: true,
        fileId: expect.any(String),
        uploadId: expect.any(String),
    });

    const {fileId, uploadId} = createMultipartUploadResponseBody;

    const putMultipartUploadPart1Response = await fetch(
        `http://localhost:${port}/${space.id}/multipart-upload/${fileId}/part/1?upload=${uploadId}`,
        {
            method: `PUT`,
            headers: {
                connection: "close",
                cookie: await sessionCookie(session),
                "content-type": "application/octet-stream",
            },
            body: new Uint8Array(1e8).fill(1),
        },
    );

    const putMultipartUploadPart1ResponseBody =
        PutFileMultipartUploadPartResponseSchema.deserialize(
            await putMultipartUploadPart1Response.json(),
        );
    if (!putMultipartUploadPart1ResponseBody.ok) throw putMultipartUploadPart1ResponseBody.error;

    const putMultipartUploadPart2Response = await fetch(
        `http://localhost:${port}/${space.id}/multipart-upload/${fileId}/part/2?upload=${uploadId}`,
        {
            method: `PUT`,
            headers: {
                connection: "close",
                cookie: await sessionCookie(session),
                "content-type": "application/octet-stream",
            },
            body: new Uint8Array(1e8).fill(2),
        },
    );

    const putMultipartUploadPart2ResponseBody =
        PutFileMultipartUploadPartResponseSchema.deserialize(
            await putMultipartUploadPart2Response.json(),
        );
    if (!putMultipartUploadPart2ResponseBody.ok) throw putMultipartUploadPart2ResponseBody.error;

    const putMultipartUploadPart3Response = await fetch(
        `http://localhost:${port}/${space.id}/multipart-upload/${fileId}/part/3?upload=${uploadId}`,
        {
            method: `PUT`,
            headers: {
                connection: "close",
                cookie: await sessionCookie(session),
                "content-type": "application/octet-stream",
            },
            body: new Uint8Array(0.5e8).fill(3),
        },
    );

    const putMultipartUploadPart3ResponseBody =
        PutFileMultipartUploadPartResponseSchema.deserialize(
            await putMultipartUploadPart3Response.json(),
        );
    if (!putMultipartUploadPart3ResponseBody.ok) throw putMultipartUploadPart3ResponseBody.error;

    const completeMultipartUploadResponse = await fetch(
        `http://localhost:${port}/${space.id}/multipart-upload/${fileId}/complete`,
        {
            method: "POST",
            headers: {
                connection: "close",
                cookie: await sessionCookie(session),
                "content-type": "application/json",
            },
            body: JSON.stringify(
                CompleteFileMultipartUploadRequestSchema.serialize({
                    parts: [
                        putMultipartUploadPart1ResponseBody,
                        putMultipartUploadPart2ResponseBody,
                        putMultipartUploadPart3ResponseBody,
                    ],
                }),
            ),
        },
    );

    const completeMultipartUploadResponseBody = UploadFileResponseSchema.deserialize(
        await completeMultipartUploadResponse.json(),
    );

    expect(completeMultipartUploadResponseBody).toEqual({
        ok: false,
        error: new PermissionDeniedError("`upload` search param is required"),
    });
});

test("can’t complete a multipart upload with system actor", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const createMultipartUploadResponse = await fetch(
        `http://localhost:${port}/${space.id}/multipart-upload`,
        {
            method: "POST",
            headers: {
                connection: "close",
                cookie: await sessionCookie(session),
                "content-type": "application/json",
            },
            body: JSON.stringify(
                CreateFileMultipartUploadRequestSchema.serialize({
                    fileId: null,
                    contentType: "application/octet-stream",
                    contentLength: 2.5e8,
                    attachTarget: null,
                }),
            ),
        },
    );

    const createMultipartUploadResponseBody = CreateFileMultipartUploadResponseSchema.deserialize(
        await createMultipartUploadResponse.json(),
    );
    if (!createMultipartUploadResponseBody.ok) throw createMultipartUploadResponseBody.error;

    expect(createMultipartUploadResponseBody).toEqual({
        ok: true,
        fileId: expect.any(String),
        uploadId: expect.any(String),
    });

    const {fileId, uploadId} = createMultipartUploadResponseBody;

    const putMultipartUploadPart1Response = await fetch(
        `http://localhost:${port}/${space.id}/multipart-upload/${fileId}/part/1?upload=${uploadId}`,
        {
            method: `PUT`,
            headers: {
                connection: "close",
                cookie: await sessionCookie(session),
                "content-type": "application/octet-stream",
            },
            body: new Uint8Array(1e8).fill(1),
        },
    );

    const putMultipartUploadPart1ResponseBody =
        PutFileMultipartUploadPartResponseSchema.deserialize(
            await putMultipartUploadPart1Response.json(),
        );
    if (!putMultipartUploadPart1ResponseBody.ok) throw putMultipartUploadPart1ResponseBody.error;

    const putMultipartUploadPart2Response = await fetch(
        `http://localhost:${port}/${space.id}/multipart-upload/${fileId}/part/2?upload=${uploadId}`,
        {
            method: `PUT`,
            headers: {
                connection: "close",
                cookie: await sessionCookie(session),
                "content-type": "application/octet-stream",
            },
            body: new Uint8Array(1e8).fill(2),
        },
    );

    const putMultipartUploadPart2ResponseBody =
        PutFileMultipartUploadPartResponseSchema.deserialize(
            await putMultipartUploadPart2Response.json(),
        );
    if (!putMultipartUploadPart2ResponseBody.ok) throw putMultipartUploadPart2ResponseBody.error;

    const putMultipartUploadPart3Response = await fetch(
        `http://localhost:${port}/${space.id}/multipart-upload/${fileId}/part/3?upload=${uploadId}`,
        {
            method: `PUT`,
            headers: {
                connection: "close",
                cookie: await sessionCookie(session),
                "content-type": "application/octet-stream",
            },
            body: new Uint8Array(0.5e8).fill(3),
        },
    );

    const putMultipartUploadPart3ResponseBody =
        PutFileMultipartUploadPartResponseSchema.deserialize(
            await putMultipartUploadPart3Response.json(),
        );
    if (!putMultipartUploadPart3ResponseBody.ok) throw putMultipartUploadPart3ResponseBody.error;

    const completeMultipartUploadResponse = await fetch(
        `http://localhost:${port}/${space.id}/multipart-upload/${fileId}/complete?upload=${uploadId}`,
        {
            method: "POST",
            headers: {
                connection: "close",
                cookie: await sessionCookie(space),
                "content-type": "application/json",
            },
            body: JSON.stringify(
                CompleteFileMultipartUploadRequestSchema.serialize({
                    parts: [
                        putMultipartUploadPart1ResponseBody,
                        putMultipartUploadPart2ResponseBody,
                        putMultipartUploadPart3ResponseBody,
                    ],
                }),
            ),
        },
    );

    const completeMultipartUploadResponseBody = UploadFileResponseSchema.deserialize(
        await completeMultipartUploadResponse.json(),
    );

    expect(completeMultipartUploadResponseBody).toEqual({
        ok: false,
        error: new PermissionDeniedError("Unexpected token payload type in session cookie"),
    });
});

test("can’t complete a multipart upload with missing parts", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const createMultipartUploadResponse = await fetch(
        `http://localhost:${port}/${space.id}/multipart-upload`,
        {
            method: "POST",
            headers: {
                connection: "close",
                cookie: await sessionCookie(session),
                "content-type": "application/json",
            },
            body: JSON.stringify(
                CreateFileMultipartUploadRequestSchema.serialize({
                    fileId: null,
                    contentType: "application/octet-stream",
                    contentLength: 2.5e8,
                    attachTarget: null,
                }),
            ),
        },
    );

    const createMultipartUploadResponseBody = CreateFileMultipartUploadResponseSchema.deserialize(
        await createMultipartUploadResponse.json(),
    );
    if (!createMultipartUploadResponseBody.ok) throw createMultipartUploadResponseBody.error;

    expect(createMultipartUploadResponseBody).toEqual({
        ok: true,
        fileId: expect.any(String),
        uploadId: expect.any(String),
    });

    const {fileId, uploadId} = createMultipartUploadResponseBody;

    const putMultipartUploadPart1Response = await fetch(
        `http://localhost:${port}/${space.id}/multipart-upload/${fileId}/part/1?upload=${uploadId}`,
        {
            method: `PUT`,
            headers: {
                connection: "close",
                cookie: await sessionCookie(session),
                "content-type": "application/octet-stream",
            },
            body: new Uint8Array(1e8).fill(1),
        },
    );

    const putMultipartUploadPart1ResponseBody =
        PutFileMultipartUploadPartResponseSchema.deserialize(
            await putMultipartUploadPart1Response.json(),
        );
    if (!putMultipartUploadPart1ResponseBody.ok) throw putMultipartUploadPart1ResponseBody.error;

    const putMultipartUploadPart2Response = await fetch(
        `http://localhost:${port}/${space.id}/multipart-upload/${fileId}/part/2?upload=${uploadId}`,
        {
            method: `PUT`,
            headers: {
                connection: "close",
                cookie: await sessionCookie(session),
                "content-type": "application/octet-stream",
            },
            body: new Uint8Array(1e8).fill(2),
        },
    );

    const putMultipartUploadPart2ResponseBody =
        PutFileMultipartUploadPartResponseSchema.deserialize(
            await putMultipartUploadPart2Response.json(),
        );
    if (!putMultipartUploadPart2ResponseBody.ok) throw putMultipartUploadPart2ResponseBody.error;

    const putMultipartUploadPart3Response = await fetch(
        `http://localhost:${port}/${space.id}/multipart-upload/${fileId}/part/3?upload=${uploadId}`,
        {
            method: `PUT`,
            headers: {
                connection: "close",
                cookie: await sessionCookie(session),
                "content-type": "application/octet-stream",
            },
            body: new Uint8Array(0.5e8).fill(3),
        },
    );

    const putMultipartUploadPart3ResponseBody =
        PutFileMultipartUploadPartResponseSchema.deserialize(
            await putMultipartUploadPart3Response.json(),
        );
    if (!putMultipartUploadPart3ResponseBody.ok) throw putMultipartUploadPart3ResponseBody.error;

    const completeMultipartUploadResponse = await fetch(
        `http://localhost:${port}/${space.id}/multipart-upload/${fileId}/complete?upload=${uploadId}`,
        {
            method: "POST",
            headers: {
                connection: "close",
                cookie: await sessionCookie(session),
                "content-type": "application/json",
            },
            body: JSON.stringify(
                CompleteFileMultipartUploadRequestSchema.serialize({
                    parts: [
                        putMultipartUploadPart1ResponseBody,
                        putMultipartUploadPart3ResponseBody,
                    ],
                }),
            ),
        },
    );

    const completeMultipartUploadResponseBody = UploadFileResponseSchema.deserialize(
        await completeMultipartUploadResponse.json(),
    );

    expect(completeMultipartUploadResponseBody).toEqual({
        ok: false,
        error: new FailedPreconditionError(
            "Expected file to be 250 MB but instead the file was 150 MB",
        ),
    });
});

test("can’t complete a multipart upload when the object is larger than what was declared", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const createMultipartUploadResponse = await fetch(
        `http://localhost:${port}/${space.id}/multipart-upload`,
        {
            method: "POST",
            headers: {
                connection: "close",
                cookie: await sessionCookie(session),
                "content-type": "application/json",
            },
            body: JSON.stringify(
                CreateFileMultipartUploadRequestSchema.serialize({
                    fileId: null,
                    contentType: "application/octet-stream",
                    contentLength: 2.5e8,
                    attachTarget: null,
                }),
            ),
        },
    );

    const createMultipartUploadResponseBody = CreateFileMultipartUploadResponseSchema.deserialize(
        await createMultipartUploadResponse.json(),
    );
    if (!createMultipartUploadResponseBody.ok) throw createMultipartUploadResponseBody.error;

    expect(createMultipartUploadResponseBody).toEqual({
        ok: true,
        fileId: expect.any(String),
        uploadId: expect.any(String),
    });

    const {fileId, uploadId} = createMultipartUploadResponseBody;

    const putMultipartUploadPart1Response = await fetch(
        `http://localhost:${port}/${space.id}/multipart-upload/${fileId}/part/1?upload=${uploadId}`,
        {
            method: `PUT`,
            headers: {
                connection: "close",
                cookie: await sessionCookie(session),
                "content-type": "application/octet-stream",
            },
            body: new Uint8Array(1e8).fill(1),
        },
    );

    const putMultipartUploadPart1ResponseBody =
        PutFileMultipartUploadPartResponseSchema.deserialize(
            await putMultipartUploadPart1Response.json(),
        );
    if (!putMultipartUploadPart1ResponseBody.ok) throw putMultipartUploadPart1ResponseBody.error;

    const putMultipartUploadPart2Response = await fetch(
        `http://localhost:${port}/${space.id}/multipart-upload/${fileId}/part/2?upload=${uploadId}`,
        {
            method: `PUT`,
            headers: {
                connection: "close",
                cookie: await sessionCookie(session),
                "content-type": "application/octet-stream",
            },
            body: new Uint8Array(1e8).fill(2),
        },
    );

    const putMultipartUploadPart2ResponseBody =
        PutFileMultipartUploadPartResponseSchema.deserialize(
            await putMultipartUploadPart2Response.json(),
        );
    if (!putMultipartUploadPart2ResponseBody.ok) throw putMultipartUploadPart2ResponseBody.error;

    const putMultipartUploadPart3Response = await fetch(
        `http://localhost:${port}/${space.id}/multipart-upload/${fileId}/part/3?upload=${uploadId}`,
        {
            method: `PUT`,
            headers: {
                connection: "close",
                cookie: await sessionCookie(session),
                "content-type": "application/octet-stream",
            },
            body: new Uint8Array(0.75e8).fill(3),
        },
    );

    const putMultipartUploadPart3ResponseBody =
        PutFileMultipartUploadPartResponseSchema.deserialize(
            await putMultipartUploadPart3Response.json(),
        );
    if (!putMultipartUploadPart3ResponseBody.ok) throw putMultipartUploadPart3ResponseBody.error;

    const completeMultipartUploadResponse = await fetch(
        `http://localhost:${port}/${space.id}/multipart-upload/${fileId}/complete?upload=${uploadId}`,
        {
            method: "POST",
            headers: {
                connection: "close",
                cookie: await sessionCookie(session),
                "content-type": "application/json",
            },
            body: JSON.stringify(
                CompleteFileMultipartUploadRequestSchema.serialize({
                    parts: [
                        putMultipartUploadPart1ResponseBody,
                        putMultipartUploadPart2ResponseBody,
                        putMultipartUploadPart3ResponseBody,
                    ],
                }),
            ),
        },
    );

    const completeMultipartUploadResponseBody = UploadFileResponseSchema.deserialize(
        await completeMultipartUploadResponse.json(),
    );

    expect(completeMultipartUploadResponseBody).toEqual({
        ok: false,
        error: new FailedPreconditionError(
            "Expected file to be 250 MB but instead the file was 275 MB",
        ),
    });
});

test("can’t complete a multipart upload when the object is smaller than what was declared", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const createMultipartUploadResponse = await fetch(
        `http://localhost:${port}/${space.id}/multipart-upload`,
        {
            method: "POST",
            headers: {
                connection: "close",
                cookie: await sessionCookie(session),
                "content-type": "application/json",
            },
            body: JSON.stringify(
                CreateFileMultipartUploadRequestSchema.serialize({
                    fileId: null,
                    contentType: "application/octet-stream",
                    contentLength: 2.5e8,
                    attachTarget: null,
                }),
            ),
        },
    );

    const createMultipartUploadResponseBody = CreateFileMultipartUploadResponseSchema.deserialize(
        await createMultipartUploadResponse.json(),
    );
    if (!createMultipartUploadResponseBody.ok) throw createMultipartUploadResponseBody.error;

    expect(createMultipartUploadResponseBody).toEqual({
        ok: true,
        fileId: expect.any(String),
        uploadId: expect.any(String),
    });

    const {fileId, uploadId} = createMultipartUploadResponseBody;

    const putMultipartUploadPart1Response = await fetch(
        `http://localhost:${port}/${space.id}/multipart-upload/${fileId}/part/1?upload=${uploadId}`,
        {
            method: `PUT`,
            headers: {
                connection: "close",
                cookie: await sessionCookie(session),
                "content-type": "application/octet-stream",
            },
            body: new Uint8Array(1e8).fill(1),
        },
    );

    const putMultipartUploadPart1ResponseBody =
        PutFileMultipartUploadPartResponseSchema.deserialize(
            await putMultipartUploadPart1Response.json(),
        );
    if (!putMultipartUploadPart1ResponseBody.ok) throw putMultipartUploadPart1ResponseBody.error;

    const putMultipartUploadPart2Response = await fetch(
        `http://localhost:${port}/${space.id}/multipart-upload/${fileId}/part/2?upload=${uploadId}`,
        {
            method: `PUT`,
            headers: {
                connection: "close",
                cookie: await sessionCookie(session),
                "content-type": "application/octet-stream",
            },
            body: new Uint8Array(1e8).fill(2),
        },
    );

    const putMultipartUploadPart2ResponseBody =
        PutFileMultipartUploadPartResponseSchema.deserialize(
            await putMultipartUploadPart2Response.json(),
        );
    if (!putMultipartUploadPart2ResponseBody.ok) throw putMultipartUploadPart2ResponseBody.error;

    const putMultipartUploadPart3Response = await fetch(
        `http://localhost:${port}/${space.id}/multipart-upload/${fileId}/part/3?upload=${uploadId}`,
        {
            method: `PUT`,
            headers: {
                connection: "close",
                cookie: await sessionCookie(session),
                "content-type": "application/octet-stream",
            },
            body: new Uint8Array(0.25e8).fill(3),
        },
    );

    const putMultipartUploadPart3ResponseBody =
        PutFileMultipartUploadPartResponseSchema.deserialize(
            await putMultipartUploadPart3Response.json(),
        );
    if (!putMultipartUploadPart3ResponseBody.ok) throw putMultipartUploadPart3ResponseBody.error;

    const completeMultipartUploadResponse = await fetch(
        `http://localhost:${port}/${space.id}/multipart-upload/${fileId}/complete?upload=${uploadId}`,
        {
            method: "POST",
            headers: {
                connection: "close",
                cookie: await sessionCookie(session),
                "content-type": "application/json",
            },
            body: JSON.stringify(
                CompleteFileMultipartUploadRequestSchema.serialize({
                    parts: [
                        putMultipartUploadPart1ResponseBody,
                        putMultipartUploadPart2ResponseBody,
                        putMultipartUploadPart3ResponseBody,
                    ],
                }),
            ),
        },
    );

    const completeMultipartUploadResponseBody = UploadFileResponseSchema.deserialize(
        await completeMultipartUploadResponse.json(),
    );

    expect(completeMultipartUploadResponseBody).toEqual({
        ok: false,
        error: new FailedPreconditionError(
            "Expected file to be 250 MB but instead the file was 225 MB",
        ),
    });
});
