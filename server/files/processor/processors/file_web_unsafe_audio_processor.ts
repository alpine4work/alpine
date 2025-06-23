import {spawn} from "child_process";
import {addMinutes} from "date-fns";
import fsSync from "fs";
import fs from "fs/promises";
import {join as joinPath} from "path";
import {Readable as ReadableStream} from "stream";
import {FileProcessorServiceActionContext} from "~/server/files/processor/file_processor_service_context.js";
import {FileProcessor} from "~/server/files/processor/processors/file_processor.js";
import {
    ffmpegExecutablePath,
    ffmpegThreadCount,
    ffprobeExecutablePath,
    getFileAudioPreviewMetadataFromFfprobeMetadata,
    parseFfmpegStderrDuration,
    parseFfmpegStderrInputCodecNames,
    parseFileAudioPreviewDurationIfPossibleFromFfmpegStderr,
} from "~/server/files/processor/processors/file_video_and_audio_processor_base.js";
import {filesBucketName} from "~/server/helpers/files_cloudflare_r2_bucket_name.js";
import {getProcessEnvToPropagate, runProcess} from "~/server/helpers/node/run_process.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {waitForProcessExit} from "~/server/helpers/node/wait_for_process_exit.js";
import {getFileContentTypeName} from "~/shared/content/code/get_file_content_type_name.js";
import {InternalError, UnknownError} from "~/shared/error/error.js";
import {
    FileContentType,
    FileMp4AudioContentType,
    FileWebUnsafeAudioContentType,
    getFileContentTypePreferredExtension,
} from "~/shared/files/file_content_type.js";
import {FileAudioPreviewMetadata} from "~/shared/files/file_preview.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {quote} from "~/shared/helpers/string/quote.js";

/**
 * To process an unsafe audio file we transcode the audio file to a format with
 * broad browser support. While processing we determine the audio duration.
 */
export function createFileWebUnsafeAudioProcessor(
    contentType: FileWebUnsafeAudioContentType,
): FileProcessor {
    return {
        type: "WebUnsafeAudio",
        hasAlternative: true,
        hasPreview: {type: "Audio"},
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

            return processFileWebUnsafeAudio(context, inputUrl, {
                signal,
                contentType,
                contentLength,
                temporaryDirectoryPath,
            });
        },
    };
}

export function processFileWebUnsafeAudio(
    context: FileProcessorServiceActionContext,
    inputUrl: string,
    {
        signal,
        contentType,
        contentLength,
        temporaryDirectoryPath,
    }: {
        signal: AbortSignal;
        contentType: FileWebUnsafeAudioContentType | FileMp4AudioContentType;
        contentLength: number;
        temporaryDirectoryPath: string;
    },
) {
    const previewDurationPromiseResolver = createPromiseResolver<number>();

    const alternativePromise = (async (): Promise<{
        contentType: FileContentType;
        contentLength: number;
        data: ReadableStream;
    }> => {
        const outputPath = joinPath(
            temporaryDirectoryPath,
            `output.${getFileContentTypePreferredExtension("audio/webm")}`,
        );

        const subprocess = spawn(
            ffmpegExecutablePath,
            [
                // Input comes from a signed HTTP URL. FFmpeg is smart about streaming only the
                // data it needs with HTTP `Range` requests.
                "-i",
                inputUrl,
                // Limit the number of threads for FFmpeg to reduce resource contention
                // in `FileProcessorService`.
                "-threads",
                String(ffmpegThreadCount),
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
                stdio: ["ignore", "pipe", "pipe"],
                signal,
            },
        );

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

        await context.tracer.withSpan(
            `FFmpeg transcode ${getFileContentTypeName(contentType)} to ${getFileContentTypeName(
                "audio/webm",
            )}`,
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
            },
        );

        // If the audio duration wasn't present in the audio's metadata then we wait
        // until FFmpeg finishes and parse the duration from `time` printed at the end
        // of FFmpeg's stderr.
        if (!previewDurationPromiseResolver.isSettled()) {
            const match = stderr.trimEnd().match(/time=(\d\d:\d\d:\d\d(?:\.\d+)?).*$/);
            if (!match) {
                throw new InternalError(
                    `Couldn’t parse video duration from FFmpeg stderr\n\nstderr:\n${stderr.trim()}`,
                );
            }

            previewDurationPromiseResolver.resolve(parseFfmpegStderrDuration(match[1]!));
        }

        // Read the transcoded alternative file from the file system.
        return {
            contentType: "audio/webm",
            contentLength: (await fs.stat(outputPath)).size,
            data: fsSync.createReadStream(outputPath),
        };
    })().catch(error => {
        previewDurationPromiseResolver.reject(error);
        throw error;
    });

    const audioPreviewMetadataPromise: Promise<FileAudioPreviewMetadata> = (async () => {
        // Even though technically we're using the FFprobe executable we still name the
        // span "FFmpeg ..." which'll make it easier for us to search for spans that
        // call one of the FFmpeg tools.
        const metadataString = await context.tracer.withSpan(
            `FFmpeg get ${getFileContentTypeName(contentType)} metadata`,
            async (context, span) => {
                span.addData({
                    file: {contentType, contentLength},
                });

                return runProcess(
                    ffprobeExecutablePath,
                    [["-print_format", "json"], "-show_streams", "-show_format", inputUrl],
                    {cwd: runfilesPath, signal},
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

        return getFileAudioPreviewMetadataFromFfprobeMetadata(metadata);
    })();

    return {
        alternativePromise,
        audioPreviewDurationPromise: previewDurationPromiseResolver.promise,
        audioPreviewMetadataPromise,
    };
}
