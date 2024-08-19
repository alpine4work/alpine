import getPort from "get-port";
import {Server} from "http";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createFileUploadServer} from "~/server/files/upload/file_upload_server.js";
import {UploadFileEventSchema} from "~/server/files/upload/internal/upload_file.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {createIterableWithLength} from "~/shared/helpers/iterable/create_iterable_with_length.js";
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

test.only("can't upload invalid image data", async () => {
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
