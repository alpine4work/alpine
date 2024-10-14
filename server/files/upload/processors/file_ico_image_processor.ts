import decodeIco from "decode-ico";
import sharp from "sharp";
import {waitForReadableStreamBuffer} from "~/server/files/upload/helpers/wait_for_readable_stream_buffer.js";
import {
    processFileImagePreviewPlaceholder,
    rethrowClassifiedSharpError,
    sharpTimeoutSeconds,
} from "~/server/files/upload/processors/file_image_processor_base.js";
import {FileProcessor} from "~/server/files/upload/processors/file_processor.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {FileContentType} from "~/shared/files/file_content_type.js";
import {FileImagePreviewPlaceholder} from "~/shared/files/file_image_preview_placeholder.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

/**
 * Special handling for `image/ico` files that selects the largest image from the
 * `.ico` container format and creates a preview from that. `.ico` files are a
 * container format that include images in either `png` or `bmp` format.
 */
export function createFileIcoImageProcessor(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    contentType: "image/ico",
): FileProcessor {
    return {
        type: "IcoImage",
        hasAlternative: "ImagePreviewContent",
        hasPreview: {
            type: "Image",
            hasContent: true,
            hasVideoDuration: false,
        },
        process: (stream, signal) => {
            const dataPromise = waitForReadableStreamBuffer(stream, signal);

            const promise = (async () => {
                const data = await dataPromise;

                const bestImage = decodeIco(data).sort(
                    (image1, image2) => image2.width * image2.height - image1.width * image1.height,
                )[0];
                if (!bestImage) {
                    throw new InvalidArgumentError('No images in ".ico" file');
                }

                const bestImageData = Buffer.from(bestImage.data);

                const previewSizePromise = Promise.resolve({
                    width: bestImage.width,
                    height: bestImage.height,
                    scale: 1,
                    hasAlpha: true,
                });

                let previewPlaceholderPromise: Promise<FileImagePreviewPlaceholder>;
                let previewContentPromise: Promise<{contentType: FileContentType; data: Buffer}>;
                switch (bestImage.type) {
                    case "png": {
                        previewPlaceholderPromise =
                            processFileImagePreviewPlaceholder(bestImageData);

                        previewContentPromise = Promise.resolve({
                            contentType: "image/png",
                            data: bestImageData,
                        });
                        break;
                    }
                    case "bmp": {
                        previewPlaceholderPromise = processFileImagePreviewPlaceholder(
                            bestImageData,
                            {
                                raw: {
                                    width: bestImage.width,
                                    height: bestImage.height,
                                    channels: 4,
                                },
                            },
                        );

                        previewContentPromise = (async () => {
                            const data = await sharp(bestImage.data, {
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

                            return {contentType: "image/png", data};
                        })();
                        break;
                    }
                    default:
                        throw exhaustive(bestImage);
                }

                return {previewSizePromise, previewPlaceholderPromise, previewContentPromise};
            })();

            return {
                imagePreviewSizePromise: promise.then(({previewSizePromise}) => previewSizePromise),
                imagePreviewPlaceholderPromise: promise.then(
                    ({previewPlaceholderPromise}) => previewPlaceholderPromise,
                ),
                imagePreviewContentPromise: promise.then(
                    ({previewContentPromise}) => previewContentPromise,
                ),
            };
        },
    };
}
