import {R2Bucket} from "@miniflare/r2";
import {FileStorage} from "@miniflare/storage-file";
import fs from "fs/promises";
import getPort from "get-port";
import {Server} from "http";
import looksSame from "looks-same";
import {join as joinPath} from "path";
import createSharp from "sharp";
import {ReadableStream} from "stream/web";
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
import {InternalError, InvalidArgumentError, NotFoundError} from "~/shared/error/error.js";
import {
    FileContentType,
    getFileContentTypePreferredExtension,
} from "~/shared/files/file_content_type.js";
import {FileModel} from "~/shared/files/file_model.js";
import {FilePreviewPlaceholder} from "~/shared/files/file_preview_placeholder.js";
import {NonEmptyReadonlyArray} from "~/shared/helpers/array/non_empty_readonly_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {findMapIterable} from "~/shared/helpers/iterable/find_map_iterable.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {quote} from "~/shared/helpers/string/quote.js";

// Use TypeScript to make sure we have at least one file as a test case for
// each of the `FileContentType`s we support.
const testCases: {
    [Key in FileContentType]: NonEmptyReadonlyArray<{
        path: string;
        contentLength: number;
        size: {width: number; height: number};
        placeholder: FilePreviewPlaceholder;
        image?: {
            contentType: FileContentType;
            contentLength: number;
            similarPath: string;
        };
    }>;
} = {
    "image/apng": [
        {
            path: "unsplash_annie_spratt_0ArJET2aSIQ.png",
            contentLength: 103683,
            size: {width: 500, height: 375},
            placeholder: FilePreviewPlaceholder.schema.deserialize([
                false,
                5,
                "yNTYzdfbztjcztfbzdba1tnZ2tzc3+Pj4uTl3d7guLSutrKs0M7L0M3IsK2klaerlqqtn7K0o7K1p7K0",
            ]),
        },
        {
            path: "wikimedia_bouncing_beach_ball.png",
            contentLength: 61968,
            size: {width: 100, height: 100},
            placeholder: FilePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/2tQE6OEuGIhLLwXAAAAAAAAAABhbGdelbRa/01KNWAAAAAAAAAAAAApcx8ANiOIJUIAGwAAAAAAAAAAqqpVA/7+SAdVVVUDAAAAAA==",
            ]),
        },
    ],
    "image/avif": [
        {
            path: "unsplash_annie_spratt_0ArJET2aSIQ.avif",
            contentLength: 3704,
            size: {width: 500, height: 375},
            placeholder: FilePreviewPlaceholder.schema.deserialize([
                false,
                5,
                "yNTYy9bbz9jcztfbzdba1tnZ2tzd3+Pj4uTl3d7fuLSvtLKt0M7L0M3IsK2klaerlqqun7C1o7K1p7K0",
            ]),
        },
    ],
    "image/gif": [
        {
            path: "unsplash_annie_spratt_0ArJET2aSIQ.gif",
            contentLength: 64718,
            size: {width: 500, height: 375},
            placeholder: FilePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "x9TY/8vW2//O2Nv/ztfa/83W2v/W2dn/2Nzd/97j5f/i5OX/3d7f/7a0rv+0saz/0M7L/9DNyP+xrKX/laer/5aprf+fr7T/o7K1/6eytf8=",
            ]),
        },
        {
            path: "wikimedia_rotating_earth.gif",
            contentLength: 118405,
            size: {width: 400, height: 400},
            placeholder: FilePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "AgEA/wMFEP8BAw//AAAA/wAAAf8AAAr/DhZM/3lwWf9HQSr/AgEC/wACCv8nLFX/o5xp/1ZTKv8AAAL/BAQA/wIDIv8HCyf/DhEF/wAABP8BAQL/AgEB/wQCBv8DAQT/AgED/w==",
            ]),
        },
    ],
    "image/jpeg": [
        {
            path: "unsplash_annie_spratt_0ArJET2aSIQ.jpeg",
            contentLength: 33102,
            size: {width: 500, height: 375},
            placeholder: FilePreviewPlaceholder.schema.deserialize([
                false,
                5,
                "x9LXytXaztfbztfay9bY19rb3N/g3+Ll4OPm3+HhtrKssq+q0M3L0c3Jsaymna2vm62xp7a6qra6q7O0",
            ]),
        },
    ],
    "image/png": [
        {
            path: "unsplash_annie_spratt_0ArJET2aSIQ.png",
            contentLength: 103683,
            size: {width: 500, height: 375},
            placeholder: FilePreviewPlaceholder.schema.deserialize([
                false,
                5,
                "yNTYzdfbztjcztfbzdba1tnZ2tzc3+Pj4uTl3d7guLSutrKs0M7L0M3IsK2klaerlqqtn7K0o7K1p7K0",
            ]),
        },
        {
            path: "wikimedia_png_transparency_demonstration.png",
            contentLength: 76547,
            size: {width: 336, height: 252},
            placeholder: FilePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "bGzYIUpW8Jo1f6owN7k9fFq0WhFupv8Xj2bAsLxTYc9jkTinAOsTDQAAAADTXDYvy2hP8t1gYD0AAAAAAAAAAJ+/fwiltkw/jcY4CQAAAAA=",
            ]),
        },
        {
            path: "wikimedia_bouncing_beach_ball.png",
            contentLength: 61968,
            size: {width: 100, height: 100},
            placeholder: FilePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/2tQE6OEuGIhLLwXAAAAAAAAAABhbGdelbRa/01KNWAAAAAAAAAAAAApcx8ANiOIJUIAGwAAAAAAAAAAqqpVA/7+SAdVVVUDAAAAAA==",
            ]),
        },
    ],
    "image/svg+xml": [
        {
            path: "undraw_landscape_photographer.svg",
            contentLength: 4701,
            size: {width: 732, height: 619},
            placeholder: FilePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "VVVVA2hWeVd3YrucAAAAAAAAAAAAAAAAaFz/DVZY/70AAAAAAAAAAAAAAAAAAAAALSxEowAAAAAAAAAAAAAAAAAAAABEO0+JAAAAAAAAAAA=",
            ]),
        },
    ],
    "image/webp": [
        {
            path: "unsplash_annie_spratt_0ArJET2aSIQ.webp",
            contentLength: 60260,
            size: {width: 500, height: 375},
            placeholder: FilePreviewPlaceholder.schema.deserialize([
                false,
                5,
                "yNTXzdba0Njc0Njcztfa297e3uLj4uXl4uTl3+Hhr62nq6mjxsXDysfCp6Sdoa+yorK2qbm7rru9sru9",
            ]),
        },
    ],
    "image/bmp": [
        {
            path: "unsplash_annie_spratt_0ArJET2aSIQ.bmp",
            contentLength: 141432,
            size: {width: 250, height: 188},
            placeholder: FilePreviewPlaceholder.schema.deserialize([
                false,
                5,
                "yNTYzdfbztjcztfbzdba1tnZ2tzc3+Pj4uTl3d7guLSutrKs0M7L0M3IsK2klaerlqqtn7K0o7K1p7K0",
            ]),
            image: {
                contentType: "image/jpeg",
                contentLength: 20318,
                similarPath: "unsplash_annie_spratt_0ArJET2aSIQ.bmp.jpeg",
            },
        },
    ],
    "image/tiff": [
        {
            path: "unsplash_annie_spratt_0ArJET2aSIQ.tiff",
            contentLength: 118764,
            size: {width: 500, height: 375},
            placeholder: FilePreviewPlaceholder.schema.deserialize([
                false,
                5,
                "yNTYzdfbztjcztfbzdba1tnZ2tzc3+Pj4uTl3d7guLSutrKs0M7L0M3IsK2klaerlqqtn7K0o7K1p7K0",
            ]),
            image: {
                contentType: "image/png",
                contentLength: 118872,
                similarPath: "unsplash_annie_spratt_0ArJET2aSIQ.png",
            },
        },
        {
            path: "wikimedia_png_transparency_demonstration.tiff",
            contentLength: 107676,
            size: {width: 336, height: 252},
            placeholder: FilePreviewPlaceholder.schema.deserialize([
                true,
                5,
                "bGzYIUpX8Jo1f6owN7Q9fFq0WhFupv8Xj2bAsLxTYc9kjzanAOsTDQAAAADTXDYvymlP8t1gYD0AAAAAAAAAAJ+/fwilskQ/japVCQAAAAA=",
            ]),
            image: {
                contentType: "image/png",
                contentLength: 92917,
                similarPath: "wikimedia_png_transparency_demonstration.png",
            },
        },
    ],
};

let r2Bucket: R2Bucket;
let serverTokenAgent: TokenAgent;
let tokenAgent: TokenAgent;
let port: number;
let server: Server;

const context = createTestContext();

beforeAll(async () => {
    const r2Storage = new FileStorage(joinPath(context.getTempPath(), "r2", filesBucketName));
    r2Bucket = new R2Bucket(r2Storage);
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

test("can process bmp files", async () => {
    const metadata = await createSharp(
        joinPath(
            runfilesPath,
            "cyberworlds/server/files/upload/test_fixtures/unsplash_annie_spratt_0ArJET2aSIQ.bmp",
        ),
    ).metadata();

    expect(metadata.format).toEqual("magick");
    expect(metadata.formatMagick).toEqual("BMP");
});

test("can process pdf files", async () => {
    const metadata = await createSharp(
        joinPath(
            runfilesPath,
            "cyberworlds/server/files/upload/test_fixtures/iup_pdf_testpage.pdf",
        ),
    ).metadata();

    expect(metadata.format).toEqual("pdf");
});

test("looks same tester works", async () => {
    const {equal} = await looksSame(
        ...(await runAllPromises([
            fs.readFile(
                joinPath(
                    runfilesPath,
                    "cyberworlds/server/files/upload/test_fixtures/unsplash_annie_spratt_0ArJET2aSIQ.png",
                ),
            ),
            fs.readFile(
                joinPath(
                    runfilesPath,
                    "cyberworlds/server/files/upload/test_fixtures/wikimedia_png_transparency_demonstration.png",
                ),
            ),
        ])),
    );

    if (equal) {
        throw new InternalError(
            "The two images we provided look the same when we expected them to not look the same",
        );
    }
});

for (const [contentType, contentTypeTestCases] of Object.entries(testCases)) {
    for (const {
        path,
        contentLength: expectedContentLength,
        size: expectedSize,
        placeholder: expectedPlaceholder,
        image: expectedImage,
    } of contentTypeTestCases) {
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

            expect(massageHeaders(response.headers)).toEqual({
                "content-type": "application/x-ndjson",
            });
            const eventOrder = [
                "Start",
                "PreviewSize",
                "PreviewPlaceholder",
                "PreviewImage",
                "Finish",
            ];
            const events = parseJsonEvents(responseText).sort(
                (event1, event2) =>
                    eventOrder.indexOf(event1.type) - eventOrder.indexOf(event2.type),
            );
            expect(events).toEqual([
                {
                    type: "Start",
                    hasPreview: true,
                    hasPreviewImage: !!expectedImage,
                    fileId: expect.any(String),
                },
                {
                    type: "PreviewSize",
                    width: expectedSize.width,
                    height: expectedSize.height,
                },
                {
                    type: "PreviewPlaceholder",
                    placeholder: expect.any(FilePreviewPlaceholder),
                },
                ...(expectedImage
                    ? [
                          {
                              type: "PreviewImage",
                              contentType: expectedImage.contentType,
                              contentLength: expectedImage.contentLength,
                          },
                      ]
                    : []),
                {
                    type: "Finish",
                },
            ]);
            expect(response.status).toEqual(200);

            const fileId = assertExists(
                findMapIterable(events, event =>
                    event.type === "Start" ? event.fileId : undefined,
                ),
            );

            const placeholder = assertExists(
                findMapIterable(events, event =>
                    event.type === "PreviewPlaceholder" ? event.placeholder : undefined,
                ),
            );

            expect(await getFile(space.systemAction(), fileId)).toEqual(
                new FileModel({
                    id: fileId,
                    contentType: contentType as FileContentType,
                    contentLength: expectedContentLength,
                    isUploading: false,
                    preview: {
                        isProcessing: false,
                        size: {width: expectedSize.width, height: expectedSize.height},
                        placeholder: expect.any(FilePreviewPlaceholder),
                        image: expectedImage
                            ? {
                                  contentType: expectedImage.contentType,
                                  contentLength: expectedImage.contentLength,
                              }
                            : undefined,
                    },
                }),
            );

            // Compare placeholders. Sharp's placeholder generation isn't deterministic
            // across platforms. So check that placeholders are close to each other if not
            // exactly equal.
            compareFilePreviewPlaceholders(placeholder, expectedPlaceholder);

            if (expectedImage) {
                const object = await r2Bucket.get(
                    `${space.id}/${fileId}.preview.${getFileContentTypePreferredExtension(
                        expectedImage.contentType,
                    )}`,
                );
                if (!object) throw new NotFoundError("Preview image file not found");

                const result = await looksSame(
                    ...(await runAllPromises([
                        convertReadableStreamToUint8Array(object.body).then(buffer =>
                            Buffer.from(buffer),
                        ),
                        fs.readFile(
                            joinPath(
                                runfilesPath,
                                "cyberworlds/server/files/upload/test_fixtures",
                                expectedImage.similarPath,
                            ),
                        ),
                    ])),
                );

                if (!result.equal) {
                    throw new InternalError(
                        "Actual preview image doesn't look the same as expected preview image",
                    );
                }
            }
        });
    }
}

function compareFilePreviewPlaceholders(
    actualPlaceholder: FilePreviewPlaceholder,
    expectedPlaceholder: FilePreviewPlaceholder,
) {
    const actualPixelGrid = actualPlaceholder.get();
    const expectedPixelGrid = expectedPlaceholder.get();
    const actualSerializedPixelGrid = actualPlaceholder.serialize();
    const expectedSerializedPixelGrid = expectedPlaceholder.serialize();
    const actualPlaceholderString = JSON.stringify(
        FilePreviewPlaceholder.schema.serialize(actualPlaceholder),
    );

    if (actualPixelGrid.length !== expectedPixelGrid.length) {
        throw new InvalidArgumentError(
            `Placeholder height doesn't match, actual placeholder: ${actualPlaceholderString}`,
        );
    }

    if (actualSerializedPixelGrid[0] !== expectedSerializedPixelGrid[0]) {
        throw new InvalidArgumentError(
            `Placeholder "hasAlphaChannel" doesn't match, actual placeholder: ${actualPlaceholderString}`,
        );
    }

    const hasAlphaChannel = actualSerializedPixelGrid[0];
    const channelCount = hasAlphaChannel ? 4 : 3;

    let totalDistance = 0;
    let pixelCount = 0;

    for (let y = 0; y < actualPixelGrid.length; y++) {
        const actualPixelRow = actualPixelGrid[y]!;
        const expectedPixelRow = expectedPixelGrid[y]!;

        if (actualPixelRow.length !== expectedPixelRow.length) {
            throw new InvalidArgumentError(
                `Placeholder width doesn't match, actual placeholder: ${actualPlaceholderString}`,
            );
        }

        for (let x = 0; x < actualPixelRow.length; x++) {
            const actualPixel = actualPixelRow[x]!;
            const expectedPixel = expectedPixelRow[x]!;

            // Make sure we're not comparing the exact same `FilePreviewPlaceholder`
            // object.
            assert(actualPixel !== expectedPixel);

            const distance =
                Math.sqrt(
                    (actualPixel.r - expectedPixel.r) ** 2 +
                        (actualPixel.g - expectedPixel.g) ** 2 +
                        (actualPixel.b - expectedPixel.b) ** 2 +
                        ((actualPixel.alpha ?? 1) * 255 - (expectedPixel.alpha ?? 1) * 255) ** 2,
                ) / channelCount;

            totalDistance += distance;
            pixelCount += 1;
        }
    }

    const averageDistance = totalDistance / pixelCount;

    if (averageDistance >= 4) {
        throw new InvalidArgumentError(
            `Placeholder pixel doesn't match (average distance = ${averageDistance}), actual placeholder: ${actualPlaceholderString}`,
        );
    }
}

function concatUint8Arrays(chunks: Array<Uint8Array>): Uint8Array {
    const result = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.length, 0));
    let offset = 0;

    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }

    return result;
}

async function convertReadableStreamToUint8Array(
    stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
    const chunks: Array<Uint8Array> = [];

    for await (const chunk of stream) {
        chunks.push(chunk);
    }

    return concatUint8Arrays(chunks);
}
