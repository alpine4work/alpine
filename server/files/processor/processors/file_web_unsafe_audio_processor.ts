import {spawn} from "child_process";
import fsSync from "fs";
import fs from "fs/promises";
import {join as joinPath} from "path";
import {Readable as ReadableStream} from "stream";
import {ReplayStream} from "~/server/files/upload/helpers/replay_stream.js";
import {FileProcessor} from "~/server/files/upload/processors/file_processor.js";
import {
    ffmpegExecutablePath,
    ffprobeExecutablePath,
    getFileAudioPreviewMetadataFromFfprobeMetadata,
    parseFfmpegStderrDuration,
    parseFfmpegStderrInputCodecNames,
    parseFileAudioPreviewDurationIfPossibleFromFfmpegStderr,
} from "~/server/files/upload/processors/file_video_and_audio_processor_base.js";
import {getProcessEnvToPropagate, runProcess} from "~/server/helpers/node/run_process.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {waitForProcessExit} from "~/server/helpers/node/wait_for_process_exit.js";
import {withTemporaryDirectory} from "~/server/helpers/node/with_temporary_directory.js";
import {InternalError, UnknownError} from "~/shared/error/error.js";
import {
    FileContentType,
    FileMp4AudioContentType,
    FileWebUnsafeAudioContentType,
    getFileContentTypePreferredExtension,
} from "~/shared/files/file_content_type.js";
import {FileAudioPreviewMetadata} from "~/shared/files/file_preview.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {isObject} from "~/shared/helpers/object/is_object.js";
import {quote} from "~/shared/helpers/string/quote.js";

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
            const previewDurationPromiseResolver = createPromiseResolver<number>();

            const extraPromise = (async () => {
                // Create a replay stream which will replay any chunks written while we create
                // our temporary directory. This won't block the Cloudflare R2 upload which is
                // also consuming the stream in parallel.
                const replayStream = stream.pipe(new ReplayStream());

                return withTemporaryDirectory(
                    parentTemporaryDirectoryPath,
                    `${fileId}_`,
                    async temporaryDirectoryPath => {
                        const outputPath = joinPath(
                            temporaryDirectoryPath,
                            `output.${getFileContentTypePreferredExtension("audio/webm")}`,
                        );

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

                        replayStream.ready();
                        replayStream.pipe(subprocess.stdin);

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

                        await span.withSpan("FFmpeg transcode audio alternative", async span => {
                            span.addData({
                                file: {contentType, contentLength, processorType},
                            });

                            await waitForProcessExit(subprocess).catch(error => {
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
                            const match = stderr
                                .trimEnd()
                                .match(/time=(\d\d:\d\d:\d\d(?:\.\d+)?).*$/);
                            if (!match) {
                                throw new InternalError(
                                    `Couldn't parse video duration from FFmpeg stderr\n\nstderr:\n${stderr.trim()}`,
                                );
                            }

                            previewDurationPromiseResolver.resolve(
                                parseFfmpegStderrDuration(match[1]!),
                            );
                        }

                        // Read the transcoded alternative file from the file system.
                        alternativePromiseResolver.resolve({
                            contentType: "audio/webm",
                            contentLength: (await fs.stat(outputPath)).size,
                            data: fsSync.createReadStream(outputPath),
                        });
                    },
                );
            })().catch(error => {
                alternativePromiseResolver.reject(error);
                previewDurationPromiseResolver.reject(error);
                throw error;
            });

            const audioPreviewMetadataPromise: Promise<FileAudioPreviewMetadata> = (async () => {
                // Even though technically we're using the FFprobe executable we still name the
                // span "FFmpeg ..." which'll make it easier for us to search for spans that
                // call one of the FFmpeg tools.
                const metadataString = await span.withSpan("FFmpeg get metadata", async span => {
                    span.addData({
                        file: {contentType, contentLength},
                    });

                    return runProcess(
                        ffprobeExecutablePath,
                        [["-print_format", "json"], "-show_streams", "-show_format", "-"],
                        {
                            cwd: runfilesPath,
                            stdin: stream,
                            onStdinError: error => {
                                // `EPIPE` errors are expected. FFmpeg will close its side of stdin once it has
                                // found the video's metadata. We can unpipe `pausedStream` once we get an `EPIPE`
                                // error as we don't need data from our input anymore.
                                if (isObject(error) && error.code === "EPIPE") {
                                    return {preventDefault: true};
                                }
                            },
                        },
                    );
                });

                let metadata: unknown;
                try {
                    metadata = JSON.parse(metadataString);
                } catch (error) {
                    if (!(error instanceof Error)) throw error;

                    // We're observing some flaky errors in unit tests where `metadataString` fails
                    // to parse as JSON. So if we're running a unit test log the string to help us
                    // debug.
                    throw new InternalError(
                        !import.meta.jest
                            ? error.message
                            : `${error.message}\n\nString: ${quote(metadataString)}`,
                    );
                }

                return getFileAudioPreviewMetadataFromFfprobeMetadata(metadata);
            })();

            return {
                extraPromise,
                alternativePromise: alternativePromiseResolver.promise,
                audioPreviewDurationPromise: previewDurationPromiseResolver.promise,
                audioPreviewMetadataPromise,
            };
        },
    };
}
