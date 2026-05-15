import {spawn} from "child_process";
import {addMinutes} from "date-fns";
import fsSync from "fs";
import fs from "fs/promises";
import {join as joinPath} from "path";
import {FileProcessorActionContext} from "~/server/files/data/file_processor_context.js";
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
    FileMp4VideoContentType,
    FileWebSafeVideoContentType,
} from "~/shared/files/file_content_type.js";
import {FileImagePreviewPlaceholder} from "~/shared/files/file_image_preview_placeholder.js";
import {FileImagePreviewSize} from "~/shared/files/file_preview.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {cast} from "~/shared/helpers/control/cast.js";

/**
 * WebM files are [completely supported by all web browsers][1]. All video codecs
 * and audio codecs used by WebM are supported cross browsers. So to process a WebM
 * file we only need to take a screenshot. We don't need to transcode the file to a
 * different format.
 *
 * We consider some MP4 videos to be web safe as well. Depending on what codecs the
 * MP4 video uses.
 *
 * [1]: https://caniuse.com/webm
 */
export function createFileWebSafeVideoProcessor(
    contentType: FileWebSafeVideoContentType,
): FileProcessor {
    return {
        type: "WebSafeVideo",
        hasAlternative: false,
        hasPreview: {
            type: "Image",
            hasContent: true,
            hasVideoDuration: true,
        },
        process: async (
            context,
            {spaceId, fileId, signal, contentLength, withTemporaryDirectory},
        ) => {
            const [temporaryDirectoryPath, inputUrl] = await runAllPromises([
                withTemporaryDirectory(),
                context.r2.getGetObjectSignedUrl(addMinutes(new Date(), 60), {
                    Bucket: filesBucketName,
                    Key: `${spaceId}/${fileId}`,
                }),
            ]);

            return processFileWebSafeVideo(context, inputUrl, {
                signal,
                contentType,
                contentLength,
                temporaryDirectoryPath,
            });
        },
    };
}

export async function processFileWebSafeVideo(
    context: FileProcessorActionContext,
    inputUrl: string,
    {
        signal,
        contentType,
        contentLength,
        temporaryDirectoryPath,
    }: {
        signal: AbortSignal;
        contentType: FileWebSafeVideoContentType | FileMp4VideoContentType;
        contentLength: number;
        temporaryDirectoryPath: string;
    },
) {
    const previewSizePromiseResolver = createPromiseResolver<
        FileImagePreviewSize & {videoDuration?: number}
    >();

    const previewPlaceholderPromiseResolver = createPromiseResolver<FileImagePreviewPlaceholder>();

    const previewContentPromise = (async () => {
        const output1Path = joinPath(
            temporaryDirectoryPath,
            `output1.${ffmpegImagePreviewContentOutputExtension}`,
        );

        const output2Path = joinPath(
            temporaryDirectoryPath,
            `output2.${ffmpegImagePreviewContentOutputExtension}`,
        );

        const output3Path = joinPath(
            temporaryDirectoryPath,
            `output3.${ffmpegImagePreviewContentOutputExtension}`,
        );

        const subprocess = spawn(
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
                    output1Path,
                    output2Path,
                    output3Path,
                }),
            ],
            {
                cwd: runfilesPath,
                env: getProcessEnvToPropagate(),
                stdio: ["ignore", "pipe", "pipe"],
                signal,
            },
        );

        let stdout = "";
        let stderr = "";

        // This function checks to see if the input's duration and width/height have been
        // written to stderr and if it has then we can resolve `previewContentPromise`.
        // This will push an update to the user waiting on their file to upload so they can
        // see a preview of the file in the product.
        const attemptResolvePreviewSize = () => {
            if (previewSizePromiseResolver.isSettled()) return;

            try {
                const previewSize =
                    parseFileImagePreviewSizeAndVideoDurationIfPossibleFromFfmpegStderr(
                        stderr,
                        // HACK: Which content types may have an alpha channel? It's ok to return true if
                        // the video doesn't actually have any transparent pixels but it's not ok to return
                        // false if the video does have transparent pixels.
                        //
                        // TODO: We should parse the pixel format out of stderr and check if the pixel
                        // format has an alpha channel.
                        cast<{
                            [Key in FileWebSafeVideoContentType | FileMp4VideoContentType]: boolean;
                        }>({
                            "video/webm": true,
                            "video/mp4": false,
                        })[contentType],
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

        await context.tracer.withSpan(
            `FFmpeg generate ${getFileContentTypeName(
                contentType,
            )} preview ${getFileContentTypeName(ffmpegImagePreviewContentOutputContentType)}`,
            async (context, span) => {
                span.addData({
                    file: {contentType, contentLength},
                });

                await waitForProcessExit(subprocess).catch(error => {
                    // We include the stderr in error messages even in production since it shouldn't
                    // contain sensitive user data. It may contain the file's duration and other
                    // metadata but it shouldn't be harmful for a developer to read that.
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
            },
        );

        attemptResolvePreviewSize();

        if (!previewSizePromiseResolver.isSettled()) {
            throw new InternalError(
                `Couldn\u2019t find video duration and width/height from FFmpeg stderr\n\nstdout:\n${stdout.trim()}\n\nstderr:\n${stderr.trim()}`,
            );
        }

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
                stderr,
            )
        ) {
            outputPath = output3Path;
        } else if (
            /(?:^|\n)\[out#0\/[^\]]*\] Output file is empty, nothing was encoded\(check -ss \/ -t \/ -frames parameters if used\)(?:\n|$)/.test(
                stderr,
            )
        ) {
            outputPath = output2Path;
        } else {
            outputPath = output1Path;
        }

        const outputContentLength = (await fs.stat(outputPath)).size;

        previewPlaceholderPromiseResolver.resolve(
            processFileImagePreviewPlaceholder(context, outputPath, {
                contentType: ffmpegImagePreviewContentOutputContentType,
                contentLength: outputContentLength,
            }),
        );

        return {
            contentType: ffmpegImagePreviewContentOutputContentType,
            contentLength: outputContentLength,
            data: fsSync.createReadStream(outputPath),
        };
    })().then(
        previewContent => {
            // All of these promise resolvers MUST have either been resolved or rejected by the
            // end of this promise. So any promise resolvers that haven't been settled yet
            // reject with an error as a safety mechanism.
            if (!previewSizePromiseResolver.isSettled()) {
                previewSizePromiseResolver.reject(
                    new InternalError("Promise resolver wasn\u2019t resolved"),
                );
            }
            if (!previewPlaceholderPromiseResolver.isSettled()) {
                previewPlaceholderPromiseResolver.reject(
                    new InternalError("Promise resolver wasn\u2019t resolved"),
                );
            }
            return previewContent;
        },
        error => {
            previewSizePromiseResolver.reject(error);
            previewPlaceholderPromiseResolver.reject(error);
            throw error;
        },
    );

    // To determine the video's duration we first wait for metadata from our FFmpeg run
    // (from `previewSizePromiseResolver`). If we have duration metadata we can return
    // immediately! If we don't then we use `ffprobe` to parse the video file and
    // figure out the duration.
    const previewVideoDurationPromise = (async () => {
        const previewSize = await previewSizePromiseResolver.promise;

        // If we were able to parse `videoDuration` with the preview size then hooray! That
        // means the video had easily accessible duration metadata. Destroy
        // `pausedProbeStream` since we don't need it and return the video duration
        // immediately.
        if (previewSize.videoDuration !== undefined) {
            return previewSize.videoDuration;
        }

        // Otherwise we need to decode the full stream to figure out the video duration.
        // Command from this [Stack Exchange][1] post using the "With `ffmpeg`" solution.
        // This approach is also recommended by the FFmpeg docs in the FFprobe tips "[Get
        // duration by decoding][2]" section.
        //
        // [1]: https://superuser.com/a/945604/857823
        // [2]: https://trac.ffmpeg.org/wiki/FFprobeTips#Getdurationbydecoding
        const subprocess = spawn(
            ffmpegExecutablePath,
            [
                "-i",
                inputUrl,
                // Limit the number of threads for FFmpeg to reduce resource contention in
                // `FileProcessorService`.
                "-threads",
                String(ffmpegThreadCount),
                // We're only running this to get the `time` output after FFmpeg has decoded our
                // file.
                "-f",
                "null",
                "pipe:1",
            ],
            {
                cwd: runfilesPath,
                env: getProcessEnvToPropagate(),
                stdio: ["ignore", "pipe", "pipe"],
                signal,
            },
        );

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

        return context.tracer.withSpan(
            `FFmpeg decode ${getFileContentTypeName(contentType)} duration`,
            async (context, span) => {
                span.addData({
                    file: {contentType, contentLength},
                });

                await waitForProcessExit(subprocess).catch(error => {
                    // We include the stderr in error messages even in production since it shouldn't
                    // contain sensitive user data. It may contain the file's duration and other
                    // metadata but it shouldn't be harmful for a developer to read that.
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
                        `Couldn\u2019t parse video duration from FFmpeg stderr\n\nstdout:\n${stdout.trim()}\n\nstderr:\n${stderr.trim()}`,
                    );
                }

                return parseFfmpegStderrDuration(match[1]!);
            },
        );
    })();

    return {
        imagePreviewSizePromise: previewSizePromiseResolver.promise,
        imagePreviewPlaceholderPromise: previewPlaceholderPromiseResolver.promise,
        imagePreviewContentPromise: previewContentPromise,
        imagePreviewVideoDurationPromise: previewVideoDurationPromise,
    };
}
