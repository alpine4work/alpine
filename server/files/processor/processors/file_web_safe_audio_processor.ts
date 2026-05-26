import {spawn} from "child_process";
import {addMinutes} from "date-fns";
import {FileProcessorActionContext} from "~/server/files/data/file_processor_context.js";
import {FileProcessor} from "~/server/files/processor/processors/file_processor.js";
import {
    ffmpegExecutablePath,
    ffmpegThreadCount,
    getFfprobeMetadata,
    getFileAudioPreviewMetadataFromFfprobeMetadata,
    parseFfmpegStderrDuration,
    parseFfmpegStderrInputCodecNames,
} from "~/server/files/processor/processors/file_video_and_audio_processor_base.js";
import {filesBucketName} from "~/server/helpers/files_cloudflare_r2_bucket_name.js";
import {getProcessEnvToPropagate} from "~/server/helpers/node/run_process.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {waitForProcessExit} from "~/server/helpers/node/wait_for_process_exit.js";
import {getFileContentTypeName} from "~/shared/content/code/get_file_content_type_name.js";
import {InternalError, UnknownError} from "~/shared/error/error.js";
import {
    FileMp4AudioContentType,
    FileWebSafeAudioContentType,
} from "~/shared/files/file_content_type.js";
import {FileAudioPreviewMetadata} from "~/shared/files/file_preview.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {isObject} from "~/shared/helpers/object/is_object.js";

/**
 * To process a safe audio file we only need the file's duration. We'll serve the
 * file to the user as-is.
 */
export function createFileWebSafeAudioProcessor(
    contentType: FileWebSafeAudioContentType,
): FileProcessor {
    return {
        type: "WebSafeAudio",
        hasAlternative: false,
        hasPreview: {type: "Audio"},
        process: async (context, {spaceId, fileId, signal, contentLength}) => {
            const inputUrl = await context.r2.getGetObjectSignedUrl(addMinutes(new Date(), 60), {
                Bucket: filesBucketName,
                Key: `${spaceId}/${fileId}`,
            });

            return processFileWebSafeAudio(context, inputUrl, {signal, contentType, contentLength});
        },
    };
}

export function processFileWebSafeAudio(
    context: FileProcessorActionContext,
    inputUrl: string,
    {
        signal,
        contentType,
        contentLength,
    }: {
        signal: AbortSignal;
        contentType: FileWebSafeAudioContentType | FileMp4AudioContentType;
        contentLength: number;
    },
) {
    const audioPreviewMetadataPromiseResolver = createPromiseResolver<FileAudioPreviewMetadata>();

    const audioPreviewDurationPromise = (async (): Promise<number> => {
        const metadata = await getFfprobeMetadata(context, inputUrl, {
            signal,
            contentType,
            contentLength,
        });

        audioPreviewMetadataPromiseResolver.resolve(
            getFileAudioPreviewMetadataFromFfprobeMetadata(metadata),
        );

        const durationString =
            // NOTE(calebmer, 2024-11-01): Our test fixture file
            // `pokemon_regirock_un_un_un_meme.wav` sometimes outputs the wrong duration to
            // FFprobe and sometimes outputs no duration. I can't find anything online that
            // explains this so for now it seems like we can't trust FFprobe's duration for WAV
            // files. Set `durationString` to null so we'll always parse the full WAV file.
            contentType !== "audio/wav" &&
            isObject(metadata) &&
            isObject(metadata.format) &&
            (typeof metadata.format.duration === "string" ||
                typeof metadata.format.duration === "number")
                ? metadata.format.duration
                : null;

        // If the file has duration metadata we can return return that without decoding the
        // full file. Otherwise, we need to decode the full file...
        if (durationString !== null && durationString !== "N/A") {
            const durationSeconds =
                typeof durationString === "string" ? parseFloat(durationString) : durationString;

            assert(!isNaN(durationSeconds));
            assert(Number.isFinite(durationSeconds));

            return Math.ceil(durationSeconds * 1000);
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
                // Input comes from a signed HTTP URL. FFmpeg is smart about streaming only the
                // data it needs with HTTP `Range` requests.
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

        return await context.tracer.withSpan(
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
                        `Couldn\u2019t parse audio duration from FFmpeg stderr\n\nstdout:\n${stdout.trim()}\n\nstderr:\n${stderr.trim()}`,
                    );
                }

                return parseFfmpegStderrDuration(match[1]!);
            },
        );
    })().then(
        duration => {
            // All of these promise resolvers MUST have either been resolved or rejected by the
            // end of this promise. So any promise resolvers that haven't been settled yet
            // reject with an error as a safety mechanism.
            if (!audioPreviewMetadataPromiseResolver.isSettled()) {
                audioPreviewMetadataPromiseResolver.reject(
                    new InternalError("Promise resolver wasn\u2019t resolved"),
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
}
