import {R2Bucket} from "@miniflare/r2";
import {FileStorage} from "@miniflare/storage-file";
import escapeHtml from "escape-html";
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
import {TestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createTestTokenAgents} from "~/server/dynamo/test_helpers/create_test_token_agent.js";
import {getFileAsUploader} from "~/server/files/data/files_table.js";
import {createFileUploadService} from "~/server/files/upload/file_upload_service.js";
import {
    ffmpegExecutablePath,
    ffprobeExecutablePath,
} from "~/server/files/upload/processors/file_video_and_audio_processor_base.js";
import {runProcess} from "~/server/helpers/node/run_process.js";
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
import {FileCodePreviewContent} from "~/shared/files/file_code_preview_content.js";
import {FileContentType} from "~/shared/files/file_content_type.js";
import {FileImagePreviewPlaceholder} from "~/shared/files/file_image_preview_placeholder.js";
import {FileModel} from "~/shared/files/file_model.js";
import {UploadFileEventSchema} from "~/shared/files/upload_file_event.js";
import {NonEmptyReadonlyArray} from "~/shared/helpers/array/non_empty_readonly_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {findMapIterable} from "~/shared/helpers/iterable/find_map_iterable.js";
import {isObject} from "~/shared/helpers/object/is_object.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {CommitBlocker} from "~/shared/helpers/types/commit_blocker.js";
import {FileId} from "~/shared/id/types/id_types.js";

const testlogsPath = joinPath(assertExists(process.env.TEST_UNDECLARED_OUTPUTS_DIR), "files");

export type FileProcessorContentTypeTestCase = NonEmptyReadonlyArray<{
    only?: CommitBlocker;
    path: string;
    alternative?: {
        contentType: FileContentType;
        similarPath?: string;
    };
    imagePreviewVideoDuration?: number;
    imagePreviewSize?: {
        width: number;
        height: number;
        scale?: number;
    };
    imagePreviewPlaceholder?: FileImagePreviewPlaceholder;
    isImagePreviewContentAlternative?: boolean;
    imagePreviewContent?: {
        contentType: FileContentType;
        similarPath: string;
    };
    audioPreviewDuration?: number;
    codePreviewContentLength?: number;
    codePreviewContent?: string;
    previewError?: {
        code: ErrorCode;
        displayMessage: ErrorDisplayMessage;
    };
    looksSameTolerance?: number;
}>;

export function testFileProcessorContentTypes(
    context: TestContext,
    testCases: {
        [key: string]: FileProcessorContentTypeTestCase;
    },
) {
    let r2Bucket: R2Bucket;
    let serverTokenAgent: TokenAgent;
    let tokenAgent: TokenAgent;
    let port: number;
    let server: Server;

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
            alternative: expectedAlternative,
            imagePreviewVideoDuration: expectedImagePreviewVideoDuration,
            imagePreviewSize: expectedImagePreviewSize,
            imagePreviewPlaceholder: expectedImagePreviewPlaceholder,
            isImagePreviewContentAlternative: expectedIsImagePreviewContentAlternative,
            imagePreviewContent: expectedImagePreviewContent,
            audioPreviewDuration: expectedAudioPreviewDuration,
            codePreviewContentLength: expectedCodePreviewContentLength,
            codePreviewContent: expectedCodePreviewContent,
            previewError: expectedPreviewError,
            looksSameTolerance = 35,
        } of contentTypeTestCases) {
            const testFn = only ? test.only : test;

            testFn(
                quote`can upload ${contentType} file ${path}`,
                async () => {
                    const space = await TestSpace.create(context);
                    const session = await space.createSession();

                    const contents = await fs.readFile(
                        joinPath(
                            runfilesPath,
                            "cyberworlds/server/files/upload/test_fixtures",
                            path,
                        ),
                    );

                    // eslint-disable-next-line no-global-fetch
                    const response = await fetch(`http://localhost:${port}/${space.id}/upload`, {
                        method: "POST",
                        headers: {
                            authorization: await authorization(session),
                            "content-type": contentType,
                        },
                        body: contents,
                    });
                    const responseText = await response.text();

                    expect(massageHeaders(response.headers)).toEqual({
                        "content-type": "application/x-ndjson",
                    });

                    const eventOrder = [
                        "Start",
                        "ImagePreviewSize",
                        "ImagePreviewPlaceholder",
                        "ImagePreviewContent",
                        "ImagePreviewVideoDuration",
                        "AudioPreviewDuration",
                        "CodePreviewContent",
                        "PreviewError",
                        "Alternative",
                        "Finish",
                    ];
                    const events = parseJsonEvents(responseText).sort(
                        (event1, event2) =>
                            eventOrder.indexOf(event1.type) - eventOrder.indexOf(event2.type),
                    );

                    expect(
                        findMapIterable(events, event =>
                            event.type === "Error" ? event.error : undefined,
                        ),
                    ).toEqual(undefined);

                    const fileId = assertExists(
                        findMapIterable(events, event =>
                            event.type === "Start" ? event.fileId : undefined,
                        ),
                    );

                    const file = await getFileAsUploader(space.systemAction(), space.id, fileId);
                    expect(file).toEqual(
                        new FileModel({
                            id: fileId,
                            contentType: contentType as FileContentType,
                            contentLength: expect.any(Number),
                            isUploading: false,
                            alternative: expectedAlternative
                                ? {
                                      isProcessing: false,
                                      contentType: expectedAlternative.contentType,
                                      contentLength: expect.any(Number),
                                      isImagePreviewContent: false,
                                  }
                                : expectedIsImagePreviewContentAlternative
                                ? {
                                      isProcessing: false,
                                      contentType: assertExists(expectedImagePreviewContent)
                                          .contentType,
                                      contentLength: expect.any(Number),
                                      isImagePreviewContent: true,
                                  }
                                : null,
                            preview: expectedPreviewError
                                ? {
                                      type: "Image",
                                      isProcessing: false,
                                      ok: false,
                                      error: expectedPreviewError,
                                      size: "Error",
                                      placeholder: "Error",
                                      content: "Error",
                                      videoDuration: "Error",
                                  }
                                : expectedImagePreviewSize
                                ? {
                                      type: "Image",
                                      isProcessing: false,
                                      ok: true,
                                      size: {
                                          width: expectedImagePreviewSize.width,
                                          height: expectedImagePreviewSize.height,
                                          scale: expectedImagePreviewSize.scale ?? 1,
                                      },
                                      placeholder: expect.any(FileImagePreviewPlaceholder),
                                      content: expectedImagePreviewContent
                                          ? {
                                                contentType:
                                                    expectedImagePreviewContent.contentType,
                                                contentLength: expect.any(Number),
                                            }
                                          : undefined,
                                      videoDuration: expectedImagePreviewVideoDuration,
                                  }
                                : expectedAudioPreviewDuration !== undefined
                                ? {
                                      type: "Audio",
                                      isProcessing: false,
                                      duration: expectedAudioPreviewDuration,
                                  }
                                : expectedCodePreviewContent !== undefined
                                ? {
                                      type: "Code",
                                      isProcessing: false,
                                      content: expect.any(FileCodePreviewContent),
                                  }
                                : null,
                        }),
                    );

                    expect(events).toEqual([
                        {
                            type: "Start",
                            hasAlternative:
                                !!expectedAlternative || !!expectedIsImagePreviewContentAlternative,
                            hasPreview:
                                !!expectedImagePreviewSize || !!expectedPreviewError
                                    ? {
                                          type: "Image",
                                          hasContent:
                                              !!expectedImagePreviewContent ||
                                              !!expectedPreviewError,
                                          hasVideoDuration: !!expectedImagePreviewVideoDuration,
                                      }
                                    : expectedAudioPreviewDuration !== undefined
                                    ? {type: "Audio"}
                                    : expectedCodePreviewContent !== undefined
                                    ? {type: "Code"}
                                    : null,
                            fileId: expect.any(String),
                        },
                        ...(expectedImagePreviewSize
                            ? [
                                  {
                                      type: "ImagePreviewSize",
                                      size: {
                                          width: expectedImagePreviewSize.width,
                                          height: expectedImagePreviewSize.height,
                                          scale: expectedImagePreviewSize.scale ?? 1,
                                      },
                                  },
                              ]
                            : []),
                        ...(expectedImagePreviewPlaceholder
                            ? [
                                  {
                                      type: "ImagePreviewPlaceholder",
                                      placeholder: expect.any(FileImagePreviewPlaceholder),
                                  },
                              ]
                            : []),
                        ...(expectedImagePreviewContent
                            ? [
                                  {
                                      type: "ImagePreviewContent",
                                      contentType: expectedImagePreviewContent.contentType,
                                      contentLength:
                                          file.preview?.type === "Image" &&
                                          !file.preview.isProcessing &&
                                          file.preview.ok
                                              ? file.preview.content?.contentLength
                                              : null,
                                  },
                              ]
                            : []),
                        ...(expectedImagePreviewVideoDuration !== undefined
                            ? [
                                  {
                                      type: "ImagePreviewVideoDuration",
                                      videoDuration: expectedImagePreviewVideoDuration,
                                  },
                              ]
                            : []),
                        ...(expectedAudioPreviewDuration !== undefined
                            ? [
                                  {
                                      type: "AudioPreviewDuration",
                                      duration: expectedAudioPreviewDuration,
                                  },
                              ]
                            : []),
                        ...(expectedCodePreviewContent !== undefined
                            ? [
                                  {
                                      type: "CodePreviewContent",
                                      content: expect.any(FileCodePreviewContent),
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
                                      isImagePreviewContent: false,
                                  },
                              ]
                            : expectedIsImagePreviewContentAlternative
                            ? [
                                  {
                                      type: "Alternative",
                                      contentType: assertExists(expectedImagePreviewContent)
                                          .contentType,
                                      contentLength:
                                          file.preview?.type === "Image" &&
                                          !file.preview.isProcessing &&
                                          file.preview.ok
                                              ? file.preview.content?.contentLength
                                              : null,
                                      isImagePreviewContent: true,
                                  },
                              ]
                            : []),
                        {
                            type: "Finish",
                        },
                    ]);
                    expect(response.status).toEqual(200);

                    // Test to make sure the object we stored in Cloudflare R2 is exactly equal to
                    // the input object.
                    {
                        const object = await r2Bucket.get(`${space.id}/${fileId}`);
                        if (!object) throw new NotFoundError("File not found");

                        const actualContents = Buffer.from(
                            await convertReadableStreamToUint8Array(object.body),
                        );

                        expect(contents.equals(actualContents)).toEqual(true);
                    }

                    const imagePreviewPlaceholder = findMapIterable(events, event =>
                        event.type === "ImagePreviewPlaceholder" ? event.placeholder : undefined,
                    );

                    if (!expectedImagePreviewPlaceholder) {
                        expect(imagePreviewPlaceholder).toEqual(undefined);
                    } else {
                        // Compare placeholders. Sharp's placeholder generation isn't deterministic
                        // across platforms. So check that placeholders are close to each other if not
                        // exactly equal.
                        compareFileImagePreviewPlaceholders(
                            assertExists(imagePreviewPlaceholder),
                            expectedImagePreviewPlaceholder,
                        );
                    }

                    const codePreviewContent = findMapIterable(events, event =>
                        event.type === "CodePreviewContent" ? event.content : undefined,
                    );
                    expect(
                        codePreviewContent
                            ?.get()
                            .map(item =>
                                item.type === "Newline"
                                    ? "\n"
                                    : item.classes
                                    ? `<span class="${item.classes}">${escapeHtml(
                                          item.string,
                                      )}</span>`
                                    : escapeHtml(item.string),
                            )
                            .join(""),
                    ).toEqual(expectedCodePreviewContent);
                    expect(codePreviewContent?.serialize().length).toEqual(
                        expectedCodePreviewContentLength,
                    );

                    await testFileUploadServiceContentTypeExpectedAlternativeSimilarity(context, {
                        r2Bucket,
                        contentType,
                        path,
                        space,
                        fileId,
                        expectedAlternative,
                        looksSameTolerance,
                    });

                    await testFileUploadServiceContentTypeExpectedImagePreviewContentSimilarity({
                        r2Bucket,
                        contentType,
                        path,
                        space,
                        fileId,
                        expectedImagePreviewContent,
                        looksSameTolerance,
                    });
                },
                60 * 1000,
            );
        }
    }
}

async function testFileUploadServiceContentTypeExpectedAlternativeSimilarity(
    context: TestContext,
    {
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
        expectedAlternative: {contentType: FileContentType; similarPath?: string} | undefined;
        looksSameTolerance: number;
    },
) {
    if (!expectedAlternative) return;

    const object = await r2Bucket.get(`${space.id}/${fileId}-alternative`);
    if (!object) throw new NotFoundError("File alternative not found");

    const actualContents = Buffer.from(await convertReadableStreamToUint8Array(object.body));

    const testlogsOutputDirectoryPath = joinPath(
        testlogsPath,
        contentType,
        removePathExtension(path),
    );

    try {
        switch (expectedAlternative.contentType) {
            case "application/pdf": {
                assert(expectedAlternative.similarPath);

                const expectedPath = joinPath(
                    runfilesPath,
                    "cyberworlds/server/files/upload/test_fixtures",
                    expectedAlternative.similarPath,
                );

                const [actualMetadata, expectedMetadata] = await runAllPromises([
                    sharp(actualContents).metadata(),
                    sharp(expectedPath).metadata(),
                ]);

                expect(actualMetadata.pages).toEqual(expectedMetadata.pages);
                expect(typeof actualMetadata.pages).toEqual("number");

                for (let i = 0; i < actualMetadata.pages!; i++) {
                    const [actualPageContents, expectedPageContents] = await runAllPromises([
                        sharp(actualContents, {pages: 1, page: i})
                            .toFormat("avif", {quality: 90})
                            .toBuffer(),
                        sharp(expectedPath, {pages: 1, page: i})
                            .toFormat("avif", {quality: 90})
                            .toBuffer(),
                    ]);

                    const result = await looksSame(actualPageContents, expectedPageContents, {
                        tolerance: looksSameTolerance,
                        createDiffImage: true,
                    });

                    if (!result.equal) {
                        await fs.mkdir(joinPath(testlogsOutputDirectoryPath, "actual"), {
                            recursive: true,
                        });
                        await fs.mkdir(joinPath(testlogsOutputDirectoryPath, "expected"), {
                            recursive: true,
                        });

                        await runAllPromises([
                            fs.writeFile(
                                joinPath(
                                    testlogsOutputDirectoryPath,
                                    "actual",
                                    `${removePathExtension(expectedAlternative.similarPath)}.page${
                                        i + 1
                                    }.avif`,
                                ),
                                actualPageContents,
                            ),
                            fs.writeFile(
                                joinPath(
                                    testlogsOutputDirectoryPath,
                                    "expected",
                                    `${removePathExtension(expectedAlternative.similarPath)}.page${
                                        i + 1
                                    }.avif`,
                                ),
                                expectedPageContents,
                            ),
                            result.diffImage?.save(
                                joinPath(testlogsOutputDirectoryPath, `diff.avif`),
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
                break;
            }
            case "video/webm": {
                assert(expectedAlternative.similarPath);

                const expectedPath = joinPath(
                    runfilesPath,
                    "cyberworlds/server/files/upload/test_fixtures",
                    expectedAlternative.similarPath,
                );

                const temporaryVideoSimilarityDirectoryPath = joinPath(
                    context.getTemporaryDirectoryPath(),
                    `files_video_similarity/${fileId}`,
                );

                await fs.mkdir(joinPath(temporaryVideoSimilarityDirectoryPath, "actual"), {
                    recursive: true,
                });
                await fs.mkdir(joinPath(temporaryVideoSimilarityDirectoryPath, "expected"), {
                    recursive: true,
                });

                const [actualMetadataString, expectedMetadataString] = await runAllPromises([
                    runProcess(
                        ffprobeExecutablePath,
                        ["-print_format", "json", "-show_streams", "-show_format", "-"],
                        {
                            cwd: runfilesPath,
                            stdin: actualContents,
                            onStdinError: error => {
                                // `EPIPE` errors are expected. FFmpeg will close its side of stdin once it has
                                // figured out the file's metadata.
                                if (isObject(error) && error.code === "EPIPE") {
                                    return {preventDefault: true};
                                }
                            },
                        },
                    ),
                    runProcess(
                        ffprobeExecutablePath,
                        ["-print_format", "json", "-show_streams", "-show_format", expectedPath],
                        {cwd: runfilesPath},
                    ),
                ]);

                let actualMetadata;
                let expectedMetadata;

                try {
                    actualMetadata = JSON.parse(actualMetadataString);
                } catch (error) {
                    throw new InternalError(
                        quote`JSON parsing failed for: ${actualMetadataString}`,
                    );
                }

                try {
                    expectedMetadata = JSON.parse(expectedMetadataString);
                } catch (error) {
                    throw new InternalError(
                        quote`JSON parsing failed for: ${expectedMetadataString}`,
                    );
                }

                // If we generated a `.webm` file without metadata (which is the case when
                // outputting to a stream) then let's repackage the `.webm` file so `ffprobe`
                // adds duration metadata then compare that against our expected metadata.
                //
                // https://stackoverflow.com/a/40117749/1568890
                if (!actualMetadata.format.duration) {
                    const actualRepackagedPath = joinPath(
                        temporaryVideoSimilarityDirectoryPath,
                        "actual_repackaged.webm",
                    );

                    await runProcess(
                        ffmpegExecutablePath,
                        [
                            "-i",
                            "pipe:0",
                            // Only use up to 2 threads for FFmpeg to avoid resource contention
                            // in tests.
                            "-threads",
                            "2",
                            // We're repackaging the file so duration metadata is added.
                            "-c",
                            "copy",
                            actualRepackagedPath,
                        ],
                        {
                            cwd: runfilesPath,
                            stdin: actualContents,
                            onStdinError: error => {
                                // `EPIPE` errors are expected. FFmpeg will close its side of stdin once it has
                                // finished parsing the file.
                                if (isObject(error) && error.code === "EPIPE") {
                                    return {preventDefault: true};
                                }
                            },
                        },
                    );

                    const actualMetadataString = await runProcess(
                        ffprobeExecutablePath,
                        [
                            "-print_format",
                            "json",
                            "-show_streams",
                            "-show_format",
                            actualRepackagedPath,
                        ],
                        {cwd: runfilesPath},
                    );

                    actualMetadata = JSON.parse(actualMetadataString);
                }

                // Delete metadata that we don't care if it's equal or not. This metadata could
                // differ slightly across platforms, differ based on input mechanism (seekable
                // file vs piped file), or could reasonably differ based on the input format.
                const cleanMetadata = (metadata: any) => {
                    delete metadata.format.filename;
                    delete metadata.format.size;
                    delete metadata.format.bit_rate;
                    delete metadata.format.tags.ENCODER;
                    delete metadata.format.tags.COMPATIBLE_BRANDS;
                    delete metadata.format.tags.MAJOR_BRAND;
                    delete metadata.format.tags.MINOR_VERSION;

                    metadata.format.start_time =
                        // Remove fractional part which may not be precisely equal.
                        metadata.format.start_time.replace(/^-?0(\.\d+)?/, "0");

                    if (metadata.format.duration) {
                        metadata.format.duration =
                            // Remove fractional part which may not be precisely equal.
                            metadata.format.duration.replace(/\.\d+$/, "");
                    }

                    for (const metadataStream of metadata.streams) {
                        delete metadataStream.chroma_location;
                        delete metadataStream.disposition.default;
                        delete metadataStream.extradata_size;
                        delete metadataStream.initial_padding;
                        delete metadataStream.start_pts;
                        delete metadataStream.color_space;
                        delete metadataStream.display_aspect_ratio;
                        delete metadataStream.tags.language;
                        delete metadataStream.tags.ENCODER;
                        delete metadataStream.tags.HANDLER_NAME;
                        delete metadataStream.tags.VENDOR_ID;

                        // Duration should be covered by `metadata.format.duration`. Doesn't need to be
                        // tested here too.
                        delete metadataStream.tags.DURATION;

                        if (typeof metadataStream.coded_height === "number") {
                            metadataStream.coded_height =
                                // Make sure height is the same to the nearest even number.
                                Math.floor(metadataStream.coded_height / 2) * 2;
                        }

                        if (typeof metadataStream.height === "number") {
                            metadataStream.height =
                                // Make sure height is the same to the nearest even number.
                                Math.floor(metadataStream.height / 2) * 2;
                        }

                        metadataStream.start_time =
                            // Remove fractional part which may not be precisely equal.
                            metadataStream.start_time.replace(/^-?0(\.\d+)?/, "0");
                    }
                };

                cleanMetadata(actualMetadata);
                cleanMetadata(expectedMetadata);

                // Make sure metadatas are the same between our actual video and expected
                // video. If this fails then the actual/expected files are saved to
                // `bazel-testlogs` for further debugging. (See the try/catch.)
                expect(actualMetadata).toEqual(expectedMetadata);

                // Take a screenshot every second of the video and we'll compare these
                // screenshots with the `looks-same` utility.
                await runAllPromises([
                    runProcess(
                        ffmpegExecutablePath,
                        [
                            ["-i", "pipe:0"],
                            ["-r", "1"],
                            // Controls JPEG image quality.
                            ["-q:v", "2"],
                            // Only use up to 2 threads for FFmpeg to avoid resource contention
                            // in tests.
                            ["-threads", "2"],
                            joinPath(
                                temporaryVideoSimilarityDirectoryPath,
                                "actual/frame_%04d.jpeg",
                            ),
                        ],
                        {
                            cwd: runfilesPath,
                            stdin: actualContents,
                            onStdinError: error => {
                                // `EPIPE` errors are expected. FFmpeg will close its side of stdin once it has
                                // finished taking screenshots.
                                if (isObject(error) && error.code === "EPIPE") {
                                    return {preventDefault: true};
                                }
                            },
                        },
                    ),
                    runProcess(
                        ffmpegExecutablePath,
                        [
                            ["-i", expectedPath],
                            ["-r", "1"],
                            // Controls JPEG image quality.
                            ["-q:v", "2"],
                            // Only use up to 2 threads for FFmpeg to avoid resource contention
                            // in tests.
                            ["-threads", "2"],
                            joinPath(
                                temporaryVideoSimilarityDirectoryPath,
                                "expected/frame_%04d.jpeg",
                            ),
                        ],
                        {cwd: runfilesPath},
                    ),
                ]);

                const [actualNames, expectedNames] = await runAllPromises([
                    fs.readdir(joinPath(temporaryVideoSimilarityDirectoryPath, "actual")),
                    fs.readdir(joinPath(temporaryVideoSimilarityDirectoryPath, "expected")),
                ]);

                expect(actualNames.length).toBeGreaterThan(0);
                expect(actualNames.length).toEqual(expectedNames.length);

                for (let i = 0; i < actualNames.length; i++) {
                    const actualName = actualNames[i]!;
                    const expectedName = expectedNames[i]!;

                    const actualPath = joinPath(
                        temporaryVideoSimilarityDirectoryPath,
                        "actual",
                        actualName,
                    );
                    const expectedPath = joinPath(
                        temporaryVideoSimilarityDirectoryPath,
                        "expected",
                        expectedName,
                    );

                    const result = await looksSame(actualPath, expectedPath, {
                        tolerance: looksSameTolerance,
                        createDiffImage: true,
                    });

                    if (!result.equal) {
                        await fs.mkdir(joinPath(testlogsOutputDirectoryPath, "actual"), {
                            recursive: true,
                        });
                        await fs.mkdir(joinPath(testlogsOutputDirectoryPath, "expected"), {
                            recursive: true,
                        });

                        await runAllPromises([
                            fs.copyFile(
                                actualPath,
                                joinPath(
                                    testlogsOutputDirectoryPath,
                                    "actual",
                                    `${removePathExtension(expectedAlternative.similarPath)}.frame${
                                        i + 1
                                    }.jpeg`,
                                ),
                            ),
                            fs.copyFile(
                                expectedPath,
                                joinPath(
                                    testlogsOutputDirectoryPath,
                                    "expected",
                                    `${removePathExtension(expectedAlternative.similarPath)}.frame${
                                        i + 1
                                    }.jpeg`,
                                ),
                            ),
                            result.diffImage?.save(
                                joinPath(testlogsOutputDirectoryPath, `diff.jpeg`),
                            ),
                        ]);

                        throw new InternalError(
                            quote`Actual alternative video frame ${
                                i + 1
                            } doesn't look the same as expected alternative video frame ${
                                i + 1
                            }, diff image saved to \`bazel-testlogs\``,
                        );
                    }
                }
                break;
            }
            case "audio/webm": {
                assert(!expectedAlternative.similarPath);

                // We don't have a readily available audio similarity test so assume the
                // generated file is good.
                break;
            }
            default:
                throw new UnimplementedError(
                    quote`Similarity test for content type ${expectedAlternative.contentType} hasn't been implemented`,
                );
        }
    } catch (error) {
        if (expectedAlternative.similarPath) {
            const expectedPath = joinPath(
                runfilesPath,
                "cyberworlds/server/files/upload/test_fixtures",
                expectedAlternative.similarPath,
            );

            await fs.mkdir(joinPath(testlogsOutputDirectoryPath, "actual"), {
                recursive: true,
            });
            await fs.mkdir(joinPath(testlogsOutputDirectoryPath, "expected"), {
                recursive: true,
            });

            await runAllPromises([
                fs.writeFile(
                    joinPath(
                        testlogsOutputDirectoryPath,
                        "actual",
                        expectedAlternative.similarPath,
                    ),
                    actualContents,
                ),
                fs.copyFile(
                    expectedPath,
                    joinPath(
                        testlogsOutputDirectoryPath,
                        "expected",
                        expectedAlternative.similarPath,
                    ),
                ),
            ]);
        }

        throw error;
    }
}

async function testFileUploadServiceContentTypeExpectedImagePreviewContentSimilarity({
    r2Bucket,
    contentType,
    path,
    space,
    fileId,
    expectedImagePreviewContent,
    looksSameTolerance,
}: {
    r2Bucket: R2Bucket;
    contentType: string;
    path: string;
    space: TestSpace;
    fileId: FileId;
    expectedImagePreviewContent: {contentType: FileContentType; similarPath: string} | undefined;
    looksSameTolerance: number;
}) {
    if (!expectedImagePreviewContent) return expectedImagePreviewContent;

    const object = await r2Bucket.get(`${space.id}/${fileId}-preview`);
    if (!object) throw new NotFoundError("File preview image file not found");

    const [actualImageContents, expectedImageContents] = await runAllPromises([
        convertReadableStreamToUint8Array(object.body).then(buffer => Buffer.from(buffer)),
        fs.readFile(
            joinPath(
                runfilesPath,
                "cyberworlds/server/files/upload/test_fixtures",
                expectedImagePreviewContent.similarPath,
            ),
        ),
    ]);

    const result = await looksSame(actualImageContents, expectedImageContents, {
        tolerance: looksSameTolerance,
        createDiffImage: true,
    });

    if (!result.equal) {
        const testlogsOutputDirectoryPath = joinPath(
            testlogsPath,
            contentType,
            removePathExtension(path),
        );

        await fs.mkdir(joinPath(testlogsOutputDirectoryPath, "actual"), {
            recursive: true,
        });
        await fs.mkdir(joinPath(testlogsOutputDirectoryPath, "expected"), {
            recursive: true,
        });

        await runAllPromises([
            fs.writeFile(
                joinPath(
                    testlogsOutputDirectoryPath,
                    "actual",
                    expectedImagePreviewContent.similarPath,
                ),
                actualImageContents,
            ),
            fs.writeFile(
                joinPath(
                    testlogsOutputDirectoryPath,
                    "expected",
                    expectedImagePreviewContent.similarPath,
                ),
                expectedImageContents,
            ),
            result.diffImage?.save(
                joinPath(
                    testlogsOutputDirectoryPath,
                    `diff${extname(expectedImagePreviewContent.similarPath)}`,
                ),
            ),
        ]);

        throw new InternalError(
            "Actual preview image doesn't look the same as expected preview image, diff image saved to `bazel-testlogs`",
        );
    }
}

function compareFileImagePreviewPlaceholders(
    actualPlaceholder: FileImagePreviewPlaceholder,
    expectedPlaceholder: FileImagePreviewPlaceholder,
) {
    const actualPixelGrid = actualPlaceholder.get();
    const expectedPixelGrid = expectedPlaceholder.get();
    const actualSerializedPixelGrid = actualPlaceholder.serialize();
    const expectedSerializedPixelGrid = expectedPlaceholder.serialize();
    const actualPlaceholderString = JSON.stringify(
        FileImagePreviewPlaceholder.schema.serialize(actualPlaceholder),
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

            // Make sure we're not comparing the exact same `FileImagePreviewPlaceholder`
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

function removePathExtension(path: string): string {
    return path.slice(0, -extname(path).length);
}
