import decodeIco from "decode-ico";
import sharp from "sharp";
import {waitForReadableStreamData} from "~/server/files/upload/helpers/wait_for_readable_stream_data.js";
import {
    processFilePreviewPlaceholder,
    rethrowClassifiedSharpError,
    sharpTimeoutSeconds,
} from "~/server/files/upload/processors/file_image_processor_base.js";
import {FileProcessor} from "~/server/files/upload/processors/file_processor.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {FileContentType} from "~/shared/files/file_content_type.js";
import {FilePreviewPlaceholder} from "~/shared/files/file_preview_placeholder.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

/**
 * Special handling for `image/ico` files that selects the largest image from the
 * `.ico` container format and creates a preview from that. `.ico` files are a
 * container format that include images in either `png` or `bmp` format.
 */
export function createFileIcoImageProcessor(): FileProcessor {
    return {
        type: "IcoImage",
        hasPreview: true,
        hasPreviewImage: true,
        hasAlternative: "PreviewImage",
        process: (stream, signal) => {
            const dataPromise = waitForReadableStreamData(stream, signal);

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
                });

                let previewPlaceholderPromise: Promise<FilePreviewPlaceholder>;
                let previewImagePromise: Promise<{contentType: FileContentType; data: Buffer}>;
                switch (bestImage.type) {
                    case "png": {
                        previewPlaceholderPromise = processFilePreviewPlaceholder(bestImageData);

                        previewImagePromise = Promise.resolve({
                            contentType: "image/png",
                            data: bestImageData,
                        });
                        break;
                    }
                    case "bmp": {
                        previewPlaceholderPromise = processFilePreviewPlaceholder(bestImageData, {
                            raw: {
                                width: bestImage.width,
                                height: bestImage.height,
                                channels: 4,
                            },
                        });

                        previewImagePromise = (async () => {
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

                return {previewSizePromise, previewPlaceholderPromise, previewImagePromise};
            })();

            return {
                previewSizePromise: promise.then(({previewSizePromise}) => previewSizePromise),
                previewPlaceholderPromise: promise.then(
                    ({previewPlaceholderPromise}) => previewPlaceholderPromise,
                ),
                previewImagePromise: promise.then(({previewImagePromise}) => previewImagePromise),
            };
        },
    };
}
