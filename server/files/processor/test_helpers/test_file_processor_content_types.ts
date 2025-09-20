import {R2Bucket} from "@miniflare/r2";
import {FileStorage} from "@miniflare/storage-file";
import escapeHtml from "escape-html";
import fs from "fs/promises";
import getPort from "get-port";
import looksSame from "looks-same";
import {extname, join as joinPath} from "path";
import sharp from "sharp";
import {CloudflareR2ClientBase} from "~/server/cloudflare/r2/cloudflare_r2_client.js";
import {CloudflareR2ContextModule} from "~/server/cloudflare/r2/cloudflare_r2_context_module.js";
import {MiniflareR2Client} from "~/server/cloudflare/r2/miniflare_r2_client.js";
import {TestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {createTestTokenAgents} from "~/server/dynamo/test_helpers/create_test_token_agent.js";
import {uploadFile} from "~/server/edge/upload_file.js";
import {getFileAsUploader} from "~/server/files/data/files_actions.js";
import {createFileProcessorServiceServer} from "~/server/files/processor/file_processor_service_server.js";
import {processFile} from "~/server/files/processor/process_file.js";
import {
    ffmpegExecutablePath,
    ffmpegThreadCount,
    ffprobeExecutablePath,
} from "~/server/files/processor/processors/file_video_and_audio_processor_base.js";
import {TestUploadFileRpcContextModule} from "~/server/files/processor/test_helpers/test_upload_file_rpc_context_module.js";
import {
    filesBindingName,
    filesBucketName,
} from "~/server/helpers/files_cloudflare_r2_bucket_name.js";
import {runProcess} from "~/server/helpers/node/run_process.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {ShutdownManager} from "~/server/node/shutdown_manager.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {
    InternalError,
    InvalidArgumentError,
    NotFoundError,
    UnimplementedError,
} from "~/shared/error/error.js";
import {FileCodePreviewContent} from "~/shared/files/file_code_preview_content.js";
import {
    FileContentType,
    getFileContentTypePreferredExtension,
} from "~/shared/files/file_content_type.js";
import {FileImagePreviewPlaceholder} from "~/shared/files/file_image_preview_placeholder.js";
import {FileModel} from "~/shared/files/file_model.js";
import {FileProcessorError} from "~/shared/files/file_processor_error.js";
import {UploadFileResponseSchema} from "~/shared/files/upload_file_protocol.js";
import {NonEmptyReadonlyArray} from "~/shared/helpers/array/non_empty_readonly_array.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {waitForReadableStreamUint8Array} from "~/shared/helpers/binary/wait_for_readable_stream_uint8_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isObject} from "~/shared/helpers/object/is_object.js";
import {pickObject} from "~/shared/helpers/object/pick_object.js";
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
        hasAlpha?: boolean;
    };
    imagePreviewPlaceholder?: FileImagePreviewPlaceholder;
    isImagePreviewContentAlternative?: boolean;
    imagePreviewContent?: {
        contentType: FileContentType;
        similarPath: string;
    };
    audioPreviewDuration?: number;
    audioPreviewMetadata?: {title?: string; artist?: string; album?: string};
    codePreviewContentLength?: number;
    codePreviewContent?: string;
    previewError?: FileProcessorError;
    looksSameTolerance?: number;
}>;

export function testFileProcessorContentTypes(
    context: TestContext,
    testCases: {
        [key: string]: FileProcessorContentTypeTestCase;
    },
) {
    const {shutdownManager, shutdown} = ShutdownManager.new({
        tracer: context.tracer.getRoot(),
        isClusterPrimary: true,
    });

    let r2Bucket: R2Bucket;
    let r2Client: CloudflareR2ClientBase;
    let appTokenAgent: TokenAgent;
    let edgeTokenAgent: TokenAgent;
    let fileProcessorTokenAgent: TokenAgent;
    let port: number;

    let processingType: "Once" | "TwiceConcurrently" = "Once";

    afterEach(() => {
        processingType = "Once";
    });

    context.setProcessJob(async (actionContext, job, jobStartTime, span) => {
        if (
            // TODO(ifitzsimmons, 2025-09-18): Remove this once we've migrated to the new job queue
            // system.
            job.type === "ProcessFile" ||
            job.type === "ProcessFileLight" ||
            job.type === "ProcessFileHeavy"
        ) {
            const process = () =>
                processFile(
                    actionContext.clone({r2: new CloudflareR2ContextModule(r2Client)}),
                    span,
                    {
                        spaceId: job.spaceId,
                        fileId: job.fileId,
                        contentType: job.contentType,
                        temporaryDirectoryPath: context.getTemporaryDirectoryPath(),
                    },
                );

            switch (processingType) {
                case "Once": {
                    await process();
                    break;
                }
                case "TwiceConcurrently": {
                    // 5% of the time run processing twice serially instead of twice concurrently.
                    // Just to make sure we exercise both code paths. Running processing twice
                    // serially can be expensive for some formats.
                    if (Math.random() < 0.05) {
                        await process();
                        await process();
                    } else {
                        await runAllPromises([process(), process()]);
                    }
                    break;
                }
                default:
                    throw exhaustive(processingType);
            }
        }
    });

    beforeAll(async () => {
        port = await getPort();

        const r2Storage = new FileStorage(
            joinPath(context.getTemporaryDirectoryPath(), "r2", filesBindingName),
        );
        r2Bucket = new R2Bucket(r2Storage);
        r2Client = new MiniflareR2Client({
            fileProcessorServiceUrl: `http://localhost:${port}`,
            bucketByName: new Map([[filesBucketName, r2Bucket]]),
        });
        const r2ContextModule = new CloudflareR2ContextModule(r2Client);

        [appTokenAgent, edgeTokenAgent, fileProcessorTokenAgent] = await createTestTokenAgents(
            context,
            ["AppService", "EdgeService", "FileProcessorService"],
        );

        const server = createFileProcessorServiceServer(context.clone({r2: r2ContextModule}), {
            shutdownManager,
            tokenAgent: fileProcessorTokenAgent,
            temporaryDirectoryPath: joinPath(context.getTemporaryDirectoryPath(), "files"),
            withFiber: (context, action) => action(),
        });

        await new Promise<void>(resolve => {
            server.listen(port, resolve);
        });
    });

    afterAll(async () => {
        await shutdown({type: "Signal", signal: "SIGINT"}, null);
    });

    async function uploadFileForTest(
        session: TestSpaceSession,
        {contentType, body}: {contentType: string; body: Buffer},
    ) {
        const fileId = await context.tracer
            .getRoot()
            .withSpan("Upload file for test", async span => {
                const token = await appTokenAgent.privateSide.dangerouslySignShortLivedToken(
                    "EdgeService",
                    session.getTokenPayload(),
                );

                const request = new Request(`http://localhost/${session.space.id}/upload`, {
                    method: "POST",
                    headers: {
                        cookie: `session=${token}`,
                        "content-type": contentType,
                        "content-length": String(body.length),
                    },
                    // TODO(calebmer, #typescript-5.9.2): Discovered after TS version upgrade, not
                    // fixing for now.
                    // @ts-expect-error
                    body,
                });

                const url = new URL(request.url);

                const response = await uploadFile(
                    ({sessionId, accountId}) =>
                        context.action({sessionId, accountId}).clone({
                            tracer: new TracerContextModule(span),
                            rpc: new TestUploadFileRpcContextModule(),
                        }),
                    {},
                    {FilesBucket: r2Bucket},
                    edgeTokenAgent,
                    request,
                    url,
                    span,
                    {spaceId: session.space.id},
                );

                const responseBody = UploadFileResponseSchema.deserialize(await response.json());
                if (!responseBody.ok) throw responseBody.error;

                return responseBody.file.id;
            });

        // Wait for the file to be processed...
        //
        // Don't log a `DeadlineExceededError` for long running tasks. It genuinely
        // takes a while for some files to process.
        await ProcessContextModule.waitForTestTasks({withoutDeadlineExceededLog: true});

        return getFileAsUploader(session.action(), session.space.id, fileId);
    }

    // Make sure file processing is idempotent by running each twice. The first
    // time the file is processed only once. The second time the file is processed
    // twice concurrently.
    for (const currentProcessingType of ["Once", "TwiceConcurrently"] as const) {
        // If `only` has been set on one of our tests, then let's only run the `Once`
        // test suite.
        const describeFn = Object.values(testCases).some(contentTypeTestCases =>
            contentTypeTestCases.some(testCase => !!testCase.only),
        )
            ? currentProcessingType === "Once"
                ? describe.only
                : describe.skip
            : describe;

        describeFn(`processing: ${currentProcessingType}`, () => {
            beforeEach(() => {
                processingType = currentProcessingType;
            });

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
                    audioPreviewMetadata: expectedAudioPreviewMetadata,
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
                                    "cyberworlds/server/files/processor/test_fixtures",
                                    path,
                                ),
                            );

                            const file = await uploadFileForTest(session, {
                                contentType,
                                body: contents,
                            });

                            expect(file).toEqual(
                                new FileModel({
                                    id: file.id,
                                    contentType: contentType as FileContentType,
                                    contentLength: expect.any(Number),
                                    isUploading: false,
                                    alternative: expectedAlternative
                                        ? {
                                              isProcessing: false,
                                              ok: true,
                                              contentType: expectedAlternative.contentType,
                                              contentLength: expect.any(Number),
                                              isImagePreviewContent: false,
                                          }
                                        : expectedIsImagePreviewContentAlternative
                                        ? {
                                              isProcessing: false,
                                              ok: true,
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
                                              videoDuration: expectedImagePreviewVideoDuration
                                                  ? "Error"
                                                  : undefined,
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
                                                  hasAlpha:
                                                      expectedImagePreviewSize.hasAlpha ?? false,
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
                                              ok: true,
                                              duration: expectedAudioPreviewDuration,
                                              metadata: {
                                                  title:
                                                      expectedAudioPreviewMetadata?.title ?? null,
                                                  artist:
                                                      expectedAudioPreviewMetadata?.artist ?? null,
                                                  album:
                                                      expectedAudioPreviewMetadata?.album ?? null,
                                              },
                                          }
                                        : expectedCodePreviewContent !== undefined
                                        ? {
                                              type: "Code",
                                              isProcessing: false,
                                              ok: true,
                                              content: expect.any(FileCodePreviewContent),
                                          }
                                        : null,
                                }),
                            );

                            // Test to make sure the object we stored in Cloudflare R2 is exactly equal to
                            // the input object.
                            {
                                const object = await r2Bucket.get(`${space.id}/${file.id}`);
                                if (!object) throw new NotFoundError("File not found");

                                const actualContents = Buffer.from(
                                    await waitForReadableStreamUint8Array(
                                        object.body as globalThis.ReadableStream<Uint8Array>,
                                    ),
                                );

                                expect(
                                    contents.equals(
                                        // TODO(calebmer, #typescript-5.9.2): Discovered after TS version upgrade, not
                                        // fixing for now.
                                        // @ts-expect-error
                                        actualContents,
                                    ),
                                ).toEqual(true);
                            }

                            const imagePreviewPlaceholder =
                                file.initialData.preview?.type === "Image" &&
                                typeof file.initialData.preview.placeholder !== "string"
                                    ? file.initialData.preview.placeholder
                                    : undefined;

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

                            const codePreviewContent =
                                file.initialData.preview?.type === "Code" &&
                                typeof file.initialData.preview.content !== "string"
                                    ? file.initialData.preview.content
                                    : undefined;

                            expect(
                                codePreviewContent
                                    ?.get()
                                    .map(item =>
                                        item.type === "Newline"
                                            ? "\n"
                                            : item.classes
                                            ? // eslint-disable-next-line string-quotes
                                              `<span class="${item.classes}">${escapeHtml(
                                                  item.string,
                                              )}</span>`
                                            : escapeHtml(item.string),
                                    )
                                    .join(""),
                            ).toEqual(expectedCodePreviewContent);
                            expect(codePreviewContent?.serialize().length).toEqual(
                                expectedCodePreviewContentLength,
                            );

                            await testFileProcessorServiceContentTypeExpectedAlternativeSimilarity(
                                context,
                                {
                                    r2Bucket,
                                    contentType,
                                    path,
                                    space,
                                    fileId: file.id,
                                    expectedAlternative,
                                    looksSameTolerance,
                                },
                            );

                            await testFileProcessorServiceContentTypeExpectedImagePreviewContentSimilarity(
                                {
                                    r2Bucket,
                                    contentType,
                                    path,
                                    space,
                                    fileId: file.id,
                                    expectedImagePreviewContent,
                                    looksSameTolerance,
                                },
                            );
                        },
                        60 * 1000,
                    );
                }
            }
        });
    }
}

async function testFileProcessorServiceContentTypeExpectedAlternativeSimilarity(
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

    const actualContents = Buffer.from(
        await waitForReadableStreamUint8Array(object.body as globalThis.ReadableStream<Uint8Array>),
    );

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
                    "cyberworlds/server/files/processor/test_fixtures",
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
                                // TODO(calebmer, #typescript-5.9.2): Discovered after TS version upgrade, not
                                // fixing for now.
                                // @ts-expect-error
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
                                // TODO(calebmer, #typescript-5.9.2): Discovered after TS version upgrade, not
                                // fixing for now.
                                // @ts-expect-error
                                expectedPageContents,
                            ),
                            result.diffImage?.save(
                                joinPath(testlogsOutputDirectoryPath, `diff.avif`),
                            ),
                        ]);

                        throw new InternalError(
                            quote`Actual alternative PDF page ${
                                i + 1
                            } doesn’t look the same as expected alternative PDF page ${
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
                    "cyberworlds/server/files/processor/test_fixtures",
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
                    retryWithExponentialBackoff(async retry => {
                        const actualMetadataString = await runProcess(
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
                        );

                        // NOTE(calebmer, 2024-11-21): We're experiencing some test flakiness where
                        // occasionally `ffmpeg` returns an empty string for metadata. Let's try
                        // retrying when this happens.
                        if (actualMetadataString === "")
                            retry(new InternalError("Metadata string is empty"));

                        return actualMetadataString;
                    }),
                    retryWithExponentialBackoff(async retry => {
                        const expectedMetadataString = await runProcess(
                            ffprobeExecutablePath,
                            [
                                "-print_format",
                                "json",
                                "-show_streams",
                                "-show_format",
                                expectedPath,
                            ],
                            {cwd: runfilesPath},
                        );

                        // NOTE(calebmer, 2024-11-21): We're experiencing some test flakiness where
                        // occasionally `ffmpeg` returns an empty string for metadata. Let's try
                        // retrying when this happens.
                        if (expectedMetadataString === "")
                            retry(new InternalError("Metadata string is empty"));

                        return expectedMetadataString;
                    }),
                ]);

                let actualMetadata;
                let expectedMetadata;

                try {
                    actualMetadata = JSON.parse(actualMetadataString);
                } catch {
                    throw new InternalError(
                        quote`JSON parsing failed for: ${actualMetadataString}`,
                    );
                }

                try {
                    expectedMetadata = JSON.parse(expectedMetadataString);
                } catch {
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
                            "-threads",
                            String(ffmpegThreadCount),
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
                            ["-threads", String(ffmpegThreadCount)],
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
                            ["-threads", String(ffmpegThreadCount)],
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
                            } doesn’t look the same as expected alternative video frame ${
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
                    quote`Similarity test for content type ${expectedAlternative.contentType} hasn’t been implemented`,
                );
        }
    } catch (error) {
        if (expectedAlternative.similarPath) {
            const expectedPath = joinPath(
                runfilesPath,
                "cyberworlds/server/files/processor/test_fixtures",
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
                    // TODO(calebmer, #typescript-5.9.2): Discovered after TS version upgrade, not
                    // fixing for now.
                    // @ts-expect-error
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

async function testFileProcessorServiceContentTypeExpectedImagePreviewContentSimilarity({
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
        waitForReadableStreamUint8Array(object.body as globalThis.ReadableStream<Uint8Array>).then(
            buffer => Buffer.from(buffer),
        ),
        fs.readFile(
            joinPath(
                runfilesPath,
                "cyberworlds/server/files/processor/test_fixtures",
                expectedImagePreviewContent.similarPath,
            ),
        ),
    ]);

    // Make sure the preview image actually matches the expected format.
    expect(
        pickObject(await sharp(actualImageContents).metadata(), ["format", "compression"]),
    ).toEqual(
        expectedImagePreviewContent.contentType === "image/avif"
            ? {
                  format: "heif",
                  compression: "av1",
              }
            : {
                  format: getFileContentTypePreferredExtension(
                      expectedImagePreviewContent.contentType,
                  ),
              },
    );

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
                // TODO(calebmer, #typescript-5.9.2): Discovered after TS version upgrade, not
                // fixing for now.
                // @ts-expect-error
                actualImageContents,
            ),
            fs.writeFile(
                joinPath(
                    testlogsOutputDirectoryPath,
                    "expected",
                    expectedImagePreviewContent.similarPath,
                ),
                // TODO(calebmer, #typescript-5.9.2): Discovered after TS version upgrade, not
                // fixing for now.
                // @ts-expect-error
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
            "Actual preview image doesn’t look the same as expected preview image, diff image saved to `bazel-testlogs`",
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
            `Placeholder height doesn’t match, actual placeholder: ${actualPlaceholderString}`,
        );
    }

    if (actualSerializedPixelGrid[0] !== expectedSerializedPixelGrid[0]) {
        throw new InvalidArgumentError(
            `Placeholder \`hasAlphaChannel\` doesn’t match, actual placeholder: ${actualPlaceholderString}`,
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
                `Placeholder width doesn’t match, actual placeholder: ${actualPlaceholderString}`,
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
            `Placeholder pixel doesn’t match (average distance = ${averageDistance}), actual placeholder: ${actualPlaceholderString}`,
        );
    }
}

function removePathExtension(path: string): string {
    return path.slice(0, -extname(path).length);
}
