import {spawn} from "child_process";
import {addMinutes} from "date-fns";
import fsSync from "fs";
import fs from "fs/promises";
import {join as joinPath} from "path";
import {Readable as ReadableStream} from "stream";
import {FileProcessorActionContext} from "~/server/files/data/file_processor_context.js";
import {createFileProcessorAnalysisPromises} from "~/server/files/processor/processors/create_file_processor_analysis_promises.js";
import {processFileImagePreviewPlaceholder} from "~/server/files/processor/processors/file_image_processor_base.js";
import {FileProcessor} from "~/server/files/processor/processors/file_processor.js";
import {
    ffmpegExecutablePath,
    ffmpegImagePreviewContentOutputContentType,
    ffmpegImagePreviewContentOutputExtension,
    ffmpegThreadCount,
    ffmpegWebSafeMp4AudioCodecNames,
    ffmpegWebSafeMp4VideoCodecNames,
    ffprobeExecutablePath,
    getFfmpegImagePreviewContentOutputOptions,
    parseFfmpegStderrDuration,
    parseFfmpegStderrInputCodecNames,
    parseFileImagePreviewSizeAndVideoDurationIfPossibleFromFfmpegStderr,
} from "~/server/files/processor/processors/file_video_and_audio_processor_base.js";
import {processFileWebSafeVideo} from "~/server/files/processor/processors/file_web_safe_video_processor.js";
import {processFileWebUnsafeVideo} from "~/server/files/processor/processors/file_web_unsafe_video_processor.js";
import {filesBucketName} from "~/server/helpers/files_cloudflare_r2_bucket_name.js";
import {getProcessEnvToPropagate, runProcess} from "~/server/helpers/node/run_process.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {waitForProcessExit} from "~/server/helpers/node/wait_for_process_exit.js";
import {getFileContentTypeName} from "~/shared/content/code/get_file_content_type_name.js";
import {InternalError, UnknownError} from "~/shared/error/error.open_source.js";
import {
    FileContentType,
    FileMp4VideoContentType,
    getFileContentTypePreferredExtension,
} from "~/shared/files/file_content_type.open_source.js";
import {FileImagePreviewPlaceholder} from "~/shared/files/file_image_preview_placeholder.js";
import {FileImagePreviewSize} from "~/shared/files/file_preview.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.open_source.js";

export function createFileMp4VideoProcessor(contentType: FileMp4VideoContentType): FileProcessor {
    return {
        type: "Mp4Video",
        hasAlternative: true,
        hasAnalysis: true,
        hasPreview: {
            type: "Image",
            hasContent: true,
            hasVideoDuration: true,
        },
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
                        /^\[[^\]]*mp4[^\]]*\] type:'(moov|mdat)'/gm,
                    );
                    const relevantAtoms = [...relevantAtomMatches].map(match => match[1]!);

                    span.addData({
                        ffmpeg: {
                            codecs: codecNames.join("/"),
                            videoMp4: {relevantAtoms: relevantAtoms.join(",")},
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

            let hasWebSafeVideoCodec = false;
            let hasWebSafeAudioCodec = false;

            for (const codecName of codecNames) {
                if (ffmpegWebSafeMp4VideoCodecNames.has(codecName)) {
                    hasWebSafeVideoCodec = true;
                }
                if (ffmpegWebSafeMp4AudioCodecNames.has(codecName)) {
                    hasWebSafeAudioCodec = true;
                }
            }

            // If we have both a web safe audio codec and a web safe video codec then we can
            // use the cheaper web safe processor and skip an expensive transcode.
            if (!hasWebSafeVideoCodec || !hasWebSafeAudioCodec) {
                return {
                    ...(await processFileWebUnsafeVideo(context, inputUrl, {
                        signal,
                        contentType,
                        contentLength,
                        temporaryDirectoryPath,
                    })),
                    ...metadataPromises,
                };
            } else if (!isDeepEqual(relevantAtoms, ["moov", "mdat"])) {
                // (All block quotes in the following section come from [Apple's QuickTime File
                // Format documentation][1].)
                //
                // For QuickTime (`video/quicktime`) videos and therefore MP4 (`video/mp4`) videos
                // (whose format is derived from QuickTime) the file is arranged into atoms. The
                // `moov` atom is the "movie atom" which contains:
                //
                // > Movie resource metadata about the movie (number and type of tracks, location
                // > of sample data, and so on). Describes where the movie data can be found and
                // > how to interpret it.
                //
                // The `mdat` atom is the "movie data atom" which contains:
                //
                // > Movie sample data—media samples such as video frames and groups of audio
                // > samples. Usually this data can be interpreted only by using the movie
                // > resource.
                //
                // Importantly, in the QuickTime/MP4 format:
                //
                // > Generally speaking, atoms can be present in any order. Do not conclude that a
                // > particular atom is not present until you have parsed all the atoms in the
                // > file.
                //
                // Typically when QuickTime/MP4 videos are encoded the `moov` atom goes after the
                // `mdat` atom. Since you need to encode the movie data before you know its
                // metadata (e.g. movie duration). However, when QuickTime/MP4 videos are played
                // (decoded) they can't be played until the `moov` atom is found. So for
                // QuickTime/MP4 files served from an HTTP server it means the client needs to
                // download the entire video file before it can start playback! (Since the client
                // needs the `moov` atom.)
                //
                // Now some clients (e.g. Chrome) are smart about this and if they don't find the
                // `moov` atom at the start of the video file they'll try making a ranged request
                // to the end of the file. Other clients (e.g. Safari) aren't smart and will
                // download the entire audio file before playback.
                //
                // It's a really bad experience for Safari users to have to sit and wait for the
                // entire video to be downloaded before playback begins. So while technically an
                // MP4 file with web safe codecs and an `mdat` atom before the `moov` atom is
                // playable in all web browsers we consider it "web unsafe" since the user
                // experience is very bad.
                //
                // We could run the `processFileWebUnsafeVideo()` code path but a full WebM
                // transcoding is unnesecary so simply run
                // `ffmpeg -i input.mp4 -c copy -movflags +faststart output.mp4` which will copy
                // the file and move the `moov` flag to the start.
                //
                // [1]:
                //     https://developer.apple.com/documentation/quicktime-file-format/quicktime_movie_files
                return {
                    ...(await processFileMp4VideoWithMoovAtomAtStart(context, inputUrl, {
                        signal,
                        contentType,
                        contentLength,
                        temporaryDirectoryPath,
                    })),
                    ...metadataPromises,
                };
            } else {
                const {
                    imagePreviewSizePromise,
                    imagePreviewPlaceholderPromise,
                    imagePreviewContentPromise,
                    imagePreviewVideoDurationPromise,
                } = await processFileWebSafeVideo(context, inputUrl, {
                    signal,
                    contentType,
                    contentLength,
                    temporaryDirectoryPath,
                });

                return {
                    alternativePromise: Promise.resolve(null),
                    imagePreviewSizePromise,
                    imagePreviewPlaceholderPromise,
                    imagePreviewContentPromise,
                    imagePreviewVideoDurationPromise,
                    ...metadataPromises,
                };
            }
        },
    };
}

async function processFileMp4VideoWithMoovAtomAtStart(
    context: FileProcessorActionContext,
    inputUrl: string,
    {
        signal,
        contentType,
        contentLength,
        temporaryDirectoryPath,
    }: {
        signal: AbortSignal;
        contentType: FileMp4VideoContentType;
        contentLength: number;
        temporaryDirectoryPath: string;
    },
) {
    const previewSizePromiseResolver = createPromiseResolver<
        FileImagePreviewSize & {videoDuration?: number}
    >();
    const previewPlaceholderPromiseResolver = createPromiseResolver<FileImagePreviewPlaceholder>();
    const previewContentPromiseResolver = createPromiseResolver<{
        contentType: FileContentType;
        contentLength: number;
        data: Buffer | ReadableStream;
    }>();
    const previewVideoDurationPromiseResolver = createPromiseResolver<number>();

    const alternativePromise = (async (): Promise<{
        contentType: FileContentType;
        contentLength: number;
        data: Buffer | ReadableStream;
    }> => {
        const previewOutput1Path = joinPath(
            temporaryDirectoryPath,
            `output1.${ffmpegImagePreviewContentOutputExtension}`,
        );

        const previewOutput2Path = joinPath(
            temporaryDirectoryPath,
            `output2.${ffmpegImagePreviewContentOutputExtension}`,
        );

        const previewOutput3Path = joinPath(
            temporaryDirectoryPath,
            `output3.${ffmpegImagePreviewContentOutputExtension}`,
        );

        const alternativeOutputPath = joinPath(
            temporaryDirectoryPath,
            `output4.${getFileContentTypePreferredExtension("video/mp4")}`,
        );

        const previewContentSubprocess = spawn(
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
                    output1Path: previewOutput1Path,
                    output2Path: previewOutput2Path,
                    output3Path: previewOutput3Path,
                }),
            ],
            {
                cwd: runfilesPath,
                env: getProcessEnvToPropagate(),
                stdio: ["ignore", "pipe", "pipe"],
                signal,
            },
        );

        const alternativeSubprocess = spawn(
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
                alternativeOutputPath,
            ],
            {
                cwd: runfilesPath,
                env: getProcessEnvToPropagate(),
                stdio: ["ignore", "pipe", "pipe"],
                signal,
            },
        );

        let previewContentStderr = "";
        let alternativeStderr = "";

        // This function checks to see if the input's duration and width/height have been
        // written to stderr and if it has then we can resolve `previewContentPromise`.
        // This will push an update to the user waiting on their file to upload so they can
        // see a preview of the file in the product.
        const attemptResolvePreviewSize = () => {
            if (previewSizePromiseResolver.isSettled()) return;

            try {
                const previewSize =
                    parseFileImagePreviewSizeAndVideoDurationIfPossibleFromFfmpegStderr(
                        previewContentStderr,
                        false,
                    );
                if (!previewSize) return;

                previewSizePromiseResolver.resolve(previewSize);

                if (previewSize.videoDuration !== undefined) {
                    previewVideoDurationPromiseResolver.resolve(previewSize.videoDuration);
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

        const [, alternative] = await runAllPromises([
            (async () => {
                await context.tracer.withSpan(
                    `FFmpeg generate ${getFileContentTypeName(
                        contentType,
                    )} preview ${getFileContentTypeName(
                        ffmpegImagePreviewContentOutputContentType,
                    )}`,
                    async (context, span) => {
                        span.addData({
                            file: {contentType, contentLength},
                        });

                        await waitForProcessExit(previewContentSubprocess).catch(error => {
                            // We include the stderr in error messages even in production since it shouldn't
                            // contain sensitive user data. It may contain the file's duration and other
                            // metadata but it shouldn't be harmful for a developer to read that.
                            //
                            // However, including the stderr will really help us debug any issues.
                            throw new UnknownError(
                                `${
                                    error instanceof Error ? error.message : String(error)
                                }\n\nstderr:\n${previewContentStderr.trim()}`,
                                {
                                    cause: error instanceof Error ? error.cause : undefined,
                                },
                            );
                        });

                        span.addData({
                            ffmpeg: {
                                codecs: parseFfmpegStderrInputCodecNames(previewContentStderr),
                            },
                        });

                        attemptResolvePreviewSize();

                        if (!previewSizePromiseResolver.isSettled()) {
                            throw new InternalError(
                                `Couldn\u2019t find video duration and width/height from FFmpeg stderr\n\nstderr:\n${previewContentStderr.trim()}`,
                            );
                        }
                    },
                );

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
                        previewContentStderr,
                    )
                ) {
                    outputPath = previewOutput3Path;
                } else if (
                    /(?:^|\n)\[out#0\/[^\]]*\] Output file is empty, nothing was encoded\(check -ss \/ -t \/ -frames parameters if used\)(?:\n|$)/.test(
                        previewContentStderr,
                    )
                ) {
                    outputPath = previewOutput2Path;
                } else {
                    outputPath = previewOutput1Path;
                }

                const outputContentLength = (await fs.stat(outputPath)).size;

                previewPlaceholderPromiseResolver.resolve(
                    processFileImagePreviewPlaceholder(context, outputPath, {
                        contentType: ffmpegImagePreviewContentOutputContentType,
                        contentLength: outputContentLength,
                    }),
                );

                previewContentPromiseResolver.resolve({
                    contentType: ffmpegImagePreviewContentOutputContentType,
                    contentLength: outputContentLength,
                    data: fsSync.createReadStream(outputPath),
                });
            })(),
            context.tracer.withSpan(
                `FFmpeg remux ${getFileContentTypeName(contentType)} (move moov atom to start)`,
                async (context, span) => {
                    span.addData({
                        file: {contentType, contentLength},
                    });

                    await waitForProcessExit(alternativeSubprocess).catch(error => {
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

                    // If the video duration wasn't present in the video's metadata then we wait until
                    // FFmpeg finishes and parse the duration from `time` printed at the end of
                    // FFmpeg's stderr.
                    if (!previewVideoDurationPromiseResolver.isSettled()) {
                        const match = alternativeStderr
                            .trimEnd()
                            .match(/time=(\d\d:\d\d:\d\d(?:\.\d+)?).*$/);
                        if (!match) {
                            throw new InternalError(
                                `Couldn\u2019t parse video duration from FFmpeg stderr\n\nstderr:\n${alternativeStderr.trim()}`,
                            );
                        }

                        previewVideoDurationPromiseResolver.resolve(
                            parseFfmpegStderrDuration(match[1]!),
                        );
                    }

                    // Read the transcoded alternative file from the file system.
                    return {
                        contentType: "video/mp4" as const,
                        contentLength: (await fs.stat(alternativeOutputPath)).size,
                        data: fsSync.createReadStream(alternativeOutputPath),
                    };
                },
            ),
        ]);

        return alternative;
    })().then(
        alternative => {
            // All of these promise resolvers MUST have either been resolved or rejected by the
            // end of this promise. So any promise resolvers that haven't been settled yet
            // reject with an error as a safety mechanism.
            if (!previewSizePromiseResolver.isSettled()) {
                previewSizePromiseResolver.reject(
                    new InternalError("Promise resolver wasn\u2019t resolved"),
                );
            }
            if (!previewContentPromiseResolver.isSettled()) {
                previewContentPromiseResolver.reject(
                    new InternalError("Promise resolver wasn\u2019t resolved"),
                );
            }
            if (!previewVideoDurationPromiseResolver.isSettled()) {
                previewVideoDurationPromiseResolver.reject(
                    new InternalError("Promise resolver wasn\u2019t resolved"),
                );
            }
            return alternative;
        },
        error => {
            previewSizePromiseResolver.reject(error);
            previewContentPromiseResolver.reject(error);
            previewVideoDurationPromiseResolver.reject(error);
            throw error;
        },
    );

    return {
        alternativePromise,
        imagePreviewSizePromise: previewSizePromiseResolver.promise,
        imagePreviewPlaceholderPromise: previewPlaceholderPromiseResolver.promise,
        imagePreviewContentPromise: previewContentPromiseResolver.promise,
        imagePreviewVideoDurationPromise: previewVideoDurationPromiseResolver.promise,
    };
}
