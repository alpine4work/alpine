import {spawn} from "child_process";
import fsSync from "fs";
import fs from "fs/promises";
import {join as joinPath} from "path";
import {ReplayStream} from "~/server/files/upload/helpers/replay_stream.js";
import {waitForWritableStreamClose} from "~/server/files/upload/helpers/wait_for_writable_stream_close.js";
import {processFileImagePreviewPlaceholder} from "~/server/files/upload/processors/file_image_processor_base.js";
import {FileProcessor} from "~/server/files/upload/processors/file_processor.js";
import {
    ffmpegExecutablePath,
    ffmpegImagePreviewContentOutputContentType,
    ffmpegImagePreviewContentOutputExtension,
    ffmpegImagePreviewContentOutputOptions,
    parseFfmpegStderrDuration,
    parseFfmpegStderrInputCodecNames,
    parseFilePreviewSizeAndVideoDurationIfPossibleFromFfmpegStderr,
} from "~/server/files/upload/processors/file_video_processor_base.js";
import {getProcessEnvToPropagate} from "~/server/helpers/node/run_process.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {waitForProcessExit} from "~/server/helpers/node/wait_for_process_exit.js";
import {withTemporaryDirectory} from "~/server/helpers/node/with_temporary_directory.js";
import {InternalError, UnknownError} from "~/shared/error/error.js";
import {
    FileContentType,
    FileMp4VideoContentType,
    FileWebmVideoContentType,
    getFileContentTypePreferredExtension,
} from "~/shared/files/file_content_type.js";
import {FileImagePreviewSize} from "~/shared/files/file_preview.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {isObject} from "~/shared/helpers/object/is_object.js";

/**
 * WebM files are [completely supported by all web browsers][1]. All video
 * codecs and audio codecs used by WebM are supported cross browsers. So to
 * process a WebM file we only need to take a screenshot. We don't need to
 * transcode the file to a different format.
 *
 * We consider some MP4 videos to be web safe as well. Depending on what codecs
 * the MP4 video uses.
 *
 * [1]: https://caniuse.com/webm
 */
export function createFileWebSafeVideoProcessor(
    contentType: FileWebmVideoContentType | FileMp4VideoContentType,
): FileProcessor {
    const processorType = "WebSafeVideo";

    return {
        type: processorType,
        hasAlternative: false,
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
            const previewSizePromiseResolver = createPromiseResolver<
                FileImagePreviewSize & {videoDuration?: number}
            >();

            const previewContentPromise = (() => {
                // Create a replay stream which will replay any chunks written while we create
                // our temporary directory. This won't block the Cloudflare R2 upload which is
                // also consuming the stream in parallel.
                const replayStream = stream.pipe(new ReplayStream());

                return withTemporaryDirectory(
                    parentTemporaryDirectoryPath,
                    `${fileId}_`,
                    async (
                        temporaryDirectoryPath,
                    ): Promise<{
                        contentType: FileContentType;
                        data: Buffer;
                    }> => {
                        const outputPath = joinPath(
                            temporaryDirectoryPath,
                            `output.${ffmpegImagePreviewContentOutputExtension}`,
                        );

                        // Some formats must be seekable so can't be piped into FFmpeg. Instead we need
                        // to provide FFmpeg a file path. For example [MOV must be seekable][1].
                        //
                        // [1]: https://ffmpeg.org/ffmpeg-protocols.html#pipe
                        const inputPath =
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

                        const subprocess = spawn(
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
                                // Capture a thumbnail from the first second of the video.
                                ...ffmpegImagePreviewContentOutputOptions,
                                // We must output to a file. We can't output to stdout when taking a screenshot
                                // or else we get the error "[avif] muxer does not support non seekable
                                // output".
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
                            replayStream.pipe(subprocess.stdin);
                        }

                        let stdout = "";
                        let stderr = "";

                        // This function checks to see if the input's duration and width/height have
                        // been written to stderr and if it has then we can resolve
                        // `previewContentPromise`. This will push an update to the user waiting on their
                        // file to upload so they can see a preview of the file in the product.
                        const attemptResolvePreviewSize = () => {
                            if (previewSizePromiseResolver.isSettled()) return;

                            try {
                                const previewSize =
                                    parseFilePreviewSizeAndVideoDurationIfPossibleFromFfmpegStderr(
                                        stderr,
                                    );
                                if (!previewSize) return;
                                previewSizePromiseResolver.resolve(previewSize);
                            } catch (error) {
                                previewSizePromiseResolver.reject(error);
                            }
                        };

                        subprocess.stdout.on("data", (chunk: Buffer) => {
                            const string = chunk.toString("utf8");
                            stdout += string;
                        });

                        subprocess.stderr.on("data", (chunk: Buffer) => {
                            const string = chunk.toString("utf8");
                            stderr += string;

                            attemptResolvePreviewSize();
                        });

                        await span.withSpan("FFmpeg generate preview image", async span => {
                            span.addData({
                                file: {contentType, contentLength, processorType},
                            });

                            await waitForProcessExit(subprocess, {
                                onStdinError: error => {
                                    // `EPIPE` errors are expected. FFmpeg will close its side of stdin once it has
                                    // taken the screenshot. We can destroy `replayStream` once we get an `EPIPE`
                                    // error as we don't need data from our input anymore.
                                    if (isObject(error) && error.code === "EPIPE") {
                                        replayStream.destroy();
                                        return {preventDefault: true};
                                    }
                                },
                            }).catch(error => {
                                // If our process was aborted then rethrow the abort error instead of a new
                                // `UnknownError`.
                                if (signal.aborted) throw signal.reason;

                                // We include the stderr in error messages even in production since it shouldn't
                                // contain sensitive user data. Even if it does contain sensitive user data it
                                // should be so opaque as to not be useful for reconstructing the video file.
                                //
                                // However, including the stderr will really help us debug any issues.
                                throw new UnknownError(
                                    `${
                                        error instanceof Error ? error.message : String(error)
                                    }\n\nstdout:\n${stdout.trim()}\n\nstderr:\n${stderr.trim()}`,
                                    {
                                        cause: error instanceof Error ? error.cause : undefined,
                                    },
                                );
                            });

                            span.addData({
                                ffmpeg: {
                                    codecs: parseFfmpegStderrInputCodecNames(stderr),
                                },
                            });
                        });

                        attemptResolvePreviewSize();

                        if (!previewSizePromiseResolver.isSettled()) {
                            throw new InternalError(
                                `Couldn't find video duration and width/height from FFmpeg stderr\n\nstdout:\n${stdout.trim()}\n\nstderr:\n${stderr.trim()}`,
                            );
                        }

                        return {
                            contentType: ffmpegImagePreviewContentOutputContentType,
                            // Unfortunately, `sharp` doesn't support efficient stream processing so it's
                            // more efficient to read the full data buffer into memory than to use
                            // `fs.createReadStream()` and stream that data into `sharp`. See our comment
                            // on `FileProcessor`.
                            //
                            // Reading the file into memory also allows our temporary directory to be
                            // cleaned up.
                            data: await fs.readFile(outputPath),
                        };
                    },
                );
            })().catch(error => {
                previewSizePromiseResolver.reject(error);
                throw error;
            });

            // To determine the video's duration we first wait for metadata from our FFmpeg
            // run (from `previewSizePromiseResolver`). If we have duration metadata we can
            // return immediately! If we don't then we use `ffprobe` to parse the video
            // file and figure out the duration.
            const previewVideoDurationPromise = (async () => {
                // Create a replay stream which will replay any chunks written while we create
                // our temporary directory. This won't block the Cloudflare R2 upload which is
                // also consuming the stream in parallel.
                const replayStream = stream.pipe(new ReplayStream());

                try {
                    const previewSize = await previewSizePromiseResolver.promise;

                    // If we were able to parse `videoDuration` with the preview size then hooray!
                    // That means the video had easily accessible duration metadata. Destroy
                    // `pausedProbeStream` since we don't need it and return the video duration
                    // immediately.
                    if (previewSize.videoDuration !== undefined) {
                        replayStream.destroy();
                        return previewSize.videoDuration;
                    }
                } catch (error) {
                    // If there was an error parsing the preview size, destroy our probe stream. We
                    // won't be using it.
                    replayStream.destroy();
                    throw error;
                }

                // Otherwise we need to decode the full stream to figure out the video
                // duration. Command from this [Stack Exchange][1] post using the
                // "With `ffmpeg`" solution. This approach is also recommended by the FFmpeg
                // docs in the FFprobe tips "[Get duration by decoding][2]" section.
                //
                // [1]: https://superuser.com/a/945604/857823
                // [2]: https://trac.ffmpeg.org/wiki/FFprobeTips#Getdurationbydecoding
                const subprocess = spawn(
                    ffmpegExecutablePath,
                    [
                        "-i",
                        "pipe:0",
                        // Only use up to 2 threads for FFmpeg to avoid resource contention
                        // in `FileUploadService`.
                        "-threads",
                        "2",
                        // We're only running this to get the `time` output after FFmpeg has
                        // decoded our file.
                        "-f",
                        "null",
                        "pipe:1",
                    ],
                    {
                        cwd: runfilesPath,
                        env: getProcessEnvToPropagate(),
                        stdio: ["pipe", "pipe", "pipe"],
                        signal,
                    },
                );

                replayStream.ready();
                replayStream.pipe(subprocess.stdin);

                let stdout = "";
                let stderr = "";

                subprocess.stdout.on("data", (chunk: Buffer) => {
                    const string = chunk.toString("utf8");
                    stdout += string;
                });

                subprocess.stderr.on("data", (chunk: Buffer) => {
                    const string = chunk.toString("utf8");
                    stderr += string;
                });

                return span.withSpan("FFmpeg decode preview video duration", async span => {
                    span.addData({
                        file: {contentType, contentLength, processorType},
                    });

                    await waitForProcessExit(subprocess).catch(error => {
                        // If our process was aborted then rethrow the abort error instead of a new
                        // `UnknownError`.
                        if (signal.aborted) throw signal.reason;

                        // We include the stderr in error messages even in production since it shouldn't
                        // contain sensitive user data. Even if it does contain sensitive user data it
                        // should be so opaque as to not be useful for reconstructing the video file.
                        //
                        // However, including the stderr will really help us debug any issues.
                        throw new UnknownError(
                            `${
                                error instanceof Error ? error.message : String(error)
                            }\n\nstdout:\n${stdout.trim()}\n\nstderr:\n${stderr.trim()}`,
                            {
                                cause: error instanceof Error ? error.cause : undefined,
                            },
                        );
                    });

                    span.addData({
                        ffmpeg: {
                            codecs: parseFfmpegStderrInputCodecNames(stderr),
                        },
                    });

                    const match = stderr.trimEnd().match(/time=(\d\d:\d\d:\d\d(?:\.\d+)?).*$/);
                    if (!match) {
                        throw new InternalError(
                            `Couldn't parse video duration from FFmpeg stderr\n\nstdout:\n${stdout.trim()}\n\nstderr:\n${stderr.trim()}`,
                        );
                    }

                    return parseFfmpegStderrDuration(match[1]!);
                });
            })();

            return {
                imagePreviewSizePromise: previewSizePromiseResolver.promise,
                imagePreviewPlaceholderPromise: (async () => {
                    const {data} = await previewContentPromise;
                    return processFileImagePreviewPlaceholder(data);
                })(),
                imagePreviewContentPromise: previewContentPromise,
                imagePreviewVideoDurationPromise: previewVideoDurationPromise,
            };
        },
    };
}
