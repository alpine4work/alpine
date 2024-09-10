import sharp from "sharp";
import {waitForReadableStreamData} from "~/server/files/upload/helpers/wait_for_readable_stream_data.js";
import {
    processImageFile,
    rethrowClassifiedSharpError,
    sharpTimeoutSeconds,
} from "~/server/files/upload/processors/file_image_processor_base.js";
import {FileProcessor} from "~/server/files/upload/processors/file_processor.js";
import {FileContentType, FileWebUnsafeImageContentType} from "~/shared/files/file_content_type.js";

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
        process: (stream, signal) => {
            const dataPromise = waitForReadableStreamData(stream, signal);
            const {imagePreviewSizePromise, imagePreviewPlaceholderPromise} = processImageFile(
                contentType,
                dataPromise,
            );

            const imagePreviewContentPromise = (async (): Promise<{
                contentType: FileContentType;
                data: Buffer;
            }> => {
                // Unfortunately, `sharp` doesn't support efficient stream processing so it's
                // more efficient to await `dataPromise` than to use `stream`. See our comment
                // on `FileProcessor`.
                const inputData = await dataPromise;

                const outputData = await sharp(inputData, {pages: 1})
                    .timeout({seconds: sharpTimeoutSeconds})
                    // AVIF is our preferred format for generating preview images ([source][1],
                    // [source][2]). AVIF has full browser support, provides better compression
                    // than JPEG and WebP, and has alpha channel support (unlike JPEG).
                    //
                    // Ideally we'd produce an image with lossless compression here since this file
                    // will be used as an alternative for the file in our image viewer. However,
                    // producing an image with lossless compression from an image with some
                    // compression (e.g. an `.heic` image) creates a much bigger file. So instead
                    // we opt for some compression but set our quality level really high (93). We
                    // don't want to produce a file too much larger than our input file and we also
                    // want to maintain as much detail as possible.
                    //
                    // Quality level of 93 was picked so that an `.heic` photo taken from my
                    // (@calebmer's) iPhone exported at high quality is about the same file size as
                    // the generated preview image.
                    //
                    // If we decide to switch this to lossless images we should use WebP instead
                    // since [AVIF is worse at lossless compression][3].
                    //
                    // [1]: https://medium.com/@julienetienne/why-you-should-use-avif-over-jpeg-webp-png-and-gif-in-2024-5603ac9d8781
                    // [2]: https://jakearchibald.com/2020/avif-has-landed
                    // [3]: https://github.com/AOMediaCodec/av1-avif/issues/111#issuecomment-717710961
                    .toFormat("avif", {quality: 93})
                    .toBuffer()
                    .catch(rethrowClassifiedSharpError);

                return {contentType: "image/avif", data: outputData};
            })();

            return {
                imagePreviewSizePromise,
                imagePreviewPlaceholderPromise,
                imagePreviewContentPromise,
            };
        },
    };
}
