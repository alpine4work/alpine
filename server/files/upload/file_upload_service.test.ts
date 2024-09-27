import {R2Bucket} from "@miniflare/r2";
import {FileStorage} from "@miniflare/storage-file";
import fsWithoutPromises from "fs";
import fs from "fs/promises";
import getPort from "get-port";
import {Server} from "http";
import net from "net";
import {join as joinPath} from "path";
import sharp from "sharp";
import {CloudflareR2ContextModule} from "~/server/cloudflare/r2/cloudflare_r2_context_module.js";
import {filesBucketName} from "~/server/cloudflare/r2/files_bucket_name.js";
import {MiniflareR2Client} from "~/server/cloudflare/r2/miniflare_r2_client.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createTestTokenAgents} from "~/server/dynamo/test_helpers/create_test_token_agent.js";
import {getFileAsUploader} from "~/server/files/data/files_table.js";
import {createFileUploadService} from "~/server/files/upload/file_upload_service.js";
import {ffprobeExecutablePath} from "~/server/files/upload/processors/file_video_and_audio_processor_base.js";
import {runProcess} from "~/server/helpers/node/run_process.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {waitForExpect} from "~/server/helpers/test/wait_for_expect.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {InvalidArgumentError, NotFoundError, PermissionDeniedError} from "~/shared/error/error.js";
import {ErrorCode} from "~/shared/error/error_code.js";
import {FileImagePreviewPlaceholder} from "~/shared/files/file_image_preview_placeholder.js";
import {FileModel} from "~/shared/files/file_model.js";
import {UploadFileEventSchema} from "~/shared/files/upload_file_event.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {iterableFirst} from "~/shared/helpers/iterable/iterable_first.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {assertId} from "~/shared/id/id.js";
import {FileId} from "~/shared/id/types/id_types.js";

const jpegTestFixturePath = joinPath(
    runfilesPath,
    "cyberworlds/server/files/upload/test_fixtures/unsplash_annie_spratt_0ArJET2aSIQ.jpeg",
);

let serverTokenAgent: TokenAgent;
let tokenAgent: TokenAgent;
let port: number;
let server: Server;

const context = createTestContext();

beforeAll(async () => {
    port = await getPort();

    const r2Storage = new FileStorage(
        joinPath(context.getTemporaryDirectoryPath(), "r2", filesBucketName),
    );
    const r2Bucket = new R2Bucket(r2Storage);
    const r2ContextModule = new CloudflareR2ContextModule(
        new MiniflareR2Client({
            fileUploadServiceHostname: `localhost:${port}`,
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
    expect(massageHeaders(response.headers)).toEqual({"content-type": "application/x-ndjson"});
    expect(parseJsonEvents(responseText)).toEqual([
        {type: "Error", error: new PermissionDeniedError("System actor is not a session actor")},
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
    expect(massageHeaders(response.headers)).toEqual({"content-type": "application/x-ndjson"});
    expect(parseJsonEvents(responseText)).toEqual([
        {type: "Error", error: new PermissionDeniedError("Account doesn't have access to space")},
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
    expect(massageHeaders(response.headers)).toEqual({"content-type": "application/x-ndjson"});
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
    expect(massageHeaders(response.headers)).toEqual({"content-type": "application/x-ndjson"});
    expect(parseJsonEvents(responseText)).toEqual([
        {type: "Error", error: new InvalidArgumentError('"Content-Type" header is required')},
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
    expect(massageHeaders(response.headers)).toEqual({"content-type": "application/x-ndjson"});
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
    expect(massageHeaders(response.headers)).toEqual({"content-type": "application/x-ndjson"});
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

    fsWithoutPromises.createReadStream(jpegTestFixturePath).pipe(socket, {end: false});

    await socketClosePromise;

    expect(
        socketText
            .replace(/^Date: .*?\r\n/m, "")
            .replace(/^[a-z0-9]+\r\n/gm, "chunk\r\n")
            .replace(/,"fileId":"[^"]*"/m, ',"fileId":"..."')
            .replace(/,"placeholder":\[false,5,".*?"\]/m, ',"placeholder":[false,5,"..."]'),
    ).toEqual(`\
HTTP/1.1 200 OK\r\n\
content-type: application/x-ndjson\r\n\
Connection: close\r\n\
Transfer-Encoding: chunked\r\n\
\r\n\
chunk\r\n\
{"type":"Start","fileId":"...","hasAlternative":false,"hasPreview":{"type":"Image","hasContent":false,"hasVideoDuration":false},"previewUrlSearch":""}\n\
\r\n\
chunk\r\n\
{"type":"ImagePreviewSize","size":{"width":500,"height":375,"scale":1}}\n\
\r\n\
chunk\r\n\
{"type":"ImagePreviewPlaceholder","placeholder":[false,5,"..."]}\n\
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
                size: {width: 500, height: 375, scale: 1},
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

    fsWithoutPromises.createReadStream(jpegTestFixturePath).pipe(socket, {end: false});

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
{"type":"Start","fileId":"...","hasAlternative":false,"hasPreview":{"type":"Image","hasContent":false,"hasVideoDuration":false},"previewUrlSearch":""}\n\
\r\n\
chunk\r\n\
{"type":"ImagePreviewSize","size":{"width":500,"height":375,"scale":1}}\n\
\r\n\
chunk\r\n\
{"type":"Error","error":{...}}\n\
\r\n\
chunk\r\n\
\r\n\
`);

    const match = assertExists(socketText.match(/,"fileId":"([^"]*)"/m));
    const fileId = assertId<FileId>(match[1]!);

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
            .replace(/,"placeholder":\[false,5,".*?"\]/m, ',"placeholder":[false,5,"..."]'),
    ).toEqual(`\
HTTP/1.1 200 OK\r\n\
content-type: application/x-ndjson\r\n\
Connection: close\r\n\
Transfer-Encoding: chunked\r\n\
\r\n\
chunk\r\n\
{"type":"Start","fileId":"...","hasAlternative":false,"hasPreview":{"type":"Image","hasContent":false,"hasVideoDuration":false},"previewUrlSearch":""}\n\
\r\n\
`);

    await waitForExpect(async () => {
        await expect(getFileAsUploader(space.systemAction(), space.id, fileId)).rejects.toThrow(
            NotFoundError,
        );
    });
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

    socket.write(jpegTestFixtureContents.subarray(Math.floor(jpegTestFixtureContents.length / 2)));

    await socketClosePromise;

    expect(
        socketText
            .replace(/^Date: .*?\r\n/m, "")
            .replace(/^[a-z0-9]+\r\n/gm, "chunk\r\n")
            .replace(/,"fileId":"[^"]*"/m, ',"fileId":"..."')
            .replace(/,"placeholder":\[false,5,".*?"\]/m, ',"placeholder":[false,5,"..."]'),
    ).toEqual(`\
HTTP/1.1 200 OK\r\n\
content-type: application/x-ndjson\r\n\
Connection: close\r\n\
Transfer-Encoding: chunked\r\n\
\r\n\
chunk\r\n\
{"type":"Start","fileId":"...","hasAlternative":false,"hasPreview":{"type":"Image","hasContent":false,"hasVideoDuration":false},"previewUrlSearch":""}\n\
\r\n\
chunk\r\n\
{"type":"ImagePreviewSize","size":{"width":500,"height":375,"scale":1}}\n\
\r\n\
chunk\r\n\
{"type":"ImagePreviewPlaceholder","placeholder":[false,5,"..."]}\n\
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
                size: {width: 500, height: 375, scale: 1},
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
    expect(massageHeaders(response.headers)).toEqual({"content-type": "application/x-ndjson"});
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
            previewUrlSearch: "",
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
            filterMapIterable(events, event => (event.type === "Start" ? event.fileId : undefined)),
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
    expect(massageHeaders(response.headers)).toEqual({"content-type": "application/x-ndjson"});
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
            previewUrlSearch: "",
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
            filterMapIterable(events, event => (event.type === "Start" ? event.fileId : undefined)),
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
    expect(massageHeaders(response.headers)).toEqual({"content-type": "application/x-ndjson"});
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
            previewUrlSearch: "",
        },
        {type: "ImagePreviewSize", size: {width: 500, height: 375, scale: 1}},
        {type: "ImagePreviewPlaceholder", placeholder: expect.any(FileImagePreviewPlaceholder)},
        {type: "Finish"},
    ]);

    const fileId = assertExists(
        iterableFirst(
            filterMapIterable(events, event => (event.type === "Start" ? event.fileId : undefined)),
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
                size: {width: 500, height: 375, scale: 1},
                placeholder: expect.any(FileImagePreviewPlaceholder),
            },
        }),
    );
});

test.only("can't resize an image with a session actor", async () => {
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
            previewUrlSearch: "",
        },
        {type: "ImagePreviewSize", size: {width: 500, height: 375, scale: 1}},
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

test.only("can't resize an image with a token that's not from edge service", async () => {
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
            previewUrlSearch: "",
        },
        {type: "ImagePreviewSize", size: {width: 500, height: 375, scale: 1}},
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

test.only("can resize a JPEG image", async () => {
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
            previewUrlSearch: "",
        },
        {type: "ImagePreviewSize", size: {width: 500, height: 375, scale: 1}},
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

test.only("can resize a PNG image", async () => {
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
            previewUrlSearch: "",
        },
        {type: "ImagePreviewSize", size: {width: 336, height: 252, scale: 1}},
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
            width: 336,
            height: 252,
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

// TODO(calebmer, #files): Make sure animated GIFs work.
test.only("can resize a GIF image", async () => {
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
            previewUrlSearch: "",
        },
        {type: "ImagePreviewSize", size: {width: 400, height: 400, scale: 1}},
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
                    }),
                    expect.objectContaining({
                        codec_name: "av1",
                        codec_type: "video",
                        width: 200,
                        height: 200,
                        start_time: "0.000000",
                        duration: "1.980000",
                        avg_frame_rate: "50/3",
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
                    }),
                    expect.objectContaining({
                        codec_name: "av1",
                        codec_type: "video",
                        width: 300,
                        height: 300,
                        start_time: "0.000000",
                        duration: "1.980000",
                        avg_frame_rate: "50/3",
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
                    }),
                    expect.objectContaining({
                        codec_name: "av1",
                        codec_type: "video",
                        width: 400,
                        height: 400,
                        start_time: "0.000000",
                        duration: "1.980000",
                        avg_frame_rate: "50/3",
                    }),
                ],
            }),
        );
    }
});

test.only("can resize an AVIF image", async () => {
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
            previewUrlSearch: "",
        },
        {type: "ImagePreviewSize", size: {width: 640, height: 426, scale: 1}},
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
