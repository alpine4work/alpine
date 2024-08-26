import {R2Bucket} from "@miniflare/r2";
import {FileStorage} from "@miniflare/storage-file";
import fs from "fs/promises";
import getPort from "get-port";
import {Server} from "http";
import {join as joinPath} from "path";
import {CloudflareR2ContextModule} from "~/server/cloudflare/r2/cloudflare_r2_context_module.js";
import {filesBucketName} from "~/server/cloudflare/r2/files_bucket_name.js";
import {MiniflareR2Client} from "~/server/cloudflare/r2/miniflare_r2_client.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createTestTokenAgents} from "~/server/dynamo/test_helpers/create_test_token_agent.js";
import {getFile} from "~/server/files/data/files_table.js";
import {createFileUploadService} from "~/server/files/upload/file_upload_service.js";
import {UploadFileEventSchema} from "~/server/files/upload/upload_file.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {FileContentType} from "~/shared/files/file_content_type.js";
import {FileModel} from "~/shared/files/file_model.js";
import {FilePreviewPlaceholder} from "~/shared/files/file_preview_placeholder.js";
import {NonEmptyReadonlyArray} from "~/shared/helpers/array/non_empty_readonly_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {iterableFirst} from "~/shared/helpers/iterable/iterable_first.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {quote} from "~/shared/helpers/string/quote.js";

// Make sure we have at least one file as a test case for each of the
// `FileContentType`s we support.
const testCases: {
    [Key in FileContentType]: NonEmptyReadonlyArray<{
        path: string;
        contentLength: number;
        size: {width: number; height: number};
    }>;
} = {
    "image/apng": [
        {
            path: "unsplash_annie_spratt_0ArJET2aSIQ.png",
            contentLength: 103683,
            size: {width: 500, height: 375},
        },
        {
            path: "wikimedia_bouncing_beach_ball.png",
            contentLength: 61968,
            size: {width: 100, height: 100},
        },
    ],
    "image/avif": [
        {
            path: "unsplash_annie_spratt_0ArJET2aSIQ.avif",
            contentLength: 3704,
            size: {width: 500, height: 375},
        },
    ],
    "image/gif": [
        {
            path: "unsplash_annie_spratt_0ArJET2aSIQ.gif",
            contentLength: 64718,
            size: {width: 500, height: 375},
        },
        {
            path: "wikimedia_rotating_earth.gif",
            contentLength: 118405,
            size: {width: 400, height: 400},
        },
    ],
    "image/jpeg": [
        {
            path: "unsplash_annie_spratt_0ArJET2aSIQ.jpeg",
            contentLength: 33102,
            size: {width: 500, height: 375},
        },
    ],
    "image/png": [
        {
            path: "unsplash_annie_spratt_0ArJET2aSIQ.png",
            contentLength: 103683,
            size: {width: 500, height: 375},
        },
        {
            path: "wikimedia_bouncing_beach_ball.png",
            contentLength: 61968,
            size: {width: 100, height: 100},
        },
    ],
    "image/svg+xml": [
        {
            path: "undraw_landscape_photographer.svg",
            contentLength: 4701,
            size: {width: 732, height: 619},
        },
    ],
    "image/webp": [
        {
            path: "unsplash_annie_spratt_0ArJET2aSIQ.webp",
            contentLength: 60260,
            size: {width: 500, height: 375},
        },
    ],
};

let serverTokenAgent: TokenAgent;
let tokenAgent: TokenAgent;
let port: number;
let server: Server;

const context = createTestContext();

beforeAll(async () => {
    const r2Storage = new FileStorage(joinPath(context.getTempPath(), "r2", filesBucketName));
    const r2Bucket = new R2Bucket(r2Storage);
    const r2ContextModule = new CloudflareR2ContextModule(
        new MiniflareR2Client(new Map([[filesBucketName, r2Bucket]])),
    );

    [[serverTokenAgent, tokenAgent], port] = await runAllPromises([
        createTestTokenAgents(context, ["FileUploadService", "EdgeService"]),
        getPort(),
    ]);
    server = createFileUploadService(context.clone({r2: r2ContextModule}), serverTokenAgent);

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

async function authorization(session: TestSession) {
    const token = await tokenAgent.privateSide.dangerouslySignShortLivedToken(
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

for (const [contentType, contentTypeTestCases] of Object.entries(testCases)) {
    for (const {path, contentLength, size} of contentTypeTestCases) {
        // eslint-disable-next-line jest/valid-title
        test(quote`can upload ${contentType} file ${path}`, async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            const response = await fetch(`http://localhost:${port}/${space.id}/upload`, {
                method: "POST",
                headers: {
                    authorization: await authorization(session),
                    "content-type": contentType,
                },
                body: await fs.readFile(
                    joinPath(runfilesPath, "cyberworlds/server/files/upload/test_fixtures", path),
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
                    fileId: expect.any(String),
                },
                {type: "PreviewSize", width: size.width, height: size.height},
                {type: "PreviewPlaceholder", placeholder: expect.any(FilePreviewPlaceholder)},
                {type: "Finish"},
            ]);

            const fileId = assertExists(
                iterableFirst(
                    filterMapIterable(events, event =>
                        event.type === "Start" ? event.fileId : null,
                    ),
                ),
            );

            expect(await getFile(space.systemAction(), fileId)).toEqual(
                new FileModel({
                    id: fileId,
                    contentType: contentType as FileContentType,
                    contentLength,
                    isUploading: false,
                    preview: {
                        isProcessing: false,
                        size: {width: size.width, height: size.height},
                        placeholder: expect.any(FilePreviewPlaceholder),
                    },
                }),
            );
        });
    }
}
