import {R2Bucket} from "@miniflare/r2";
import {FileStorage} from "@miniflare/storage-file";
import fsSync from "fs";
import fs from "fs/promises";
import getPort from "get-port";
import {IncomingMessage, Server, createServer} from "http";
import net from "net";
import {join as joinPath} from "path";
import {
    CloudflareR2Client,
    CloudflareR2ClientBase,
} from "~/server/cloudflare/r2/cloudflare_r2_client.js";
import {CloudflareR2ContextModule} from "~/server/cloudflare/r2/cloudflare_r2_context_module.js";
import {MiniflareR2Client} from "~/server/cloudflare/r2/miniflare_r2_client.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createTestTokenAgents} from "~/server/dynamo/test_helpers/create_test_token_agent.js";
import {getFileAsUploader} from "~/server/files/data/files_table.js";
import {createFileUploadService} from "~/server/files/upload/file_upload_service.js";
import {
    filesBindingName,
    filesBucketName,
} from "~/server/helpers/files_cloudflare_r2_bucket_name.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {waitForExpect} from "~/server/helpers/test/wait_for_expect.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {
    FailedPreconditionError,
    InvalidArgumentError,
    NotFoundError,
    PermissionDeniedError,
} from "~/shared/error/error.js";
import {ErrorCode} from "~/shared/error/error_code.js";
import {FileImagePreviewPlaceholder} from "~/shared/files/file_image_preview_placeholder.js";
import {FileModel} from "~/shared/files/file_model.js";
import {UploadFileEventSchema} from "~/shared/files/upload_file_event.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {iterableFirst} from "~/shared/helpers/iterable/iterable_first.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {CommitBlocker} from "~/shared/helpers/types/commit_blocker.js";
import {
    generateChronologicalId,
    generateChronologicalIdWithTime,
} from "~/shared/id/chronological_id.js";
import {assertId} from "~/shared/id/id.js";
import {FileId} from "~/shared/id/types/id_types.js";

const jpegTestFixturePath = joinPath(
    runfilesPath,
    "cyberworlds/server/files/upload/test_fixtures/unsplash_annie_spratt_0ArJET2aSIQ.jpeg",
);

const context = createTestContext();

// Derived from:
// https://github.com/jshttp/type-is/blob/0d79e2d0c5737206d0f688769c5acffee1de953f/index.js#L93-L96
function doesIncomingMessageHaveBody(message: IncomingMessage): boolean {
    return (
        message.headers["transfer-encoding"] !== undefined ||
        (message.headers["content-length"] !== undefined &&
            !isNaN(parseFloat(message.headers["content-length"])))
    );
}

// We want to test both with the Miniflare client we use in development
// (`MiniflareR2Client`) and the AWS S3 client we use in production
// (`CloudflareR2Client`). To make sure there won't be any AWS S3 client
// specific bugs in production.
const testCases: Array<{
    only?: CommitBlocker;
    name: string;
    setup: (options: {port: number}) => Promise<{
        r2Client: CloudflareR2ClientBase;
        teardown: () => Promise<void>;
    }>;
}> = [
    {
        name: "Miniflare R2 client",
        setup: async ({port}) => {
            const r2Storage = new FileStorage(
                joinPath(context.getTemporaryDirectoryPath(), "r2", filesBindingName),
            );
            const r2Bucket = new R2Bucket(r2Storage);

            const r2Client = new MiniflareR2Client({
                fileUploadServiceUrl: `http://localhost:${port}`,
                bucketByName: new Map([[filesBucketName, r2Bucket]]),
            });

            return {
                r2Client,
                teardown: async () => {},
            };
        },
    },
    {
        name: "AWS S3 client",
        setup: async () => {
            const noopS3Port = await getPort();

            const noopS3Server = createServer((req, res) => {
                const cleanup = () => {
                    timeout.clear();
                    req.off("data", handleData);
                    req.off("end", handleEnd);
                    req.off("close", handleClose);
                };

                const timeout = createTimeout(() => {
                    cleanup();

                    res.destroy();
                }, 1000 * 5);

                const handleData = () => {};

                const handleEnd = () => {
                    cleanup();

                    res.writeHead(200, {"content-type": "text/plain"});
                    res.end("200 OK");
                };

                const handleClose = () => {
                    cleanup();
                };

                if (!doesIncomingMessageHaveBody(req) || req.readableEnded) {
                    handleEnd();
                } else {
                    req.on("data", handleData);
                    req.on("end", handleEnd);
                    req.on("close", handleClose);
                }
            });

            const accountId = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte =>
                byte.toString(16).padStart(2, "0"),
            ).join("");

            const accessKeyId = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte =>
                byte.toString(16).padStart(2, "0"),
            ).join("");

            const secretAccessKey = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte =>
                byte.toString(16).padStart(2, "0"),
            ).join("");

            // This test exercises `FileUploadService` using `CloudflareR2Client` which we
            // use in production. We have a dummy S3 server that does not actually upload
            // the provided file and always returns a "200 OK" response.
            const r2Client = new CloudflareR2Client({
                endpointOverrideForTest: `http://localhost:${noopS3Port}`,
                accountId,
                accessKeyId,
                secretAccessKey,
            });

            await new Promise<void>(resolve => {
                noopS3Server.listen(noopS3Port, resolve);
            });

            return {
                r2Client,
                teardown: async () => {
                    await new Promise<void>((resolve, reject) => {
                        noopS3Server.close(error => {
                            if (error) reject(error);
                            else resolve();
                        });
                    });

                    r2Client.destroyForTest();
                },
            };
        },
    },
];

for (const testCase of testCases) {
    const describeFn = testCase
        ? describe
        : testCases.some(otherTestCase => !!otherTestCase && otherTestCase !== testCase)
        ? describe.skip
        : describe;

    describeFn(`${testCase.name}`, () => {
        let serverTokenAgent: TokenAgent;
        let tokenAgent: TokenAgent;
        let port: number;
        let server: Server;
        let teardown: () => Promise<void>;

        beforeAll(async () => {
            port = await getPort();

            let r2Client;
            ({r2Client, teardown} = await testCase.setup({port}));

            [serverTokenAgent, tokenAgent] = await createTestTokenAgents(context, [
                "FileUploadService",
                "EdgeService",
            ]);
            server = createFileUploadService(
                context.clone({r2: new CloudflareR2ContextModule(r2Client)}),
                {
                    tokenAgent: serverTokenAgent,
                    temporaryDirectoryPath: joinPath(context.getTemporaryDirectoryPath(), "files"),
                },
            );

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

            await teardown();
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

            const response = await fetch(`http://localhost:${port}/${space.id}/upload`);
            const responseText = await response.text();

            expect(response.status).toEqual(400);
            expect(massageHeaders(response.headers)).toEqual({"content-type": "text/plain"});
            expect(responseText).toEqual("400 Bad Request");
        });

        test("must use session with upload route", async () => {
            const space = await TestSpace.create(context);

            const response = await fetch(`http://localhost:${port}/${space.id}/upload`, {
                headers: {authorization: await authorization(space)},
            });
            const responseText = await response.text();

            expect(response.status).toEqual(400);
            expect(massageHeaders(response.headers)).toEqual({
                "content-type": "application/x-ndjson",
            });
            expect(parseJsonEvents(responseText)).toEqual([
                {
                    type: "Error",
                    error: new PermissionDeniedError("System actor is not a session actor"),
                },
            ]);
        });

        test("must be authorized to access space to upload", async () => {
            const otherSpace = await TestSpace.create(context);
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const response = await fetch(`http://localhost:${port}/${otherSpace.id}/upload`, {
                headers: {authorization: await authorization(session)},
            });
            const responseText = await response.text();

            expect(response.status).toEqual(400);
            expect(massageHeaders(response.headers)).toEqual({
                "content-type": "application/x-ndjson",
            });
            expect(parseJsonEvents(responseText)).toEqual([
                {
                    type: "Error",
                    error: new PermissionDeniedError("Account doesn't have access to space"),
                },
            ]);
        });

        test("must use POST method to upload route", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const response = await fetch(`http://localhost:${port}/${space.id}/upload`, {
                headers: {authorization: await authorization(session)},
            });
            const responseText = await response.text();

            expect(response.status).toEqual(400);
            expect(massageHeaders(response.headers)).toEqual({
                "content-type": "application/x-ndjson",
            });
            expect(parseJsonEvents(responseText)).toEqual([
                {type: "Error", error: new InvalidArgumentError('Must use "POST" method')},
            ]);
        });

        test("must provide Content-Type header to upload route", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const response = await fetch(`http://localhost:${port}/${space.id}/upload`, {
                method: "POST",
                headers: {authorization: await authorization(session)},
            });
            const responseText = await response.text();

            expect(response.status).toEqual(400);
            expect(massageHeaders(response.headers)).toEqual({
                "content-type": "application/x-ndjson",
            });
            expect(parseJsonEvents(responseText)).toEqual([
                {
                    type: "Error",
                    error: new InvalidArgumentError('"Content-Type" header is required'),
                },
            ]);
        });

        test("must provide a valid Content-Type header to upload route", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const response = await fetch(`http://localhost:${port}/${space.id}/upload`, {
                method: "POST",
                headers: {
                    authorization: await authorization(session),
                    "content-type": "application/example",
                },
            });
            const responseText = await response.text();

            expect(response.status).toEqual(400);
            expect(massageHeaders(response.headers)).toEqual({
                "content-type": "application/x-ndjson",
            });
            expect(parseJsonEvents(responseText)).toEqual([
                {
                    type: "Error",
                    error: new InvalidArgumentError(
                        'Unsupported "Content-Type" header "application/example"',
                    ),
                },
            ]);
        });

        test("can't upload data with a Content-Length header that's too big", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const response = await fetch(`http://localhost:${port}/${space.id}/upload`, {
                method: "POST",
                headers: {
                    authorization: await authorization(session),
                    "content-type": "image/png",
                },
                body: new Uint8Array(2e9),
            });
            const responseText = await response.text();

            expect(response.status).toEqual(400);
            expect(massageHeaders(response.headers)).toEqual({
                "content-type": "application/x-ndjson",
            });
            expect(parseJsonEvents(responseText)).toEqual([
                {
                    type: "Error",
                    error: new InvalidArgumentError(
                        '"Content-Length" of 2 GB is more than our maximum file size of 1 GB',
                    ),
                },
            ]);
        });

        // We use Node.js's raw `net.connect()` utilities in some tests to send an HTTP
        // request because we want to intentionally send requests outside of normal
        // HTTP syntax. For example writing more bytes than what's declared by
        // `Content-Length`. Or ending a request before it's finished. Node.js's
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

            const authorizationHeader = await authorization(session);

            await new Promise<void>((resolve, reject) => {
                socket.write(
                    `\
POST /${space.id}/upload HTTP/1.1\r\n\
Host: localhost:${port}\r\n\
Connection: close\r\n\
Authorization: ${authorizationHeader}\r\n\
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

            expect(
                socketText
                    .replace(/^Date: .*?\r\n/m, "")
                    .replace(/^[a-z0-9]+\r\n/gm, "chunk\r\n")
                    .replace(/,"fileId":"[^"]*"/m, ',"fileId":"..."')
                    .replace(
                        /,"placeholder":\[false,(\d+),".*?"\]/m,
                        ',"placeholder":[false,$1,"..."]',
                    ),
            ).toEqual(`\
HTTP/1.1 200 OK\r\n\
content-type: application/x-ndjson\r\n\
Connection: close\r\n\
Transfer-Encoding: chunked\r\n\
\r\n\
chunk\r\n\
{"type":"Start","fileId":"...","hasAlternative":false,"hasPreview":{"type":"Image","hasContent":false,"hasVideoDuration":false},"signedUrlSearch":""}\n\
\r\n\
chunk\r\n\
{"type":"ImagePreviewSize","size":{"width":500,"height":375,"scale":1,"hasAlpha":false}}\n\
\r\n\
chunk\r\n\
{"type":"ImagePreviewPlaceholder","placeholder":[false,7,"..."]}\n\
\r\n\
chunk\r\n\
{"type":"Finish"}\n\
\r\n\
chunk\r\n\
\r\n\
`);

            const match = assertExists(socketText.match(/,"fileId":"([^"]*)"/m));
            const fileId = assertId<FileId>(match[1]!);

            expect(await getFileAsUploader(space.systemAction(), space.id, fileId)).toEqual(
                new FileModel({
                    id: fileId,
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
        });

        // `http.createServer()` should truncate for us when we write more bytes than
        // what's in `Content-Length`. But we want to make sure this happens with a
        // test so we don't accidentally let attackers upload larger files then what
        // we allow.
        test("if more data is written than what's in Content-Length server truncates the content and only processes the truncated content", async () => {
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

            const authorizationHeader = await authorization(session);

            await new Promise<void>((resolve, reject) => {
                socket.write(
                    `\
POST /${space.id}/upload HTTP/1.1\r\n\
Host: localhost:${port}\r\n\
Connection: close\r\n\
Authorization: ${authorizationHeader}\r\n\
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

            socket.write(fileContent.subarray(0, 20000));

            const fileId = await waitForExpect(() => {
                const match = assertExists(socketText.match(/,"fileId":"([^"]*)"/m));
                return assertId<FileId>(match[1]!);
            });

            socket.write(fileContent.subarray(20000));

            await socketClosePromise;

            expect(
                socketText
                    .replace(/^Date: .*?\r\n/m, "")
                    .replace(/^[a-z0-9]+\r\n/gm, "chunk\r\n")
                    .replace(/,"fileId":"[^"]*"/m, ',"fileId":"..."')
                    .replace(/,"stack":".*?"/gm, "")
                    .replace(/,"original":{.*?}/m, "")
                    .replace(/,"error":{.*?}/m, ',"error":{...}'),
            ).toEqual(`\
HTTP/1.1 200 OK\r\n\
content-type: application/x-ndjson\r\n\
Connection: close\r\n\
Transfer-Encoding: chunked\r\n\
\r\n\
chunk\r\n\
{"type":"Start","fileId":"...","hasAlternative":false,"hasPreview":{"type":"Image","hasContent":false,"hasVideoDuration":false},"signedUrlSearch":""}\n\
\r\n\
`);

            await ProcessContextModule.waitForTestTasks();

            await expect(getFileAsUploader(space.systemAction(), space.id, fileId)).rejects.toThrow(
                NotFoundError,
            );
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

            const authorizationHeader = await authorization(session);

            await new Promise<void>((resolve, reject) => {
                socket.write(
                    `\
POST /${space.id}/upload HTTP/1.1\r\n\
Host: localhost:${port}\r\n\
Connection: close\r\n\
Authorization: ${authorizationHeader}\r\n\
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
                jpegTestFixtureContents.subarray(0, Math.floor(jpegTestFixtureContents.length / 2)),
            );

            const fileId = await waitForExpect(() => {
                const match = assertExists(socketText.match(/,"fileId":"([^"]*)"/m));
                return assertId<FileId>(match[1]!);
            });

            expect(await getFileAsUploader(space.systemAction(), space.id, fileId)).toEqual(
                new FileModel({
                    id: fileId,
                    contentType: "image/jpeg",
                    contentLength: 33102,
                    isUploading: true,
                    alternative: null,
                    preview: {
                        type: "Image",
                        isProcessing: true,
                        size: "Processing",
                        placeholder: "Processing",
                    },
                }),
            );

            socket.end();

            await socketClosePromise;

            expect(
                socketText
                    .replace(/^Date: .*?\r\n/m, "")
                    .replace(/^[a-z0-9]+\r\n/gm, "chunk\r\n")
                    .replace(/,"fileId":"[^"]*"/m, ',"fileId":"..."')
                    .replace(
                        /,"placeholder":\[false,(\d+),".*?"\]/m,
                        ',"placeholder":[false,$1,"..."]',
                    ),
            ).toEqual(`\
HTTP/1.1 200 OK\r\n\
content-type: application/x-ndjson\r\n\
Connection: close\r\n\
Transfer-Encoding: chunked\r\n\
\r\n\
chunk\r\n\
{"type":"Start","fileId":"...","hasAlternative":false,"hasPreview":{"type":"Image","hasContent":false,"hasVideoDuration":false},"signedUrlSearch":""}\n\
\r\n\
`);

            await ProcessContextModule.waitForTestTasks();

            await expect(getFileAsUploader(space.systemAction(), space.id, fileId)).rejects.toThrow(
                NotFoundError,
            );
        });

        test("can observe file while it's being uploaded", async () => {
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

            const authorizationHeader = await authorization(session);

            await new Promise<void>((resolve, reject) => {
                socket.write(
                    `\
POST /${space.id}/upload HTTP/1.1\r\n\
Host: localhost:${port}\r\n\
Connection: close\r\n\
Authorization: ${authorizationHeader}\r\n\
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
                jpegTestFixtureContents.subarray(0, Math.floor(jpegTestFixtureContents.length / 2)),
            );

            const fileId = await waitForExpect(() => {
                const match = assertExists(socketText.match(/,"fileId":"([^"]*)"/m));
                return assertId<FileId>(match[1]!);
            });

            expect(await getFileAsUploader(space.systemAction(), space.id, fileId)).toEqual(
                new FileModel({
                    id: fileId,
                    contentType: "image/jpeg",
                    contentLength: 33102,
                    isUploading: true,
                    alternative: null,
                    preview: {
                        type: "Image",
                        isProcessing: true,
                        size: "Processing",
                        placeholder: "Processing",
                    },
                }),
            );

            socket.write(
                jpegTestFixtureContents.subarray(Math.floor(jpegTestFixtureContents.length / 2)),
            );

            await socketClosePromise;

            expect(
                socketText
                    .replace(/^Date: .*?\r\n/m, "")
                    .replace(/^[a-z0-9]+\r\n/gm, "chunk\r\n")
                    .replace(/,"fileId":"[^"]*"/m, ',"fileId":"..."')
                    .replace(
                        /,"placeholder":\[false,(\d+),".*?"\]/m,
                        ',"placeholder":[false,$1,"..."]',
                    ),
            ).toEqual(`\
HTTP/1.1 200 OK\r\n\
content-type: application/x-ndjson\r\n\
Connection: close\r\n\
Transfer-Encoding: chunked\r\n\
\r\n\
chunk\r\n\
{"type":"Start","fileId":"...","hasAlternative":false,"hasPreview":{"type":"Image","hasContent":false,"hasVideoDuration":false},"signedUrlSearch":""}\n\
\r\n\
chunk\r\n\
{"type":"ImagePreviewSize","size":{"width":500,"height":375,"scale":1,"hasAlpha":false}}\n\
\r\n\
chunk\r\n\
{"type":"ImagePreviewPlaceholder","placeholder":[false,7,"..."]}\n\
\r\n\
chunk\r\n\
{"type":"Finish"}\n\
\r\n\
chunk\r\n\
\r\n\
`);

            expect(await getFileAsUploader(space.systemAction(), space.id, fileId)).toEqual(
                new FileModel({
                    id: fileId,
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
        });

        test("can't upload invalid image data", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const response = await fetch(`http://localhost:${port}/${space.id}/upload`, {
                method: "POST",
                headers: {
                    authorization: await authorization(session),
                    "content-type": "image/png",
                },
                body: new Uint8Array(1e5),
            });
            const responseText = await response.text();

            expect(response.status).toEqual(200);
            expect(massageHeaders(response.headers)).toEqual({
                "content-type": "application/x-ndjson",
            });
            const events = parseJsonEvents(responseText);
            expect(events).toEqual([
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
                    type: "Error",
                    error: expect.objectContaining({
                        code: ErrorCode.InvalidArgument,
                        message: expect.stringMatching(
                            /^Input buffer has corrupt header: x2vips: libX error: Improper image header[^]*x2vips: unable to read buffer/,
                        ),
                    }),
                },
            ]);

            const fileId = assertExists(
                iterableFirst(
                    filterMapIterable(events, event =>
                        event.type === "Start" ? event.fileId : undefined,
                    ),
                ),
            );

            await expect(getFileAsUploader(space.systemAction(), space.id, fileId)).rejects.toThrow(
                NotFoundError,
            );
        });

        test("can't upload image with the wrong content type", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const response = await fetch(`http://localhost:${port}/${space.id}/upload`, {
                method: "POST",
                headers: {
                    authorization: await authorization(session),
                    "content-type": "image/png",
                },
                body: await fs.readFile(jpegTestFixturePath),
            });
            const responseText = await response.text();

            expect(response.status).toEqual(200);
            expect(massageHeaders(response.headers)).toEqual({
                "content-type": "application/x-ndjson",
            });
            const events = parseJsonEvents(responseText);
            expect(events).toEqual([
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
                    type: "Error",
                    error: new InvalidArgumentError(
                        'Expected file in "png" format but received file in "jpeg" format',
                    ),
                },
            ]);

            const fileId = assertExists(
                iterableFirst(
                    filterMapIterable(events, event =>
                        event.type === "Start" ? event.fileId : undefined,
                    ),
                ),
            );

            await expect(getFileAsUploader(space.systemAction(), space.id, fileId)).rejects.toThrow(
                NotFoundError,
            );
        });

        test("can upload image", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const response = await fetch(`http://localhost:${port}/${space.id}/upload`, {
                method: "POST",
                headers: {
                    authorization: await authorization(session),
                    "content-type": "image/jpeg",
                },
                body: await fs.readFile(jpegTestFixturePath),
            });
            const responseText = await response.text();

            expect(response.status).toEqual(200);
            expect(massageHeaders(response.headers)).toEqual({
                "content-type": "application/x-ndjson",
            });
            const events = parseJsonEvents(responseText);
            expect(events).toEqual([
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
                {
                    type: "ImagePreviewPlaceholder",
                    placeholder: expect.any(FileImagePreviewPlaceholder),
                },
                {type: "Finish"},
            ]);

            const fileId = assertExists(
                iterableFirst(
                    filterMapIterable(events, event =>
                        event.type === "Start" ? event.fileId : undefined,
                    ),
                ),
            );

            expect(await getFileAsUploader(space.systemAction(), space.id, fileId)).toEqual(
                new FileModel({
                    id: fileId,
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
        });

        test("can upload large image", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const response = await fetch(`http://localhost:${port}/${space.id}/upload`, {
                method: "POST",
                headers: {
                    authorization: await authorization(session),
                    "content-type": "image/jpeg",
                },
                body: await fs.readFile(
                    joinPath(
                        runfilesPath,
                        "cyberworlds/server/files/upload/test_fixtures/unsplash_annie_spratt_0ArJET2aSIQ_large.jpeg",
                    ),
                ),
            });
            const responseText = await response.text();

            expect(response.status).toEqual(200);
            expect(massageHeaders(response.headers)).toEqual({
                "content-type": "application/x-ndjson",
            });
            const events = parseJsonEvents(responseText);
            expect(events).toEqual([
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
                    size: {width: 3992, height: 2992, scale: 1, hasAlpha: false},
                },
                {
                    type: "ImagePreviewPlaceholder",
                    placeholder: expect.any(FileImagePreviewPlaceholder),
                },
                {type: "Finish"},
            ]);

            const fileId = assertExists(
                iterableFirst(
                    filterMapIterable(events, event =>
                        event.type === "Start" ? event.fileId : undefined,
                    ),
                ),
            );

            expect(await getFileAsUploader(space.systemAction(), space.id, fileId)).toEqual(
                new FileModel({
                    id: fileId,
                    contentType: "image/jpeg",
                    contentLength: 2274056,
                    isUploading: false,
                    alternative: null,
                    preview: {
                        type: "Image",
                        isProcessing: false,
                        ok: true,
                        size: {width: 3992, height: 2992, scale: 1, hasAlpha: false},
                        placeholder: expect.any(FileImagePreviewPlaceholder),
                    },
                }),
            );
        });

        test("can upload large image with a stream", async () => {
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

            const authorizationHeader = await authorization(session);

            await new Promise<void>((resolve, reject) => {
                socket.write(
                    `\
POST /${space.id}/upload HTTP/1.1\r\n\
Host: localhost:${port}\r\n\
Connection: close\r\n\
Authorization: ${authorizationHeader}\r\n\
Content-Type: image/jpeg\r\n\
Content-Length: 2274056\r\n\
\r\n\
`,
                    error => {
                        if (error) reject(error);
                        else resolve();
                    },
                );
            });

            fsSync
                .createReadStream(
                    joinPath(
                        runfilesPath,
                        "cyberworlds/server/files/upload/test_fixtures/unsplash_annie_spratt_0ArJET2aSIQ_large.jpeg",
                    ),
                )
                .pipe(socket, {end: false});

            await socketClosePromise;

            expect(
                socketText
                    .replace(/^Date: .*?\r\n/m, "")
                    .replace(/^[a-z0-9]+\r\n/gm, "chunk\r\n")
                    .replace(/,"fileId":"[^"]*"/m, ',"fileId":"..."')
                    .replace(
                        /,"placeholder":\[false,(\d+),".*?"\]/m,
                        ',"placeholder":[false,$1,"..."]',
                    ),
            ).toEqual(`\
HTTP/1.1 200 OK\r\n\
content-type: application/x-ndjson\r\n\
Connection: close\r\n\
Transfer-Encoding: chunked\r\n\
\r\n\
chunk\r\n\
{"type":"Start","fileId":"...","hasAlternative":false,"hasPreview":{"type":"Image","hasContent":false,"hasVideoDuration":false},"signedUrlSearch":""}\n\
\r\n\
chunk\r\n\
{"type":"ImagePreviewSize","size":{"width":3992,"height":2992,"scale":1,"hasAlpha":false}}\n\
\r\n\
chunk\r\n\
{"type":"ImagePreviewPlaceholder","placeholder":[false,7,"..."]}\n\
\r\n\
chunk\r\n\
{"type":"Finish"}\n\
\r\n\
chunk\r\n\
\r\n\
`);
        });

        test("can upload large image at a specific rate", async () => {
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

            const authorizationHeader = await authorization(session);

            await new Promise<void>((resolve, reject) => {
                socket.write(
                    `\
POST /${space.id}/upload HTTP/1.1\r\n\
Host: localhost:${port}\r\n\
Connection: close\r\n\
Authorization: ${authorizationHeader}\r\n\
Content-Type: image/jpeg\r\n\
Content-Length: 2274056\r\n\
\r\n\
`,
                    error => {
                        if (error) reject(error);
                        else resolve();
                    },
                );
            });

            const content = await fs.readFile(
                joinPath(
                    runfilesPath,
                    "cyberworlds/server/files/upload/test_fixtures/unsplash_annie_spratt_0ArJET2aSIQ_large.jpeg",
                ),
            );

            const contentRate = 50_000;

            for (let contentIndex = 0; contentIndex < content.length; contentIndex += contentRate) {
                if (!socket.write(content.subarray(contentIndex, contentIndex + contentRate))) {
                    await new Promise(resolve => {
                        socket.once("drain", resolve);
                    });
                }

                await wait(10);
            }

            await socketClosePromise;

            expect(
                socketText
                    .replace(/^Date: .*?\r\n/m, "")
                    .replace(/^[a-z0-9]+\r\n/gm, "chunk\r\n")
                    .replace(/,"fileId":"[^"]*"/m, ',"fileId":"..."')
                    .replace(
                        /,"placeholder":\[false,(\d+),".*?"\]/m,
                        ',"placeholder":[false,$1,"..."]',
                    ),
            ).toEqual(`\
HTTP/1.1 200 OK\r\n\
content-type: application/x-ndjson\r\n\
Connection: close\r\n\
Transfer-Encoding: chunked\r\n\
\r\n\
chunk\r\n\
{"type":"Start","fileId":"...","hasAlternative":false,"hasPreview":{"type":"Image","hasContent":false,"hasVideoDuration":false},"signedUrlSearch":""}\n\
\r\n\
chunk\r\n\
{"type":"ImagePreviewSize","size":{"width":3992,"height":2992,"scale":1,"hasAlpha":false}}\n\
\r\n\
chunk\r\n\
{"type":"ImagePreviewPlaceholder","placeholder":[false,7,"..."]}\n\
\r\n\
chunk\r\n\
{"type":"Finish"}\n\
\r\n\
chunk\r\n\
\r\n\
`);
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
                        authorization: await authorization(session),
                        "content-type": "image/jpeg",
                    },
                    body: await fs.readFile(jpegTestFixturePath),
                },
            );
            const responseText = await response.text();

            expect(response.status).toEqual(200);
            expect(massageHeaders(response.headers)).toEqual({
                "content-type": "application/x-ndjson",
            });
            const events = parseJsonEvents(responseText);
            expect(events).toEqual([
                {
                    type: "Start",
                    hasAlternative: false,
                    hasPreview: {
                        type: "Image",
                        hasContent: false,
                        hasVideoDuration: false,
                    },
                    fileId: providedFileId,
                    signedUrlSearch: "",
                },
                {
                    type: "ImagePreviewSize",
                    size: {width: 500, height: 375, scale: 1, hasAlpha: false},
                },
                {
                    type: "ImagePreviewPlaceholder",
                    placeholder: expect.any(FileImagePreviewPlaceholder),
                },
                {type: "Finish"},
            ]);

            expect(await getFileAsUploader(space.systemAction(), space.id, providedFileId)).toEqual(
                new FileModel({
                    id: providedFileId,
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
        });

        test("can't upload image with the same provided id twice", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const providedFileId = generateChronologicalId<FileId>();

            {
                const response = await fetch(
                    `http://localhost:${port}/${space.id}/upload?id=${providedFileId}`,
                    {
                        method: "POST",
                        headers: {
                            authorization: await authorization(session),
                            "content-type": "image/jpeg",
                        },
                        body: await fs.readFile(jpegTestFixturePath),
                    },
                );
                const responseText = await response.text();

                expect(response.status).toEqual(200);
                expect(massageHeaders(response.headers)).toEqual({
                    "content-type": "application/x-ndjson",
                });
                const events = parseJsonEvents(responseText);
                expect(events).toEqual([
                    {
                        type: "Start",
                        hasAlternative: false,
                        hasPreview: {
                            type: "Image",
                            hasContent: false,
                            hasVideoDuration: false,
                        },
                        fileId: providedFileId,
                        signedUrlSearch: "",
                    },
                    {
                        type: "ImagePreviewSize",
                        size: {width: 500, height: 375, scale: 1, hasAlpha: false},
                    },
                    {
                        type: "ImagePreviewPlaceholder",
                        placeholder: expect.any(FileImagePreviewPlaceholder),
                    },
                    {type: "Finish"},
                ]);
            }

            expect(await getFileAsUploader(space.systemAction(), space.id, providedFileId)).toEqual(
                new FileModel({
                    id: providedFileId,
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
                const response = await fetch(
                    `http://localhost:${port}/${space.id}/upload?id=${providedFileId}`,
                    {
                        method: "POST",
                        headers: {
                            authorization: await authorization(session),
                            "content-type": "image/jpeg",
                        },
                        body: await fs.readFile(jpegTestFixturePath),
                    },
                );
                const responseText = await response.text();

                expect(response.status).toEqual(400);
                expect(massageHeaders(response.headers)).toEqual({
                    "content-type": "application/x-ndjson",
                });
                const events = parseJsonEvents(responseText);
                expect(events).toEqual([
                    {
                        type: "Error",
                        error: new FailedPreconditionError(
                            "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [None, ConditionalCheckFailed]",
                        ),
                    },
                ]);
            }
        });

        test("can upload image with a provided that has a time way before the current time", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const providedFileId = generateChronologicalIdWithTime<FileId>(
                Date.now() + 1000 * 60 * 10,
            );

            const response = await fetch(
                `http://localhost:${port}/${space.id}/upload?id=${providedFileId}`,
                {
                    method: "POST",
                    headers: {
                        authorization: await authorization(session),
                        "content-type": "image/jpeg",
                    },
                    body: await fs.readFile(jpegTestFixturePath),
                },
            );
            const responseText = await response.text();

            expect(response.status).toEqual(400);
            expect(massageHeaders(response.headers)).toEqual({
                "content-type": "application/x-ndjson",
            });
            const events = parseJsonEvents(responseText);
            expect(events).toEqual([
                {
                    type: "Error",
                    error: new FailedPreconditionError(
                        "Provided `FileId` must be within a 4 minute window of the current time",
                    ),
                },
            ]);

            await expect(
                getFileAsUploader(space.systemAction(), space.id, providedFileId),
            ).rejects.toThrow(new NotFoundError("File not found"));
        });

        test("can upload image with a provided that has a time way after the current time", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const providedFileId = generateChronologicalIdWithTime<FileId>(
                Date.now() - 1000 * 60 * 10,
            );

            const response = await fetch(
                `http://localhost:${port}/${space.id}/upload?id=${providedFileId}`,
                {
                    method: "POST",
                    headers: {
                        authorization: await authorization(session),
                        "content-type": "image/jpeg",
                    },
                    body: await fs.readFile(jpegTestFixturePath),
                },
            );
            const responseText = await response.text();

            expect(response.status).toEqual(400);
            expect(massageHeaders(response.headers)).toEqual({
                "content-type": "application/x-ndjson",
            });
            const events = parseJsonEvents(responseText);
            expect(events).toEqual([
                {
                    type: "Error",
                    error: new FailedPreconditionError(
                        "Provided `FileId` must be within a 4 minute window of the current time",
                    ),
                },
            ]);

            await expect(
                getFileAsUploader(space.systemAction(), space.id, providedFileId),
            ).rejects.toThrow(new NotFoundError("File not found"));
        });
    });
}
