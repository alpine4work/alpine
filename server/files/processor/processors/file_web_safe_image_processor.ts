import fsSync from "fs";
import {join as joinPath} from "path";
import {Readable as ReadableStream} from "stream";
import {finished} from "stream/promises";
import {createFileProcessorAnalysisPromises} from "~/server/files/processor/processors/create_file_processor_analysis_promises.js";
import {processImageFile} from "~/server/files/processor/processors/file_image_processor_base.js";
import {FileProcessor} from "~/server/files/processor/processors/file_processor.js";
import {filesBucketName} from "~/server/helpers/files_cloudflare_r2_bucket_name.js";
import {FileWebSafeImageContentType} from "~/shared/files/file_content_type.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";

export function createFileWebSafeImageProcessor(
    contentType: FileWebSafeImageContentType,
): FileProcessor {
    return {
        type: "WebSafeImage",
        hasAlternative: false,
        hasAnalysis: true,
        hasPreview: {
            type: "Image",
            hasContent: false,
            hasVideoDuration: false,
        },
        hasTranscript: false,
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
            const [temporaryDirectoryPath, object] = await runAllPromises([
                withTemporaryDirectory(),
                context.r2.GetObject(
                    {
                        Bucket: filesBucketName,
                        Key: `${spaceId}/${fileId}`,
                    },
                    {signal},
                ),
            ]);

            assert(object.Body instanceof ReadableStream);

            const inputPath = joinPath(temporaryDirectoryPath, "input.pdf");
            const inputWriteStream = fsSync.createWriteStream(inputPath);

            await finished(object.Body.pipe(inputWriteStream));

            return {
                ...processImageFile(context, inputPath, {signal, contentType, contentLength}),
                ...createFileProcessorAnalysisPromises(context, {
                    contentType,
                    fileId,
                    hasTranscript: false,
                    inputPathIfExists: inputPath,
                    parentTemporaryDirectoryPath,
                    signal,
                    spaceId,
                }),
            };
        },
    };
}
