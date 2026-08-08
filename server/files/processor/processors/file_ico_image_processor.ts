import decodeIco from "decode-ico";
import fs from "fs/promises";
import {join as joinPath} from "path";
import sharp from "sharp";
import {Readable as ReadableStream, Writable as WritableStream} from "stream";
import {finished} from "stream/promises";
import {createFileProcessorAnalysisPromises} from "~/server/files/processor/processors/create_file_processor_analysis_promises.js";
import {processFileImagePreviewPlaceholder} from "~/server/files/processor/processors/file_image_processor_base.js";
import {FileProcessor} from "~/server/files/processor/processors/file_processor.js";
import {rethrowClassifiedSharpError} from "~/server/files/processor/sharp/rethrow_classified_sharp_error.js";
import {sharpTimeoutSeconds} from "~/server/files/processor/sharp/sharp_timeout_seconds.js";
import {filesBucketName} from "~/server/helpers/files_cloudflare_r2_bucket_name.js";
import {getFileContentTypeName} from "~/shared/content/code/get_file_content_type_name.js";
import {InvalidArgumentError} from "~/shared/error/error.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";

/**
 * Special handling for `image/ico` files that selects the largest image from the
 * `.ico` container format and creates a preview from that. `.ico` files are a
 * container format that include images in either `png` or `bmp` format.
 */
export function createFileIcoImageProcessor(contentType: "image/ico"): FileProcessor {
    return {
        type: "IcoImage",
        hasAlternative: "ImagePreviewContent",
        hasAnalysis: true,
        hasPreview: {
            type: "Image",
            hasContent: true,
            hasVideoDuration: false,
        },
        hasTranscript: false,
        process: (
            context,
            {spaceId, fileId, signal, parentTemporaryDirectoryPath, withTemporaryDirectory},
        ) => {
            // We load the file into memory since `decodeIco()` needs the full file. This is
            // acceptable for `image/ico` files since they're usually quite small.
            const bestImagePromise = (async () => {
                const object = await context.r2.GetObject(
                    {
                        Bucket: filesBucketName,
                        Key: `${spaceId}/${fileId}`,
                    },
                    {signal},
                );
                const stream = object.Body;
                assert(stream instanceof ReadableStream);

                const chunks: Array<Uint8Array> = [];

                const writableStream = new WritableStream({
                    write: (data: Uint8Array, encoding, callback) => {
                        chunks.push(data);
                        callback();
                    },
                    final: callback => {
                        callback();
                    },
                });

                await finished(stream.pipe(writableStream));

                const data = Buffer.concat(chunks);

                const bestImage = decodeIco(
                    // TODO(calebmer, #typescript-5.9.2): Discovered after TS version upgrade, not
                    // fixing for now.
                    // @ts-expect-error
                    data,
                ).sort(
                    (image1, image2) => image2.width * image2.height - image1.width * image1.height,
                )[0];
                if (!bestImage) {
                    throw new InvalidArgumentError("No images in `.ico` file");
                }

                return bestImage;
            })();

            const imagePreviewContentPromise = (async () => {
                const bestImage = await bestImagePromise;

                switch (bestImage.type) {
                    case "png": {
                        return {
                            contentType: "image/png" as const,
                            contentLength: bestImage.data.length,
                            data: Buffer.from(bestImage.data),
                        };
                    }
                    case "bmp": {
                        const data = await context.tracer.withSpan(
                            `sharp reformat ${getFileContentTypeName(
                                "image/bmp",
                            )} to ${getFileContentTypeName("image/png")}`,
                            (context, span) => {
                                span.addData({
                                    file: {
                                        contentType: "image/bmp",
                                        contentLength: bestImage.data.length,
                                    },
                                });

                                return sharp(bestImage.data, {
                                    raw: {
                                        width: bestImage.width,
                                        height: bestImage.height,
                                        channels: 4,
                                    },
                                })
                                    .timeout({seconds: sharpTimeoutSeconds})
                                    .toFormat("png")
                                    .toBuffer()
                                    .catch(rethrowClassifiedSharpError);
                            },
                        );

                        return {
                            contentType: "image/png" as const,
                            contentLength: data.length,
                            data,
                        };
                    }
                    default:
                        throw exhaustive(bestImage);
                }
            })();

            async function createMetadataInputPath() {
                const [temporaryDirectoryPath, content] = await runAllPromises([
                    withTemporaryDirectory(),
                    imagePreviewContentPromise,
                ]);
                const inputPath = joinPath(temporaryDirectoryPath, "metadata-input.png");

                await fs.writeFile(inputPath, content.data.toString("base64"), "base64");

                return inputPath;
            }

            return {
                imagePreviewSizePromise: (async () => {
                    const bestImage = await bestImagePromise;

                    return {
                        width: bestImage.width,
                        height: bestImage.height,
                        scale: 1,
                        hasAlpha: true,
                    };
                })(),
                imagePreviewPlaceholderPromise: (async () => {
                    const bestImage = await bestImagePromise;

                    switch (bestImage.type) {
                        case "png": {
                            return await processFileImagePreviewPlaceholder(
                                context,
                                bestImage.data,
                                {
                                    contentType: "image/png",
                                    contentLength: bestImage.data.length,
                                },
                            );
                        }
                        case "bmp": {
                            return await processFileImagePreviewPlaceholder(
                                context,
                                bestImage.data,
                                {
                                    contentType: "image/bmp",
                                    contentLength: bestImage.data.length,
                                    raw: {
                                        width: bestImage.width,
                                        height: bestImage.height,
                                        channels: 4,
                                    },
                                },
                            );
                        }
                        default:
                            throw exhaustive(bestImage);
                    }
                })(),
                imagePreviewContentPromise,
                ...createFileProcessorAnalysisPromises(context, {
                    contentType,
                    fileId,
                    hasTranscript: false,
                    inputPathIfExists: createMetadataInputPath,
                    parentTemporaryDirectoryPath,
                    signal,
                    spaceId,
                }),
            };
        },
    };
}
