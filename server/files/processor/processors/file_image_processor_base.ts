import sharp from "sharp";
import {FileProcessorActionContext} from "~/server/files/data/file_processor_context.js";
import {rethrowClassifiedSharpError} from "~/server/files/processor/sharp/rethrow_classified_sharp_error.js";
import {sharpTimeoutSeconds} from "~/server/files/processor/sharp/sharp_timeout_seconds.js";
import {getFileContentTypeName} from "~/shared/content/code/get_file_content_type_name.js";
import {InternalError, InvalidArgumentError} from "~/shared/error/error.open_source.js";
import {
    FileContentType,
    FileImageContentType,
} from "~/shared/files/file_content_type.open_source.js";
import {
    FileImagePreviewPlaceholder,
    fileImagePreviewPlaceholderBaseSize,
} from "~/shared/files/file_image_preview_placeholder.js";
import {FileImagePreviewSize} from "~/shared/files/file_preview.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {quote} from "~/shared/helpers/string/quote.open_source.js";

/**
 * Generate a placeholder image which we'll render before the browser has
 * downloaded the full image. The code below is derived from the
 * [`plaiceholder`][1] project. We don't use `plaiceholder` directly since it's
 * fundamentally pretty simple and the implementation is inefficient. (It
 * unconditionally generates a color and `base64` placeholder.)
 *
 * [1]:
 *     https://github.com/joe-bell/plaiceholder/blob/36d4518301c6512957c63977133f6224f491c7f2/packages/plaiceholder/src/index.ts#L219-L334
 */
export async function processFileImagePreviewPlaceholder(
    context: FileProcessorActionContext,
    input: string | Buffer | ArrayBuffer | Uint8Array | Uint8ClampedArray,
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
        info: {channels, width},
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
                    // We've found our test for `py_pdf_sample_libreoffice_write_password.pdf` is flaky
                    // if this is `failOn: "warning"` (the default) since sharp occasionally doesn't
                    // include "pdfload: password required" in the error message.
                    //
                    // We suspect that there's a race condition in libvips between some process trying
                    // to read encrypted PDF data and the process which determines the PDF is
                    // encrypted. If the process trying to read encrypted PDF data runs first it logs a
                    // warning. This behavior is reasonable from libvips, we just need to make sure we
                    // don't prematurely fail on warning.
                    failOn: "error",
                })
                    .timeout({seconds: sharpTimeoutSeconds})
                    // Rotate so that we respect EXIF orientation metadata.
                    .rotate()
                    // This method of placeholder generation gives more detail (pixels) to images
                    // further away from the aspect ratio 1:1. Ideally we'd have about the same number
                    // of pixels no matter the aspect ratio. Unfortunately, at this point we don't know
                    // the image's dimensions.
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

    return FileImagePreviewPlaceholder.fromSerialized([
        channels === 4,
        width,
        // TODO(calebmer, #typescript-5.9.2): Discovered after TS version upgrade, not
        // fixing for now.
        // @ts-expect-error
        outputData,
    ]);
}

export function processImageFile(
    context: FileProcessorActionContext,
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
                                "Couldn\u2019t find `width` or `height` of image file",
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
                // NOTE(calebmer, 2024-11-13): `sharp` is flaky when it comes to returning an error
                // message. Our "can't upload invalid image data" test in `upload_file.test.ts`
                // observes occasional failures where we get a truncated error message such as
                // "Input buffer has corrupt header: " or "Input file has corrupt header: " instead
                // of the full "Input buffer has corrupt header: x2vips: libX error: Improper image
                // header...". So when we detect a truncated error message from `sharp` let's retry
                // the `metadata()` call up to 10 times until we get a real error message.
                //
                // Code in `sharp` where this error message is created:
                // https://github.com/lovell/sharp/blob/1533bf995acda779313fc178d2b9d46791349961/src/common.cc#L417
                if (
                    retryCount <= 10 &&
                    error instanceof Error &&
                    /^Input (?:buffer|file) has corrupt header: *$/.test(error.message)
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
