import fsSync from "fs";
import fs from "fs/promises";
import {join as joinPath} from "path";
import sharp from "sharp";
import {Readable as ReadableStream} from "stream";
import {finished} from "stream/promises";
import {processImageFile} from "~/server/files/processor/processors/file_image_processor_base.js";
import {FileProcessor} from "~/server/files/processor/processors/file_processor.js";
import {rethrowClassifiedSharpError} from "~/server/files/processor/sharp/rethrow_classified_sharp_error.js";
import {sharpTimeoutSeconds} from "~/server/files/processor/sharp/sharp_timeout_seconds.js";
import {filesBucketName} from "~/server/helpers/files_cloudflare_r2_bucket_name.js";
import {getFileContentTypeName} from "~/shared/content/code/get_file_content_type_name.js";
import {
    FileContentType,
    FileWebUnsafeImageContentType,
    getFileContentTypePreferredExtension,
} from "~/shared/files/file_content_type.js";
import {getFilePreviewImageMaxResizeWidth} from "~/shared/files/get_file_preview_image_resize_width.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";

export function createFileWebUnsafeImageProcessor(
    contentType: Exclude<FileWebUnsafeImageContentType, "image/ico">,
): FileProcessor {
    return {
        type: "WebUnsafeImage",
        hasAlternative: "ImagePreviewContent",
        hasPreview: {
            type: "Image",
            hasContent: true,
            hasVideoDuration: false,
        },
        process: async (
            context,
            {spaceId, fileId, signal, contentLength, withTemporaryDirectory},
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

            const inputPath = joinPath(
                temporaryDirectoryPath,
                `input.${getFileContentTypePreferredExtension(contentType)}`,
            );
            const outputPath = joinPath(
                temporaryDirectoryPath,
                `output.${getFileContentTypePreferredExtension("image/avif")}`,
            );

            const inputWriteStream = fsSync.createWriteStream(inputPath);

            await finished(object.Body.pipe(inputWriteStream));

            const imagePreviewContentPromise = (async (): Promise<{
                contentType: FileContentType;
                contentLength: number;
                data: ReadableStream;
            }> => {
                await context.tracer.withSpan(
                    `sharp reformat ${getFileContentTypeName(
                        contentType,
                    )} to ${getFileContentTypeName("image/avif")}`,
                    async (context, span) => {
                        span.addData({
                            file: {contentType, contentLength},
                        });

                        await sharp(inputPath, {pages: 1})
                            .timeout({seconds: sharpTimeoutSeconds})
                            .resize({
                                width: getFilePreviewImageMaxResizeWidth(),
                                height: getFilePreviewImageMaxResizeWidth(),
                                fit: "inside",
                                withoutEnlargement: true,
                            })
                            // AVIF is our preferred format for generating preview images ([source][1],
                            // [source][2]). AVIF has full browser support, provides better compression than
                            // JPEG and WebP, and has alpha channel support (unlike JPEG).
                            //
                            // Ideally we'd produce an image with lossless compression here since this file
                            // will be used as an alternative for the file in our image viewer. However,
                            // producing an image with lossless compression from an image with some compression
                            // (e.g. an `.heic` image) creates a much bigger file. So instead we opt for some
                            // compression but set our quality level really high (93). We don't want to produce
                            // a file too much larger than our input file and we also want to maintain as much
                            // detail as possible.
                            //
                            // Quality level of 93 was picked so that an `.heic` photo taken from my
                            // (@calebmer's) iPhone exported at high quality is about the same file size as the
                            // generated preview image.
                            //
                            // If we decide to switch this to lossless images we should use WebP instead since
                            // [AVIF is worse at lossless compression][3].
                            //
                            // [1]:
                            //     https://medium.com/@julienetienne/why-you-should-use-avif-over-jpeg-webp-png-and-gif-in-2024-5603ac9d8781
                            // [2]: https://jakearchibald.com/2020/avif-has-landed
                            // [3]: https://github.com/AOMediaCodec/av1-avif/issues/111#issuecomment-717710961
                            .toFormat("avif", {quality: 93})
                            .toFile(outputPath)
                            .catch(rethrowClassifiedSharpError);
                    },
                );

                return {
                    contentType: "image/avif",
                    contentLength: (await fs.stat(outputPath)).size,
                    data: fsSync.createReadStream(outputPath),
                };
            })();

            const {imagePreviewSizePromise, imagePreviewPlaceholderPromise} = processImageFile(
                context,
                inputPath,
                {signal, contentType, contentLength},
            );

            return {
                imagePreviewSizePromise,
                imagePreviewPlaceholderPromise,
                imagePreviewContentPromise,
            };
        },
    };
}
