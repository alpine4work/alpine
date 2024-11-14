import {spawn} from "child_process";
import {ReplayStream} from "~/server/files/upload/helpers/replay_stream.js";
import {FileProcessor} from "~/server/files/upload/processors/file_processor.js";
import {
    ffmpegExecutablePath,
    ffprobeExecutablePath,
    getFileAudioPreviewMetadataFromFfprobeMetadata,
    parseFfmpegStderrDuration,
    parseFfmpegStderrInputCodecNames,
} from "~/server/files/upload/processors/file_video_and_audio_processor_base.js";
import {getProcessEnvToPropagate, runProcess} from "~/server/helpers/node/run_process.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {waitForProcessExit} from "~/server/helpers/node/wait_for_process_exit.js";
import {InternalError, UnknownError} from "~/shared/error/error.js";
import {
    FileMp4AudioContentType,
    FileWebSafeAudioContentType,
} from "~/shared/files/file_content_type.js";
import {FileAudioPreviewMetadata} from "~/shared/files/file_preview.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {isObject} from "~/shared/helpers/object/is_object.js";
import {quote} from "~/shared/helpers/string/quote.js";

/**
 * To process a safe audio file we only need the file's duration. We'll serve
 * the file to the user as-is.
 */
export function createFileWebSafeAudioProcessor(
    contentType: FileWebSafeAudioContentType | FileMp4AudioContentType,
): FileProcessor {
    const processorType = "WebSafeAudio";

    return {
        type: processorType,
        hasAlternative: false,
        hasPreview: {type: "Audio"},
        process: (stream, signal, {span, contentLength}) => {
            const audioPreviewMetadataPromiseResolver =
                createPromiseResolver<FileAudioPreviewMetadata>();

            const audioPreviewDurationPromise = (async (): Promise<number> => {
                const replayStream = stream.pipe(new ReplayStream());

                try {
                    // Even though technically we're using the FFprobe executable we still name the
                    // span "FFmpeg ..." which'll make it easier for us to search for spans that
                    // call one of the FFmpeg tools.
                    const metadataString = await span.withSpan(
                        "FFmpeg get metadata",
                        async span => {
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
                        },
                    );

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

                    audioPreviewMetadataPromiseResolver.resolve(
                        getFileAudioPreviewMetadataFromFfprobeMetadata(metadata),
                    );

                    const durationString =
                        // NOTE(calebmer, 2024-11-01): Our test fixture file
                        // `pokemon_regirock_un_un_un_meme.wav` sometimes outputs the wrong duration to
                        // FFprobe and sometimes outputs no duration. I can't find anything online that
                        // explains this so for now it seems like we can't trust FFprobe's duration for
                        // WAV files. Set `durationString` to null so we'll always parse the full WAV
                        // file.
                        contentType !== "audio/wav" &&
                        isObject(metadata) &&
                        isObject(metadata.format) &&
                        (typeof metadata.format.duration === "string" ||
                            typeof metadata.format.duration === "number")
                            ? metadata.format.duration
                            : null;

                    // If the file has duration metadata we can return return that without decoding
                    // the full file. Otherwise, we need to decode the full file...
                    if (durationString !== null && durationString !== "N/A") {
                        replayStream.destroy();

                        const durationSeconds =
                            typeof durationString === "string"
                                ? parseFloat(durationString)
                                : durationString;

                        assert(!isNaN(durationSeconds));
                        assert(Number.isFinite(durationSeconds));

                        return Math.ceil(durationSeconds * 1000);
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

                return span.withSpan("FFmpeg decode audio preview duration", async span => {
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
                            `Couldn't parse audio duration from FFmpeg stderr\n\nstdout:\n${stdout.trim()}\n\nstderr:\n${stderr.trim()}`,
                        );
                    }

                    return parseFfmpegStderrDuration(match[1]!);
                });
            })().then(
                duration => {
                    // All of these promise resolvers MUST have either been resolved or rejected by
                    // the end of this promise. So any promise resolvers that haven't been settled
                    // yet reject with an error as a safety mechanism.
                    if (!audioPreviewMetadataPromiseResolver.isSettled()) {
                        audioPreviewMetadataPromiseResolver.reject(
                            new InternalError("Promise resolver wasn't resolved"),
                        );
                    }

                    return duration;
                },
                error => {
                    audioPreviewMetadataPromiseResolver.reject(error);
                    throw error;
                },
            );

            return {
                audioPreviewDurationPromise,
                audioPreviewMetadataPromise: audioPreviewMetadataPromiseResolver.promise,
            };
        },
    };
}
