import {spawn} from "child_process";
import fsSync from "fs";
import fs from "fs/promises";
import {join as joinPath} from "path";
import {Readable as ReadableStream} from "stream";
import {ReplayStream} from "~/server/files/upload/helpers/replay_stream.js";
import {waitForWritableStreamClose} from "~/server/files/upload/helpers/wait_for_writable_stream_close.js";
import {processFileImagePreviewPlaceholder} from "~/server/files/upload/processors/file_image_processor_base.js";
import {FileProcessor} from "~/server/files/upload/processors/file_processor.js";
import {
    ffmpegExecutablePath,
    ffmpegImagePreviewContentOutputContentType,
    ffmpegImagePreviewContentOutputExtension,
    getFfmpegImagePreviewContentOutputOptions,
    parseFfmpegStderrDuration,
    parseFfmpegStderrInputCodecNames,
    parseFileImagePreviewSizeAndVideoDurationIfPossibleFromFfmpegStderr,
} from "~/server/files/upload/processors/file_video_and_audio_processor_base.js";
import {getProcessEnvToPropagate} from "~/server/helpers/node/run_process.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {waitForProcessExit} from "~/server/helpers/node/wait_for_process_exit.js";
import {withTemporaryDirectory} from "~/server/helpers/node/with_temporary_directory.js";
import {InternalError, UnknownError} from "~/shared/error/error.js";
import {
    FileContentType,
    FileMp4VideoContentType,
    FileWebUnsafeVideoContentType,
    getFileContentTypePreferredExtension,
} from "~/shared/files/file_content_type.js";
import {FileImagePreviewSize} from "~/shared/files/file_preview.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {isObject} from "~/shared/helpers/object/is_object.js";

/**
 * For video formats that don't have broad browser support we convert them to
 * WebM using the VP9 video codec and Opus audio codec. This is what [MDN
 * recommends for a good everyday video codec]. We save the WebM data as the
 * file's alternative so it's displayed in our file viewer instead of the file
 * itself.
 *
 * [1]: https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Video_codecs#choosing_a_video_codec
 */
export function createFileWebUnsafeVideoProcessor(
    contentType: FileWebUnsafeVideoContentType | FileMp4VideoContentType,
): FileProcessor {
    const processorType = "WebUnsafeVideo";

    return {
        type: processorType,
        hasAlternative: true,
        hasPreview: {
            type: "Image",
            hasContent: true,
            hasVideoDuration: true,
        },
        process: (
            stream,
            signal,
            {span, fileId, contentLength, temporaryDirectoryPath: parentTemporaryDirectoryPath},
        ) => {
            const alternativePromiseResolver = createPromiseResolver<{
                contentType: FileContentType;
                contentLength: number;
                data: ReadableStream;
            }>();
            const previewSizePromiseResolver = createPromiseResolver<
                FileImagePreviewSize & {videoDuration?: number}
            >();
            const previewContentPromiseResolver = createPromiseResolver<{
                contentType: FileContentType;
                contentLength: number;
                data: Buffer;
            }>();
            const previewVideoDurationPromiseResolver = createPromiseResolver<number>();

            const extraPromise = (() => {
                // Create a replay stream which will replay any chunks written while we create
                // our temporary directory. This won't block the Cloudflare R2 upload which is
                // also consuming the stream in parallel.
                const replayStream = stream.pipe(new ReplayStream());

                return withTemporaryDirectory(
                    parentTemporaryDirectoryPath,
                    `${fileId}_`,
                    async temporaryDirectoryPath => {
                        const previewOutput1Path = joinPath(
                            temporaryDirectoryPath,
                            `preview-output-1.${ffmpegImagePreviewContentOutputExtension}`,
                        );

                        const previewOutput2Path = joinPath(
                            temporaryDirectoryPath,
                            `preview-output-2.${ffmpegImagePreviewContentOutputExtension}`,
                        );

                        const previewOutput3Path = joinPath(
                            temporaryDirectoryPath,
                            `preview-output-3.${ffmpegImagePreviewContentOutputExtension}`,
                        );

                        const outputPath = joinPath(
                            temporaryDirectoryPath,
                            `output.${getFileContentTypePreferredExtension("video/webm")}`,
                        );

                        // Some formats must be seekable so can't be piped into FFmpeg. Instead we need
                        // to provide FFmpeg a file path. For example [MOV must be seekable][1]. MPEG
                        // can't find the duration when it's streamed in.
                        //
                        // [1]: https://ffmpeg.org/ffmpeg-protocols.html#pipe
                        const inputPath =
                            contentType === "video/quicktime" ||
                            contentType === "video/mpeg" ||
                            contentType === "video/mp4"
                                ? joinPath(
                                      temporaryDirectoryPath,
                                      `input.${getFileContentTypePreferredExtension(contentType)}`,
                                  )
                                : null;

                        if (inputPath !== null) {
                            const writeStream = fsSync.createWriteStream(inputPath);

                            replayStream.ready();
                            replayStream.pipe(writeStream);

                            await waitForWritableStreamClose(writeStream, signal);
                        }

                        const previewContentSubprocess = spawn(
                            ffmpegExecutablePath,
                            [
                                // Input is coming from stdin unless `inputPath` is set.
                                // https://ffmpeg.org/ffmpeg-protocols.html#pipe
                                "-i",
                                inputPath ?? "pipe:0",
                                // Only use up to 2 threads for FFmpeg to avoid resource contention
                                // in `FileUploadService`.
                                "-threads",
                                "2",
                                // Capture thumbnails from the beginning of the video.
                                //
                                // We must output to a file. We can't output to stdout when taking a screenshot
                                // or else we get the error "[avif] muxer does not support non seekable
                                // output".
                                ...getFfmpegImagePreviewContentOutputOptions({
                                    output1Path: previewOutput1Path,
                                    output2Path: previewOutput2Path,
                                    output3Path: previewOutput3Path,
                                }),
                            ],
                            {
                                cwd: runfilesPath,
                                env: getProcessEnvToPropagate(),
                                stdio: ["pipe", "pipe", "pipe"],
                                signal,
                            },
                        );

                        const alternativeSubprocess = spawn(
                            ffmpegExecutablePath,
                            [
                                // Input is coming from stdin unless `inputPath` is set.
                                // https://ffmpeg.org/ffmpeg-protocols.html#pipe
                                "-i",
                                inputPath ?? "pipe:0",
                                // Only use up to 2 threads for FFmpeg to avoid resource contention
                                // in `FileUploadService`.
                                "-threads",
                                "2",
                                // Convert the video file to WebM using the VP9 video codec and Opus audio
                                // codec. This is what [MDN recommends for a good everyday video codec].
                                //
                                // [1]: https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Video_codecs#choosing_a_video_codec
                                "-f",
                                "webm",
                                "-vcodec",
                                "libvpx-vp9",
                                "-acodec",
                                "libopus",
                                // Output the new video to the provided path.
                                outputPath,
                            ],
                            {
                                cwd: runfilesPath,
                                env: getProcessEnvToPropagate(),
                                stdio: ["pipe", "pipe", "pipe"],
                                signal,
                            },
                        );

                        if (inputPath === null) {
                            replayStream.ready();
                            replayStream.pipe(previewContentSubprocess.stdin);
                            replayStream.pipe(alternativeSubprocess.stdin);
                        }

                        let previewContentStderr = "";
                        let alternativeStderr = "";

                        // This function checks to see if the input's duration and width/height have
                        // been written to stderr and if it has then we can resolve
                        // `previewContentPromise`. This will push an update to the user waiting on their
                        // file to upload so they can see a preview of the file in the product.
                        const attemptResolvePreviewSize = () => {
                            if (previewSizePromiseResolver.isSettled()) return;

                            try {
                                const previewSize =
                                    parseFileImagePreviewSizeAndVideoDurationIfPossibleFromFfmpegStderr(
                                        previewContentStderr,
                                        // HACK: Which content types may have an alpha channel? It's ok to return true
                                        // if the video doesn't actually have any transparent pixels but it's not ok to
                                        // return false if the video does have transparent pixels.
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
                                    previewVideoDurationPromiseResolver.resolve(
                                        previewSize.videoDuration,
                                    );
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

                        await runAllPromises([
                            (async () => {
                                await span.withSpan("FFmpeg generate preview image", async span => {
                                    span.addData({
                                        file: {contentType, contentLength, processorType},
                                    });

                                    await waitForProcessExit(previewContentSubprocess, {
                                        onStdinError: error => {
                                            // `EPIPE` errors are expected. FFmpeg will close its side of stdin once it has
                                            // taken the screenshot. We can't destroy `replayStream` since it'll still
                                            // be used to pipe data into `alternativeSubprocess`.
                                            if (isObject(error) && error.code === "EPIPE") {
                                                return {preventDefault: true};
                                            }
                                        },
                                    }).catch(error => {
                                        // If our process was aborted then rethrow the abort error instead of a new
                                        // `UnknownError`.
                                        if (signal.aborted) throw signal.reason;

                                        // We include the stderr in error messages even in production since it shouldn't
                                        // contain sensitive user data. It may contain the file's duration and other
                                        // metadata but it shouldn't be harmful for a developer to read that.
                                        //
                                        // However, including the stderr will really help us debug any issues.
                                        throw new UnknownError(
                                            `${
                                                error instanceof Error
                                                    ? error.message
                                                    : String(error)
                                            }\n\nstderr:\n${previewContentStderr.trim()}`,
                                            {
                                                cause:
                                                    error instanceof Error
                                                        ? error.cause
                                                        : undefined,
                                            },
                                        );
                                    });

                                    span.addData({
                                        ffmpeg: {
                                            codecs: parseFfmpegStderrInputCodecNames(
                                                previewContentStderr,
                                            ),
                                        },
                                    });

                                    attemptResolvePreviewSize();

                                    if (!previewSizePromiseResolver.isSettled()) {
                                        throw new InternalError(
                                            `Couldn't find video duration and width/height from FFmpeg stderr\n\nstderr:\n${previewContentStderr.trim()}`,
                                        );
                                    }
                                });

                                // Determine which thumbnail to use. If the second thumbnail (taken at 1s) is
                                // empty then we need to use the third thumbnail (taken at 0s). If the first
                                // thumbnail (taken at 10s) is empty but not the second thumbnail then we'll
                                // use the second thumbnail (taken at 1s).
                                //
                                // This way if a video is longer than 10s we'll use the 10s thumbnail.
                                // Otherwise we'll use the 1s thumbnail.
                                let outputData;
                                if (
                                    /(?:^|\n)\[out#1\/[^\]]*\] Output file is empty, nothing was encoded\(check -ss \/ -t \/ -frames parameters if used\)(?:\n|$)/.test(
                                        previewContentStderr,
                                    )
                                ) {
                                    outputData = await fs.readFile(previewOutput3Path);
                                } else if (
                                    /(?:^|\n)\[out#0\/[^\]]*\] Output file is empty, nothing was encoded\(check -ss \/ -t \/ -frames parameters if used\)(?:\n|$)/.test(
                                        previewContentStderr,
                                    )
                                ) {
                                    outputData = await fs.readFile(previewOutput2Path);
                                } else {
                                    outputData = await fs.readFile(previewOutput1Path);
                                }

                                previewContentPromiseResolver.resolve({
                                    contentType: ffmpegImagePreviewContentOutputContentType,
                                    contentLength: outputData.length,
                                    // Unfortunately, `sharp` doesn't support efficient stream processing so it's
                                    // more efficient to read the full data buffer into memory than to use
                                    // `fs.createReadStream()` and stream that data into `sharp`. See our comment
                                    // on `FileProcessor`.
                                    //
                                    // Reading the file into memory also allows our temporary directory to be
                                    // cleaned up.
                                    data: outputData,
                                });
                            })(),
                            span.withSpan("FFmpeg transcode video alternative", async span => {
                                span.addData({
                                    file: {contentType, contentLength, processorType},
                                });

                                await waitForProcessExit(alternativeSubprocess).catch(error => {
                                    // If our process was aborted then rethrow the abort error instead of a new
                                    // `UnknownError`.
                                    if (signal.aborted) throw signal.reason;

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

                                // If the video duration wasn't present in the video's metadata then we wait
                                // until FFmpeg finishes and parse the duration from `time` printed at the end
                                // of FFmpeg's stderr.
                                if (!previewVideoDurationPromiseResolver.isSettled()) {
                                    const match = alternativeStderr
                                        .trimEnd()
                                        .match(/time=(\d\d:\d\d:\d\d(?:\.\d+)?).*$/);
                                    if (!match) {
                                        throw new InternalError(
                                            `Couldn't parse video duration from FFmpeg stderr\n\nstderr:\n${alternativeStderr.trim()}`,
                                        );
                                    }

                                    previewVideoDurationPromiseResolver.resolve(
                                        parseFfmpegStderrDuration(match[1]!),
                                    );
                                }

                                // Read the transcoded alternative file from the file system.
                                alternativePromiseResolver.resolve({
                                    contentType: "video/webm",
                                    contentLength: (await fs.stat(outputPath)).size,
                                    data: fsSync.createReadStream(outputPath),
                                });
                            }),
                        ]);
                    },
                );
            })().then(
                () => {
                    // All of these promise resolvers MUST have either been resolved or rejected by
                    // the end of this promise. So any promise resolvers that haven't been settled
                    // yet reject with an error as a safety mechanism.
                    if (!alternativePromiseResolver.isSettled()) {
                        alternativePromiseResolver.reject(
                            new InternalError("Promise resolver wasn't resolved"),
                        );
                    }
                    if (!previewSizePromiseResolver.isSettled()) {
                        previewSizePromiseResolver.reject(
                            new InternalError("Promise resolver wasn't resolved"),
                        );
                    }
                    if (!previewContentPromiseResolver.isSettled()) {
                        previewContentPromiseResolver.reject(
                            new InternalError("Promise resolver wasn't resolved"),
                        );
                    }
                    if (!previewVideoDurationPromiseResolver.isSettled()) {
                        previewVideoDurationPromiseResolver.reject(
                            new InternalError("Promise resolver wasn't resolved"),
                        );
                    }
                },
                error => {
                    alternativePromiseResolver.reject(error);
                    previewSizePromiseResolver.reject(error);
                    previewContentPromiseResolver.reject(error);
                    previewVideoDurationPromiseResolver.reject(error);
                    throw error;
                },
            );

            return {
                extraPromise,
                alternativePromise: alternativePromiseResolver.promise,
                imagePreviewSizePromise: previewSizePromiseResolver.promise,
                imagePreviewPlaceholderPromise: (async () => {
                    const {data} = await previewContentPromiseResolver.promise;
                    return processFileImagePreviewPlaceholder(data);
                })(),
                imagePreviewContentPromise: previewContentPromiseResolver.promise,
                imagePreviewVideoDurationPromise: previewVideoDurationPromiseResolver.promise,
            };
        },
    };
}
