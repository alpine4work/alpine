import fs from "fs";
import getPort from "get-port";
import {Server} from "http";
import net from "net";
import {join as joinPath} from "path";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createFileUploadServer} from "~/server/files/upload/file_upload_server.js";
import {UploadFileEventSchema} from "~/server/files/upload/internal/upload_file.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";

let port: number;
let server: Server;

const context = createTestContext();

beforeAll(async () => {
    port = await getPort();
    server = createFileUploadServer(context.tracer.getRoot(), context);

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
    const response = await fetch(`http://localhost:${port}/unknown`);
    const responseText = await response.text();

    expect(response.status).toEqual(404);
    expect(massageHeaders(response.headers)).toEqual({"content-type": "text/plain"});
    expect(responseText).toEqual("404 Not Found");
});

test("must use POST method to upload route", async () => {
    const response = await fetch(`http://localhost:${port}/upload`);
    const responseText = await response.text();

    expect(response.status).toEqual(400);
    expect(massageHeaders(response.headers)).toEqual({"content-type": "application/x-ndjson"});
    expect(parseJsonEvents(responseText)).toEqual([
        {type: "Error", error: new InvalidArgumentError('Must use "POST" method')},
    ]);
});

test("must provide Content-Type header to upload route", async () => {
    const response = await fetch(`http://localhost:${port}/upload`, {method: "POST"});
    const responseText = await response.text();

    expect(response.status).toEqual(400);
    expect(massageHeaders(response.headers)).toEqual({"content-type": "application/x-ndjson"});
    expect(parseJsonEvents(responseText)).toEqual([
        {type: "Error", error: new InvalidArgumentError('"Content-Type" header is required')},
    ]);
});

test("must provide a valid Content-Type header to upload route", async () => {
    const response = await fetch(`http://localhost:${port}/upload`, {
        method: "POST",
        headers: {"content-type": "text/html"},
    });
    const responseText = await response.text();

    expect(response.status).toEqual(400);
    expect(massageHeaders(response.headers)).toEqual({"content-type": "application/x-ndjson"});
    expect(parseJsonEvents(responseText)).toEqual([
        {
            type: "Error",
            error: new InvalidArgumentError('Unsupported "Content-Type" header "text/html"'),
        },
    ]);
});

test("can't upload data with a Content-Length header that's too big", async () => {
    const response = await fetch(`http://localhost:${port}/upload`, {
        method: "POST",
        headers: {"content-type": "image/png"},
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

test("if more data is written than what's in Content-Length server truncates the content and only processes the truncated content", async () => {
    // We use Node.js's raw `net.connect()` utilities in this test to send an HTTP
    // request because we want to intentionally write more bytes than what's
    // declared by `Content-Length`. Node.js's `http.createServer()` should
    // truncate for us. But we want to make sure this happens with a test so we
    // don't accidentally let attackers upload larger files then what we allow.

    {
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

        await new Promise<void>((resolve, reject) => {
            socket.write(
                `\
POST /upload HTTP/1.1\r\n\
Host: localhost:${port}\r\n\
Connection: close\r\n\
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

        fs.createReadStream(
            joinPath(
                runfilesPath,
                "cyberworlds/server/files/upload/test_fixtures/unsplash_annie_spratt_0ArJET2aSIQ.jpeg",
            ),
        ).pipe(socket, {end: false});

        await socketClosePromise;

        expect(
            socketText
                .replace(/^Date: .*?\r\n/m, "")
                .replace(/^[a-z0-9]+\r\n/gm, "chunk\r\n")
                .replace(/,"placeholder":\[false,8,".*?"\]/m, ',"placeholder":[false,8,"..."]'),
        ).toEqual(`\
HTTP/1.1 200 OK\r\n\
content-type: application/x-ndjson\r\n\
Connection: close\r\n\
Transfer-Encoding: chunked\r\n\
\r\n\
chunk\r\n\
{"type":"PreviewSize","width":500,"height":375}\n\
\r\n\
chunk\r\n\
{"type":"PreviewPlaceholder","placeholder":[false,8,"..."]}\n\
\r\n\
chunk\r\n\
{"type":"Ok"}\n\
\r\n\
chunk\r\n\
\r\n\
`);
    }

    {
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

        await new Promise<void>((resolve, reject) => {
            socket.write(
                `\
POST /upload HTTP/1.1\r\n\
Host: localhost:${port}\r\n\
Connection: close\r\n\
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

        fs.createReadStream(
            joinPath(
                runfilesPath,
                "cyberworlds/server/files/upload/test_fixtures/unsplash_annie_spratt_0ArJET2aSIQ.jpeg",
            ),
        ).pipe(socket, {end: false});

        await socketClosePromise;

        expect(
            socketText
                .replace(/^Date: .*?\r\n/m, "")
                .replace(/^[a-z0-9]+\r\n/gm, "chunk\r\n")
                .replace(/,"stack":".*?"/m, "")
                .replace(/,"original":{.*?}/m, ""),
        ).toEqual(`\
HTTP/1.1 200 OK\r\n\
content-type: application/x-ndjson\r\n\
Connection: close\r\n\
Transfer-Encoding: chunked\r\n\
\r\n\
chunk\r\n\
{"type":"PreviewSize","width":500,"height":375}\n\
\r\n\
chunk\r\n\
{"type":"Error","error":{"code":3,"message":"VipsJpeg: Premature end of input file","name":"InvalidArgumentError"}}\n\
\r\n\
chunk\r\n\
\r\n\
`);
    }
});

test("can't upload invalid image data", async () => {
    const response = await fetch(`http://localhost:${port}/upload`, {
        method: "POST",
        headers: {"content-type": "image/png"},
        body: new Uint8Array(1e5),
    });
    const responseText = await response.text();

    expect(response.status).toEqual(400);
    expect(massageHeaders(response.headers)).toEqual({"content-type": "application/x-ndjson"});
    expect(parseJsonEvents(responseText)).toEqual([
        {
            type: "Error",
            error: new InvalidArgumentError("Input buffer contains unsupported image format"),
        },
    ]);
});
