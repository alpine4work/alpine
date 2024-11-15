import {R2Bucket} from "@miniflare/r2";
import {FileStorage} from "@miniflare/storage-file";
import fs from "fs/promises";
import getPort from "get-port";
import {Server} from "http";
import looksSame from "looks-same";
import {join as joinPath} from "path";
import sharp from "sharp";
import {CloudflareR2ContextModule} from "~/server/cloudflare/r2/cloudflare_r2_context_module.js";
import {MiniflareR2Client} from "~/server/cloudflare/r2/miniflare_r2_client.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createTestTokenAgents} from "~/server/dynamo/test_helpers/create_test_token_agent.js";
import {createFileUploadService} from "~/server/files/upload/file_upload_service.js";
import {ffprobeExecutablePath} from "~/server/files/upload/processors/file_video_and_audio_processor_base.js";
import {
    filesBindingName,
    filesBucketName,
} from "~/server/helpers/files_cloudflare_r2_bucket_name.js";
import {runProcess} from "~/server/helpers/node/run_process.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {InternalError, InvalidArgumentError} from "~/shared/error/error.js";
import {FileWebSafeImageContentType} from "~/shared/files/file_content_type.js";
import {FileImagePreviewPlaceholder} from "~/shared/files/file_image_preview_placeholder.js";
import {UploadFileEventSchema} from "~/shared/files/upload_file_event.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {findMapIterable} from "~/shared/helpers/iterable/find_map_iterable.js";
import {iterableFirst} from "~/shared/helpers/iterable/iterable_first.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";

const jpegTestFixturePath = joinPath(
    runfilesPath,
    "cyberworlds/server/files/upload/test_fixtures/unsplash_annie_spratt_0ArJET2aSIQ.jpeg",
);

const testlogsPath = joinPath(assertExists(process.env.TEST_UNDECLARED_OUTPUTS_DIR));

let serverTokenAgent: TokenAgent;
let tokenAgent: TokenAgent;
let port: number;
let server: Server;

const context = createTestContext();

beforeAll(async () => {
    port = await getPort();

    const r2Storage = new FileStorage(
        joinPath(context.getTemporaryDirectoryPath(), "r2", filesBindingName),
    );
    const r2Bucket = new R2Bucket(r2Storage);
    const r2ContextModule = new CloudflareR2ContextModule(
        new MiniflareR2Client({
            fileUploadServiceUrl: `http://localhost:${port}`,
            bucketByName: new Map([[filesBucketName, r2Bucket]]),
        }),
    );

    [serverTokenAgent, tokenAgent] = await createTestTokenAgents(context, [
        "FileUploadService",
        "EdgeService",
    ]);
    server = createFileUploadService(context.clone({r2: r2ContextModule}), {
        tokenAgent: serverTokenAgent,
        temporaryDirectoryPath: joinPath(context.getTemporaryDirectoryPath(), "files"),
    });

    await new Promise<void>(resolve => {
        server.listen(port, resolve);
    });
});

afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
        server.close(error => {
            if (error) reject(error);
            else resolve();
        });
    });
});

async function authorization(
    session: TestSession | TestSpace,
    authorizationTokenAgent: TokenAgent = tokenAgent,
) {
    const token = await authorizationTokenAgent.privateSide.dangerouslySignShortLivedToken(
        "FileUploadService",
        session.getTokenPayload(),
    );

    return `Bearer ${token}`;
}

function massageHeaders(headers: Headers) {
    return omitObject(Object.fromEntries(headers), [
        "connection",
        "date",
        "keep-alive",
        "transfer-encoding",
    ]);
}

function parseJsonEvents(responseText: string) {
    return responseText
        .trim()
        .split("\n")
        .map(eventString => UploadFileEventSchema.deserialize(JSON.parse(eventString)));
}

test("can't resize an image with a session actor", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const uploadResponse = await fetch(`http://localhost:${port}/${space.id}/upload`, {
        method: "POST",
        headers: {
            authorization: await authorization(session),
            "content-type": "image/jpeg",
        },
        body: await fs.readFile(jpegTestFixturePath),
    });
    const uploadResponseText = await uploadResponse.text();

    expect(uploadResponse.status).toEqual(200);
    expect(massageHeaders(uploadResponse.headers)).toEqual({
        "content-type": "application/x-ndjson",
    });
    const uploadEvents = parseJsonEvents(uploadResponseText);
    expect(uploadEvents).toEqual([
        {
            type: "Start",
            hasAlternative: false,
            hasPreview: {
                type: "Image",
                hasContent: false,
                hasVideoDuration: false,
            },
            fileId: expect.any(String),
            signedUrlSearch: "",
        },
        {type: "ImagePreviewSize", size: {width: 500, height: 375, scale: 1, hasAlpha: false}},
        {type: "ImagePreviewPlaceholder", placeholder: expect.any(FileImagePreviewPlaceholder)},
        {type: "Finish"},
    ]);

    const fileId = assertExists(
        iterableFirst(
            filterMapIterable(uploadEvents, event =>
                event.type === "Start" ? event.fileId : undefined,
            ),
        ),
    );

    const resizeResponse = await fetch(
        `http://localhost:${port}/${space.id}/resize/${fileId}?width=200`,
        {
            method: "GET",
            headers: {authorization: await authorization(session)},
        },
    );

    expect(resizeResponse.status).toEqual(400);
    expect(resizeResponse.headers.get("content-type")).toEqual("text/plain");
    expect(await resizeResponse.text()).toEqual("400 Bad Request");
});

test("can't resize an image with a token that's not from edge service", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const uploadResponse = await fetch(`http://localhost:${port}/${space.id}/upload`, {
        method: "POST",
        headers: {
            authorization: await authorization(session),
            "content-type": "image/jpeg",
        },
        body: await fs.readFile(jpegTestFixturePath),
    });
    const uploadResponseText = await uploadResponse.text();

    expect(uploadResponse.status).toEqual(200);
    expect(massageHeaders(uploadResponse.headers)).toEqual({
        "content-type": "application/x-ndjson",
    });
    const uploadEvents = parseJsonEvents(uploadResponseText);
    expect(uploadEvents).toEqual([
        {
            type: "Start",
            hasAlternative: false,
            hasPreview: {
                type: "Image",
                hasContent: false,
                hasVideoDuration: false,
            },
            fileId: expect.any(String),
            signedUrlSearch: "",
        },
        {type: "ImagePreviewSize", size: {width: 500, height: 375, scale: 1, hasAlpha: false}},
        {type: "ImagePreviewPlaceholder", placeholder: expect.any(FileImagePreviewPlaceholder)},
        {type: "Finish"},
    ]);

    const fileId = assertExists(
        iterableFirst(
            filterMapIterable(uploadEvents, event =>
                event.type === "Start" ? event.fileId : undefined,
            ),
        ),
    );

    const resizeResponse = await fetch(
        `http://localhost:${port}/${space.id}/resize/${fileId}?width=200`,
        {
            method: "GET",
            headers: {authorization: await authorization(space, serverTokenAgent)},
        },
    );

    expect(resizeResponse.status).toEqual(400);
    expect(resizeResponse.headers.get("content-type")).toEqual("text/plain");
    expect(await resizeResponse.text()).toEqual("400 Bad Request");
});

test("can't resize an image that doesn't exist", async () => {
    const space = await TestSpace.create(context);

    const resizeResponse = await fetch(
        `http://localhost:${port}/${space.id}/resize/${generateChronologicalId()}?width=200`,
        {
            method: "GET",
            headers: {authorization: await authorization(space)},
        },
    );

    expect(resizeResponse.status).toEqual(404);
    expect(resizeResponse.headers.get("content-type")).toEqual("text/plain");
    expect(await resizeResponse.text()).toEqual("404 Not Found");
});

// Use a TypeScript object map to make sure we have tests for every web safe
// image content type. If a new web safe image content type is added then we
// should add another test here.
const testsByFileWebSafeImageContentType: {[Key in FileWebSafeImageContentType]: () => void} = {
    "image/jpeg": () => {
        test("can resize a JPEG image", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const uploadResponse = await fetch(`http://localhost:${port}/${space.id}/upload`, {
                method: "POST",
                headers: {
                    authorization: await authorization(session),
                    "content-type": "image/jpeg",
                },
                body: await fs.readFile(jpegTestFixturePath),
            });
            const uploadResponseText = await uploadResponse.text();

            expect(uploadResponse.status).toEqual(200);
            expect(massageHeaders(uploadResponse.headers)).toEqual({
                "content-type": "application/x-ndjson",
            });
            const uploadEvents = parseJsonEvents(uploadResponseText);
            expect(
                uploadEvents.filter(
                    event => event.type === "Start" || event.type === "ImagePreviewSize",
                ),
            ).toEqual([
                {
                    type: "Start",
                    hasAlternative: false,
                    hasPreview: {
                        type: "Image",
                        hasContent: false,
                        hasVideoDuration: false,
                    },
                    fileId: expect.any(String),
                    signedUrlSearch: "",
                },
                {
                    type: "ImagePreviewSize",
                    size: {width: 500, height: 375, scale: 1, hasAlpha: false},
                },
            ]);

            const fileId = assertExists(
                iterableFirst(
                    filterMapIterable(uploadEvents, event =>
                        event.type === "Start" ? event.fileId : undefined,
                    ),
                ),
            );

            {
                const resizeResponse = await fetch(
                    `http://localhost:${port}/${space.id}/resize/${fileId}?width=200`,
                    {
                        method: "GET",
                        headers: {authorization: await authorization(space)},
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
                    `http://localhost:${port}/${space.id}/resize/${fileId}?width=400`,
                    {
                        method: "GET",
                        headers: {authorization: await authorization(space)},
                    },
                );

                expect(resizeResponse.status).toEqual(200);
                expect(resizeResponse.headers.get("content-type")).toEqual("image/avif");

                const resizeBody = await resizeResponse.arrayBuffer();
                expect(await sharp(resizeBody).metadata()).toEqual({
                    format: "heif",
                    size: expect.any(Number),
                    width: 400,
                    height: 299,
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
                    `http://localhost:${port}/${space.id}/resize/${fileId}?width=600`,
                    {
                        method: "GET",
                        headers: {authorization: await authorization(space)},
                    },
                );

                expect(resizeResponse.status).toEqual(200);
                expect(resizeResponse.headers.get("content-type")).toEqual("image/avif");

                const resizeBody = await resizeResponse.arrayBuffer();
                expect(await sharp(resizeBody).metadata()).toEqual({
                    format: "heif",
                    size: expect.any(Number),
                    width: 500,
                    height: 374,
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

            const uploadResponse = await fetch(`http://localhost:${port}/${space.id}/upload`, {
                method: "POST",
                headers: {
                    authorization: await authorization(session),
                    "content-type": "image/png",
                },
                body: await fs.readFile(
                    joinPath(
                        runfilesPath,
                        "cyberworlds/server/files/upload/test_fixtures/wikimedia_png_transparency_demonstration.png",
                    ),
                ),
            });
            const uploadResponseText = await uploadResponse.text();

            expect(uploadResponse.status).toEqual(200);
            expect(massageHeaders(uploadResponse.headers)).toEqual({
                "content-type": "application/x-ndjson",
            });
            const uploadEvents = parseJsonEvents(uploadResponseText);
            expect(
                uploadEvents.filter(
                    event => event.type === "Start" || event.type === "ImagePreviewSize",
                ),
            ).toEqual([
                {
                    type: "Start",
                    hasAlternative: false,
                    hasPreview: {
                        type: "Image",
                        hasContent: false,
                        hasVideoDuration: false,
                    },
                    fileId: expect.any(String),
                    signedUrlSearch: "",
                },
                {
                    type: "ImagePreviewSize",
                    size: {width: 336, height: 252, scale: 1, hasAlpha: true},
                },
            ]);

            const fileId = assertExists(
                iterableFirst(
                    filterMapIterable(uploadEvents, event =>
                        event.type === "Start" ? event.fileId : undefined,
                    ),
                ),
            );

            {
                const resizeResponse = await fetch(
                    `http://localhost:${port}/${space.id}/resize/${fileId}?width=200`,
                    {
                        method: "GET",
                        headers: {authorization: await authorization(space)},
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
                    `http://localhost:${port}/${space.id}/resize/${fileId}?width=400`,
                    {
                        method: "GET",
                        headers: {authorization: await authorization(space)},
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

            const uploadResponse = await fetch(`http://localhost:${port}/${space.id}/upload`, {
                method: "POST",
                headers: {
                    authorization: await authorization(session),
                    "content-type": "image/png",
                },
                body: await fs.readFile(
                    joinPath(
                        runfilesPath,
                        "cyberworlds/server/files/upload/test_fixtures/unsplash_annie_spratt_0ArJET2aSIQ.png",
                    ),
                ),
            });
            const uploadResponseText = await uploadResponse.text();

            expect(uploadResponse.status).toEqual(200);
            expect(massageHeaders(uploadResponse.headers)).toEqual({
                "content-type": "application/x-ndjson",
            });
            const uploadEvents = parseJsonEvents(uploadResponseText);
            expect(
                uploadEvents.filter(
                    event => event.type === "Start" || event.type === "ImagePreviewSize",
                ),
            ).toEqual([
                {
                    type: "Start",
                    hasAlternative: false,
                    hasPreview: {
                        type: "Image",
                        hasContent: false,
                        hasVideoDuration: false,
                    },
                    fileId: expect.any(String),
                    signedUrlSearch: "",
                },
                {
                    type: "ImagePreviewSize",
                    size: {width: 500, height: 375, scale: 1, hasAlpha: false},
                },
            ]);

            const fileId = assertExists(
                iterableFirst(
                    filterMapIterable(uploadEvents, event =>
                        event.type === "Start" ? event.fileId : undefined,
                    ),
                ),
            );

            {
                const resizeResponse = await fetch(
                    `http://localhost:${port}/${space.id}/resize/${fileId}?width=400`,
                    {
                        method: "GET",
                        headers: {authorization: await authorization(space)},
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
                    `http://localhost:${port}/${space.id}/resize/${fileId}?width=600`,
                    {
                        method: "GET",
                        headers: {authorization: await authorization(space)},
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

                const uploadResponse = await fetch(`http://localhost:${port}/${space.id}/upload`, {
                    method: "POST",
                    headers: {
                        authorization: await authorization(session),
                        "content-type": "image/gif",
                    },
                    body: await fs.readFile(
                        joinPath(
                            runfilesPath,
                            "cyberworlds/server/files/upload/test_fixtures/wikimedia_rotating_earth.gif",
                        ),
                    ),
                });
                const uploadResponseText = await uploadResponse.text();

                expect(uploadResponse.status).toEqual(200);
                expect(massageHeaders(uploadResponse.headers)).toEqual({
                    "content-type": "application/x-ndjson",
                });
                const uploadEvents = parseJsonEvents(uploadResponseText);
                expect(
                    uploadEvents.filter(
                        event => event.type === "Start" || event.type === "ImagePreviewSize",
                    ),
                ).toEqual([
                    {
                        type: "Start",
                        hasAlternative: false,
                        hasPreview: {
                            type: "Image",
                            hasContent: false,
                            hasVideoDuration: false,
                        },
                        fileId: expect.any(String),
                        signedUrlSearch: "",
                    },
                    {
                        type: "ImagePreviewSize",
                        size: {width: 400, height: 400, scale: 1, hasAlpha: true},
                    },
                ]);

                const fileId = assertExists(
                    iterableFirst(
                        filterMapIterable(uploadEvents, event =>
                            event.type === "Start" ? event.fileId : undefined,
                        ),
                    ),
                );

                {
                    const resizeResponse = await fetch(
                        `http://localhost:${port}/${space.id}/resize/${fileId}?width=200`,
                        {
                            method: "GET",
                            headers: {authorization: await authorization(space)},
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
                                duration: "1.980000",
                            }),
                            streams: [
                                expect.objectContaining({
                                    codec_name: "av1",
                                    codec_type: "video",
                                    width: 200,
                                    height: 200,
                                    start_time: "0.000000",
                                    avg_frame_rate: "1/1",
                                    pix_fmt: "gbrp",
                                    tags: expect.objectContaining({title: "Color"}),
                                }),
                                expect.objectContaining({
                                    codec_name: "av1",
                                    codec_type: "video",
                                    width: 200,
                                    height: 200,
                                    start_time: "0.000000",
                                    avg_frame_rate: "1/1",
                                    pix_fmt: "gray",
                                    tags: expect.objectContaining({title: "Alpha"}),
                                }),
                                expect.objectContaining({
                                    codec_name: "av1",
                                    codec_type: "video",
                                    width: 200,
                                    height: 200,
                                    start_time: "0.000000",
                                    avg_frame_rate: "50/3",
                                    pix_fmt: "gbrp",
                                }),
                                expect.objectContaining({
                                    codec_name: "av1",
                                    codec_type: "video",
                                    width: 200,
                                    height: 200,
                                    start_time: "0.000000",
                                    duration: "1.980000",
                                    avg_frame_rate: "50/3",
                                    pix_fmt: "gray",
                                }),
                            ],
                        }),
                    );
                }

                {
                    const resizeResponse = await fetch(
                        `http://localhost:${port}/${space.id}/resize/${fileId}?width=300`,
                        {
                            method: "GET",
                            headers: {authorization: await authorization(space)},
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
                                duration: "1.980000",
                            }),
                            streams: [
                                expect.objectContaining({
                                    codec_name: "av1",
                                    codec_type: "video",
                                    width: 300,
                                    height: 300,
                                    start_time: "0.000000",
                                    avg_frame_rate: "1/1",
                                    pix_fmt: "gbrp",
                                    tags: expect.objectContaining({title: "Color"}),
                                }),
                                expect.objectContaining({
                                    codec_name: "av1",
                                    codec_type: "video",
                                    width: 300,
                                    height: 300,
                                    start_time: "0.000000",
                                    avg_frame_rate: "1/1",
                                    pix_fmt: "gray",
                                    tags: expect.objectContaining({title: "Alpha"}),
                                }),
                                expect.objectContaining({
                                    codec_name: "av1",
                                    codec_type: "video",
                                    width: 300,
                                    height: 300,
                                    start_time: "0.000000",
                                    avg_frame_rate: "50/3",
                                    pix_fmt: "gbrp",
                                }),
                                expect.objectContaining({
                                    codec_name: "av1",
                                    codec_type: "video",
                                    width: 300,
                                    height: 300,
                                    start_time: "0.000000",
                                    duration: "1.980000",
                                    avg_frame_rate: "50/3",
                                    pix_fmt: "gray",
                                }),
                            ],
                        }),
                    );
                }

                {
                    const resizeResponse = await fetch(
                        `http://localhost:${port}/${space.id}/resize/${fileId}?width=600`,
                        {
                            method: "GET",
                            headers: {authorization: await authorization(space)},
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
                                duration: "1.980000",
                            }),
                            streams: [
                                expect.objectContaining({
                                    codec_name: "av1",
                                    codec_type: "video",
                                    width: 400,
                                    height: 400,
                                    start_time: "0.000000",
                                    avg_frame_rate: "1/1",
                                    pix_fmt: "gbrp",
                                    tags: expect.objectContaining({title: "Color"}),
                                }),
                                expect.objectContaining({
                                    codec_name: "av1",
                                    codec_type: "video",
                                    width: 400,
                                    height: 400,
                                    start_time: "0.000000",
                                    avg_frame_rate: "1/1",
                                    pix_fmt: "gray",
                                    tags: expect.objectContaining({title: "Alpha"}),
                                }),
                                expect.objectContaining({
                                    codec_name: "av1",
                                    codec_type: "video",
                                    width: 400,
                                    height: 400,
                                    start_time: "0.000000",
                                    avg_frame_rate: "50/3",
                                    pix_fmt: "gbrp",
                                }),
                                expect.objectContaining({
                                    codec_name: "av1",
                                    codec_type: "video",
                                    width: 400,
                                    height: 400,
                                    start_time: "0.000000",
                                    duration: "1.980000",
                                    avg_frame_rate: "50/3",
                                    pix_fmt: "gray",
                                }),
                            ],
                        }),
                    );
                }
            },
            // For some reason, this test can take a while compared to other tests in
            // this file.
            30 * 1000,
        );

        test("can resize a GIF image without transparency", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const uploadResponse = await fetch(`http://localhost:${port}/${space.id}/upload`, {
                method: "POST",
                headers: {
                    authorization: await authorization(session),
                    "content-type": "image/gif",
                },
                body: await fs.readFile(
                    joinPath(
                        runfilesPath,
                        "cyberworlds/server/files/upload/test_fixtures/unsplash_annie_spratt_0ArJET2aSIQ.gif",
                    ),
                ),
            });
            const uploadResponseText = await uploadResponse.text();

            expect(uploadResponse.status).toEqual(200);
            expect(massageHeaders(uploadResponse.headers)).toEqual({
                "content-type": "application/x-ndjson",
            });
            const uploadEvents = parseJsonEvents(uploadResponseText);
            expect(
                uploadEvents.filter(
                    event => event.type === "Start" || event.type === "ImagePreviewSize",
                ),
            ).toEqual([
                {
                    type: "Start",
                    hasAlternative: false,
                    hasPreview: {
                        type: "Image",
                        hasContent: false,
                        hasVideoDuration: false,
                    },
                    fileId: expect.any(String),
                    signedUrlSearch: "",
                },
                {
                    type: "ImagePreviewSize",
                    size: {width: 500, height: 375, scale: 1, hasAlpha: true},
                },
            ]);

            const fileId = assertExists(
                iterableFirst(
                    filterMapIterable(uploadEvents, event =>
                        event.type === "Start" ? event.fileId : undefined,
                    ),
                ),
            );

            {
                const resizeResponse = await fetch(
                    `http://localhost:${port}/${space.id}/resize/${fileId}?width=400`,
                    {
                        method: "GET",
                        headers: {authorization: await authorization(space)},
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
                            duration: "0.100000",
                        }),
                        streams: [
                            expect.objectContaining({
                                codec_name: "av1",
                                codec_type: "video",
                                width: 400,
                                height: 300,
                                start_time: "0.000000",
                                avg_frame_rate: "1/1",
                                pix_fmt: "gbrp",
                                tags: expect.objectContaining({title: "Color"}),
                            }),
                            expect.objectContaining({
                                codec_name: "av1",
                                codec_type: "video",
                                width: 400,
                                height: 300,
                                start_time: "0.000000",
                                avg_frame_rate: "1/1",
                                tags: expect.objectContaining({title: "Alpha"}),
                            }),
                            expect.objectContaining({
                                codec_name: "av1",
                                codec_type: "video",
                                width: 400,
                                height: 300,
                                start_time: "0.000000",
                                avg_frame_rate: "100/1",
                            }),
                            expect.objectContaining({
                                codec_name: "av1",
                                codec_type: "video",
                                width: 400,
                                height: 300,
                                start_time: "0.000000",
                                duration: "0.100000",
                                avg_frame_rate: "100/1",
                            }),
                        ],
                    }),
                );
            }

            {
                const resizeResponse = await fetch(
                    `http://localhost:${port}/${space.id}/resize/${fileId}?width=600`,
                    {
                        method: "GET",
                        headers: {authorization: await authorization(space)},
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
                            duration: "0.100000",
                        }),
                        streams: [
                            expect.objectContaining({
                                codec_name: "av1",
                                codec_type: "video",
                                width: 500,
                                height: 375,
                                start_time: "0.000000",
                                avg_frame_rate: "1/1",
                                pix_fmt: "gbrp",
                                tags: expect.objectContaining({title: "Color"}),
                            }),
                            expect.objectContaining({
                                codec_name: "av1",
                                codec_type: "video",
                                width: 500,
                                height: 375,
                                start_time: "0.000000",
                                avg_frame_rate: "1/1",
                                tags: expect.objectContaining({title: "Alpha"}),
                            }),
                            expect.objectContaining({
                                codec_name: "av1",
                                codec_type: "video",
                                width: 500,
                                height: 375,
                                start_time: "0.000000",
                                avg_frame_rate: "100/1",
                            }),
                            expect.objectContaining({
                                codec_name: "av1",
                                codec_type: "video",
                                width: 500,
                                height: 375,
                                start_time: "0.000000",
                                duration: "0.100000",
                                avg_frame_rate: "100/1",
                            }),
                        ],
                    }),
                );
            }
        });
    },
    "image/apng": () => {
        test("can resize an APNG image", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const uploadResponse = await fetch(`http://localhost:${port}/${space.id}/upload`, {
                method: "POST",
                headers: {
                    authorization: await authorization(session),
                    "content-type": "image/apng",
                },
                body: await fs.readFile(
                    joinPath(
                        runfilesPath,
                        "cyberworlds/server/files/upload/test_fixtures/wikimedia_bouncing_beach_ball.png",
                    ),
                ),
            });
            const uploadResponseText = await uploadResponse.text();

            expect(uploadResponse.status).toEqual(200);
            expect(massageHeaders(uploadResponse.headers)).toEqual({
                "content-type": "application/x-ndjson",
            });
            const uploadEvents = parseJsonEvents(uploadResponseText);
            expect(
                uploadEvents.filter(
                    event => event.type === "Start" || event.type === "ImagePreviewSize",
                ),
            ).toEqual([
                {
                    type: "Start",
                    hasAlternative: false,
                    hasPreview: {
                        type: "Image",
                        hasContent: false,
                        hasVideoDuration: false,
                    },
                    fileId: expect.any(String),
                    signedUrlSearch: "",
                },
                {
                    type: "ImagePreviewSize",
                    size: {width: 100, height: 100, scale: 1, hasAlpha: true},
                },
            ]);

            const fileId = assertExists(
                iterableFirst(
                    filterMapIterable(uploadEvents, event =>
                        event.type === "Start" ? event.fileId : undefined,
                    ),
                ),
            );

            {
                const resizeResponse = await fetch(
                    `http://localhost:${port}/${space.id}/resize/${fileId}?width=40`,
                    {
                        method: "GET",
                        headers: {authorization: await authorization(space)},
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
                    `http://localhost:${port}/${space.id}/resize/${fileId}?width=80`,
                    {
                        method: "GET",
                        headers: {authorization: await authorization(space)},
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
                    `http://localhost:${port}/${space.id}/resize/${fileId}?width=120`,
                    {
                        method: "GET",
                        headers: {authorization: await authorization(space)},
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

            const uploadResponse = await fetch(`http://localhost:${port}/${space.id}/upload`, {
                method: "POST",
                headers: {
                    authorization: await authorization(session),
                    "content-type": "image/avif",
                },
                body: await fs.readFile(
                    joinPath(
                        runfilesPath,
                        "cyberworlds/server/files/upload/test_fixtures/filesampleshub_heif_sample1.avif",
                    ),
                ),
            });
            const uploadResponseText = await uploadResponse.text();

            expect(uploadResponse.status).toEqual(200);
            expect(massageHeaders(uploadResponse.headers)).toEqual({
                "content-type": "application/x-ndjson",
            });
            const uploadEvents = parseJsonEvents(uploadResponseText);
            expect(
                uploadEvents.filter(
                    event => event.type === "Start" || event.type === "ImagePreviewSize",
                ),
            ).toEqual([
                {
                    type: "Start",
                    hasAlternative: false,
                    hasPreview: {
                        type: "Image",
                        hasContent: false,
                        hasVideoDuration: false,
                    },
                    fileId: expect.any(String),
                    signedUrlSearch: "",
                },
                {
                    type: "ImagePreviewSize",
                    size: {width: 640, height: 426, scale: 1, hasAlpha: false},
                },
            ]);

            const fileId = assertExists(
                iterableFirst(
                    filterMapIterable(uploadEvents, event =>
                        event.type === "Start" ? event.fileId : undefined,
                    ),
                ),
            );

            {
                const resizeResponse = await fetch(
                    `http://localhost:${port}/${space.id}/resize/${fileId}?width=200`,
                    {
                        method: "GET",
                        headers: {authorization: await authorization(space)},
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
                    `http://localhost:${port}/${space.id}/resize/${fileId}?width=400`,
                    {
                        method: "GET",
                        headers: {authorization: await authorization(space)},
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
                    `http://localhost:${port}/${space.id}/resize/${fileId}?width=700`,
                    {
                        method: "GET",
                        headers: {authorization: await authorization(space)},
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

            const uploadResponse = await fetch(`http://localhost:${port}/${space.id}/upload`, {
                method: "POST",
                headers: {
                    authorization: await authorization(session),
                    "content-type": "image/avif",
                },
                body: await fs.readFile(
                    joinPath(
                        runfilesPath,
                        "cyberworlds/server/files/upload/test_fixtures/wikimedia_png_transparency_demonstration.avif",
                    ),
                ),
            });
            const uploadResponseText = await uploadResponse.text();

            expect(uploadResponse.status).toEqual(200);
            expect(massageHeaders(uploadResponse.headers)).toEqual({
                "content-type": "application/x-ndjson",
            });
            const uploadEvents = parseJsonEvents(uploadResponseText);
            expect(
                uploadEvents.filter(
                    event => event.type === "Start" || event.type === "ImagePreviewSize",
                ),
            ).toEqual([
                {
                    type: "Start",
                    hasAlternative: false,
                    hasPreview: {
                        type: "Image",
                        hasContent: false,
                        hasVideoDuration: false,
                    },
                    fileId: expect.any(String),
                    signedUrlSearch: "",
                },
                {
                    type: "ImagePreviewSize",
                    size: {width: 336, height: 252, scale: 1, hasAlpha: true},
                },
            ]);

            const fileId = assertExists(
                iterableFirst(
                    filterMapIterable(uploadEvents, event =>
                        event.type === "Start" ? event.fileId : undefined,
                    ),
                ),
            );

            {
                const resizeResponse = await fetch(
                    `http://localhost:${port}/${space.id}/resize/${fileId}?width=200`,
                    {
                        method: "GET",
                        headers: {authorization: await authorization(space)},
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
                    `http://localhost:${port}/${space.id}/resize/${fileId}?width=400`,
                    {
                        method: "GET",
                        headers: {authorization: await authorization(space)},
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

            const uploadResponse = await fetch(`http://localhost:${port}/${space.id}/upload`, {
                method: "POST",
                headers: {
                    authorization: await authorization(session),
                    "content-type": "image/avif",
                },
                body: await fs.readFile(
                    joinPath(
                        runfilesPath,
                        "cyberworlds/server/files/upload/test_fixtures/wikimedia_bouncing_beach_ball.avif",
                    ),
                ),
            });
            const uploadResponseText = await uploadResponse.text();

            expect(uploadResponse.status).toEqual(200);
            expect(massageHeaders(uploadResponse.headers)).toEqual({
                "content-type": "application/x-ndjson",
            });
            const uploadEvents = parseJsonEvents(uploadResponseText);

            // TODO(calebmer): Support animated `.avif` files. `sharp` doesn't support
            // animated `.avif` files. So we'll need a separate image processor
            // implementation that uses FFmpeg.
            expect(
                findMapIterable(uploadEvents, event =>
                    event.type === "Error" ? event.error : undefined,
                ),
            ).toEqual(new InvalidArgumentError("Input buffer contains unsupported image format"));
        });
    },
    "image/webp": () => {
        test("can resize a WEBP image without transparency", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const uploadResponse = await fetch(`http://localhost:${port}/${space.id}/upload`, {
                method: "POST",
                headers: {
                    authorization: await authorization(session),
                    "content-type": "image/webp",
                },
                body: await fs.readFile(
                    joinPath(
                        runfilesPath,
                        "cyberworlds/server/files/upload/test_fixtures/unsplash_annie_spratt_0ArJET2aSIQ.webp",
                    ),
                ),
            });
            const uploadResponseText = await uploadResponse.text();

            expect(uploadResponse.status).toEqual(200);
            expect(massageHeaders(uploadResponse.headers)).toEqual({
                "content-type": "application/x-ndjson",
            });
            const uploadEvents = parseJsonEvents(uploadResponseText);
            expect(
                uploadEvents.filter(
                    event => event.type === "Start" || event.type === "ImagePreviewSize",
                ),
            ).toEqual([
                {
                    type: "Start",
                    hasAlternative: false,
                    hasPreview: {
                        type: "Image",
                        hasContent: false,
                        hasVideoDuration: false,
                    },
                    fileId: expect.any(String),
                    signedUrlSearch: "",
                },
                {
                    type: "ImagePreviewSize",
                    size: {width: 500, height: 375, scale: 1, hasAlpha: false},
                },
            ]);

            const fileId = assertExists(
                iterableFirst(
                    filterMapIterable(uploadEvents, event =>
                        event.type === "Start" ? event.fileId : undefined,
                    ),
                ),
            );

            {
                const resizeResponse = await fetch(
                    `http://localhost:${port}/${space.id}/resize/${fileId}?width=200`,
                    {
                        method: "GET",
                        headers: {authorization: await authorization(space)},
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
                    `http://localhost:${port}/${space.id}/resize/${fileId}?width=400`,
                    {
                        method: "GET",
                        headers: {authorization: await authorization(space)},
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
                    `http://localhost:${port}/${space.id}/resize/${fileId}?width=600`,
                    {
                        method: "GET",
                        headers: {authorization: await authorization(space)},
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

            const uploadResponse = await fetch(`http://localhost:${port}/${space.id}/upload`, {
                method: "POST",
                headers: {
                    authorization: await authorization(session),
                    "content-type": "image/webp",
                },
                body: await fs.readFile(
                    joinPath(
                        runfilesPath,
                        "cyberworlds/server/files/upload/test_fixtures/wikimedia_png_transparency_demonstration.webp",
                    ),
                ),
            });
            const uploadResponseText = await uploadResponse.text();

            expect(uploadResponse.status).toEqual(200);
            expect(massageHeaders(uploadResponse.headers)).toEqual({
                "content-type": "application/x-ndjson",
            });
            const uploadEvents = parseJsonEvents(uploadResponseText);
            expect(
                uploadEvents.filter(
                    event => event.type === "Start" || event.type === "ImagePreviewSize",
                ),
            ).toEqual([
                {
                    type: "Start",
                    hasAlternative: false,
                    hasPreview: {
                        type: "Image",
                        hasContent: false,
                        hasVideoDuration: false,
                    },
                    fileId: expect.any(String),
                    signedUrlSearch: "",
                },
                {
                    type: "ImagePreviewSize",
                    size: {width: 336, height: 252, scale: 1, hasAlpha: true},
                },
            ]);

            const fileId = assertExists(
                iterableFirst(
                    filterMapIterable(uploadEvents, event =>
                        event.type === "Start" ? event.fileId : undefined,
                    ),
                ),
            );

            {
                const resizeResponse = await fetch(
                    `http://localhost:${port}/${space.id}/resize/${fileId}?width=200`,
                    {
                        method: "GET",
                        headers: {authorization: await authorization(space)},
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
                    `http://localhost:${port}/${space.id}/resize/${fileId}?width=400`,
                    {
                        method: "GET",
                        headers: {authorization: await authorization(space)},
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
        test("can't resize an SVG image", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const uploadResponse = await fetch(`http://localhost:${port}/${space.id}/upload`, {
                method: "POST",
                headers: {
                    authorization: await authorization(session),
                    "content-type": "image/svg+xml",
                },
                body: await fs.readFile(
                    joinPath(
                        runfilesPath,
                        "cyberworlds/server/files/upload/test_fixtures/undraw_landscape_photographer.svg",
                    ),
                ),
            });
            const uploadResponseText = await uploadResponse.text();

            expect(uploadResponse.status).toEqual(200);
            expect(massageHeaders(uploadResponse.headers)).toEqual({
                "content-type": "application/x-ndjson",
            });
            const uploadEvents = parseJsonEvents(uploadResponseText);
            expect(
                uploadEvents.filter(
                    event => event.type === "Start" || event.type === "ImagePreviewSize",
                ),
            ).toEqual([
                {
                    type: "Start",
                    hasAlternative: false,
                    hasPreview: {
                        type: "Image",
                        hasContent: false,
                        hasVideoDuration: false,
                    },
                    fileId: expect.any(String),
                    signedUrlSearch: "",
                },
                {
                    type: "ImagePreviewSize",
                    size: {width: 732, height: 619, scale: 1, hasAlpha: true},
                },
            ]);

            const fileId = assertExists(
                iterableFirst(
                    filterMapIterable(uploadEvents, event =>
                        event.type === "Start" ? event.fileId : undefined,
                    ),
                ),
            );

            {
                const resizeResponse = await fetch(
                    `http://localhost:${port}/${space.id}/resize/${fileId}?width=200`,
                    {
                        method: "GET",
                        headers: {authorization: await authorization(space)},
                    },
                );

                expect(resizeResponse.status).toEqual(400);
                expect(resizeResponse.headers.get("content-type")).toEqual("text/plain");
                expect(await resizeResponse.text()).toEqual("400 Bad Request");
            }
        });
    },
};

for (const tests of Object.values(testsByFileWebSafeImageContentType)) {
    tests();
}

test("can resize a HEIC image's preview", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const uploadResponse = await fetch(`http://localhost:${port}/${space.id}/upload`, {
        method: "POST",
        headers: {
            authorization: await authorization(session),
            "content-type": "image/heic",
        },
        body: await fs.readFile(
            joinPath(
                runfilesPath,
                "cyberworlds/server/files/upload/test_fixtures/iphone_calebmer_colorado_twin_lakes.heic",
            ),
        ),
    });
    const uploadResponseText = await uploadResponse.text();

    expect(uploadResponse.status).toEqual(200);
    expect(massageHeaders(uploadResponse.headers)).toEqual({
        "content-type": "application/x-ndjson",
    });
    const uploadEvents = parseJsonEvents(uploadResponseText);
    expect(
        uploadEvents.filter(event => event.type === "Start" || event.type === "ImagePreviewSize"),
    ).toEqual([
        {
            type: "Start",
            hasAlternative: true,
            hasPreview: {
                type: "Image",
                hasContent: true,
                hasVideoDuration: false,
            },
            fileId: expect.any(String),
            signedUrlSearch: "",
        },
        {type: "ImagePreviewSize", size: {width: 480, height: 640, scale: 1, hasAlpha: false}},
    ]);

    const fileId = assertExists(
        iterableFirst(
            filterMapIterable(uploadEvents, event =>
                event.type === "Start" ? event.fileId : undefined,
            ),
        ),
    );

    {
        const resizeResponse = await fetch(
            `http://localhost:${port}/${space.id}/resize/${fileId}?width=200`,
            {
                method: "GET",
                headers: {authorization: await authorization(space)},
            },
        );

        expect(resizeResponse.status).toEqual(400);
        expect(resizeResponse.headers.get("content-type")).toEqual("text/plain");
        expect(await resizeResponse.text()).toEqual("400 Bad Request");
    }

    {
        const resizeResponse = await fetch(
            `http://localhost:${port}/${space.id}/resize/${fileId}?width=200&variant=preview`,
            {
                method: "GET",
                headers: {authorization: await authorization(space)},
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
            `http://localhost:${port}/${space.id}/resize/${fileId}?width=400&variant=preview`,
            {
                method: "GET",
                headers: {authorization: await authorization(space)},
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
            `http://localhost:${port}/${space.id}/resize/${fileId}?width=600&variant=preview`,
            {
                method: "GET",
                headers: {authorization: await authorization(space)},
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

    const uploadResponse = await fetch(`http://localhost:${port}/${space.id}/upload`, {
        method: "POST",
        headers: {
            authorization: await authorization(session),
            "content-type": "image/avif",
        },
        body: await fs.readFile(
            joinPath(
                runfilesPath,
                "cyberworlds/server/files/upload/test_fixtures/cooksmarts_guide_to_stir_frying.avif",
            ),
        ),
    });
    const uploadResponseText = await uploadResponse.text();

    expect(uploadResponse.status).toEqual(200);
    expect(massageHeaders(uploadResponse.headers)).toEqual({
        "content-type": "application/x-ndjson",
    });
    const uploadEvents = parseJsonEvents(uploadResponseText);
    expect(
        uploadEvents.filter(event => event.type === "Start" || event.type === "ImagePreviewSize"),
    ).toEqual([
        {
            type: "Start",
            hasAlternative: false,
            hasPreview: {
                type: "Image",
                hasContent: false,
                hasVideoDuration: false,
            },
            fileId: expect.any(String),
            signedUrlSearch: "",
        },
        {type: "ImagePreviewSize", size: {width: 400, height: 4778, scale: 1, hasAlpha: true}},
    ]);

    const fileId = assertExists(
        iterableFirst(
            filterMapIterable(uploadEvents, event =>
                event.type === "Start" ? event.fileId : undefined,
            ),
        ),
    );

    {
        const resizeResponse = await fetch(
            `http://localhost:${port}/${space.id}/resize/${fileId}?width=100`,
            {
                method: "GET",
                headers: {authorization: await authorization(space)},
            },
        );

        expect(resizeResponse.status).toEqual(200);
        expect(resizeResponse.headers.get("content-type")).toEqual("image/avif");

        const resizeBody = await resizeResponse.arrayBuffer();
        expect(await sharp(resizeBody).metadata()).toEqual({
            format: "heif",
            size: expect.any(Number),
            width: 100,
            height: 238,
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
            `http://localhost:${port}/${space.id}/resize/${fileId}?width=300`,
            {
                method: "GET",
                headers: {authorization: await authorization(space)},
            },
        );

        expect(resizeResponse.status).toEqual(200);
        expect(resizeResponse.headers.get("content-type")).toEqual("image/avif");

        const resizeBody = await resizeResponse.arrayBuffer();

        const actualContents = Buffer.from(resizeBody);

        const expectedPath = joinPath(
            runfilesPath,
            "cyberworlds/server/files/upload/test_fixtures/cooksmarts_guide_to_stir_frying_cropped.avif",
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
                fs.writeFile(joinPath(testlogsOutputDirectoryPath, "actual.avif"), actualContents),
                result.diffImage.save(joinPath(testlogsOutputDirectoryPath, "diff.avif")),
            ]);

            throw new InternalError(
                "Actual resized image doesn't look like expected resized image, diff image saved to `bazel-testlogs`",
            );
        }
    }

    {
        const resizeResponse = await fetch(
            `http://localhost:${port}/${space.id}/resize/${fileId}?width=500`,
            {
                method: "GET",
                headers: {authorization: await authorization(space)},
            },
        );

        expect(resizeResponse.status).toEqual(200);
        expect(resizeResponse.headers.get("content-type")).toEqual("image/avif");

        const resizeBody = await resizeResponse.arrayBuffer();
        expect(await sharp(resizeBody).metadata()).toEqual({
            format: "heif",
            size: expect.any(Number),
            width: 400,
            height: 952,
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

    const uploadResponse = await fetch(`http://localhost:${port}/${space.id}/upload`, {
        method: "POST",
        headers: {
            authorization: await authorization(session),
            "content-type": "image/avif",
        },
        body: await fs.readFile(
            joinPath(
                runfilesPath,
                "cyberworlds/server/files/upload/test_fixtures/cooksmarts_guide_to_stir_frying_rotated.avif",
            ),
        ),
    });
    const uploadResponseText = await uploadResponse.text();

    expect(uploadResponse.status).toEqual(200);
    expect(massageHeaders(uploadResponse.headers)).toEqual({
        "content-type": "application/x-ndjson",
    });
    const uploadEvents = parseJsonEvents(uploadResponseText);
    expect(
        uploadEvents.filter(event => event.type === "Start" || event.type === "ImagePreviewSize"),
    ).toEqual([
        {
            type: "Start",
            hasAlternative: false,
            hasPreview: {
                type: "Image",
                hasContent: false,
                hasVideoDuration: false,
            },
            fileId: expect.any(String),
            signedUrlSearch: "",
        },
        {type: "ImagePreviewSize", size: {width: 4778, height: 400, scale: 1, hasAlpha: true}},
    ]);

    const fileId = assertExists(
        iterableFirst(
            filterMapIterable(uploadEvents, event =>
                event.type === "Start" ? event.fileId : undefined,
            ),
        ),
    );

    {
        const resizeResponse = await fetch(
            `http://localhost:${port}/${space.id}/resize/${fileId}?width=600`,
            {
                method: "GET",
                headers: {authorization: await authorization(space)},
            },
        );

        expect(resizeResponse.status).toEqual(200);
        expect(resizeResponse.headers.get("content-type")).toEqual("image/avif");

        const resizeBody = await resizeResponse.arrayBuffer();
        expect(await sharp(resizeBody).metadata()).toEqual({
            format: "heif",
            size: expect.any(Number),
            width: 600,
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

        const actualContents = Buffer.from(resizeBody);

        const expectedPath = joinPath(
            runfilesPath,
            "cyberworlds/server/files/upload/test_fixtures/cooksmarts_guide_to_stir_frying_rotated_cropped.avif",
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
                fs.writeFile(joinPath(testlogsOutputDirectoryPath, "actual.avif"), actualContents),
                result.diffImage.save(joinPath(testlogsOutputDirectoryPath, "diff.avif")),
            ]);

            throw new InternalError(
                "Actual resized image doesn't look like expected resized image, diff image saved to `bazel-testlogs`",
            );
        }
    }

    {
        const resizeResponse = await fetch(
            `http://localhost:${port}/${space.id}/resize/${fileId}?width=800`,
            {
                method: "GET",
                headers: {authorization: await authorization(space)},
            },
        );

        expect(resizeResponse.status).toEqual(200);
        expect(resizeResponse.headers.get("content-type")).toEqual("image/avif");

        const resizeBody = await resizeResponse.arrayBuffer();
        expect(await sharp(resizeBody).metadata()).toEqual({
            format: "heif",
            size: expect.any(Number),
            width: 800,
            height: 336,
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
            `http://localhost:${port}/${space.id}/resize/${fileId}?width=1200`,
            {
                method: "GET",
                headers: {authorization: await authorization(space)},
            },
        );

        expect(resizeResponse.status).toEqual(200);
        expect(resizeResponse.headers.get("content-type")).toEqual("image/avif");

        const resizeBody = await resizeResponse.arrayBuffer();
        expect(await sharp(resizeBody).metadata()).toEqual({
            format: "heif",
            size: expect.any(Number),
            width: 952,
            height: 400,
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
