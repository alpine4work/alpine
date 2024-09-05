import {R2Bucket} from "@miniflare/r2";
import {FileStorage} from "@miniflare/storage-file";
import fs from "fs/promises";
import getPort from "get-port";
import {Server} from "http";
import looksSame from "looks-same";
import {extname, join as joinPath} from "path";
import sharp from "sharp";
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
import {
    InternalError,
    InvalidArgumentError,
    NotFoundError,
    UnimplementedError,
} from "~/shared/error/error.js";
import {ErrorCode} from "~/shared/error/error_code.js";
import {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.js";
import {FileContentType, FileDocumentContentType} from "~/shared/files/file_content_type.js";
import {FileModel} from "~/shared/files/file_model.js";
import {FilePreviewPlaceholder} from "~/shared/files/file_preview_placeholder.js";
import {NonEmptyReadonlyArray} from "~/shared/helpers/array/non_empty_readonly_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {findMapIterable} from "~/shared/helpers/iterable/find_map_iterable.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {CommitBlocker} from "~/shared/helpers/types/commit_blocker.js";
import {FileId} from "~/shared/id/types/id_types.js";

const testlogsPath = joinPath(assertExists(process.env.TEST_UNDECLARED_OUTPUTS_DIR), "files");

export type FileLibreofficeContentType = Exclude<FileDocumentContentType, "application/pdf">;

export type FileUploadServiceContentTypeTestCase = NonEmptyReadonlyArray<{
    only?: CommitBlocker;
    path: string;
    contentLength: number;
    alternative?: {
        contentType: FileContentType;
        contentLength: number;
        similarPath: string;
    };
    previewSize?: {width: number; height: number; scale?: number};
    previewPlaceholder?: FilePreviewPlaceholder;
    isPreviewImageAlternative?: boolean;
    previewImage?: {
        contentType: FileContentType;
        contentLength: number;
        similarPath: string;
    };
    previewError?: {
        code: ErrorCode;
        displayMessage: ErrorDisplayMessage;
    };
    looksSameTolerance?: number;
}>;

export function testFileUploadServiceContentTypes(testCases: {
    [key: string]: FileUploadServiceContentTypeTestCase;
}) {
    let r2Bucket: R2Bucket;
    let serverTokenAgent: TokenAgent;
    let tokenAgent: TokenAgent;
    let port: number;
    let server: Server;

    const context = createTestContext();

    beforeAll(async () => {
        const r2Storage = new FileStorage(
            joinPath(context.getTemporaryDirectoryPath(), "r2", filesBucketName),
        );
        r2Bucket = new R2Bucket(r2Storage);
        const r2ContextModule = new CloudflareR2ContextModule(
            new MiniflareR2Client(new Map([[filesBucketName, r2Bucket]])),
        );

        [[serverTokenAgent, tokenAgent], port] = await runAllPromises([
            createTestTokenAgents(context, ["FileUploadService", "EdgeService"]),
            getPort(),
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
        for (const {
            only,
            path,
            contentLength: expectedContentLength,
            alternative: expectedAlternative,
            previewSize: expectedPreviewSize,
            previewPlaceholder: expectedPreviewPlaceholder,
            isPreviewImageAlternative: expectedIsPreviewImageAlternative,
            previewImage: expectedPreviewImage,
            previewError: expectedPreviewError,
            looksSameTolerance = 35,
        } of contentTypeTestCases) {
            const testFn = only ? test.only : test;

            testFn(
                quote`can upload ${contentType} file ${path}`,
                async () => {
                    const space = await TestSpace.create(context);
                    const session = await space.createSession();

                    // eslint-disable-next-line no-global-fetch
                    const response = await fetch(`http://localhost:${port}/${space.id}/upload`, {
                        method: "POST",
                        headers: {
                            authorization: await authorization(session),
                            "content-type": contentType,
                        },
                        body: await fs.readFile(
                            joinPath(
                                runfilesPath,
                                "cyberworlds/server/files/upload/test_fixtures",
                                path,
                            ),
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
                        "PreviewError",
                        "Alternative",
                        "Finish",
                    ];
                    const events = parseJsonEvents(responseText).sort(
                        (event1, event2) =>
                            eventOrder.indexOf(event1.type) - eventOrder.indexOf(event2.type),
                    );

                    const error = findMapIterable(events, event =>
                        event.type === "Error" ? event.error : undefined,
                    );
                    if (error !== undefined) {
                        throw error;
                    }

                    const fileId = assertExists(
                        findMapIterable(events, event =>
                            event.type === "Start" ? event.fileId : undefined,
                        ),
                    );

                    const file = await getFile(space.systemAction(), fileId);
                    expect(file).toEqual(
                        new FileModel({
                            id: fileId,
                            contentType: contentType as FileContentType,
                            contentLength: expectedContentLength,
                            isUploading: false,
                            alternative: expectedAlternative
                                ? {
                                      isProcessing: false,
                                      contentType: expectedAlternative.contentType,
                                      contentLength: expect.any(Number),
                                      isPreviewImage: false,
                                  }
                                : expectedIsPreviewImageAlternative
                                ? {
                                      isProcessing: false,
                                      contentType: assertExists(expectedPreviewImage).contentType,
                                      contentLength: expect.any(Number),
                                      isPreviewImage: true,
                                  }
                                : null,
                            preview: expectedPreviewError
                                ? {
                                      isProcessing: false,
                                      ok: false,
                                      error: expectedPreviewError,
                                  }
                                : expectedPreviewSize
                                ? {
                                      isProcessing: false,
                                      ok: true,
                                      size: {
                                          width: expectedPreviewSize.width,
                                          height: expectedPreviewSize.height,
                                          scale: expectedPreviewSize.scale ?? 1,
                                      },
                                      placeholder: expect.any(FilePreviewPlaceholder),
                                      image: expectedPreviewImage
                                          ? {
                                                contentType: expectedPreviewImage.contentType,
                                                contentLength: expect.any(Number),
                                            }
                                          : undefined,
                                  }
                                : null,
                        }),
                    );

                    if (!expectedPreviewError && expectedPreviewSize && expectedPreviewImage) {
                        assert(file.preview);
                        assert(!file.preview.isProcessing);
                        assert(file.preview.ok);
                        assert(file.preview.image);

                        const epsilon = 2000;
                        const withinRange =
                            expectedPreviewImage.contentLength - epsilon <=
                                file.preview.image.contentLength &&
                            file.preview.image.contentLength <=
                                expectedPreviewImage.contentLength + epsilon;

                        if (!withinRange) {
                            throw new InternalError(
                                `Expected preview image content length to be ${expectedPreviewImage.contentLength} (±${epsilon}) but the actual content length is ${file.preview.image.contentLength}`,
                            );
                        }

                        if (expectedIsPreviewImageAlternative) {
                            assert(file.alternative);
                            assert(!file.alternative.isProcessing);

                            expect(file.alternative.contentLength).toEqual(
                                file.preview.image.contentLength,
                            );
                        }
                    }

                    if (expectedAlternative) {
                        assert(file.alternative);
                        assert(!file.alternative.isProcessing);

                        const epsilon = 2000;
                        const withinRange =
                            expectedAlternative.contentLength - epsilon <=
                                file.alternative.contentLength &&
                            file.alternative.contentLength <=
                                expectedAlternative.contentLength + epsilon;

                        if (!withinRange) {
                            throw new InternalError(
                                `Expected alternative file content length to be ${expectedAlternative.contentLength} (±${epsilon}) but the actual content length is ${file.alternative.contentLength}`,
                            );
                        }
                    }

                    expect(events).toEqual([
                        {
                            type: "Start",
                            hasAlternative:
                                !!expectedAlternative || !!expectedIsPreviewImageAlternative,
                            hasPreview: !!expectedPreviewSize || !!expectedPreviewError,
                            hasPreviewImage: !!expectedPreviewImage || !!expectedPreviewError,
                            fileId: expect.any(String),
                        },
                        ...(expectedPreviewSize
                            ? [
                                  {
                                      type: "PreviewSize",
                                      width: expectedPreviewSize.width,
                                      height: expectedPreviewSize.height,
                                      scale: expectedPreviewSize.scale ?? 1,
                                  },
                              ]
                            : []),
                        ...(expectedPreviewPlaceholder
                            ? [
                                  {
                                      type: "PreviewPlaceholder",
                                      placeholder: expect.any(FilePreviewPlaceholder),
                                  },
                              ]
                            : []),
                        ...(expectedPreviewImage
                            ? [
                                  {
                                      type: "PreviewImage",
                                      contentType: expectedPreviewImage.contentType,
                                      contentLength:
                                          file.preview &&
                                          !file.preview.isProcessing &&
                                          file.preview.ok
                                              ? file.preview.image?.contentLength
                                              : null,
                                  },
                              ]
                            : []),
                        ...(expectedPreviewError
                            ? [
                                  {
                                      type: "PreviewError",
                                      error: expectedPreviewError,
                                  },
                              ]
                            : []),
                        ...(expectedAlternative
                            ? [
                                  {
                                      type: "Alternative",
                                      contentType: expectedAlternative.contentType,
                                      contentLength:
                                          file.alternative && !file.alternative.isProcessing
                                              ? file.alternative.contentLength
                                              : null,
                                      isPreviewImage: false,
                                  },
                              ]
                            : expectedIsPreviewImageAlternative
                            ? [
                                  {
                                      type: "Alternative",
                                      contentType: assertExists(expectedPreviewImage).contentType,
                                      contentLength:
                                          file.preview &&
                                          !file.preview.isProcessing &&
                                          file.preview.ok
                                              ? file.preview.image?.contentLength
                                              : null,
                                      isPreviewImage: true,
                                  },
                              ]
                            : []),
                        {
                            type: "Finish",
                        },
                    ]);
                    expect(response.status).toEqual(200);

                    const placeholder = findMapIterable(events, event =>
                        event.type === "PreviewPlaceholder" ? event.placeholder : undefined,
                    );

                    if (!expectedPreviewPlaceholder) {
                        expect(placeholder).toEqual(undefined);
                    } else {
                        // Compare placeholders. Sharp's placeholder generation isn't deterministic
                        // across platforms. So check that placeholders are close to each other if not
                        // exactly equal.
                        compareFilePreviewPlaceholders(
                            assertExists(placeholder),
                            expectedPreviewPlaceholder,
                        );
                    }

                    await testFileUploadServiceContentTypeExpectedAlternativeSimilarity({
                        r2Bucket,
                        contentType,
                        path,
                        space,
                        fileId,
                        expectedAlternative,
                        looksSameTolerance,
                    });

                    await testFileUploadServiceContentTypeExpectedPreviewImageSimilarity({
                        r2Bucket,
                        contentType,
                        path,
                        space,
                        fileId,
                        expectedPreviewImage,
                        looksSameTolerance,
                    });
                },
                30 * 1000,
            );
        }
    }
}

async function testFileUploadServiceContentTypeExpectedAlternativeSimilarity({
    r2Bucket,
    path,
    space,
    fileId,
    contentType,
    expectedAlternative,
    looksSameTolerance,
}: {
    r2Bucket: R2Bucket;
    contentType: string;
    path: string;
    space: TestSpace;
    fileId: FileId;
    expectedAlternative:
        | {contentType: FileContentType; contentLength: number; similarPath: string}
        | undefined;
    looksSameTolerance: number;
}) {
    if (!expectedAlternative) return;

    const object = await r2Bucket.get(`${space.id}/${fileId}-alternative`);
    if (!object) throw new NotFoundError("File alternative not found");

    const [actualContents, expectedContents] = await runAllPromises([
        convertReadableStreamToUint8Array(object.body).then(buffer => Buffer.from(buffer)),
        fs.readFile(
            joinPath(
                runfilesPath,
                "cyberworlds/server/files/upload/test_fixtures",
                expectedAlternative.similarPath,
            ),
        ),
    ]);

    const name = encodeURIComponent(
        `${contentType.replaceAll("/", "_")}.${path.slice(0, -extname(path).length)}`,
    );

    if (expectedAlternative.contentType === "application/pdf") {
        const [actualMetadata, expectedMetadata] = await runAllPromises([
            sharp(actualContents).metadata(),
            sharp(expectedContents).metadata(),
        ]);

        if (
            typeof actualMetadata.pages !== "number" ||
            actualMetadata.pages !== expectedMetadata.pages
        ) {
            await fs.mkdir(testlogsPath, {recursive: true});

            await runAllPromises([
                fs.writeFile(joinPath(testlogsPath, `${name}.input.actual.pdf`), actualContents),
                fs.writeFile(
                    joinPath(testlogsPath, `${name}.input.expected.pdf`),
                    expectedContents,
                ),
            ]);

            throw new InternalError(
                quote`Actual alternative PDF doesn't have the same number of pages as expected alternative PDF (actual page count: ${actualMetadata.pages}, expected page count: ${expectedMetadata.pages}), files saved to \`bazel-testlogs\``,
            );
        }

        for (let i = 0; i < actualMetadata.pages; i++) {
            const [actualPageContents, expectedPageContents] = await runAllPromises([
                sharp(actualContents, {pages: 1, page: i})
                    .toFormat("avif", {quality: 90})
                    .toBuffer(),
                sharp(expectedContents, {pages: 1, page: i})
                    .toFormat("avif", {quality: 90})
                    .toBuffer(),
            ]);

            const result = await looksSame(actualPageContents, expectedPageContents, {
                tolerance: looksSameTolerance,
                createDiffImage: true,
            });

            if (!result.equal) {
                await fs.mkdir(testlogsPath, {recursive: true});

                await runAllPromises([
                    fs.writeFile(
                        joinPath(testlogsPath, `${name}.input.actual.pdf`),
                        actualContents,
                    ),
                    fs.writeFile(
                        joinPath(testlogsPath, `${name}.input.expected.pdf`),
                        expectedContents,
                    ),
                    fs.writeFile(
                        joinPath(testlogsPath, `${name}.input.page${i + 1}.actual.avif`),
                        actualPageContents,
                    ),
                    fs.writeFile(
                        joinPath(testlogsPath, `${name}.input.page${i + 1}.expected.avif`),
                        expectedPageContents,
                    ),
                    result.diffImage?.save(
                        joinPath(testlogsPath, `${name}.diff.page${i + 1}.avif`),
                    ),
                ]);

                throw new InternalError(
                    quote`Actual alternative PDF page ${
                        i + 1
                    } doesn't look the same as expected alternative PDF page ${
                        i + 1
                    }, diff image saved to \`bazel-testlogs\``,
                );
            }
        }
    } else {
        throw new UnimplementedError(
            quote`Similarity test for content type ${expectedAlternative.contentType} hasn't been implemented`,
        );
    }
}

async function testFileUploadServiceContentTypeExpectedPreviewImageSimilarity({
    r2Bucket,
    contentType,
    path,
    space,
    fileId,
    expectedPreviewImage,
    looksSameTolerance,
}: {
    r2Bucket: R2Bucket;
    contentType: string;
    path: string;
    space: TestSpace;
    fileId: FileId;
    expectedPreviewImage:
        | {contentType: FileContentType; contentLength: number; similarPath: string}
        | undefined;
    looksSameTolerance: number;
}) {
    if (!expectedPreviewImage) return expectedPreviewImage;

    const object = await r2Bucket.get(`${space.id}/${fileId}-preview`);
    if (!object) throw new NotFoundError("File preview image file not found");

    const [actualImageContents, expectedImageContents] = await runAllPromises([
        convertReadableStreamToUint8Array(object.body).then(buffer => Buffer.from(buffer)),
        fs.readFile(
            joinPath(
                runfilesPath,
                "cyberworlds/server/files/upload/test_fixtures",
                expectedPreviewImage.similarPath,
            ),
        ),
    ]);

    const result = await looksSame(actualImageContents, expectedImageContents, {
        tolerance: looksSameTolerance,
        createDiffImage: true,
    });

    if (!result.equal) {
        const name = encodeURIComponent(
            `${contentType.replaceAll("/", "_")}.${path.slice(0, -extname(path).length)}`,
        );
        const extension = extname(expectedPreviewImage.similarPath);

        await fs.mkdir(testlogsPath, {recursive: true});

        await runAllPromises([
            fs.writeFile(
                joinPath(testlogsPath, `${name}.input.actual${extension}`),
                actualImageContents,
            ),
            fs.writeFile(
                joinPath(testlogsPath, `${name}.input.expected${extension}`),
                expectedImageContents,
            ),
            result.diffImage?.save(joinPath(testlogsPath, `${name}.diff${extension}`)),
        ]);

        throw new InternalError(
            "Actual preview image doesn't look the same as expected preview image, diff image saved to `bazel-testlogs`",
        );
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
