import sharp from "sharp";
import {
    DeadlineExceededError,
    ErrorBase,
    InternalError,
    InvalidArgumentError,
    PermissionDeniedError,
    UnknownError,
} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {FileImageContentType} from "~/shared/files/file_content_type.js";
import {FileImagePreviewPlaceholder} from "~/shared/files/file_image_preview_placeholder.js";
import {
    maxFilePreviewAspectRatio,
    minFilePreviewAspectRatio,
} from "~/shared/files/min_and_max_file_preview_aspect_ratio.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isObject} from "~/shared/helpers/object/is_object.js";
import {quote} from "~/shared/helpers/string/quote.js";

export const sharpTimeoutSeconds = 20;

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
    input: Buffer | ArrayBuffer | Uint8Array,
    options?: sharp.SharpOptions,
): Promise<FileImagePreviewPlaceholder> {
    // A placeholder of size 5 generates at most 60 pixels (if width is 5, then max
    // height is `round(5 / minFilePreviewAspectRatio)` which equals 12 as of
    // 2024-10-04).
    //
    // A pixel is 3 or 4 bytes depending on whether there's an alpha channel. So
    // the max number of bytes in a placeholder is 240 bytes.
    const placeholderSize = 5;

    const {
        data: outputData,
        info: {channels, width, height},
    } = await sharp(input, {
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
        .resize(placeholderSize, placeholderSize, {fit: "outside"})
        .toFormat("png")
        .modulate({brightness: 1, saturation: 1.2})
        .raw()
        .toBuffer({resolveWithObject: true})
        .catch(rethrowClassifiedSharpError);

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
    contentType: Exclude<FileImageContentType, "image/ico">,
    dataPromise: Promise<Buffer>,
) {
    const previewSizePromise = (async () => {
        const data = await dataPromise;

        const metadata = await sharp(data, {pages: 1})
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
            throw new InternalError('Couldn\'t find "width" or "height" of image file');
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
    })();

    const previewPlaceholderPromise = (async () => {
        const inputData = await dataPromise;
        return processFileImagePreviewPlaceholder(inputData);
    })();

    return {
        imagePreviewSizePromise: previewSizePromise,
        imagePreviewPlaceholderPromise: previewPlaceholderPromise,
    };
}

export function rethrowClassifiedSharpError(error: unknown): never {
    throw classifySharpError(error);
}

export const pdfPasswordRequiredErrorDisplayMessage = errorDisplayMessage`A password is required to open this file. Try downloading the file and opening it in a PDF reader that supports password protected files.`;

export function classifySharpError(error: unknown): ErrorBase {
    if (!isObject(error) || typeof error.message !== "string") {
        return classifySharpError({message: String(error)});
    }

    // If our timeout was exceeded while processing the file. See:
    // https://sharp.pixelplumbing.com/api-output#timeout
    if (error.message.includes("timeout")) {
        return new DeadlineExceededError(formatSharpErrorMessage(error.message));
    }

    // Kinda hacky, but treat any error from `sharp` that refers to an "input" or
    // an "image" as a user error not a system error.
    //
    // e.g. This error:
    // https://github.com/lovell/sharp/blob/fc32e0bd3f9111b80cf078df7b0cfc355695674e/src/common.cc#L413
    if (/(input|image)/i.test(error.message)) {
        if (error.message.includes("pdf") && error.message.includes("password required")) {
            return new PermissionDeniedError(formatSharpErrorMessage(error.message), {
                displayMessage: pdfPasswordRequiredErrorDisplayMessage,
            });
        } else {
            return new InvalidArgumentError(formatSharpErrorMessage(error.message));
        }
    }

    // Unclassified `sharp` error. We've observed that errors from `sharp` often
    // don't use the JavaScript error subclass! So make sure to create an error
    // object.
    return new UnknownError(formatSharpErrorMessage(error.message));
}

function formatSharpErrorMessage(message: string): string {
    return (
        message
            // Security through obscurity: Don't disclose that we use GraphicsMagick in
            // error messages so attackers don't know to try GraphicsMagick exploits. We
            // use GraphicsMagick instead of ImageMagick which has fewer CVEs but since
            // the attack surface is still broad we think it's worth not clearly disclosing
            // the library we use. Replace "magick" with "x".
            .replaceAll(/magick/gi, substring =>
                substring[0]! === substring[0]!.toLowerCase() ? "x" : "X",
            )
    );
}
