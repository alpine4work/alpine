import {addMinutes} from "date-fns";
import {FileProcessor} from "~/server/files/processor/processors/file_processor.js";
import {
    ffmpegWebSafeMp4AudioCodecNames,
    ffprobeExecutablePath,
} from "~/server/files/processor/processors/file_video_and_audio_processor_base.js";
import {processFileWebSafeAudio} from "~/server/files/processor/processors/file_web_safe_audio_processor.js";
import {processFileWebUnsafeAudio} from "~/server/files/processor/processors/file_web_unsafe_audio_processor.js";
import {filesBucketName} from "~/server/helpers/files_cloudflare_r2_bucket_name.js";
import {runProcess} from "~/server/helpers/node/run_process.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {getFileContentTypeName} from "~/shared/content/code/get_file_content_type_name.js";
import {FileMp4AudioContentType} from "~/shared/files/file_content_type.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";

export function createFileMp4AudioProcessor(contentType: FileMp4AudioContentType): FileProcessor {
    return {
        type: "Mp4Audio",
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

            const codecNames = await context.tracer.withSpan(
                `FFmpeg get ${getFileContentTypeName(contentType)} codecs`,
                async (context, span) => {
                    span.addData({
                        file: {contentType, contentLength},
                    });

                    const codecNamesString = await runProcess(
                        ffprobeExecutablePath,
                        [
                            ["-v", "error"],
                            ["-show_entries", "stream=codec_name"],
                            ["-of", "default=noprint_wrappers=1:nokey=1"],
                            inputUrl,
                        ],
                        {cwd: runfilesPath, signal},
                    );

                    const codecNames = codecNamesString.trim().split("\n");

                    span.addData({
                        ffmpeg: {codecs: codecNames.join("/")},
                    });

                    return codecNames;
                },
            );

            let hasWebSafeAudioCodec = false;

            for (const codecName of codecNames) {
                if (ffmpegWebSafeMp4AudioCodecNames.has(codecName)) {
                    hasWebSafeAudioCodec = true;
                }
            }

            // If we have a web safe audio codec then we can use the cheaper web safe processor
            // and skip an expensive transcode.
            if (!hasWebSafeAudioCodec) {
                return processFileWebUnsafeAudio(context, inputUrl, {
                    signal,
                    contentType,
                    contentLength,
                    temporaryDirectoryPath,
                });
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
                };
            }
        },
    };
}
