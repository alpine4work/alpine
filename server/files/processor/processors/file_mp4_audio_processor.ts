import {spawn} from "child_process";
import {addMinutes} from "date-fns";
import fsSync from "fs";
import fs from "fs/promises";
import {join as joinPath} from "path";
import {Readable as ReadableStream} from "stream";
import {FileProcessorActionContext} from "~/server/files/data/file_processor_context.js";
import {createFileProcessorAnalysisPromises} from "~/server/files/processor/processors/create_file_processor_analysis_promises.js";
import {FileProcessor} from "~/server/files/processor/processors/file_processor.js";
import {
    ffmpegExecutablePath,
    ffmpegThreadCount,
    ffmpegWebSafeMp4AudioCodecNames,
    ffprobeExecutablePath,
    getFfprobeMetadata,
    getFileAudioPreviewMetadataFromFfprobeMetadata,
    parseFfmpegStderrDuration,
    parseFfmpegStderrInputCodecNames,
    parseFileAudioPreviewDurationIfPossibleFromFfmpegStderr,
} from "~/server/files/processor/processors/file_video_and_audio_processor_base.js";
import {processFileWebSafeAudio} from "~/server/files/processor/processors/file_web_safe_audio_processor.js";
import {processFileWebUnsafeAudio} from "~/server/files/processor/processors/file_web_unsafe_audio_processor.js";
import {filesBucketName} from "~/server/helpers/files_cloudflare_r2_bucket_name.js";
import {getProcessEnvToPropagate, runProcess} from "~/server/helpers/node/run_process.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {waitForProcessExit} from "~/server/helpers/node/wait_for_process_exit.js";
import {getFileContentTypeName} from "~/shared/content/code/get_file_content_type_name.js";
import {InternalError, UnknownError} from "~/shared/error/error.open_source.js";
import {
    FileContentType,
    FileMp4AudioContentType,
    getFileContentTypePreferredExtension,
} from "~/shared/files/file_content_type.open_source.js";
import {FileAudioPreviewMetadata} from "~/shared/files/file_preview.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.open_source.js";

export function createFileMp4AudioProcessor(contentType: FileMp4AudioContentType): FileProcessor {
    return {
        type: "Mp4Audio",
        hasAlternative: true,
        hasAnalysis: true,
        hasPreview: {type: "Audio"},
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

            const {codecNames, relevantAtoms} = await context.tracer.withSpan(
                `FFmpeg get ${getFileContentTypeName(contentType)} codecs`,
                async (context, span) => {
                    span.addData({
                        file: {contentType, contentLength},
                    });

                    let stderr = "";

                    const codecNamesString = await runProcess(
                        ffprobeExecutablePath,
                        [
                            // Trace mp4 format parsing so we can see whether the `moov` atom appears before
                            // the `mdat` atom.
                            ["-v", "trace"],
                            // Extract the stream names.
                            ["-show_entries", "stream=codec_name"],
                            ["-of", "default=noprint_wrappers=1:nokey=1"],
                            inputUrl,
                        ],
                        {
                            cwd: runfilesPath,
                            signal,
                            // `-v trace` emits a lot of "debug" output. Don't include it in the error message.
                            withOutputInErrorMessage: false,
                            // We need the stderr trace output to determine whether the `moov` atom appears
                            // before the `mdat` atom.
                            onStderrData: (string, chunk, fullString) => {
                                stderr = fullString;
                            },
                        },
                    );

                    const codecNames = codecNamesString.trim().split("\n");

                    const relevantAtomMatches = stderr.matchAll(
                        /^\[[^\]]*m4a[^\]]*\] type:'(moov|mdat)'/gm,
                    );
                    const relevantAtoms = [...relevantAtomMatches].map(match => match[1]!);

                    span.addData({
                        ffmpeg: {
                            codecs: codecNames.join("/"),
                            audioMp4: {relevantAtoms: relevantAtoms.join(",")},
                        },
                    });

                    return {codecNames, relevantAtoms};
                },
            );
            const metadataPromises = createFileProcessorAnalysisPromises(context, {
                contentType,
                fileId,
                hasTranscript: true,
                parentTemporaryDirectoryPath,
                signal,
                spaceId,
            });

            let hasWebSafeAudioCodec = false;

            for (const codecName of codecNames) {
                if (ffmpegWebSafeMp4AudioCodecNames.has(codecName)) {
                    hasWebSafeAudioCodec = true;
                }
            }

            // If we have a web safe audio codec then we can use the cheaper web safe processor
            // and skip an expensive transcode.
            if (!hasWebSafeAudioCodec) {
                return {
                    ...processFileWebUnsafeAudio(context, inputUrl, {
                        signal,
                        contentType,
                        contentLength,
                        temporaryDirectoryPath,
                    }),
                    ...metadataPromises,
                };
            } else if (!isDeepEqual(relevantAtoms, ["moov", "mdat"])) {
                // (All block quotes in the following section come from [Apple's QuickTime File
                // Format documentation][1].)
                //
                // For QuickTime (`audio/quicktime`) audio and therefore MP4 (`audio/mp4`) audio
                // (whose format is derived from QuickTime) the file is arranged into atoms. The
                // `moov` atom is the "movie atom" which contains:
                //
                // > Movie resource metadata about the movie (number and type of tracks, location
                // > of sample data, and so on). Describes where the movie data can be found and
                // > how to interpret it.
                //
                // The `mdat` atom is the "movie data atom" which contains:
                //
                // > Movie sample data—media samples such as audio frames and groups of audio
                // > samples. Usually this data can be interpreted only by using the movie
                // > resource.
                //
                // Importantly, in the QuickTime/MP4 format:
                //
                // > Generally speaking, atoms can be present in any order. Do not conclude that a
                // > particular atom is not present until you have parsed all the atoms in the
                // > file.
                //
                // Typically when QuickTime/MP4 audio are encoded the `moov` atom goes after the
                // `mdat` atom. Since you need to encode the movie data before you know its
                // metadata (e.g. movie duration). However, when QuickTime/MP4 audio are played
                // (decoded) they can't be played until the `moov` atom is found. So for
                // QuickTime/MP4 files served from an HTTP server it means the client needs to
                // download the entire audio file before it can start playback! (Since the client
                // needs the `moov` atom.)
                //
                // Now some clients (e.g. Chrome) are smart about this and if they don't find the
                // `moov` atom at the start of the audio file they'll try making a ranged request
                // to the end of the file. Other clients (e.g. Safari) aren't smart and will
                // download the entire audio file before playback.
                //
                // It's a really bad experience for Safari users to have to sit and wait for the
                // entire audio to be downloaded before playback begins. So while technically an
                // MP4 file with web safe codecs and an `mdat` atom before the `moov` atom is
                // playable in all web browsers we consider it "web unsafe" since the user
                // experience is very bad.
                //
                // We could run the `processFileWebUnsafeAudio()` code path but a full WebM
                // transcoding is unnesecary so simply run
                // `ffmpeg -i input.m4a -c copy -movflags +faststart output.m4a` which will copy
                // the file and move the `moov` flag to the start.
                //
                // [1]:
                //     https://developer.apple.com/documentation/quicktime-file-format/quicktime_movie_files
                return {
                    ...processFileMp4AudioWithMoovAtomAtStart(context, inputUrl, {
                        signal,
                        contentType,
                        contentLength,
                        temporaryDirectoryPath,
                    }),
                    ...metadataPromises,
                };
            } else {
                const {audioPreviewDurationPromise, audioPreviewMetadataPromise} =
                    processFileWebSafeAudio(context, inputUrl, {
                        signal,
                        contentType,
                        contentLength,
                    });

                return {
                    alternativePromise: Promise.resolve(null),
                    audioPreviewDurationPromise,
                    audioPreviewMetadataPromise,
                    ...metadataPromises,
                };
            }
        },
    };
}

function processFileMp4AudioWithMoovAtomAtStart(
    context: FileProcessorActionContext,
    inputUrl: string,
    {
        signal,
        contentType,
        contentLength,
        temporaryDirectoryPath,
    }: {
        signal: AbortSignal;
        contentType: FileMp4AudioContentType;
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
            `output.${getFileContentTypePreferredExtension("audio/mp4")}`,
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
                // Move the `moov` atom to the front of the file. This should be a fairly cheap
                // operation.
                "-c",
                "copy",
                "-movflags",
                "+faststart",
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

        // This function checks to see if the input's duration and width/height have been
        // written to stderr and if it has then we can resolve `previewContentPromise`.
        // This will push an update to the user waiting on their file to upload so they can
        // see a preview of the file in the product.
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
            `FFmpeg remux ${getFileContentTypeName(contentType)} (move moov atom to start)`,
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

        // If the audio duration wasn't present in the audio's metadata then we wait until
        // FFmpeg finishes and parse the duration from `time` printed at the end of
        // FFmpeg's stderr.
        if (!previewDurationPromiseResolver.isSettled()) {
            const match = stderr.trimEnd().match(/time=(\d\d:\d\d:\d\d(?:\.\d+)?).*$/);
            if (!match) {
                throw new InternalError(
                    `Couldn\u2019t parse video duration from FFmpeg stderr\n\nstderr:\n${stderr.trim()}`,
                );
            }

            previewDurationPromiseResolver.resolve(parseFfmpegStderrDuration(match[1]!));
        }

        // Read the transcoded alternative file from the file system.
        return {
            contentType: "audio/mp4",
            contentLength: (await fs.stat(outputPath)).size,
            data: fsSync.createReadStream(outputPath),
        };
    })().catch(error => {
        previewDurationPromiseResolver.reject(error);
        throw error;
    });

    const audioPreviewMetadataPromise: Promise<FileAudioPreviewMetadata> = (async () => {
        const metadata = await getFfprobeMetadata(context, inputUrl, {
            signal,
            contentType,
            contentLength,
        });

        return getFileAudioPreviewMetadataFromFfprobeMetadata(metadata);
    })();

    return {
        alternativePromise,
        audioPreviewDurationPromise: previewDurationPromiseResolver.promise,
        audioPreviewMetadataPromise,
    };
}
