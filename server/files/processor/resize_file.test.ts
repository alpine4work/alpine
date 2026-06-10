import {R2Bucket} from "@miniflare/r2";
import {FileStorage} from "@miniflare/storage-file";
import fs from "fs/promises";
import getPort from "get-port";
import looksSame from "looks-same";
import {join as joinPath} from "path";
import sharp from "sharp";
import {CloudflareR2ClientBase} from "~/server/cloudflare/r2/cloudflare_r2_client.js";
import {CloudflareR2ContextModule} from "~/server/cloudflare/r2/cloudflare_r2_context_module.js";
import {MiniflareR2Client} from "~/server/cloudflare/r2/miniflare_r2_client.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createTestTokenAgents} from "~/server/dynamo/test_helpers/create_test_token_agent.js";
import {uploadFile} from "~/server/edge/upload_file.js";
import {getFileAsUploader} from "~/server/files/data/files_actions.js";
import {createFileProcessorServiceServer} from "~/server/files/processor/file_processor_service_server.js";
import {processFile} from "~/server/files/processor/process_file.js";
import {ffprobeExecutablePath} from "~/server/files/processor/processors/file_video_and_audio_processor_base.js";
import {TestUploadFileRpcContextModule} from "~/server/files/processor/test_helpers/test_upload_file_rpc_context_module.js";
import {
    filesBindingName,
    filesBucketName,
} from "~/server/helpers/files_cloudflare_r2_bucket_name.js";
import {runProcess} from "~/server/helpers/node/run_process.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {ShutdownManager} from "~/server/node/shutdown_manager.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {InternalError} from "~/shared/error/error.js";
import {FileContentType, FileWebSafeImageContentType} from "~/shared/files/file_content_type.js";
import {FileImagePreviewPlaceholder} from "~/shared/files/file_image_preview_placeholder.js";
import {FileModel} from "~/shared/files/file_model.js";
import {UploadFileResponseSchema} from "~/shared/files/upload_file_protocol.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

// Increase timeout to reduce test flakiness. Working with images can be expensive,
// especially on overloaded CI machines.
import.meta.jest.setTimeout(30 * 1000);

const jpegTestFixturePath = joinPath(
    runfilesPath,
    "cyberworlds/server/files/processor/test_fixtures/unsplash_annie_spratt_0ArJET2aSIQ.jpeg",
);

const testlogsPath = joinPath(assertExists(process.env.TEST_UNDECLARED_OUTPUTS_DIR));

const {shutdownManager, shutdown} = ShutdownManager.new({
    tracer: testTracer,
    isClusterPrimary: true,
    flushTracer: async () => {},
});

let r2Bucket: R2Bucket;
let r2Client: CloudflareR2ClientBase;
let appTokenAgent: TokenAgent;
let edgeTokenAgent: TokenAgent;
let fileProcessorTokenAgent: TokenAgent;
let port: number;

const context = createTestContext({
    processJob: async (actionContext, job, jobStartTime, span) => {
        if (
            // TODO(ifitzsimmons, 2025-09-18): Remove this once we've migrated to the new job
            // queue system.
            job.type === "ProcessFile" ||
            job.type === "ProcessFileLight" ||
            job.type === "ProcessFileHeavy"
        ) {
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

    const r2Storage = new FileStorage(
        joinPath(context.getTemporaryDirectoryPath(), "r2", filesBindingName),
    );
    r2Bucket = new R2Bucket(r2Storage);
    r2Client = new MiniflareR2Client({
        fileProcessorServiceUrl: `http://localhost:${port}`,
        bucketByName: new Map([[filesBucketName, r2Bucket]]),
    });
    const r2ContextModule = new CloudflareR2ContextModule(r2Client);

    [appTokenAgent, edgeTokenAgent, fileProcessorTokenAgent] = await createTestTokenAgents(
        context,
        ["AppService", "EdgeService", "FileProcessorService"],
    );

    const server = createFileProcessorServiceServer(context.clone({r2: r2ContextModule}), {
        shutdownManager,
        tokenAgent: fileProcessorTokenAgent,
        temporaryDirectoryPath: joinPath(context.getTemporaryDirectoryPath(), "files"),
        withFiber: (context, action) => action(),
    });

    await new Promise<void>(resolve => {
        server.listen(port, resolve);
    });
});

afterAll(async () => {
    await shutdown({type: "Signal", signal: "SIGINT"}, null);
});

async function authorization(
    session: TestSession | TestSpace,
    authorizationTokenAgent: TokenAgent = edgeTokenAgent,
) {
    const token = await authorizationTokenAgent.privateSide.dangerouslySignShortLivedToken(
        "FileProcessorService",
        session.getTokenPayload(),
    );

    return `Bearer ${token}`;
}

async function uploadFileForTest(
    session: TestSpaceSession,
    {contentType, body}: {contentType: FileContentType | "image/heic"; body: Buffer},
) {
    const fileId = await context.tracer.getRoot().withSpan("Upload file for test", async span => {
        const token = await appTokenAgent.privateSide.dangerouslySignShortLivedToken(
            "EdgeService",
            session.getTokenPayload(),
        );

        const request = new Request(`http://localhost/${session.space.id}/upload`, {
            method: "POST",
            headers: {
                connection: "close",
                cookie: `session=${token}`,
                "content-type": contentType,
                "content-length": String(body.length),
            },
            // TODO(calebmer, #typescript-5.9.2): Discovered after TS version upgrade, not
            // fixing for now.
            // @ts-expect-error
            body,
        });

        const url = new URL(request.url);

        const response = await uploadFile(
            ({sessionId, accountId}) =>
                context.action({sessionId, accountId}).clone({
                    tracer: new TracerContextModule(span),
                    rpc: new TestUploadFileRpcContextModule(),
                }),
            {},
            {FilesBucket: r2Bucket, COOKIE_NAME_SUFFIX: ""},
            edgeTokenAgent,
            request,
            url,
            span,
            {spaceId: session.space.id},
        );

        const responseBody = UploadFileResponseSchema.deserialize(await response.json());
        if (!responseBody.ok) throw responseBody.error;

        return responseBody.file.id;
    });

    // Wait for the file to be processed...
    await ProcessContextModule.waitForTestTasks();

    return getFileAsUploader(session.action(), fileId);
}

test("can\u2019t resize an image with a session actor", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const file = await uploadFileForTest(session, {
        contentType: "image/jpeg",
        body: await fs.readFile(jpegTestFixturePath),
    });

    expect(file).toEqual(
        new FileModel({
            spaceId: space.id,
            id: file.id,
            contentType: "image/jpeg",
            contentLength: 33102,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: false,
                ok: true,
                size: {width: 500, height: 375, scale: 1, hasAlpha: false},
                placeholder: expect.any(FileImagePreviewPlaceholder),
            },
        }),
    );

    const resizeResponse = await fetch(
        `http://localhost:${port}/${space.id}/resize/${file.id}?width=200`,
        {
            method: "GET",
            headers: {connection: "close", authorization: await authorization(session)},
        },
    );

    expect(resizeResponse.status).toEqual(400);
    expect(resizeResponse.headers.get("content-type")).toEqual("text/plain");
    expect(await resizeResponse.text()).toMatch(
        /^400 Bad Request\n\nPermissionDeniedError: Session actor is not a system actor\n/,
    );
});

test("can\u2019t resize an image with a token that\u2019s not from edge service or resources service", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const file = await uploadFileForTest(session, {
        contentType: "image/jpeg",
        body: await fs.readFile(jpegTestFixturePath),
    });

    expect(file).toEqual(
        new FileModel({
            spaceId: space.id,
            id: file.id,
            contentType: "image/jpeg",
            contentLength: 33102,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: false,
                ok: true,
                size: {width: 500, height: 375, scale: 1, hasAlpha: false},
                placeholder: expect.any(FileImagePreviewPlaceholder),
            },
        }),
    );

    const resizeResponse = await fetch(
        `http://localhost:${port}/${space.id}/resize/${file.id}?width=200`,
        {
            method: "GET",
            headers: {
                connection: "close",
                authorization: await authorization(space, fileProcessorTokenAgent),
            },
        },
    );

    expect(resizeResponse.status).toEqual(400);
    expect(resizeResponse.headers.get("content-type")).toEqual("text/plain");
    expect(await resizeResponse.text()).toMatch(
        /^400 Bad Request\n\nPermissionDeniedError: Only `EdgeService` or `ResourceService` can resize a file\n/,
    );
});

test("can\u2019t resize an image that doesn\u2019t exist", async () => {
    const space = await TestSpace.create(context);

    const resizeResponse = await fetch(
        `http://localhost:${port}/${space.id}/resize/${generateChronologicalId()}?width=200`,
        {
            method: "GET",
            headers: {connection: "close", authorization: await authorization(space)},
        },
    );

    expect(resizeResponse.status).toEqual(404);
    expect(resizeResponse.headers.get("content-type")).toEqual("text/plain");
    expect(await resizeResponse.text()).toEqual("404 Not Found");
});

// Use a TypeScript object map to make sure we have tests for every web safe image
// content type. If a new web safe image content type is added then we should add
// another test here.
const testsByFileWebSafeImageContentType: {[Key in FileWebSafeImageContentType]: () => void} = {
    "image/jpeg": () => {
        test("can resize a JPEG image", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const file = await uploadFileForTest(session, {
                contentType: "image/jpeg",
                body: await fs.readFile(jpegTestFixturePath),
            });

            expect(file).toEqual(
                new FileModel({
                    spaceId: space.id,
                    id: file.id,
                    contentType: "image/jpeg",
                    contentLength: 33102,
                    isUploading: false,
                    alternative: null,
                    preview: {
                        type: "Image",
                        isProcessing: false,
                        ok: true,
                        size: {width: 500, height: 375, scale: 1, hasAlpha: false},
                        placeholder: expect.any(FileImagePreviewPlaceholder),
                    },
                }),
            );

            {
                const resizeResponse = await fetch(
                    `http://localhost:${port}/${space.id}/resize/${file.id}?width=200`,
                    {
                        method: "GET",
                        headers: {connection: "close", authorization: await authorization(space)},
                    },
                );

                expect(resizeResponse.status).toEqual(200);
                expect(resizeResponse.headers.get("content-type")).toEqual("image/avif");

                const resizeBody = await resizeResponse.arrayBuffer();
                expect(await sharp(resizeBody).metadata()).toEqual({
                    format: "heif",
                    size: expect.any(Number),
                    width: 200,
                    height: 150,
                    space: "srgb",
                    channels: 3,
                    depth: "uchar",
                    isProgressive: false,
                    pages: 1,
                    pagePrimary: 0,
                    compression: "av1",
                    hasProfile: false,
                    hasAlpha: false,
                });
            }

            {
                const resizeResponse = await fetch(
                    `http://localhost:${port}/${space.id}/resize/${file.id}?width=400`,
                    {
                        method: "GET",
                        headers: {connection: "close", authorization: await authorization(space)},
                    },
                );

                expect(resizeResponse.status).toEqual(200);
                expect(resizeResponse.headers.get("content-type")).toEqual("image/avif");

                const resizeBody = await resizeResponse.arrayBuffer();
                expect(await sharp(resizeBody).metadata()).toEqual({
                    format: "heif",
                    size: expect.any(Number),
                    width: 400,
                    height: 300,
                    space: "srgb",
                    channels: 3,
                    depth: "uchar",
                    isProgressive: false,
                    pages: 1,
                    pagePrimary: 0,
                    compression: "av1",
                    hasProfile: false,
                    hasAlpha: false,
                });
            }

            {
                const resizeResponse = await fetch(
                    `http://localhost:${port}/${space.id}/resize/${file.id}?width=600`,
                    {
                        method: "GET",
                        headers: {connection: "close", authorization: await authorization(space)},
                    },
                );

                expect(resizeResponse.status).toEqual(200);
                expect(resizeResponse.headers.get("content-type")).toEqual("image/avif");

                const resizeBody = await resizeResponse.arrayBuffer();
                expect(await sharp(resizeBody).metadata()).toEqual({
                    format: "heif",
                    size: expect.any(Number),
                    width: 500,
                    height: 375,
                    space: "srgb",
                    channels: 3,
                    depth: "uchar",
                    isProgressive: false,
                    pages: 1,
                    pagePrimary: 0,
                    compression: "av1",
                    hasProfile: false,
                    hasAlpha: false,
                });
            }
        });
    },
    "image/png": () => {
        test("can resize a PNG image with transparency", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const file = await uploadFileForTest(session, {
                contentType: "image/png",
                body: await fs.readFile(
                    joinPath(
                        runfilesPath,
                        "cyberworlds/server/files/processor/test_fixtures/wikimedia_png_transparency_demonstration.png",
                    ),
                ),
            });

            expect(file).toEqual(
                new FileModel({
                    spaceId: space.id,
                    id: file.id,
                    contentType: "image/png",
                    contentLength: 76547,
                    isUploading: false,
                    alternative: null,
                    preview: {
                        type: "Image",
                        isProcessing: false,
                        ok: true,
                        size: {width: 336, height: 252, scale: 1, hasAlpha: true},
                        placeholder: expect.any(FileImagePreviewPlaceholder),
                    },
                }),
            );

            {
                const resizeResponse = await fetch(
                    `http://localhost:${port}/${space.id}/resize/${file.id}?width=200`,
                    {
                        method: "GET",
                        headers: {connection: "close", authorization: await authorization(space)},
                    },
                );

                expect(resizeResponse.status).toEqual(200);
                expect(resizeResponse.headers.get("content-type")).toEqual("image/avif");

                const resizeBody = await resizeResponse.arrayBuffer();
                expect(await sharp(resizeBody).metadata()).toEqual({
                    format: "heif",
                    size: expect.any(Number),
                    width: 200,
                    height: 150,
                    space: "srgb",
                    channels: 4,
                    depth: "uchar",
                    isProgressive: false,
                    pages: 1,
                    pagePrimary: 0,
                    compression: "av1",
                    hasProfile: false,
                    hasAlpha: true,
                });
            }

            {
                const resizeResponse = await fetch(
                    `http://localhost:${port}/${space.id}/resize/${file.id}?width=400`,
                    {
                        method: "GET",
                        headers: {connection: "close", authorization: await authorization(space)},
                    },
                );

                expect(resizeResponse.status).toEqual(200);
                expect(resizeResponse.headers.get("content-type")).toEqual("image/avif");

                const resizeBody = await resizeResponse.arrayBuffer();
                expect(await sharp(resizeBody).metadata()).toEqual({
                    format: "heif",
                    size: expect.any(Number),
                    width: 336,
                    height: 252,
                    space: "srgb",
                    channels: 4,
                    depth: "uchar",
                    isProgressive: false,
                    pages: 1,
                    pagePrimary: 0,
                    compression: "av1",
                    hasProfile: false,
                    hasAlpha: true,
                });
            }
        });

        test("can resize a PNG image without transparency", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const file = await uploadFileForTest(session, {
                contentType: "image/png",
                body: await fs.readFile(
                    joinPath(
                        runfilesPath,
                        "cyberworlds/server/files/processor/test_fixtures/unsplash_annie_spratt_0ArJET2aSIQ.png",
                    ),
                ),
            });

            expect(file).toEqual(
                new FileModel({
                    spaceId: space.id,
                    id: file.id,
                    contentType: "image/png",
                    contentLength: 103683,
                    isUploading: false,
                    alternative: null,
                    preview: {
                        type: "Image",
                        isProcessing: false,
                        ok: true,
                        size: {width: 500, height: 375, scale: 1, hasAlpha: false},
                        placeholder: expect.any(FileImagePreviewPlaceholder),
                    },
                }),
            );

            {
                const resizeResponse = await fetch(
                    `http://localhost:${port}/${space.id}/resize/${file.id}?width=400`,
                    {
                        method: "GET",
                        headers: {connection: "close", authorization: await authorization(space)},
                    },
                );

                expect(resizeResponse.status).toEqual(200);
                expect(resizeResponse.headers.get("content-type")).toEqual("image/avif");

                const resizeBody = await resizeResponse.arrayBuffer();
                expect(await sharp(resizeBody).metadata()).toEqual({
                    format: "heif",
                    size: expect.any(Number),
                    width: 400,
                    height: 300,
                    space: "srgb",
                    channels: 3,
                    depth: "uchar",
                    isProgressive: false,
                    pages: 1,
                    pagePrimary: 0,
                    compression: "av1",
                    hasProfile: false,
                    hasAlpha: false,
                });
            }

            {
                const resizeResponse = await fetch(
                    `http://localhost:${port}/${space.id}/resize/${file.id}?width=600`,
                    {
                        method: "GET",
                        headers: {connection: "close", authorization: await authorization(space)},
                    },
                );

                expect(resizeResponse.status).toEqual(200);
                expect(resizeResponse.headers.get("content-type")).toEqual("image/avif");

                const resizeBody = await resizeResponse.arrayBuffer();
                expect(await sharp(resizeBody).metadata()).toEqual({
                    format: "heif",
                    size: expect.any(Number),
                    width: 500,
                    height: 375,
                    space: "srgb",
                    channels: 3,
                    depth: "uchar",
                    isProgressive: false,
                    pages: 1,
                    pagePrimary: 0,
                    compression: "av1",
                    hasProfile: false,
                    hasAlpha: false,
                });
            }
        });
    },
    "image/gif": () => {
        test(
            "can resize a GIF image with transparency",
            async () => {
                const space = await TestSpace.create(context);
                const session = await space.createSession();

                const inputBodyPromise = fs.readFile(
                    joinPath(
                        runfilesPath,
                        "cyberworlds/server/files/processor/test_fixtures/wikimedia_rotating_earth.gif",
                    ),
                );
                const file = await uploadFileForTest(session, {
                    contentType: "image/gif",
                    body: await inputBodyPromise,
                });

                expect(file).toEqual(
                    new FileModel({
                        spaceId: space.id,
                        id: file.id,
                        contentType: "image/gif",
                        contentLength: 118405,
                        isUploading: false,
                        alternative: null,
                        preview: {
                            type: "Image",
                            isProcessing: false,
                            ok: true,
                            size: {width: 400, height: 400, scale: 1, hasAlpha: true},
                            placeholder: expect.any(FileImagePreviewPlaceholder),
                        },
                    }),
                );

                {
                    const resizeResponse = await fetch(
                        `http://localhost:${port}/${space.id}/resize/${file.id}?width=200`,
                        {
                            method: "GET",
                            headers: {
                                connection: "close",
                                authorization: await authorization(space),
                            },
                        },
                    );

                    // NOTE(ifitzsimmons, #dont-resize-gifs): We stopped resizing gifs because they
                    // take too long (often timing out at 30 seconds). If we get to a place where we
                    // want to resize gifs asynchronously while serving the original image/gif content,
                    // we can re-use the old tests gif tests here:
                    // https://github.com/cyberworlds/cyberworlds/blob/2a492ef16f10196366605fcaa90d8f8a392cce2e/server/files/processor/resize_file.test.ts#L595-L1301
                    expect(resizeResponse.status).toEqual(400);
                    expect(resizeResponse.headers.get("content-type")).toEqual("text/plain");
                    expect(await resizeResponse.text()).toMatch(
                        /^400 Bad Request\n*FailedPreconditionError: Resizing `image\/gif` is not supported\n*/,
                    );
                }
            },
            // For some reason, this test can take a while compared to other tests in this
            // file.
            30 * 1000,
        );
    },
    "image/apng": () => {
        test("can resize an APNG image", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const file = await uploadFileForTest(session, {
                contentType: "image/apng",
                body: await fs.readFile(
                    joinPath(
                        runfilesPath,
                        "cyberworlds/server/files/processor/test_fixtures/wikimedia_bouncing_beach_ball.png",
                    ),
                ),
            });

            expect(file).toEqual(
                new FileModel({
                    spaceId: space.id,
                    id: file.id,
                    contentType: "image/apng",
                    contentLength: 61968,
                    isUploading: false,
                    alternative: null,
                    preview: {
                        type: "Image",
                        isProcessing: false,
                        ok: true,
                        size: {width: 100, height: 100, scale: 1, hasAlpha: true},
                        placeholder: expect.any(FileImagePreviewPlaceholder),
                    },
                }),
            );

            {
                const resizeResponse = await fetch(
                    `http://localhost:${port}/${space.id}/resize/${file.id}?width=40`,
                    {
                        method: "GET",
                        headers: {connection: "close", authorization: await authorization(space)},
                    },
                );

                expect(resizeResponse.status).toEqual(200);
                expect(resizeResponse.headers.get("content-type")).toEqual("image/avif");

                const resizeBody = await resizeResponse.arrayBuffer();

                // We need to use `ffprobe` instead of `sharp` since the GIF will become an
                // animated AVIF file which `sharp()` doesn't like.
                expect(
                    JSON.parse(
                        await runProcess(
                            ffprobeExecutablePath,
                            ["-print_format", "json", "-show_streams", "-show_format", "-"],
                            {cwd: runfilesPath, stdin: new Uint8Array(resizeBody)},
                        ),
                    ),
                ).toEqual(
                    expect.objectContaining({
                        format: expect.objectContaining({
                            start_time: "0.000000",
                            duration: "1.500000",
                        }),
                        streams: [
                            expect.objectContaining({
                                codec_name: "av1",
                                codec_type: "video",
                                width: 40,
                                height: 40,
                                start_time: "0.000000",
                                avg_frame_rate: "1/1",
                                pix_fmt: "gbrp",
                                tags: expect.objectContaining({title: "Color"}),
                            }),
                            expect.objectContaining({
                                codec_name: "av1",
                                codec_type: "video",
                                width: 40,
                                height: 40,
                                start_time: "0.000000",
                                avg_frame_rate: "1/1",
                                pix_fmt: "gray",
                                tags: expect.objectContaining({title: "Alpha"}),
                            }),
                            expect.objectContaining({
                                codec_name: "av1",
                                codec_type: "video",
                                width: 40,
                                height: 40,
                                start_time: "0.000000",
                                avg_frame_rate: "40/3",
                                pix_fmt: "gbrp",
                            }),
                            expect.objectContaining({
                                codec_name: "av1",
                                codec_type: "video",
                                width: 40,
                                height: 40,
                                start_time: "0.000000",
                                duration: "1.500000",
                                avg_frame_rate: "40/3",
                                pix_fmt: "gray",
                            }),
                        ],
                    }),
                );
            }

            {
                const resizeResponse = await fetch(
                    `http://localhost:${port}/${space.id}/resize/${file.id}?width=80`,
                    {
                        method: "GET",
                        headers: {connection: "close", authorization: await authorization(space)},
                    },
                );

                expect(resizeResponse.status).toEqual(200);
                expect(resizeResponse.headers.get("content-type")).toEqual("image/avif");

                const resizeBody = await resizeResponse.arrayBuffer();

                // We need to use `ffprobe` instead of `sharp` since the GIF will become an
                // animated AVIF file which `sharp()` doesn't like.
                expect(
                    JSON.parse(
                        await runProcess(
                            ffprobeExecutablePath,
                            ["-print_format", "json", "-show_streams", "-show_format", "-"],
                            {cwd: runfilesPath, stdin: new Uint8Array(resizeBody)},
                        ),
                    ),
                ).toEqual(
                    expect.objectContaining({
                        format: expect.objectContaining({
                            start_time: "0.000000",
                            duration: "1.500000",
                        }),
                        streams: [
                            expect.objectContaining({
                                codec_name: "av1",
                                codec_type: "video",
                                width: 80,
                                height: 80,
                                start_time: "0.000000",
                                avg_frame_rate: "1/1",
                                pix_fmt: "gbrp",
                                tags: expect.objectContaining({title: "Color"}),
                            }),
                            expect.objectContaining({
                                codec_name: "av1",
                                codec_type: "video",
                                width: 80,
                                height: 80,
                                start_time: "0.000000",
                                avg_frame_rate: "1/1",
                                pix_fmt: "gray",
                                tags: expect.objectContaining({title: "Alpha"}),
                            }),
                            expect.objectContaining({
                                codec_name: "av1",
                                codec_type: "video",
                                width: 80,
                                height: 80,
                                start_time: "0.000000",
                                avg_frame_rate: "40/3",
                                pix_fmt: "gbrp",
                            }),
                            expect.objectContaining({
                                codec_name: "av1",
                                codec_type: "video",
                                width: 80,
                                height: 80,
                                start_time: "0.000000",
                                duration: "1.500000",
                                avg_frame_rate: "40/3",
                                pix_fmt: "gray",
                            }),
                        ],
                    }),
                );
            }

            {
                const resizeResponse = await fetch(
                    `http://localhost:${port}/${space.id}/resize/${file.id}?width=120`,
                    {
                        method: "GET",
                        headers: {connection: "close", authorization: await authorization(space)},
                    },
                );

                expect(resizeResponse.status).toEqual(200);
                expect(resizeResponse.headers.get("content-type")).toEqual("image/avif");

                const resizeBody = await resizeResponse.arrayBuffer();

                // We need to use `ffprobe` instead of `sharp` since the GIF will become an
                // animated AVIF file which `sharp()` doesn't like.
                expect(
                    JSON.parse(
                        await runProcess(
                            ffprobeExecutablePath,
                            ["-print_format", "json", "-show_streams", "-show_format", "-"],
                            {cwd: runfilesPath, stdin: new Uint8Array(resizeBody)},
                        ),
                    ),
                ).toEqual(
                    expect.objectContaining({
                        format: expect.objectContaining({
                            start_time: "0.000000",
                            duration: "1.500000",
                        }),
                        streams: [
                            expect.objectContaining({
                                codec_name: "av1",
                                codec_type: "video",
                                width: 100,
                                height: 100,
                                start_time: "0.000000",
                                avg_frame_rate: "1/1",
                                pix_fmt: "gbrp",
                                tags: expect.objectContaining({title: "Color"}),
                            }),
                            expect.objectContaining({
                                codec_name: "av1",
                                codec_type: "video",
                                width: 100,
                                height: 100,
                                start_time: "0.000000",
                                avg_frame_rate: "1/1",
                                pix_fmt: "gray",
                                tags: expect.objectContaining({title: "Alpha"}),
                            }),
                            expect.objectContaining({
                                codec_name: "av1",
                                codec_type: "video",
                                width: 100,
                                height: 100,
                                start_time: "0.000000",
                                avg_frame_rate: "40/3",
                                pix_fmt: "gbrp",
                            }),
                            expect.objectContaining({
                                codec_name: "av1",
                                codec_type: "video",
                                width: 100,
                                height: 100,
                                start_time: "0.000000",
                                duration: "1.500000",
                                avg_frame_rate: "40/3",
                                pix_fmt: "gray",
                            }),
                        ],
                    }),
                );
            }
        });
    },
    "image/avif": () => {
        test("can resize an AVIF image", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const file = await uploadFileForTest(session, {
                contentType: "image/avif",
                body: await fs.readFile(
                    joinPath(
                        runfilesPath,
                        "cyberworlds/server/files/processor/test_fixtures/filesampleshub_heif_sample1.avif",
                    ),
                ),
            });

            expect(file).toEqual(
                new FileModel({
                    spaceId: space.id,
                    id: file.id,
                    contentType: "image/avif",
                    contentLength: 74432,
                    isUploading: false,
                    alternative: null,
                    preview: {
                        type: "Image",
                        isProcessing: false,
                        ok: true,
                        size: {width: 640, height: 426, scale: 1, hasAlpha: false},
                        placeholder: expect.any(FileImagePreviewPlaceholder),
                    },
                }),
            );

            {
                const resizeResponse = await fetch(
                    `http://localhost:${port}/${space.id}/resize/${file.id}?width=200`,
                    {
                        method: "GET",
                        headers: {connection: "close", authorization: await authorization(space)},
                    },
                );

                expect(resizeResponse.status).toEqual(200);
                expect(resizeResponse.headers.get("content-type")).toEqual("image/avif");

                const resizeBody = await resizeResponse.arrayBuffer();
                expect(await sharp(resizeBody).metadata()).toEqual({
                    format: "heif",
                    size: expect.any(Number),
                    width: 200,
                    height: 133,
                    space: "srgb",
                    channels: 3,
                    depth: "uchar",
                    isProgressive: false,
                    pages: 1,
                    pagePrimary: 0,
                    compression: "av1",
                    hasProfile: false,
                    hasAlpha: false,
                });
            }

            {
                const resizeResponse = await fetch(
                    `http://localhost:${port}/${space.id}/resize/${file.id}?width=400`,
                    {
                        method: "GET",
                        headers: {connection: "close", authorization: await authorization(space)},
                    },
                );

                expect(resizeResponse.status).toEqual(200);
                expect(resizeResponse.headers.get("content-type")).toEqual("image/avif");

                const resizeBody = await resizeResponse.arrayBuffer();
                expect(await sharp(resizeBody).metadata()).toEqual({
                    format: "heif",
                    size: expect.any(Number),
                    width: 400,
                    height: 266,
                    space: "srgb",
                    channels: 3,
                    depth: "uchar",
                    isProgressive: false,
                    pages: 1,
                    pagePrimary: 0,
                    compression: "av1",
                    hasProfile: false,
                    hasAlpha: false,
                });
            }

            {
                const resizeResponse = await fetch(
                    `http://localhost:${port}/${space.id}/resize/${file.id}?width=700`,
                    {
                        method: "GET",
                        headers: {connection: "close", authorization: await authorization(space)},
                    },
                );

                expect(resizeResponse.status).toEqual(200);
                expect(resizeResponse.headers.get("content-type")).toEqual("image/avif");

                const resizeBody = await resizeResponse.arrayBuffer();
                expect(await sharp(resizeBody).metadata()).toEqual({
                    format: "heif",
                    size: expect.any(Number),
                    width: 640,
                    height: 426,
                    space: "srgb",
                    channels: 3,
                    depth: "uchar",
                    isProgressive: false,
                    pages: 1,
                    pagePrimary: 0,
                    compression: "av1",
                    hasProfile: false,
                    hasAlpha: false,
                });
            }
        });

        test("can resize an AVIF image with transparency", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const file = await uploadFileForTest(session, {
                contentType: "image/avif",
                body: await fs.readFile(
                    joinPath(
                        runfilesPath,
                        "cyberworlds/server/files/processor/test_fixtures/wikimedia_png_transparency_demonstration.avif",
                    ),
                ),
            });

            expect(file).toEqual(
                new FileModel({
                    spaceId: space.id,
                    id: file.id,
                    contentType: "image/avif",
                    contentLength: 24923,
                    isUploading: false,
                    alternative: null,
                    preview: {
                        type: "Image",
                        isProcessing: false,
                        ok: true,
                        size: {width: 336, height: 252, scale: 1, hasAlpha: true},
                        placeholder: expect.any(FileImagePreviewPlaceholder),
                    },
                }),
            );

            {
                const resizeResponse = await fetch(
                    `http://localhost:${port}/${space.id}/resize/${file.id}?width=200`,
                    {
                        method: "GET",
                        headers: {connection: "close", authorization: await authorization(space)},
                    },
                );

                expect(resizeResponse.status).toEqual(200);
                expect(resizeResponse.headers.get("content-type")).toEqual("image/avif");

                const resizeBody = await resizeResponse.arrayBuffer();
                expect(await sharp(resizeBody).metadata()).toEqual({
                    format: "heif",
                    size: expect.any(Number),
                    width: 200,
                    height: 150,
                    space: "srgb",
                    channels: 4,
                    depth: "uchar",
                    isProgressive: false,
                    pages: 1,
                    pagePrimary: 0,
                    compression: "av1",
                    hasProfile: false,
                    hasAlpha: true,
                });
            }

            {
                const resizeResponse = await fetch(
                    `http://localhost:${port}/${space.id}/resize/${file.id}?width=400`,
                    {
                        method: "GET",
                        headers: {connection: "close", authorization: await authorization(space)},
                    },
                );

                expect(resizeResponse.status).toEqual(200);
                expect(resizeResponse.headers.get("content-type")).toEqual("image/avif");

                const resizeBody = await resizeResponse.arrayBuffer();
                expect(await sharp(resizeBody).metadata()).toEqual({
                    format: "heif",
                    size: expect.any(Number),
                    width: 336,
                    height: 252,
                    space: "srgb",
                    channels: 4,
                    depth: "uchar",
                    isProgressive: false,
                    pages: 1,
                    pagePrimary: 0,
                    compression: "av1",
                    hasProfile: false,
                    hasAlpha: true,
                });
            }
        });

        test("can resize an animated AVIF image", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const file = await uploadFileForTest(session, {
                contentType: "image/avif",
                body: await fs.readFile(
                    joinPath(
                        runfilesPath,
                        "cyberworlds/server/files/processor/test_fixtures/wikimedia_bouncing_beach_ball.avif",
                    ),
                ),
            });

            // TODO(calebmer): Support animated `.avif` files. `sharp` doesn't support animated
            // `.avif` files. So we'll need a separate image processor implementation that uses
            // FFmpeg.
            expect(file).toEqual(
                new FileModel({
                    spaceId: space.id,
                    id: file.id,
                    contentType: "image/avif",
                    contentLength: 10448,
                    isUploading: false,
                    alternative: null,
                    preview: {
                        type: "Image",
                        isProcessing: false,
                        ok: false,
                        error: {type: "Unknown"},
                        size: "Error",
                        placeholder: "Error",
                    },
                }),
            );
        });
    },
    "image/webp": () => {
        test("can resize a WEBP image without transparency", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const file = await uploadFileForTest(session, {
                contentType: "image/webp",
                body: await fs.readFile(
                    joinPath(
                        runfilesPath,
                        "cyberworlds/server/files/processor/test_fixtures/unsplash_annie_spratt_0ArJET2aSIQ.webp",
                    ),
                ),
            });

            expect(file).toEqual(
                new FileModel({
                    spaceId: space.id,
                    id: file.id,
                    contentType: "image/webp",
                    contentLength: 60260,
                    isUploading: false,
                    alternative: null,
                    preview: {
                        type: "Image",
                        isProcessing: false,
                        ok: true,
                        size: {width: 500, height: 375, scale: 1, hasAlpha: false},
                        placeholder: expect.any(FileImagePreviewPlaceholder),
                    },
                }),
            );

            {
                const resizeResponse = await fetch(
                    `http://localhost:${port}/${space.id}/resize/${file.id}?width=200`,
                    {
                        method: "GET",
                        headers: {connection: "close", authorization: await authorization(space)},
                    },
                );

                expect(resizeResponse.status).toEqual(200);
                expect(resizeResponse.headers.get("content-type")).toEqual("image/avif");

                const resizeBody = await resizeResponse.arrayBuffer();
                expect(await sharp(resizeBody).metadata()).toEqual({
                    format: "heif",
                    size: expect.any(Number),
                    width: 200,
                    height: 150,
                    space: "srgb",
                    channels: 4,
                    depth: "uchar",
                    isProgressive: false,
                    pages: 1,
                    pagePrimary: 0,
                    compression: "av1",
                    hasProfile: false,
                    hasAlpha: true,
                });
            }

            {
                const resizeResponse = await fetch(
                    `http://localhost:${port}/${space.id}/resize/${file.id}?width=400`,
                    {
                        method: "GET",
                        headers: {connection: "close", authorization: await authorization(space)},
                    },
                );

                expect(resizeResponse.status).toEqual(200);
                expect(resizeResponse.headers.get("content-type")).toEqual("image/avif");

                const resizeBody = await resizeResponse.arrayBuffer();
                expect(await sharp(resizeBody).metadata()).toEqual({
                    format: "heif",
                    size: expect.any(Number),
                    width: 400,
                    height: 300,
                    space: "srgb",
                    channels: 4,
                    depth: "uchar",
                    isProgressive: false,
                    pages: 1,
                    pagePrimary: 0,
                    compression: "av1",
                    hasProfile: false,
                    hasAlpha: true,
                });
            }

            {
                const resizeResponse = await fetch(
                    `http://localhost:${port}/${space.id}/resize/${file.id}?width=600`,
                    {
                        method: "GET",
                        headers: {connection: "close", authorization: await authorization(space)},
                    },
                );

                expect(resizeResponse.status).toEqual(200);
                expect(resizeResponse.headers.get("content-type")).toEqual("image/avif");

                const resizeBody = await resizeResponse.arrayBuffer();
                expect(await sharp(resizeBody).metadata()).toEqual({
                    format: "heif",
                    size: expect.any(Number),
                    width: 500,
                    height: 375,
                    space: "srgb",
                    channels: 4,
                    depth: "uchar",
                    isProgressive: false,
                    pages: 1,
                    pagePrimary: 0,
                    compression: "av1",
                    hasProfile: false,
                    hasAlpha: true,
                });
            }
        });

        test("can resize a WEBP image with transparency", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const file = await uploadFileForTest(session, {
                contentType: "image/webp",
                body: await fs.readFile(
                    joinPath(
                        runfilesPath,
                        "cyberworlds/server/files/processor/test_fixtures/wikimedia_png_transparency_demonstration.webp",
                    ),
                ),
            });

            expect(file).toEqual(
                new FileModel({
                    spaceId: space.id,
                    id: file.id,
                    contentType: "image/webp",
                    contentLength: 22500,
                    isUploading: false,
                    alternative: null,
                    preview: {
                        type: "Image",
                        isProcessing: false,
                        ok: true,
                        size: {width: 336, height: 252, scale: 1, hasAlpha: true},
                        placeholder: expect.any(FileImagePreviewPlaceholder),
                    },
                }),
            );

            {
                const resizeResponse = await fetch(
                    `http://localhost:${port}/${space.id}/resize/${file.id}?width=200`,
                    {
                        method: "GET",
                        headers: {connection: "close", authorization: await authorization(space)},
                    },
                );

                expect(resizeResponse.status).toEqual(200);
                expect(resizeResponse.headers.get("content-type")).toEqual("image/avif");

                const resizeBody = await resizeResponse.arrayBuffer();
                expect(await sharp(resizeBody).metadata()).toEqual({
                    format: "heif",
                    size: expect.any(Number),
                    width: 200,
                    height: 150,
                    space: "srgb",
                    channels: 4,
                    depth: "uchar",
                    isProgressive: false,
                    pages: 1,
                    pagePrimary: 0,
                    compression: "av1",
                    hasProfile: false,
                    hasAlpha: true,
                });
            }

            {
                const resizeResponse = await fetch(
                    `http://localhost:${port}/${space.id}/resize/${file.id}?width=400`,
                    {
                        method: "GET",
                        headers: {connection: "close", authorization: await authorization(space)},
                    },
                );

                expect(resizeResponse.status).toEqual(200);
                expect(resizeResponse.headers.get("content-type")).toEqual("image/avif");

                const resizeBody = await resizeResponse.arrayBuffer();
                expect(await sharp(resizeBody).metadata()).toEqual({
                    format: "heif",
                    size: expect.any(Number),
                    width: 336,
                    height: 252,
                    space: "srgb",
                    channels: 4,
                    depth: "uchar",
                    isProgressive: false,
                    pages: 1,
                    pagePrimary: 0,
                    compression: "av1",
                    hasProfile: false,
                    hasAlpha: true,
                });
            }
        });
    },
    "image/svg+xml": () => {
        test("can\u2019t resize an SVG image", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const file = await uploadFileForTest(session, {
                contentType: "image/svg+xml",
                body: await fs.readFile(
                    joinPath(
                        runfilesPath,
                        "cyberworlds/server/files/processor/test_fixtures/undraw_landscape_photographer.svg",
                    ),
                ),
            });

            expect(file).toEqual(
                new FileModel({
                    spaceId: space.id,
                    id: file.id,
                    contentType: "image/svg+xml",
                    contentLength: 4701,
                    isUploading: false,
                    alternative: null,
                    preview: {
                        type: "Image",
                        isProcessing: false,
                        ok: true,
                        size: {width: 732, height: 619, scale: 1, hasAlpha: true},
                        placeholder: expect.any(FileImagePreviewPlaceholder),
                    },
                }),
            );

            {
                const resizeResponse = await fetch(
                    `http://localhost:${port}/${space.id}/resize/${file.id}?width=200`,
                    {
                        method: "GET",
                        headers: {connection: "close", authorization: await authorization(space)},
                    },
                );

                expect(resizeResponse.status).toEqual(400);
                expect(resizeResponse.headers.get("content-type")).toEqual("text/plain");
                expect(await resizeResponse.text()).toMatch(
                    /^400 Bad Request\n\nFailedPreconditionError: Content type `image\/svg\+xml` is a vector format, resizing is pointless/,
                );
            }
        });
    },
};

for (const tests of Object.values(testsByFileWebSafeImageContentType)) {
    tests();
}

test("can resize a HEIC image\u2019s preview", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const file = await uploadFileForTest(session, {
        contentType: "image/heic",
        body: await fs.readFile(
            joinPath(
                runfilesPath,
                "cyberworlds/server/files/processor/test_fixtures/calebmer_iphone_colorado_twin_lakes.heic",
            ),
        ),
    });

    expect(file).toEqual(
        new FileModel({
            spaceId: space.id,
            id: file.id,
            contentType: "image/heif",
            contentLength: 88109,
            isUploading: false,
            alternative: {
                isProcessing: false,
                ok: true,
                contentType: "image/avif",
                contentLength: expect.any(Number),
                isImagePreviewContent: true,
            },
            preview: {
                type: "Image",
                isProcessing: false,
                ok: true,
                size: {width: 480, height: 640, scale: 1, hasAlpha: false},
                placeholder: expect.any(FileImagePreviewPlaceholder),
                content: {
                    contentType: "image/avif",
                    contentLength: expect.any(Number),
                },
            },
        }),
    );

    {
        const resizeResponse = await fetch(
            `http://localhost:${port}/${space.id}/resize/${file.id}?width=200`,
            {
                method: "GET",
                headers: {connection: "close", authorization: await authorization(space)},
            },
        );

        expect(resizeResponse.status).toEqual(400);
        expect(resizeResponse.headers.get("content-type")).toEqual("text/plain");
        expect(await resizeResponse.text()).toMatch(
            /^400 Bad Request\n\nFailedPreconditionError: Can only resize web safe image but instead got content type `image\/heif`\n/,
        );
    }

    {
        const resizeResponse = await fetch(
            `http://localhost:${port}/${space.id}/resize/${file.id}?width=200&variant=preview`,
            {
                method: "GET",
                headers: {connection: "close", authorization: await authorization(space)},
            },
        );

        expect(resizeResponse.status).toEqual(200);
        expect(resizeResponse.headers.get("content-type")).toEqual("image/avif");

        const resizeBody = await resizeResponse.arrayBuffer();
        expect(await sharp(resizeBody).metadata()).toEqual({
            format: "heif",
            size: expect.any(Number),
            width: 200,
            height: 267,
            space: "srgb",
            channels: 3,
            depth: "uchar",
            isProgressive: false,
            pages: 1,
            pagePrimary: 0,
            compression: "av1",
            hasProfile: false,
            hasAlpha: false,
        });
    }

    {
        const resizeResponse = await fetch(
            `http://localhost:${port}/${space.id}/resize/${file.id}?width=400&variant=preview`,
            {
                method: "GET",
                headers: {connection: "close", authorization: await authorization(space)},
            },
        );

        expect(resizeResponse.status).toEqual(200);
        expect(resizeResponse.headers.get("content-type")).toEqual("image/avif");

        const resizeBody = await resizeResponse.arrayBuffer();
        expect(await sharp(resizeBody).metadata()).toEqual({
            format: "heif",
            size: expect.any(Number),
            width: 400,
            height: 533,
            space: "srgb",
            channels: 3,
            depth: "uchar",
            isProgressive: false,
            pages: 1,
            pagePrimary: 0,
            compression: "av1",
            hasProfile: false,
            hasAlpha: false,
        });
    }

    {
        const resizeResponse = await fetch(
            `http://localhost:${port}/${space.id}/resize/${file.id}?width=600&variant=preview`,
            {
                method: "GET",
                headers: {connection: "close", authorization: await authorization(space)},
            },
        );

        expect(resizeResponse.status).toEqual(200);
        expect(resizeResponse.headers.get("content-type")).toEqual("image/avif");

        const resizeBody = await resizeResponse.arrayBuffer();
        expect(await sharp(resizeBody).metadata()).toEqual({
            format: "heif",
            size: expect.any(Number),
            width: 480,
            height: 640,
            space: "srgb",
            channels: 3,
            depth: "uchar",
            isProgressive: false,
            pages: 1,
            pagePrimary: 0,
            compression: "av1",
            hasProfile: false,
            hasAlpha: false,
        });
    }
});

test("will crop when resizing an image beyond our vertical aspect ratio limit", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const file = await uploadFileForTest(session, {
        contentType: "image/avif",
        body: await fs.readFile(
            joinPath(
                runfilesPath,
                "cyberworlds/server/files/processor/test_fixtures/cooksmarts_guide_to_stir_frying.avif",
            ),
        ),
    });

    expect(file).toEqual(
        new FileModel({
            spaceId: space.id,
            id: file.id,
            contentType: "image/avif",
            contentLength: 108552,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: false,
                ok: true,
                size: {width: 400, height: 4778, scale: 1, hasAlpha: true},
                placeholder: expect.any(FileImagePreviewPlaceholder),
            },
        }),
    );

    {
        const resizeResponse = await fetch(
            `http://localhost:${port}/${space.id}/resize/${file.id}?width=100`,
            {
                method: "GET",
                headers: {connection: "close", authorization: await authorization(space)},
            },
        );

        expect(resizeResponse.status).toEqual(200);
        expect(resizeResponse.headers.get("content-type")).toEqual("image/avif");

        const resizeBody = await resizeResponse.arrayBuffer();
        expect(await sharp(resizeBody).metadata()).toEqual({
            format: "heif",
            size: expect.any(Number),
            width: 100,
            height: 1195,
            space: "srgb",
            channels: 4,
            depth: "uchar",
            isProgressive: false,
            pages: 1,
            pagePrimary: 0,
            compression: "av1",
            hasProfile: false,
            hasAlpha: true,
        });
    }

    {
        const resizeResponse = await fetch(
            `http://localhost:${port}/${space.id}/resize/${file.id}?width=300`,
            {
                method: "GET",
                headers: {connection: "close", authorization: await authorization(space)},
            },
        );

        expect(resizeResponse.status).toEqual(200);
        expect(resizeResponse.headers.get("content-type")).toEqual("image/avif");

        const resizeBody = await resizeResponse.arrayBuffer();

        const actualContents = Buffer.from(resizeBody);

        const expectedPath = joinPath(
            runfilesPath,
            "cyberworlds/server/files/processor/test_fixtures/cooksmarts_guide_to_stir_frying_resized.avif",
        );

        const result = await looksSame(actualContents, expectedPath, {
            tolerance: 35,
            createDiffImage: true,
        });

        if (!result.equal) {
            const testlogsOutputDirectoryPath = joinPath(
                testlogsPath,
                "file_resize_vertical_aspect_ratio_limit",
            );

            await fs.mkdir(testlogsOutputDirectoryPath, {recursive: true});

            await runAllPromises([
                fs.copyFile(expectedPath, joinPath(testlogsOutputDirectoryPath, "expected.avif")),
                fs.writeFile(
                    joinPath(testlogsOutputDirectoryPath, "actual.avif"),
                    // TODO(calebmer, #typescript-5.9.2): Discovered after TS version upgrade, not
                    // fixing for now.
                    // @ts-expect-error
                    actualContents,
                ),
                result.diffImage.save(joinPath(testlogsOutputDirectoryPath, "diff.avif")),
            ]);

            throw new InternalError(
                "Actual resized image doesn\u2019t look like expected resized image, diff image saved to `bazel-testlogs`",
            );
        }
    }

    {
        const resizeResponse = await fetch(
            `http://localhost:${port}/${space.id}/resize/${file.id}?width=500`,
            {
                method: "GET",
                headers: {connection: "close", authorization: await authorization(space)},
            },
        );

        expect(resizeResponse.status).toEqual(200);
        expect(resizeResponse.headers.get("content-type")).toEqual("image/avif");

        const resizeBody = await resizeResponse.arrayBuffer();
        expect(await sharp(resizeBody).metadata()).toEqual({
            format: "heif",
            size: expect.any(Number),
            width: 352,
            height: 4200,
            space: "srgb",
            channels: 4,
            depth: "uchar",
            isProgressive: false,
            pages: 1,
            pagePrimary: 0,
            compression: "av1",
            hasProfile: false,
            hasAlpha: true,
        });
    }
});

test("will crop when resizing an image beyond our horizontal aspect ratio limit", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const file = await uploadFileForTest(session, {
        contentType: "image/avif",
        body: await fs.readFile(
            joinPath(
                runfilesPath,
                "cyberworlds/server/files/processor/test_fixtures/cooksmarts_guide_to_stir_frying_rotated.avif",
            ),
        ),
    });

    expect(file).toEqual(
        new FileModel({
            spaceId: space.id,
            id: file.id,
            contentType: "image/avif",
            contentLength: 140556,
            isUploading: false,
            alternative: null,
            preview: {
                type: "Image",
                isProcessing: false,
                ok: true,
                size: {width: 4778, height: 400, scale: 1, hasAlpha: true},
                placeholder: expect.any(FileImagePreviewPlaceholder),
            },
        }),
    );

    {
        const resizeResponse = await fetch(
            `http://localhost:${port}/${space.id}/resize/${file.id}?width=600`,
            {
                method: "GET",
                headers: {connection: "close", authorization: await authorization(space)},
            },
        );

        expect(resizeResponse.status).toEqual(200);
        expect(resizeResponse.headers.get("content-type")).toEqual("image/avif");

        const resizeBody = await resizeResponse.arrayBuffer();
        expect(await sharp(resizeBody).metadata()).toEqual({
            format: "heif",
            size: expect.any(Number),
            width: 600,
            height: 50,
            space: "srgb",
            channels: 4,
            depth: "uchar",
            isProgressive: false,
            pages: 1,
            pagePrimary: 0,
            compression: "av1",
            hasProfile: false,
            hasAlpha: true,
        });

        const actualContents = Buffer.from(resizeBody);

        const expectedPath = joinPath(
            runfilesPath,
            "cyberworlds/server/files/processor/test_fixtures/cooksmarts_guide_to_stir_frying_rotated_resized.avif",
        );

        const result = await looksSame(actualContents, expectedPath, {
            tolerance: 35,
            createDiffImage: true,
        });

        if (!result.equal) {
            const testlogsOutputDirectoryPath = joinPath(
                testlogsPath,
                "file_resize_horizontal_aspect_ratio_limit",
            );

            await fs.mkdir(testlogsOutputDirectoryPath, {recursive: true});

            await runAllPromises([
                fs.copyFile(expectedPath, joinPath(testlogsOutputDirectoryPath, "expected.avif")),
                fs.writeFile(
                    joinPath(testlogsOutputDirectoryPath, "actual.avif"),
                    // TODO(calebmer, #typescript-5.9.2): Discovered after TS version upgrade, not
                    // fixing for now.
                    // @ts-expect-error
                    actualContents,
                ),
                result.diffImage.save(joinPath(testlogsOutputDirectoryPath, "diff.avif")),
            ]);

            throw new InternalError(
                "Actual resized image doesn\u2019t look like expected resized image, diff image saved to `bazel-testlogs`",
            );
        }
    }

    {
        const resizeResponse = await fetch(
            `http://localhost:${port}/${space.id}/resize/${file.id}?width=800`,
            {
                method: "GET",
                headers: {connection: "close", authorization: await authorization(space)},
            },
        );

        expect(resizeResponse.status).toEqual(200);
        expect(resizeResponse.headers.get("content-type")).toEqual("image/avif");

        const resizeBody = await resizeResponse.arrayBuffer();
        expect(await sharp(resizeBody).metadata()).toEqual({
            format: "heif",
            size: expect.any(Number),
            width: 800,
            height: 67,
            space: "srgb",
            channels: 4,
            depth: "uchar",
            isProgressive: false,
            pages: 1,
            pagePrimary: 0,
            compression: "av1",
            hasProfile: false,
            hasAlpha: true,
        });
    }

    {
        const resizeResponse = await fetch(
            `http://localhost:${port}/${space.id}/resize/${file.id}?width=1200`,
            {
                method: "GET",
                headers: {connection: "close", authorization: await authorization(space)},
            },
        );

        expect(resizeResponse.status).toEqual(200);
        expect(resizeResponse.headers.get("content-type")).toEqual("image/avif");

        const resizeBody = await resizeResponse.arrayBuffer();
        expect(await sharp(resizeBody).metadata()).toEqual({
            format: "heif",
            size: expect.any(Number),
            width: 1200,
            height: 100,
            space: "srgb",
            channels: 4,
            depth: "uchar",
            isProgressive: false,
            pages: 1,
            pagePrimary: 0,
            compression: "av1",
            hasProfile: false,
            hasAlpha: true,
        });
    }
});
