import {spawn} from "child_process";
import fs from "fs/promises";
import {join as joinPath} from "path";
import {PassThrough as PassThroughStream} from "stream";
import {processFilePreviewPlaceholder} from "~/server/files/upload/processors/file_image_processor_base.js";
import {FileProcessor} from "~/server/files/upload/processors/file_processor.js";
import {
    ffmpegExecutablePath,
    ffmpegPreviewImageOutputContentType,
    ffmpegPreviewImageOutputExtension,
    ffmpegPreviewImageOutputOptions,
    parseFfmpegStderrDuration,
    parseFilePreviewSizeAndVideoDurationIfPossibleFromFfmpegStderr,
} from "~/server/files/upload/processors/file_video_processor_base.js";
import {getProcessEnvToPropagate} from "~/server/helpers/node/run_process.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {waitForProcessExit} from "~/server/helpers/node/wait_for_process_exit.js";
import {withTemporaryDirectory} from "~/server/helpers/node/with_temporary_directory.js";
import {InternalError, UnknownError} from "~/shared/error/error.js";
import {FileContentType, FileWebmVideoContentType} from "~/shared/files/file_content_type.js";
import {FilePreviewSize} from "~/shared/files/file_preview.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {isObject} from "~/shared/helpers/object/is_object.js";

/**
 * WebM files are [completely supported by all web browsers][1]. All video
 * codecs and audio codecs used by WebM are supported cross browsers. So to
 * process a WebM file we only need to take a screenshot. We don't need to
 * transcode the file to a different format.
 *
 * [1]: https://caniuse.com/webm
 */
export function createFileWebmVideoProcessor(contentType: FileWebmVideoContentType): FileProcessor {
    const processorType = "WebmVideo";

    return {
        type: processorType,
        hasAlternative: false,
        hasPreview: true,
        hasPreviewImage: true,
        hasPreviewVideoDuration: true,
        process: (
            stream,
            signal,
            {span, fileId, contentLength, temporaryDirectoryPath: parentTemporaryDirectoryPath},
        ) => {
            const previewSizePromiseResolver = createPromiseResolver<
                FilePreviewSize & {videoDuration?: number}
            >();

            const previewImagePromise = (() => {
                // Pause our stream while we wait to create the temporary directory. We use
                // `.pipe(new PassThroughStream())` to create a new stream with a new internal
                // buffer instead of pausing the stream we were provided (which is being used
                // to upload the file to Cloudflare R2).
                const pausedStream = new PassThroughStream();
                pausedStream.pause();
                stream.pipe(pausedStream);

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
                            `output.${ffmpegPreviewImageOutputExtension}`,
                        );

                        const subprocess = spawn(
                            ffmpegExecutablePath,
                            [
                                // Input is coming from stdin.
                                // https://ffmpeg.org/ffmpeg-protocols.html#pipe
                                "-i",
                                "pipe:0",
                                // Capture a thumbnail from the first second of the video.
                                ...ffmpegPreviewImageOutputOptions,
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

                        pausedStream.pipe(subprocess.stdin);
                        pausedStream.resume();

                        let stdout = "";
                        let stderr = "";

                        // This function checks to see if the input's duration and width/height have
                        // been written to stderr and if it has then we can resolve
                        // `previewImagePromise`. This will push an update to the user waiting on their
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

                        await span.withSpan("FFmpeg generate preview image", span => {
                            span.addData({
                                file: {contentType, contentLength, processorType},
                            });

                            return waitForProcessExit(subprocess, {
                                onStdinError: error => {
                                    // `EPIPE` errors are expected. FFmpeg will close its side of stdin once it has
                                    // taken the screenshot. We can destroy `pausedStream` once we get an `EPIPE`
                                    // error as we don't need data from our input anymore.
                                    if (isObject(error) && error.code === "EPIPE") {
                                        stream.unpipe(pausedStream);
                                        pausedStream.destroy();

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
                        });

                        attemptResolvePreviewSize();

                        if (!previewSizePromiseResolver.isSettled()) {
                            throw new InternalError(
                                `Couldn't find video duration and width/height from FFmpeg stderr\n\nstdout:\n${stdout.trim()}\n\nstderr:\n${stderr.trim()}`,
                            );
                        }

                        return {
                            contentType: ffmpegPreviewImageOutputContentType,
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
                // Pause our stream while we wait to create the temporary directory. We use
                // `.pipe(new PassThroughStream())` to create a new stream with a new internal
                // buffer instead of pausing the stream we were provided (which is being used
                // to upload the file to Cloudflare R2).
                const pausedStream = new PassThroughStream();
                pausedStream.pause();
                stream.pipe(pausedStream);

                try {
                    const previewSize = await previewSizePromiseResolver.promise;

                    // If we were able to parse `videoDuration` with the preview size then hooray!
                    // That means the video had easily accessible duration metadata. Destroy
                    // `pausedProbeStream` since we don't need it and return the video duration
                    // immediately.
                    if (previewSize.videoDuration !== undefined) {
                        stream.unpipe(pausedStream);
                        pausedStream.destroy();

                        return previewSize.videoDuration;
                    }
                } catch (error) {
                    // If there was an error parsing the preview size, destroy our probe stream. We
                    // won't be using it.
                    stream.unpipe(pausedStream);
                    pausedStream.destroy();

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
                    ["-i", "pipe:0", "-f", "null", "pipe:1"],
                    {
                        cwd: runfilesPath,
                        env: getProcessEnvToPropagate(),
                        stdio: ["pipe", "pipe", "pipe"],
                        signal,
                    },
                );

                pausedStream.pipe(subprocess.stdin);
                pausedStream.resume();

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
                previewSizePromise: previewSizePromiseResolver.promise,
                previewPlaceholderPromise: (async () => {
                    const {data} = await previewImagePromise;
                    return processFilePreviewPlaceholder(data);
                })(),
                previewImagePromise,
                previewVideoDurationPromise,
            };
        },
    };
}
