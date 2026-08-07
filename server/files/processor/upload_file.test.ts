import {R2Bucket} from "@miniflare/r2";
import {FileStorage} from "@miniflare/storage-file";
import fsSync from "fs";
import fs from "fs/promises";
import getPort from "get-port";
import net from "net";
import {join as joinPath} from "path";
import {CloudflareR2ContextModule} from "~/server/cloudflare/r2/cloudflare_r2_context_module.js";
import {MiniflareR2Client} from "~/server/cloudflare/r2/miniflare_r2_client.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createTestTokenAgents} from "~/server/dynamo/test_helpers/create_test_token_agent.js";
import {uploadFile} from "~/server/edge/upload_file.js";
import {getFileAsUploader} from "~/server/files/data/files_actions.js";
import {processFile} from "~/server/files/processor/process_file.js";
import {TestUploadFileRpcContextModule} from "~/server/files/processor/test_helpers/test_upload_file_rpc_context_module.js";
import {
    filesBindingName,
    filesBucketName,
} from "~/server/helpers/files_cloudflare_r2_bucket_name.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {LanguageModelsNoopDevelopmentContextModule} from "~/server/language_models/language_models_noop_development_context_module.js";
import {
    LanguageModelsGenerateObjectOptions,
    LanguageModelsGenerateObjectResult,
} from "~/server/language_models/language_models_types.js";
import {createStandardizedServer} from "~/server/node/create_standardized_server.js";
import {ShutdownManager} from "~/server/node/shutdown_manager.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {
    FailedPreconditionError,
    InvalidArgumentError,
    NotFoundError,
    PermissionDeniedError,
} from "~/shared/error/error.open_source.js";
import {FileImagePreviewPlaceholder} from "~/shared/files/file_image_preview_placeholder.js";
import {FileModel} from "~/shared/files/file_model.js";
import {UploadFileResponseSchema} from "~/shared/files/upload_file_protocol.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {isObject} from "~/shared/helpers/object/is_object.open_source.js";
import {omitObject} from "~/shared/helpers/object/omit_object.open_source.js";
import {
    generateChronologicalId,
    generateChronologicalIdWithTime,
} from "~/shared/id/chronological_id.open_source.js";
import {assertId, isId} from "~/shared/id/id.open_source.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {waitForExpect} from "~/shared/test_helpers/wait_for_expect.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const jpegTestFixturePath = joinPath(
    runfilesPath,
    "cyberworlds/server/files/processor/test_fixtures/unsplash_annie_spratt_0ArJET2aSIQ.jpeg",
);

const testUploadFileAnalysisResult = {tags: ["upload test"]};

const {shutdownManager, shutdown} = ShutdownManager.new({
    tracer: testTracer,
    isClusterPrimary: true,
    flushTracer: async () => {},
});

let r2Client: MiniflareR2Client;
let appTokenAgent: TokenAgent;
let edgeTokenAgent: TokenAgent;
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
                actionContext.clone({
                    r2: new CloudflareR2ContextModule(r2Client),
                    languageModels: new TestUploadFileLanguageModelsContextModule(),
                }),
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

    const server = createStandardizedServer<
        {type: "Upload"; spaceId: SpaceId} | {type: "NotFound"}
    >(
        testTracer,
        shutdownManager,
        url => {
            const pathnameParts = url.pathname.slice(1).split("/");

            if (pathnameParts[0] && isId<SpaceId>(pathnameParts[0])) {
                const spaceId = pathnameParts[0];

                if (pathnameParts.length === 2 && pathnameParts[1] === "upload") {
                    return ["/:spaceId/upload", {type: "Upload", spaceId}];
                }
            }

            return ["/*", {type: "NotFound"}];
        },
        async (request, url, route, span) => {
            switch (route.type) {
                case "NotFound": {
                    return new Response("404 Not Found", {
                        status: 404,
                        headers: {connection: "close", "content-type": "text/plain"},
                    });
                }
                case "Upload": {
                    return uploadFile(
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

class TestUploadFileLanguageModelsContextModule extends LanguageModelsNoopDevelopmentContextModule {
    override async generateObject<ObjectType>(
        options: LanguageModelsGenerateObjectOptions<ObjectType>,
    ): Promise<LanguageModelsGenerateObjectResult<ObjectType>> {
        return {
            object: options.schema.deserialize(testUploadFileAnalysisResult as never),
            text: JSON.stringify(testUploadFileAnalysisResult),
        };
    }

    override fork(): TestUploadFileLanguageModelsContextModule {
        return new TestUploadFileLanguageModelsContextModule();
    }
}

function massageHeaders(headers: Headers) {
    return omitObject(Object.fromEntries(headers), [
        "connection",
        "date",
        "keep-alive",
        "transfer-encoding",
    ]);
}

test("404 response for unknown routes", async () => {
    {
        const response = await fetch(`http://localhost:${port}/unknown`);
        const responseText = await response.text();

        expect(response.status).toEqual(404);
        expect(massageHeaders(response.headers)).toEqual({"content-type": "text/plain"});
        expect(responseText).toEqual("404 Not Found");
    }

    {
        const response = await fetch(`http://localhost:${port}/upload`);
        const responseText = await response.text();

        expect(response.status).toEqual(404);
        expect(massageHeaders(response.headers)).toEqual({"content-type": "text/plain"});
        expect(responseText).toEqual("404 Not Found");
    }

    {
        const response = await fetch(
            `http://localhost:${port}/${generateChronologicalId()}/upload/unknown`,
        );
        const responseText = await response.text();

        expect(response.status).toEqual(404);
        expect(massageHeaders(response.headers)).toEqual({"content-type": "text/plain"});
        expect(responseText).toEqual("404 Not Found");
    }
});

test("must provide an Authorization header to upload route", async () => {
    const space = await TestSpace.create(context);

    const response = await fetch(`http://localhost:${port}/${space.id}/upload`, {
        method: "POST",
        headers: {connection: "close", "content-type": "image/jpeg"},
        body: new Uint8Array(100),
    });
    const responseBody = UploadFileResponseSchema.deserialize(await response.json());

    expect(response.status).toEqual(400);
    expect(massageHeaders(response.headers)).toEqual({
        "content-type": "application/json",
    });
    expect(responseBody).toEqual({
        ok: false,
        error: new PermissionDeniedError("Unauthenticated session"),
    });
});

test("must use session with upload route", async () => {
    const space = await TestSpace.create(context);

    const response = await fetch(`http://localhost:${port}/${space.id}/upload`, {
        method: "POST",
        headers: {
            connection: "close",
            cookie: await sessionCookie(space),
            "content-type": "image/jpeg",
        },
        body: new Uint8Array(100),
    });
    const responseBody = UploadFileResponseSchema.deserialize(await response.json());

    expect(response.status).toEqual(400);
    expect(massageHeaders(response.headers)).toEqual({
        "content-type": "application/json",
    });
    expect(responseBody).toEqual({
        ok: false,
        error: new PermissionDeniedError("Unexpected token payload type in session cookie"),
    });
});

test("must be authorized to access space to upload", async () => {
    const otherSpace = await TestSpace.create(context);
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const response = await fetch(`http://localhost:${port}/${otherSpace.id}/upload`, {
        method: "POST",
        headers: {
            connection: "close",
            cookie: await sessionCookie(session),
            "content-type": "image/jpeg",
        },
        body: new Uint8Array(100),
    });
    const responseBody = UploadFileResponseSchema.deserialize(await response.json());

    expect(response.status).toEqual(400);
    expect(massageHeaders(response.headers)).toEqual({
        "content-type": "application/json",
    });
    expect(responseBody).toEqual({
        ok: false,
        error: new PermissionDeniedError("Account doesn\u2019t have access to space"),
    });
});

test("must use POST method to upload route", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const response = await fetch(`http://localhost:${port}/${space.id}/upload`, {
        method: "GET",
        headers: {
            connection: "close",
            cookie: await sessionCookie(session),
            "content-type": "image/jpeg",
        },
    });
    const responseBody = UploadFileResponseSchema.deserialize(await response.json());

    expect(response.status).toEqual(400);
    expect(massageHeaders(response.headers)).toEqual({
        "content-type": "application/json",
    });
    expect(responseBody).toEqual({
        ok: false,
        error: new InvalidArgumentError("Must use `POST` method"),
    });
});

test("must provide Content-Type header to upload route", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const response = await fetch(`http://localhost:${port}/${space.id}/upload`, {
        method: "POST",
        headers: {connection: "close", cookie: await sessionCookie(session)},
        body: new Uint8Array(100),
    });
    const responseBody = UploadFileResponseSchema.deserialize(await response.json());

    expect(response.status).toEqual(400);
    expect(massageHeaders(response.headers)).toEqual({
        "content-type": "application/json",
    });
    expect(responseBody).toEqual({
        ok: false,
        error: new InvalidArgumentError("`Content-Type` header is required"),
    });
});

test("must provide a valid Content-Type header to upload route", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const response = await fetch(`http://localhost:${port}/${space.id}/upload`, {
        method: "POST",
        headers: {
            connection: "close",
            cookie: await sessionCookie(session),
            "content-type": "application/example",
        },
        body: new Uint8Array(100),
    });
    const responseBody = UploadFileResponseSchema.deserialize(await response.json());

    expect(response.status).toEqual(400);
    expect(massageHeaders(response.headers)).toEqual({
        "content-type": "application/json",
    });
    expect(responseBody).toEqual({
        ok: false,
        error: new InvalidArgumentError("Unsupported `Content-Type` header `application/example`"),
    });
});

// We use Node.js's raw `net.connect()` utilities in some tests to send an HTTP
// request because we want to intentionally send requests outside of normal HTTP
// syntax. For example writing more bytes than what's declared by `Content-Length`.
// Or ending a request before it's finished. Node.js's
test("can upload file with raw `net.connect()` calls", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const socket = net.connect({
        host: "localhost",
        port,
    });

    let socketText = "";

    socket.on("data", chunk => {
        socketText += chunk.toString("utf8");
    });

    const socketClosePromise = new Promise<void>((resolve, reject) => {
        socket.on("close", resolve);
        socket.on("error", reject);
    });

    await new Promise<void>((resolve, reject) => {
        socket.on("connect", resolve);
        socket.on("error", reject);
    });

    const cookieHeader = await sessionCookie(session);

    await new Promise<void>((resolve, reject) => {
        socket.write(
            `\
POST /${space.id}/upload HTTP/1.1\r\n\
Host: localhost:${port}\r\n\
Connection: close\r\n\
Cookie: ${cookieHeader}\r\n\
Content-Type: image/jpeg\r\n\
Content-Length: 33102\r\n\
\r\n\
`,
            error => {
                if (error) reject(error);
                else resolve();
            },
        );
    });

    fsSync.createReadStream(jpegTestFixturePath).pipe(socket, {end: false});

    await socketClosePromise;

    /* eslint-disable cyberworlds/string-quotes */

    expect(
        socketText
            .replace(/^Date: .*?\r\n/m, "")
            .replace(/^[a-z0-9]+\r\n/gm, "chunk\r\n")
            .replace(
                /,"file":\{"id":"[^"]*","spaceId":"[^"]*"/m,
                ',"file":{"id":"...","spaceId":"..."',
            ),
    ).toEqual(`\
HTTP/1.1 200 OK\r\n\
content-type: application/json\r\n\
Connection: close\r\n\
Transfer-Encoding: chunked\r\n\
\r\n\
chunk\r\n\
{"ok":true,"signedUrlSearch":"?sig=test","file":{"id":"...","spaceId":"...","contentType":"image/jpeg","contentLength":33102,"isUploading":false,"alternative":null,"preview":{"type":"Image","isProcessing":true,"size":null,"placeholder":null},"analysis":{"isProcessing":true},"transcript":null}}\r\n\
chunk\r\n\
\r\n\
`);

    /* eslint-enable cyberworlds/string-quotes */

    const match = assertExists(socketText.match(/,"file":\{"id":"([^"]*)"/m));
    const fileId = assertId<FileId>(match[1]!);

    await ProcessContextModule.waitForTestTasks();

    expect(await getFileAsUploader(space.systemAction(), fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileId,
            contentType: "image/jpeg",
            contentLength: 33102,
            isUploading: false,
            alternative: null,
            transcript: null,
            preview: {
                type: "Image",
                isProcessing: false,
                ok: true,
                size: {width: 500, height: 375, scale: 1, hasAlpha: false},
                placeholder: expect.any(FileImagePreviewPlaceholder),
            },
            analysis: {
                isProcessing: false,
                ok: true,
                result: testUploadFileAnalysisResult,
            },
        }),
    );
});

test("can\u2019t upload data with a Content-Length header that\u2019s too big", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const socket = net.connect({
        host: "localhost",
        port,
    });

    let socketText = "";

    socket.on("data", chunk => {
        socketText += chunk.toString("utf8");
    });

    const socketClosePromise = new Promise<void>((resolve, reject) => {
        socket.on("close", resolve);
        socket.on("error", reject);
    });

    await new Promise<void>((resolve, reject) => {
        socket.on("connect", resolve);
        socket.on("error", reject);
    });

    const cookieHeader = await sessionCookie(session);

    const requestBody = new Uint8Array(2e9);

    await new Promise<void>((resolve, reject) => {
        socket.write(
            `\
POST /${space.id}/upload HTTP/1.1\r\n\
Host: localhost:${port}\r\n\
Connection: close\r\n\
Cookie: ${cookieHeader}\r\n\
Content-Type: image/jpeg\r\n\
Content-Length: ${requestBody.length}\r\n\
\r\n\
`,
            error => {
                if (error) reject(error);
                else resolve();
            },
        );
    });

    // Ignore any `EPIPE` errors from the socket. The server will close the socket once
    // an error is returned causing our writes to possibly fail.
    try {
        await socketClosePromise;
    } catch (error) {
        if (!isObject(error) || error.code !== "EPIPE") {
            throw error;
        }
    }

    /* eslint-disable cyberworlds/string-quotes */

    expect(
        socketText
            .replace(/^Date: .*?\r\n/m, "")
            .replace(/^[a-z0-9]+\r\n/gm, "chunk\r\n")
            .replace(/,"stack":".*"}/m, ',"stack":"..."'),
    ).toEqual(`\
HTTP/1.1 400 Bad Request\r\n\
content-type: application/json\r\n\
Connection: close\r\n\
Transfer-Encoding: chunked\r\n\
\r\n\
chunk\r\n\
{"ok":false,"error":{"code":3,"message":"\`Content-Length\` of 2 GB is more than our maximum file size of 1 GB","name":"InvalidArgumentError","stack":"..."}}\r\n\
chunk\r\n\
\r\n\
`);

    /* eslint-enable cyberworlds/string-quotes */
});

// `http.createServer()` should truncate for us when we write more bytes than
// what's in `Content-Length`. But we want to make sure this happens with a test so
// we don't accidentally let attackers upload larger files then what we allow.
test("if more data is written than what\u2019s in Content-Length server truncates the content and only processes the truncated content", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const socket = net.connect({
        host: "localhost",
        port,
    });

    let socketText = "";

    socket.on("data", chunk => {
        socketText += chunk.toString("utf8");
    });

    const socketClosePromise = new Promise<void>((resolve, reject) => {
        socket.on("close", resolve);
        socket.on("error", reject);
    });

    await new Promise<void>((resolve, reject) => {
        socket.on("connect", resolve);
        socket.on("error", reject);
    });

    const fileId = generateChronologicalId<FileId>();
    const cookieHeader = await sessionCookie(session);

    await new Promise<void>((resolve, reject) => {
        socket.write(
            `\
POST /${space.id}/upload?id=${fileId} HTTP/1.1\r\n\
Host: localhost:${port}\r\n\
Connection: close\r\n\
Cookie: ${cookieHeader}\r\n\
Content-Type: image/jpeg\r\n\
Content-Length: 33002\r\n\
\r\n\
`,
            error => {
                if (error) reject(error);
                else resolve();
            },
        );
    });

    const fileContent = await fs.readFile(jpegTestFixturePath);

    socket.write(
        // TODO(calebmer, #typescript-5.9.2): Discovered after TS version upgrade, not
        // fixing for now.
        // @ts-expect-error
        fileContent,
    );

    await socketClosePromise;

    expect(socketText.replace(/^Date: .*?\r\n/m, "").replace(/^[a-z0-9]+\r\n/gm, "chunk\r\n"))
        .toEqual(`\
HTTP/1.1 400 Bad Request\r\n\
Connection: close\r\n\
\r\n\
`);
});

test("request can be ended before completion", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const socket = net.connect({
        host: "localhost",
        port,
    });

    let socketText = "";

    socket.on("data", chunk => {
        socketText += chunk.toString("utf8");
    });

    const socketClosePromise = new Promise<void>((resolve, reject) => {
        socket.on("close", resolve);
        socket.on("error", reject);
    });

    await new Promise<void>((resolve, reject) => {
        socket.on("connect", resolve);
        socket.on("error", reject);
    });

    const fileId = generateChronologicalId<FileId>();
    const cookieHeader = await sessionCookie(session);

    await new Promise<void>((resolve, reject) => {
        socket.write(
            `\
POST /${space.id}/upload?id=${fileId} HTTP/1.1\r\n\
Host: localhost:${port}\r\n\
Connection: close\r\n\
Cookie: ${cookieHeader}\r\n\
Content-Type: image/jpeg\r\n\
Content-Length: 33102\r\n\
\r\n\
`,
            error => {
                if (error) reject(error);
                else resolve();
            },
        );
    });

    const jpegTestFixtureContents = await fs.readFile(jpegTestFixturePath);

    socket.write(
        // TODO(calebmer, #typescript-5.9.2): Discovered after TS version upgrade, not
        // fixing for now.
        // @ts-expect-error
        jpegTestFixtureContents.subarray(0, Math.floor(jpegTestFixtureContents.length / 2)),
    );

    await waitForExpect(async () => {
        await getFileAsUploader(space.systemAction(), fileId);
    });

    expect(await getFileAsUploader(space.systemAction(), fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileId,
            contentType: "image/jpeg",
            contentLength: 33102,
            isUploading: true,
            alternative: null,
            transcript: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
            analysis: {isProcessing: true},
        }),
    );

    socket.end();

    await socketClosePromise;

    /* eslint-disable cyberworlds/string-quotes */

    expect(
        socketText
            .replace(/^Date: .*?\r\n/m, "")
            .replace(/^[a-z0-9]+\r\n/gm, "chunk\r\n")
            .replace(/,"file":\{"id":"[^"]*"/m, ',"file":{"id":"..."'),
    ).toEqual(`\
HTTP/1.1 400 Bad Request\r\n\
Connection: close\r\n\
\r\n\
`);

    /* eslint-enable cyberworlds/string-quotes */
});

test("can observe file while it\u2019s being uploaded", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const socket = net.connect({
        host: "localhost",
        port,
    });

    let socketText = "";

    socket.on("data", chunk => {
        socketText += chunk.toString("utf8");
    });

    const socketClosePromise = new Promise<void>((resolve, reject) => {
        socket.on("close", resolve);
        socket.on("error", reject);
    });

    await new Promise<void>((resolve, reject) => {
        socket.on("connect", resolve);
        socket.on("error", reject);
    });

    const fileId = generateChronologicalId<FileId>();
    const cookieHeader = await sessionCookie(session);

    await new Promise<void>((resolve, reject) => {
        socket.write(
            `\
POST /${space.id}/upload?id=${fileId} HTTP/1.1\r\n\
Host: localhost:${port}\r\n\
Connection: close\r\n\
Cookie: ${cookieHeader}\r\n\
Content-Type: image/jpeg\r\n\
Content-Length: 33102\r\n\
\r\n\
`,
            error => {
                if (error) reject(error);
                else resolve();
            },
        );
    });

    const jpegTestFixtureContents = await fs.readFile(jpegTestFixturePath);

    socket.write(
        // TODO(calebmer, #typescript-5.9.2): Discovered after TS version upgrade, not
        // fixing for now.
        // @ts-expect-error
        jpegTestFixtureContents.subarray(0, Math.floor(jpegTestFixtureContents.length / 2)),
    );

    await waitForExpect(async () => {
        await getFileAsUploader(space.systemAction(), fileId);
    });

    expect(await getFileAsUploader(space.systemAction(), fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileId,
            contentType: "image/jpeg",
            contentLength: 33102,
            isUploading: true,
            alternative: null,
            transcript: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
            analysis: {isProcessing: true},
        }),
    );

    socket.write(
        // TODO(calebmer, #typescript-5.9.2): Discovered after TS version upgrade, not
        // fixing for now.
        // @ts-expect-error
        jpegTestFixtureContents.subarray(Math.floor(jpegTestFixtureContents.length / 2)),
    );

    await socketClosePromise;

    /* eslint-disable cyberworlds/string-quotes */

    expect(
        socketText
            .replace(/^Date: .*?\r\n/m, "")
            .replace(/^[a-z0-9]+\r\n/gm, "chunk\r\n")
            .replace(
                /,"file":\{"id":"[^"]*","spaceId":"[^"]*"/m,
                ',"file":{"id":"...","spaceId":"..."',
            ),
    ).toEqual(`\
HTTP/1.1 200 OK\r\n\
content-type: application/json\r\n\
Connection: close\r\n\
Transfer-Encoding: chunked\r\n\
\r\n\
chunk\r\n\
{"ok":true,"signedUrlSearch":"?sig=test","file":{"id":"...","spaceId":"...","contentType":"image/jpeg","contentLength":33102,"isUploading":false,"alternative":null,"preview":{"type":"Image","isProcessing":true,"size":null,"placeholder":null},"analysis":{"isProcessing":true},"transcript":null}}\r\n\
chunk\r\n\
\r\n\
`);

    /* eslint-enable cyberworlds/string-quotes */

    await ProcessContextModule.waitForTestTasks();

    expect(await getFileAsUploader(space.systemAction(), fileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: fileId,
            contentType: "image/jpeg",
            contentLength: 33102,
            isUploading: false,
            alternative: null,
            transcript: null,
            preview: {
                type: "Image",
                isProcessing: false,
                ok: true,
                size: {width: 500, height: 375, scale: 1, hasAlpha: false},
                placeholder: expect.any(FileImagePreviewPlaceholder),
            },
            analysis: {
                isProcessing: false,
                ok: true,
                result: testUploadFileAnalysisResult,
            },
        }),
    );
});

test("can\u2019t process invalid image data", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const response = await fetch(`http://localhost:${port}/${space.id}/upload`, {
        method: "POST",
        headers: {
            connection: "close",
            cookie: await sessionCookie(session),
            "content-type": "image/png",
        },
        body: new Uint8Array(1e5),
    });
    const responseBody = UploadFileResponseSchema.deserialize(await response.json());

    expect(response.status).toEqual(200);
    expect(massageHeaders(response.headers)).toEqual({
        "content-type": "application/json",
    });
    expect(responseBody).toEqual({
        ok: true,
        signedUrlSearch: "?sig=test",
        file: new FileModel({
            spaceId: space.id,
            id: expect.any(String),
            contentType: "image/png",
            contentLength: 100000,
            isUploading: false,
            alternative: null,
            transcript: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
            analysis: {isProcessing: true},
        }),
    });
    assert(responseBody.ok);

    await ProcessContextModule.waitForTestTasks();

    expect(await getFileAsUploader(space.systemAction(), responseBody.file.id)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: expect.any(String),
            contentType: "image/png",
            contentLength: 100000,
            isUploading: false,
            alternative: null,
            transcript: null,
            preview: {
                type: "Image",
                isProcessing: false,
                ok: false,
                error: {type: "Unknown"},
                size: "Error",
                placeholder: "Error",
            },
            analysis: {
                isProcessing: false,
                ok: false,
                error: {type: "Unknown"},
            },
        }),
    );
});

test("can\u2019t process image with the wrong content type", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const response = await fetch(`http://localhost:${port}/${space.id}/upload`, {
        method: "POST",
        headers: {
            connection: "close",
            cookie: await sessionCookie(session),
            "content-type": "image/png",
        },
        // TODO(calebmer, #typescript-5.9.2): Discovered after TS version upgrade, not
        // fixing for now.
        // @ts-expect-error
        body: await fs.readFile(jpegTestFixturePath),
    });
    const responseBody = UploadFileResponseSchema.deserialize(await response.json());

    expect(response.status).toEqual(200);
    expect(massageHeaders(response.headers)).toEqual({
        "content-type": "application/json",
    });
    expect(responseBody).toEqual({
        ok: true,
        signedUrlSearch: "?sig=test",
        file: new FileModel({
            spaceId: space.id,
            id: expect.any(String),
            contentType: "image/png",
            contentLength: 33102,
            isUploading: false,
            alternative: null,
            transcript: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
            analysis: {isProcessing: true},
        }),
    });
    assert(responseBody.ok);

    await ProcessContextModule.waitForTestTasks();

    expect(await getFileAsUploader(space.systemAction(), responseBody.file.id)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: expect.any(String),
            contentType: "image/png",
            contentLength: 33102,
            isUploading: false,
            alternative: null,
            transcript: null,
            preview: {
                type: "Image",
                isProcessing: false,
                ok: false,
                error: {type: "Unknown"},
                size: "Error",
                placeholder: expect.any(FileImagePreviewPlaceholder),
            },
            analysis: {
                isProcessing: false,
                ok: true,
                result: testUploadFileAnalysisResult,
            },
        }),
    );
});

test("can upload and process image", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const response = await fetch(`http://localhost:${port}/${space.id}/upload`, {
        method: "POST",
        headers: {
            connection: "close",
            cookie: await sessionCookie(session),
            "content-type": "image/jpeg",
        },
        // TODO(calebmer, #typescript-5.9.2): Discovered after TS version upgrade, not
        // fixing for now.
        // @ts-expect-error
        body: await fs.readFile(jpegTestFixturePath),
    });
    const responseBody = UploadFileResponseSchema.deserialize(await response.json());

    expect(response.status).toEqual(200);
    expect(massageHeaders(response.headers)).toEqual({
        "content-type": "application/json",
    });
    expect(responseBody).toEqual({
        ok: true,
        signedUrlSearch: "?sig=test",
        file: new FileModel({
            spaceId: space.id,
            id: expect.any(String),
            contentType: "image/jpeg",
            contentLength: 33102,
            isUploading: false,
            alternative: null,
            transcript: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
            analysis: {isProcessing: true},
        }),
    });
    assert(responseBody.ok);

    await ProcessContextModule.waitForTestTasks();

    expect(await getFileAsUploader(space.systemAction(), responseBody.file.id)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: responseBody.file.id,
            contentType: "image/jpeg",
            contentLength: 33102,
            isUploading: false,
            alternative: null,
            transcript: null,
            preview: {
                type: "Image",
                isProcessing: false,
                ok: true,
                size: {width: 500, height: 375, scale: 1, hasAlpha: false},
                placeholder: expect.any(FileImagePreviewPlaceholder),
            },
            analysis: {
                isProcessing: false,
                ok: true,
                result: testUploadFileAnalysisResult,
            },
        }),
    );
});

test("can upload and process large image", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const response = await fetch(`http://localhost:${port}/${space.id}/upload`, {
        method: "POST",
        headers: {
            connection: "close",
            cookie: await sessionCookie(session),
            "content-type": "image/jpeg",
        },
        // TODO(calebmer, #typescript-5.9.2): Discovered after TS version upgrade, not
        // fixing for now.
        // @ts-expect-error
        body: await fs.readFile(
            joinPath(
                runfilesPath,
                "cyberworlds/server/files/processor/test_fixtures/unsplash_annie_spratt_0ArJET2aSIQ_large.jpeg",
            ),
        ),
    });
    const responseBody = UploadFileResponseSchema.deserialize(await response.json());

    expect(response.status).toEqual(200);
    expect(massageHeaders(response.headers)).toEqual({
        "content-type": "application/json",
    });
    expect(responseBody).toEqual({
        ok: true,
        signedUrlSearch: "?sig=test",
        file: new FileModel({
            spaceId: space.id,
            id: expect.any(String),
            contentType: "image/jpeg",
            contentLength: 2274056,
            isUploading: false,
            alternative: null,
            transcript: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
            analysis: {isProcessing: true},
        }),
    });
    assert(responseBody.ok);

    await ProcessContextModule.waitForTestTasks();

    expect(await getFileAsUploader(space.systemAction(), responseBody.file.id)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: responseBody.file.id,
            contentType: "image/jpeg",
            contentLength: 2274056,
            isUploading: false,
            alternative: null,
            transcript: null,
            preview: {
                type: "Image",
                isProcessing: false,
                ok: true,
                size: {width: 3992, height: 2992, scale: 1, hasAlpha: false},
                placeholder: expect.any(FileImagePreviewPlaceholder),
            },
            analysis: {
                isProcessing: false,
                ok: true,
                result: testUploadFileAnalysisResult,
            },
        }),
    );
});

test("can upload image with a provided id", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const providedFileId = generateChronologicalId<FileId>();

    const response = await fetch(
        `http://localhost:${port}/${space.id}/upload?id=${providedFileId}`,
        {
            method: "POST",
            headers: {
                connection: "close",
                cookie: await sessionCookie(session),
                "content-type": "image/jpeg",
            },
            // TODO(calebmer, #typescript-5.9.2): Discovered after TS version upgrade, not
            // fixing for now.
            // @ts-expect-error
            body: await fs.readFile(jpegTestFixturePath),
        },
    );
    const responseBody = UploadFileResponseSchema.deserialize(await response.json());

    expect(response.status).toEqual(200);
    expect(massageHeaders(response.headers)).toEqual({
        "content-type": "application/json",
    });
    expect(responseBody).toEqual({
        ok: true,
        signedUrlSearch: "?sig=test",
        file: new FileModel({
            spaceId: space.id,
            id: providedFileId,
            contentType: "image/jpeg",
            contentLength: 33102,
            isUploading: false,
            alternative: null,
            transcript: null,
            preview: {
                type: "Image",
                isProcessing: true,
                size: "Processing",
                placeholder: "Processing",
            },
            analysis: {isProcessing: true},
        }),
    });
    assert(responseBody.ok);

    await ProcessContextModule.waitForTestTasks();

    expect(await getFileAsUploader(space.systemAction(), providedFileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: providedFileId,
            contentType: "image/jpeg",
            contentLength: 33102,
            isUploading: false,
            alternative: null,
            transcript: null,
            preview: {
                type: "Image",
                isProcessing: false,
                ok: true,
                size: {width: 500, height: 375, scale: 1, hasAlpha: false},
                placeholder: expect.any(FileImagePreviewPlaceholder),
            },
            analysis: {
                isProcessing: false,
                ok: true,
                result: testUploadFileAnalysisResult,
            },
        }),
    );
});

test("can\u2019t upload image with the same provided id twice", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const providedFileId = generateChronologicalId<FileId>();

    {
        const response = await fetch(
            `http://localhost:${port}/${space.id}/upload?id=${providedFileId}`,
            {
                method: "POST",
                headers: {
                    connection: "close",
                    cookie: await sessionCookie(session),
                    "content-type": "image/jpeg",
                },
                // TODO(calebmer, #typescript-5.9.2): Discovered after TS version upgrade, not
                // fixing for now.
                // @ts-expect-error
                body: await fs.readFile(jpegTestFixturePath),
            },
        );
        const responseBody = UploadFileResponseSchema.deserialize(await response.json());

        expect(response.status).toEqual(200);
        expect(massageHeaders(response.headers)).toEqual({
            "content-type": "application/json",
        });
        expect(responseBody).toEqual({
            ok: true,
            signedUrlSearch: "?sig=test",
            file: new FileModel({
                spaceId: space.id,
                id: providedFileId,
                contentType: "image/jpeg",
                contentLength: 33102,
                isUploading: false,
                alternative: null,
                transcript: null,
                preview: {
                    type: "Image",
                    isProcessing: true,
                    size: "Processing",
                    placeholder: "Processing",
                },
                analysis: {isProcessing: true},
            }),
        });
        assert(responseBody.ok);
    }

    await ProcessContextModule.waitForTestTasks();

    expect(await getFileAsUploader(space.systemAction(), providedFileId)).toEqual(
        new FileModel({
            spaceId: space.id,
            id: providedFileId,
            contentType: "image/jpeg",
            contentLength: 33102,
            isUploading: false,
            alternative: null,
            transcript: null,
            preview: {
                type: "Image",
                isProcessing: false,
                ok: true,
                size: {width: 500, height: 375, scale: 1, hasAlpha: false},
                placeholder: expect.any(FileImagePreviewPlaceholder),
            },
            analysis: {
                isProcessing: false,
                ok: true,
                result: testUploadFileAnalysisResult,
            },
        }),
    );

    {
        const response = await fetch(
            `http://localhost:${port}/${space.id}/upload?id=${providedFileId}`,
            {
                method: "POST",
                headers: {
                    connection: "close",
                    cookie: await sessionCookie(session),
                    "content-type": "image/jpeg",
                },
                // TODO(calebmer, #typescript-5.9.2): Discovered after TS version upgrade, not
                // fixing for now.
                // @ts-expect-error
                body: await fs.readFile(jpegTestFixturePath),
            },
        );
        const responseBody = UploadFileResponseSchema.deserialize(await response.json());

        expect(response.status).toEqual(400);
        expect(massageHeaders(response.headers)).toEqual({
            "content-type": "application/json",
        });
        expect(responseBody).toEqual({
            ok: false,
            error: new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [None, ConditionalCheckFailed]",
            ),
        });
    }
});

test("can upload image with a provided that has a time way before the current time", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const providedFileId = generateChronologicalIdWithTime<FileId>(Date.now() + 1000 * 60 * 10);

    const response = await fetch(
        `http://localhost:${port}/${space.id}/upload?id=${providedFileId}`,
        {
            method: "POST",
            headers: {
                connection: "close",
                cookie: await sessionCookie(session),
                "content-type": "image/jpeg",
            },
            // TODO(calebmer, #typescript-5.9.2): Discovered after TS version upgrade, not
            // fixing for now.
            // @ts-expect-error
            body: await fs.readFile(jpegTestFixturePath),
        },
    );
    const responseBody = UploadFileResponseSchema.deserialize(await response.json());

    expect(response.status).toEqual(400);
    expect(massageHeaders(response.headers)).toEqual({
        "content-type": "application/json",
    });
    expect(responseBody).toEqual({
        ok: false,
        error: new FailedPreconditionError(
            "Provided `FileId` must be within a 4 minute window of the current time",
        ),
    });

    await expect(getFileAsUploader(space.systemAction(), providedFileId)).rejects.toThrow(
        new NotFoundError("File not found"),
    );
});

test("can upload image with a provided `FileId` that has a time way after the current time", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const providedFileId = generateChronologicalIdWithTime<FileId>(Date.now() - 1000 * 60 * 10);

    const response = await fetch(
        `http://localhost:${port}/${space.id}/upload?id=${providedFileId}`,
        {
            method: "POST",
            headers: {
                connection: "close",
                cookie: await sessionCookie(session),
                "content-type": "image/jpeg",
            },
            // TODO(calebmer, #typescript-5.9.2): Discovered after TS version upgrade, not
            // fixing for now.
            // @ts-expect-error
            body: await fs.readFile(jpegTestFixturePath),
        },
    );
    const responseBody = UploadFileResponseSchema.deserialize(await response.json());

    expect(response.status).toEqual(400);
    expect(massageHeaders(response.headers)).toEqual({
        "content-type": "application/json",
    });
    expect(responseBody).toEqual({
        ok: false,
        error: new FailedPreconditionError(
            "Provided `FileId` must be within a 4 minute window of the current time",
        ),
    });

    await expect(getFileAsUploader(space.systemAction(), providedFileId)).rejects.toThrow(
        new NotFoundError("File not found"),
    );
});
