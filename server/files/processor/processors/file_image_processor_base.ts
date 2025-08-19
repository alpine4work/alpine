import sharp from "sharp";
import {FileProcessorServiceActionContext} from "~/server/files/processor/context/file_processor_service_context.js";
import {rethrowClassifiedSharpError} from "~/server/files/processor/sharp/rethrow_classified_sharp_error.js";
import {sharpTimeoutSeconds} from "~/server/files/processor/sharp/sharp_timeout_seconds.js";
import {getFileContentTypeName} from "~/shared/content/code/get_file_content_type_name.js";
import {InternalError, InvalidArgumentError} from "~/shared/error/error.js";
import {FileContentType, FileImageContentType} from "~/shared/files/file_content_type.js";
import {
    FileImagePreviewPlaceholder,
    fileImagePreviewPlaceholderBaseSize,
} from "~/shared/files/file_image_preview_placeholder.js";
import {FileImagePreviewSize} from "~/shared/files/file_preview.js";
import {
    maxFilePreviewAspectRatio,
    minFilePreviewAspectRatio,
} from "~/shared/files/min_and_max_file_preview_aspect_ratio.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {quote} from "~/shared/helpers/string/quote.js";

/**
 * Generate a placeholder image which we'll render before the browser has
 * downloaded the full image. The code below is derived from the
 * [`plaiceholder`][1] project. We don't use `plaiceholder` directly since it's
 * fundamentally pretty simple and the implementation is inefficient. (It
 * unconditionally generates a color and `base64` placeholder.)
 *
 * [1]: https://github.com/joe-bell/plaiceholder/blob/36d4518301c6512957c63977133f6224f491c7f2/packages/plaiceholder/src/index.ts#L219-L334
 */
export async function processFileImagePreviewPlaceholder(
    context: FileProcessorServiceActionContext,
    input: string | Buffer | ArrayBuffer | Uint8Array,
    {
        contentType,
        contentLength,
        ...options
    }: {
        contentType: FileContentType;
        contentLength: number;
    } & sharp.SharpOptions,
): Promise<FileImagePreviewPlaceholder> {
    const {
        data: outputData,
        info: {channels, width, height},
    } = await context.tracer.withSpan(
        `sharp generate ${getFileContentTypeName(contentType)} placeholder`,
        (context, span) => {
            span.addData({
                file: {contentType, contentLength},
            });

            return (
                sharp(input, {
                    ...options,
                    pages: 1,
                    // We've found our test for `py_pdf_sample_libreoffice_write_password.pdf` is
                    // flaky if this is `failOn: "warning"` (the default) since sharp occasionally
                    // doesn't include "pdfload: password required" in the error message.
                    //
                    // We suspect that there's a race condition in libvips between some process
                    // trying to read encrypted PDF data and the process which determines the PDF
                    // is encrypted. If the process trying to read encrypted PDF data runs first
                    // it logs a warning. This behavior is reasonable from libvips, we just need to
                    // make sure we don't prematurely fail on warning.
                    failOn: "error",
                })
                    .timeout({seconds: sharpTimeoutSeconds})
                    // Rotate so that we respect EXIF orientation metadata.
                    .rotate()
                    // This method of placeholder generation gives more detail (pixels) to images
                    // further away from the aspect ratio 1:1. Ideally we'd have about the same
                    // number of pixels no matter the aspect ratio. Unfortunately, at this point we
                    // don't know the image's dimensions.
                    .resize(
                        fileImagePreviewPlaceholderBaseSize,
                        fileImagePreviewPlaceholderBaseSize,
                        {fit: "outside"},
                    )
                    .toFormat("png")
                    .modulate({brightness: 1, saturation: 1.2})
                    .raw()
                    .toBuffer({resolveWithObject: true})
                    .catch(rethrowClassifiedSharpError)
            );
        },
    );

    assert(channels === 3 || channels === 4);

    const aspectRatio = width / height;

    if (aspectRatio < minFilePreviewAspectRatio) {
        const croppedHeight = Math.round(width / minFilePreviewAspectRatio);

        return FileImagePreviewPlaceholder.fromSerialized([
            channels === 4,
            width,
            outputData.subarray(0, width * croppedHeight * channels),
        ]);
    } else if (aspectRatio > maxFilePreviewAspectRatio) {
        const croppedWidth = Math.round(height * maxFilePreviewAspectRatio);
        const cropStartX = Math.round((width - croppedWidth) / 2);
        const croppedOutputData = new Uint8Array(croppedWidth * height * channels);

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < croppedWidth; x++) {
                for (let c = 0; c < channels; c++) {
                    croppedOutputData[(y * croppedWidth + x) * channels + c] =
                        outputData[(y * width + (cropStartX + x)) * channels + c]!;
                }
            }
        }

        return FileImagePreviewPlaceholder.fromSerialized([
            channels === 4,
            croppedWidth,
            croppedOutputData,
        ]);
    } else {
        return FileImagePreviewPlaceholder.fromSerialized([channels === 4, width, outputData]);
    }
}

export function processImageFile(
    context: FileProcessorServiceActionContext,
    inputPath: string,
    {
        signal,
        contentType,
        contentLength,
    }: {
        signal: AbortSignal;
        contentType: Exclude<FileImageContentType, "image/ico">;
        contentLength: number;
    },
): {
    imagePreviewSizePromise: Promise<FileImagePreviewSize>;
    imagePreviewPlaceholderPromise: Promise<FileImagePreviewPlaceholder>;
} {
    // All processing done in this function is with `sharp()` which doesn't support
    // an `AbortSignal` but does support a timeout. `sharp()` will abort itself
    // after our 20s timeout which is fine.
    //
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    signal;

    const previewSizePromise = (async () => {
        let retryCount = 0;

        while (true) {
            retryCount++;

            try {
                const metadata = await context.tracer.withSpan(
                    `sharp get ${getFileContentTypeName(contentType)} metadata`,
                    async (context, span) => {
                        span.addData({
                            file: {contentType, contentLength},
                        });

                        const metadata = await sharp(inputPath, {pages: 1})
                            .timeout({seconds: sharpTimeoutSeconds})
                            .metadata()
                            .catch(rethrowClassifiedSharpError);

                        let expectedFormat: keyof sharp.FormatEnum;
                        let expectedCompression: sharp.Metadata["compression"];
                        let expectedFormatMagick: sharp.Metadata["formatMagick"];

                        switch (contentType) {
                            case "image/apng":
                                expectedFormat = "png";
                                break;
                            case "image/avif":
                                // See: https://github.com/lovell/sharp/issues/2504
                                expectedFormat = "heif";
                                expectedCompression = "av1";
                                break;
                            case "image/gif":
                                expectedFormat = "gif";
                                break;
                            case "image/jpeg":
                                expectedFormat = "jpeg";
                                break;
                            case "image/png":
                                expectedFormat = "png";
                                break;
                            case "image/svg+xml":
                                expectedFormat = "svg";
                                break;
                            case "image/webp":
                                expectedFormat = "webp";
                                break;
                            case "image/bmp":
                                expectedFormat = "magick";
                                expectedFormatMagick = "BMP";
                                break;
                            case "image/tiff":
                                expectedFormat = "tiff";
                                break;
                            case "image/heif":
                                expectedFormat = "heif";
                                expectedCompression = "hevc";
                                break;
                            default:
                                throw exhaustive(contentType);
                        }

                        if (metadata.format !== expectedFormat) {
                            throw new InvalidArgumentError(
                                quote`Expected file in ${expectedFormat} format but received file in ${metadata.format} format`,
                            );
                        }

                        if (metadata.compression !== expectedCompression) {
                            throw new InvalidArgumentError(
                                quote`Expected file in ${expectedFormat} format to use ${expectedCompression} compression but received file with ${metadata.compression} compression`,
                            );
                        }

                        if (metadata.formatMagick !== expectedFormatMagick) {
                            throw new InvalidArgumentError(
                                quote`Expected file in ${expectedFormat} format to use ${expectedFormatMagick} magick format but received file with ${metadata.formatMagick} magick format`,
                            );
                        }

                        if (metadata.width === undefined || metadata.height === undefined) {
                            throw new InternalError(
                                "Couldn’t find `width` or `height` of image file",
                            );
                        }

                        return {
                            width:
                                // Respect EXIF orientation metadata. Based on example from `sharp`.
                                // https://sharp.pixelplumbing.com/api-input#metadata
                                metadata.orientation !== undefined && metadata.orientation >= 5
                                    ? metadata.height
                                    : metadata.width,
                            height:
                                // Respect EXIF orientation metadata. Based on example from `sharp`.
                                // https://sharp.pixelplumbing.com/api-input#metadata
                                metadata.orientation !== undefined && metadata.orientation >= 5
                                    ? metadata.width
                                    : metadata.height,
                            scale: 1,
                            hasAlpha: metadata.hasAlpha ?? false,
                        };
                    },
                );

                return metadata;
            } catch (error) {
                // NOTE(calebmer, 2024-11-13): `sharp` is flaky when it comes to returning an
                // error message. Our "can't upload invalid image data" test in
                // `upload_file.test.ts` observes occasional failures where we get the
                // truncated error message "Input buffer has corrupt header: " instead
                // of the full "Input buffer has corrupt header: x2vips: libX error: Improper
                // image header...". So when we detect a truncated error message from
                // `sharp` let's retry the `metadata()` call up to 10 times until we get a real
                // error message.
                //
                // Code in `sharp` where this error message is created:
                // https://github.com/lovell/sharp/blob/1533bf995acda779313fc178d2b9d46791349961/src/common.cc#L417
                if (
                    retryCount <= 10 &&
                    error instanceof Error &&
                    /^Input buffer has corrupt header: *$/.test(error.message)
                ) {
                    await wait(100);
                    continue;
                }

                throw error;
            }
        }
    })();

    const previewPlaceholderPromise = processFileImagePreviewPlaceholder(context, inputPath, {
        contentType,
        contentLength,
    });

    return {
        imagePreviewSizePromise: previewSizePromise,
        imagePreviewPlaceholderPromise: previewPlaceholderPromise,
    };
}
