import {spawn} from "child_process";
import {addMinutes} from "date-fns";
import fsSync from "fs";
import fs from "fs/promises";
import {join as joinPath} from "path";
import {Readable as ReadableStream} from "stream";
import {FileProcessorActionContext} from "~/server/files/data/file_processor_context.js";
import {createFileProcessorAnalysisPromises} from "~/server/files/processor/processors/create_file_processor_analysis_promises.js";
import {processFileImagePreviewPlaceholder} from "~/server/files/processor/processors/file_image_processor_base.js";
import {FileProcessor} from "~/server/files/processor/processors/file_processor.js";
import {
    ffmpegExecutablePath,
    ffmpegImagePreviewContentOutputContentType,
    ffmpegImagePreviewContentOutputExtension,
    ffmpegThreadCount,
    getFfmpegImagePreviewContentOutputOptions,
    parseFfmpegStderrDuration,
    parseFfmpegStderrInputCodecNames,
    parseFileImagePreviewSizeAndVideoDurationIfPossibleFromFfmpegStderr,
} from "~/server/files/processor/processors/file_video_and_audio_processor_base.js";
import {filesBucketName} from "~/server/helpers/files_cloudflare_r2_bucket_name.js";
import {getProcessEnvToPropagate} from "~/server/helpers/node/run_process.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {waitForProcessExit} from "~/server/helpers/node/wait_for_process_exit.js";
import {getFileContentTypeName} from "~/shared/content/code/get_file_content_type_name.js";
import {InternalError, UnknownError} from "~/shared/error/error.js";
import {
    FileContentType,
    FileMp4VideoContentType,
    FileWebUnsafeVideoContentType,
    getFileContentTypePreferredExtension,
} from "~/shared/files/file_content_type.js";
import {FileImagePreviewPlaceholder} from "~/shared/files/file_image_preview_placeholder.js";
import {FileImagePreviewSize} from "~/shared/files/file_preview.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {cast} from "~/shared/helpers/control/cast.js";

/**
 * For video formats that don't have broad browser support we convert them to WebM
 * using the VP9 video codec and Opus audio codec. This is what [MDN recommends for
 * a good everyday video codec]. We save the WebM data as the file's alternative so
 * it's displayed in our file viewer instead of the file itself.
 *
 * [1]:
 *     https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Video_codecs#choosing_a_video_codec
 */
export function createFileWebUnsafeVideoProcessor(
    contentType: FileWebUnsafeVideoContentType,
): FileProcessor {
    return {
        type: "WebUnsafeVideo",
        hasAlternative: true,
        hasAnalysis: true,
        hasPreview: {
            type: "Image",
            hasContent: true,
            hasVideoDuration: true,
        },
        hasTranscript: true,
        process: async (
            context,
            {
                spaceId,
                fileId,
                signal,
                contentLength,
                parentTemporaryDirectoryPath,
                withTemporaryDirectory,
            },
        ) => {
            const [temporaryDirectoryPath, inputUrl] = await runAllPromises([
                withTemporaryDirectory(),
                context.r2.getGetObjectSignedUrl(addMinutes(new Date(), 60), {
                    Bucket: filesBucketName,
                    Key: `${spaceId}/${fileId}`,
                }),
            ]);

            return {
                ...(await processFileWebUnsafeVideo(context, inputUrl, {
                    signal,
                    contentType,
                    contentLength,
                    temporaryDirectoryPath,
                })),
                ...createFileProcessorAnalysisPromises(context, {
                    contentType,
                    fileId,
                    hasTranscript: true,
                    parentTemporaryDirectoryPath,
                    signal,
                    spaceId,
                }),
            };
        },
    };
}

export async function processFileWebUnsafeVideo(
    context: FileProcessorActionContext,
    inputUrl: string,
    {
        signal,
        contentType,
        contentLength,
        temporaryDirectoryPath,
    }: {
        signal: AbortSignal;
        contentType: FileWebUnsafeVideoContentType | FileMp4VideoContentType;
        contentLength: number;
        temporaryDirectoryPath: string;
    },
) {
    const previewSizePromiseResolver = createPromiseResolver<
        FileImagePreviewSize & {videoDuration?: number}
    >();
    const previewPlaceholderPromiseResolver = createPromiseResolver<FileImagePreviewPlaceholder>();
    const previewContentPromiseResolver = createPromiseResolver<{
        contentType: FileContentType;
        contentLength: number;
        data: Buffer | ReadableStream;
    }>();
    const previewVideoDurationPromiseResolver = createPromiseResolver<number>();

    const alternativePromise = (async (): Promise<{
        contentType: FileContentType;
        contentLength: number;
        data: Buffer | ReadableStream;
    }> => {
        const previewOutput1Path = joinPath(
            temporaryDirectoryPath,
            `output1.${ffmpegImagePreviewContentOutputExtension}`,
        );

        const previewOutput2Path = joinPath(
            temporaryDirectoryPath,
            `output2.${ffmpegImagePreviewContentOutputExtension}`,
        );

        const previewOutput3Path = joinPath(
            temporaryDirectoryPath,
            `output3.${ffmpegImagePreviewContentOutputExtension}`,
        );

        const alternativeOutputPath = joinPath(
            temporaryDirectoryPath,
            `output4.${getFileContentTypePreferredExtension("video/webm")}`,
        );

        const previewContentSubprocess = spawn(
            ffmpegExecutablePath,
            [
                // Input comes from a signed HTTP URL. FFmpeg is smart about streaming only the
                // data it needs with HTTP `Range` requests.
                "-i",
                inputUrl,
                // Limit the number of threads for FFmpeg to reduce resource contention in
                // `FileProcessorService`.
                "-threads",
                String(ffmpegThreadCount),
                // Capture thumbnails from the beginning of the video.
                //
                // We must output to a file. We can't output to stdout when taking a screenshot or
                // else we get the error "[avif] muxer does not support non seekable output".
                ...getFfmpegImagePreviewContentOutputOptions({
                    output1Path: previewOutput1Path,
                    output2Path: previewOutput2Path,
                    output3Path: previewOutput3Path,
                }),
            ],
            {
                cwd: runfilesPath,
                env: getProcessEnvToPropagate(),
                stdio: ["ignore", "pipe", "pipe"],
                signal,
            },
        );

        const alternativeSubprocess = spawn(
            ffmpegExecutablePath,
            [
                // Input comes from a signed HTTP URL. FFmpeg is smart about streaming only the
                // data it needs with HTTP `Range` requests.
                "-i",
                inputUrl,
                // Limit the number of threads for FFmpeg to reduce resource contention in
                // `FileProcessorService`.
                "-threads",
                String(ffmpegThreadCount),
                // Convert the video file to WebM using the VP9 video codec and Opus audio codec.
                // This is what [MDN recommends for a good everyday video codec].
                //
                // [1]:
                //     https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Video_codecs#choosing_a_video_codec
                "-f",
                "webm",
                "-vcodec",
                "libvpx-vp9",
                "-acodec",
                "libopus",
                // Enable row based multi-threading for `libvpx-vp9` encoding since it's not
                // enabled by default. https://trac.ffmpeg.org/wiki/Encode/VP9#rowmt
                "-row-mt",
                "1",
                // In unit tests, tune `libvpx-vp9` encoding to prefer speed over quality at all
                // costs. This takes the test for `calebmer_alpine_forum_screen_recording.mov` from
                // completing in ~30s to completing in ~2s.
                // https://trac.ffmpeg.org/wiki/Encode/VP9#DeadlineQuality
                ...(import.meta.jest
                    ? ["-deadline", "realtime", "-cpu-used", "8"]
                    : // NOTE(ifitzsimmons, 2025-07-31): See benchmarks:
                      // https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/documents/mmcg93qv2zvzmnmqt3ec6vtexm
                      // This alleviates some of the timeout issues we've seen in production without
                      // compromising too much on quality. We landed on this setting during Tea Time. We
                      // did discuss changing video resolution to 1080p as well since this only impacts
                      // the quality of embedded videos (downloading from the app downloads the original
                      // video). We decided to continue to allow high resolution videos and compromise on
                      // compression efficiency instead. This means the web safe files that we store will
                      // be slightly larger.
                      ["-deadline", "realtime", "-cpu-used", "6"]),
                // Output the new video to the provided path.
                alternativeOutputPath,
            ],
            {
                cwd: runfilesPath,
                env: getProcessEnvToPropagate(),
                stdio: ["ignore", "pipe", "pipe"],
                signal,
            },
        );

        let previewContentStderr = "";
        let alternativeStderr = "";

        // This function checks to see if the input's duration and width/height have been
        // written to stderr and if it has then we can resolve `previewContentPromise`.
        // This will push an update to the user waiting on their file to upload so they can
        // see a preview of the file in the product.
        const attemptResolvePreviewSize = () => {
            if (previewSizePromiseResolver.isSettled()) return;

            try {
                const previewSize =
                    parseFileImagePreviewSizeAndVideoDurationIfPossibleFromFfmpegStderr(
                        previewContentStderr,
                        // HACK: Which content types may have an alpha channel? It's ok to return true if
                        // the video doesn't actually have any transparent pixels but it's not ok to return
                        // false if the video does have transparent pixels.
                        //
                        // TODO: We should parse the pixel format out of stderr and check if the pixel
                        // format has an alpha channel.
                        cast<{
                            [Key in
                                | FileWebUnsafeVideoContentType
                                | FileMp4VideoContentType]: boolean;
                        }>({
                            "video/quicktime": false,
                            "video/mpeg": false,
                            "video/x-matroska": false,
                            "video/mp4": false,
                        })[contentType],
                    );
                if (!previewSize) return;

                previewSizePromiseResolver.resolve(previewSize);

                if (previewSize.videoDuration !== undefined) {
                    previewVideoDurationPromiseResolver.resolve(previewSize.videoDuration);
                }
            } catch (error) {
                previewSizePromiseResolver.reject(error);
            }
        };

        previewContentSubprocess.stderr.on("data", (chunk: Buffer) => {
            const string = chunk.toString("utf8");
            previewContentStderr += string;

            attemptResolvePreviewSize();
        });

        alternativeSubprocess.stderr.on("data", (chunk: Buffer) => {
            const string = chunk.toString("utf8");
            alternativeStderr += string;
        });

        const [, alternative] = await runAllPromises([
            (async () => {
                await context.tracer.withSpan(
                    `FFmpeg generate ${getFileContentTypeName(
                        contentType,
                    )} preview ${getFileContentTypeName(
                        ffmpegImagePreviewContentOutputContentType,
                    )}`,
                    async (context, span) => {
                        span.addData({
                            file: {contentType, contentLength},
                        });

                        await waitForProcessExit(previewContentSubprocess).catch(error => {
                            // We include the stderr in error messages even in production since it shouldn't
                            // contain sensitive user data. It may contain the file's duration and other
                            // metadata but it shouldn't be harmful for a developer to read that.
                            //
                            // However, including the stderr will really help us debug any issues.
                            throw new UnknownError(
                                `${
                                    error instanceof Error ? error.message : String(error)
                                }\n\nstderr:\n${previewContentStderr.trim()}`,
                                {
                                    cause: error instanceof Error ? error.cause : undefined,
                                },
                            );
                        });

                        span.addData({
                            ffmpeg: {
                                codecs: parseFfmpegStderrInputCodecNames(previewContentStderr),
                            },
                        });

                        attemptResolvePreviewSize();

                        if (!previewSizePromiseResolver.isSettled()) {
                            throw new InternalError(
                                `Couldn\u2019t find video duration and width/height from FFmpeg stderr\n\nstderr:\n${previewContentStderr.trim()}`,
                            );
                        }
                    },
                );

                // Determine which thumbnail to use. If the second thumbnail (taken at 1s) is empty
                // then we need to use the third thumbnail (taken at 0s). If the first thumbnail
                // (taken at 10s) is empty but not the second thumbnail then we'll use the second
                // thumbnail (taken at 1s).
                //
                // This way if a video is longer than 10s we'll use the 10s thumbnail. Otherwise
                // we'll use the 1s thumbnail.
                let outputPath: string;
                if (
                    /(?:^|\n)\[out#1\/[^\]]*\] Output file is empty, nothing was encoded\(check -ss \/ -t \/ -frames parameters if used\)(?:\n|$)/.test(
                        previewContentStderr,
                    )
                ) {
                    outputPath = previewOutput3Path;
                } else if (
                    /(?:^|\n)\[out#0\/[^\]]*\] Output file is empty, nothing was encoded\(check -ss \/ -t \/ -frames parameters if used\)(?:\n|$)/.test(
                        previewContentStderr,
                    )
                ) {
                    outputPath = previewOutput2Path;
                } else {
                    outputPath = previewOutput1Path;
                }

                const outputContentLength = (await fs.stat(outputPath)).size;

                previewPlaceholderPromiseResolver.resolve(
                    processFileImagePreviewPlaceholder(context, outputPath, {
                        contentType: ffmpegImagePreviewContentOutputContentType,
                        contentLength: outputContentLength,
                    }),
                );

                previewContentPromiseResolver.resolve({
                    contentType: ffmpegImagePreviewContentOutputContentType,
                    contentLength: outputContentLength,
                    data: fsSync.createReadStream(outputPath),
                });
            })(),
            context.tracer.withSpan(
                `FFmpeg transcode ${getFileContentTypeName(
                    contentType,
                )} to ${getFileContentTypeName("video/webm")}`,
                async (context, span) => {
                    span.addData({
                        file: {contentType, contentLength},
                    });

                    await waitForProcessExit(alternativeSubprocess).catch(error => {
                        // We include the stderr in error messages even in production since it shouldn't
                        // contain sensitive user data. It may contain the file's duration and other
                        // metadata but it shouldn't be harmful for a developer to read that.
                        //
                        // However, including the stderr will really help us debug any issues.
                        throw new UnknownError(
                            `${
                                error instanceof Error ? error.message : String(error)
                            }\n\nstderr:\n${alternativeStderr.trim()}`,
                            {
                                cause: error instanceof Error ? error.cause : undefined,
                            },
                        );
                    });

                    span.addData({
                        ffmpeg: {
                            codecs: parseFfmpegStderrInputCodecNames(alternativeStderr),
                        },
                    });

                    // If the video duration wasn't present in the video's metadata then we wait until
                    // FFmpeg finishes and parse the duration from `time` printed at the end of
                    // FFmpeg's stderr.
                    if (!previewVideoDurationPromiseResolver.isSettled()) {
                        const match = alternativeStderr
                            .trimEnd()
                            .match(/time=(\d\d:\d\d:\d\d(?:\.\d+)?).*$/);
                        if (!match) {
                            throw new InternalError(
                                `Couldn\u2019t parse video duration from FFmpeg stderr\n\nstderr:\n${alternativeStderr.trim()}`,
                            );
                        }

                        previewVideoDurationPromiseResolver.resolve(
                            parseFfmpegStderrDuration(match[1]!),
                        );
                    }

                    // Read the transcoded alternative file from the file system.
                    return {
                        contentType: "video/webm" as const,
                        contentLength: (await fs.stat(alternativeOutputPath)).size,
                        data: fsSync.createReadStream(alternativeOutputPath),
                    };
                },
            ),
        ]);

        return alternative;
    })().then(
        alternative => {
            // All of these promise resolvers MUST have either been resolved or rejected by the
            // end of this promise. So any promise resolvers that haven't been settled yet
            // reject with an error as a safety mechanism.
            if (!previewSizePromiseResolver.isSettled()) {
                previewSizePromiseResolver.reject(
                    new InternalError("Promise resolver wasn\u2019t resolved"),
                );
            }
            if (!previewContentPromiseResolver.isSettled()) {
                previewContentPromiseResolver.reject(
                    new InternalError("Promise resolver wasn\u2019t resolved"),
                );
            }
            if (!previewVideoDurationPromiseResolver.isSettled()) {
                previewVideoDurationPromiseResolver.reject(
                    new InternalError("Promise resolver wasn\u2019t resolved"),
                );
            }
            return alternative;
        },
        error => {
            previewSizePromiseResolver.reject(error);
            previewContentPromiseResolver.reject(error);
            previewVideoDurationPromiseResolver.reject(error);
            throw error;
        },
    );

    return {
        alternativePromise,
        imagePreviewSizePromise: previewSizePromiseResolver.promise,
        imagePreviewPlaceholderPromise: previewPlaceholderPromiseResolver.promise,
        imagePreviewContentPromise: previewContentPromiseResolver.promise,
        imagePreviewVideoDurationPromise: previewVideoDurationPromiseResolver.promise,
    };
}
