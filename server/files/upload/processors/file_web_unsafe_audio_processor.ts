import {spawn} from "child_process";
import {Readable as ReadableStream} from "stream";
import {FileProcessor} from "~/server/files/upload/processors/file_processor.js";
import {
    ffmpegExecutablePath,
    parseFfmpegStderrDuration,
    parseFfmpegStderrInputCodecNames,
    parseFileAudioPreviewDurationIfPossibleFromFfmpegStderr,
} from "~/server/files/upload/processors/file_video_and_audio_processor_base.js";
import {getProcessEnvToPropagate} from "~/server/helpers/node/run_process.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {waitForProcessExit} from "~/server/helpers/node/wait_for_process_exit.js";
import {InternalError, UnknownError} from "~/shared/error/error.js";
import {
    FileContentType,
    FileMp4AudioContentType,
    FileWebUnsafeAudioContentType,
} from "~/shared/files/file_content_type.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";

/**
 * To process an unsafe audio file we transcode the audio file to a format with
 * broad browser support. While processing we determine the audio duration.
 */
export function createFileWebUnsafeAudioProcessor(
    contentType: FileWebUnsafeAudioContentType | FileMp4AudioContentType,
): FileProcessor {
    const processorType = "WebUnsafeAudio";

    return {
        type: processorType,
        hasAlternative: true,
        hasPreview: {type: "Audio"},
        process: (stream, signal, {span, contentLength}) => {
            const alternativePromiseResolver = createPromiseResolver<{
                contentType: FileContentType;
                data: ReadableStream;
            }>();
            const previewDurationPromiseResolver = createPromiseResolver<number>();

            const extraPromise = (async () => {
                const subprocess = spawn(
                    ffmpegExecutablePath,
                    [
                        // Input is coming from stdin.
                        // https://ffmpeg.org/ffmpeg-protocols.html#pipe
                        "-i",
                        "pipe:0",
                        // Only use up to 2 threads for FFmpeg to avoid resource contention
                        // in `FileUploadService`.
                        "-threads",
                        "2",
                        // Convert the audio file to WebM using the Opus audio codec. This is what [MDN
                        // recommends for a good everyday video codec][1] We use this same
                        // recommendation for audio for consistency.
                        //
                        // [1]: https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Video_codecs#choosing_a_video_codec
                        "-f",
                        "webm",
                        "-acodec",
                        "libopus",
                        // Output the new audio to stdout.
                        "pipe:1",
                    ],
                    {
                        cwd: runfilesPath,
                        env: getProcessEnvToPropagate(),
                        stdio: ["pipe", "pipe", "pipe"],
                        signal,
                    },
                );

                stream.pipe(subprocess.stdin);

                let stderr = "";

                // This function checks to see if the input's duration and width/height have
                // been written to stderr and if it has then we can resolve
                // `previewContentPromise`. This will push an update to the user waiting on their
                // file to upload so they can see a preview of the file in the product.
                const attemptResolvePreviewDuration = () => {
                    if (previewDurationPromiseResolver.isSettled()) return;

                    try {
                        const previewDuration =
                            parseFileAudioPreviewDurationIfPossibleFromFfmpegStderr(stderr);
                        if (previewDuration === null) return;

                        previewDurationPromiseResolver.resolve(previewDuration);
                    } catch (error) {
                        previewDurationPromiseResolver.reject(error);
                    }
                };

                subprocess.stderr.on("data", (chunk: Buffer) => {
                    const string = chunk.toString("utf8");
                    stderr += string;

                    attemptResolvePreviewDuration();
                });

                // `subprocess.stdout` will stream the transcoded alternative file.
                alternativePromiseResolver.resolve({
                    contentType: "audio/webm",
                    data: subprocess.stdout,
                });

                await span.withSpan("FFmpeg transcode audio alternative", async span => {
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
                            }\n\nstderr:\n${stderr.trim()}`,
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

                // If the audio duration wasn't present in the audio's metadata then we wait
                // until FFmpeg finishes and parse the duration from `time` printed at the end
                // of FFmpeg's stderr.
                if (!previewDurationPromiseResolver.isSettled()) {
                    const match = stderr.trimEnd().match(/time=(\d\d:\d\d:\d\d(?:\.\d+)?).*$/);
                    if (!match) {
                        throw new InternalError(
                            `Couldn't parse video duration from FFmpeg stderr\n\nstderr:\n${stderr.trim()}`,
                        );
                    }

                    previewDurationPromiseResolver.resolve(parseFfmpegStderrDuration(match[1]!));
                }
            })().catch(error => {
                alternativePromiseResolver.reject(error);
                previewDurationPromiseResolver.reject(error);
                throw error;
            });

            return {
                extraPromise,
                alternativePromise: alternativePromiseResolver.promise,
                audioPreviewDurationPromise: previewDurationPromiseResolver.promise,
            };
        },
    };
}
