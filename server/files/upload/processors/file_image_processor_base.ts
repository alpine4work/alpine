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
    // A placeholder of size 5 generates 25 pixels and is encoded to <700 bytes.
    const placeholderSize = 5;

    const {
        data: outputData,
        info: {channels, width},
    } = await sharp(input, {...options, pages: 1})
        .timeout({seconds: sharpTimeoutSeconds})
        .resize(placeholderSize, placeholderSize, {fit: "inside"})
        .toFormat("png")
        .modulate({brightness: 1, saturation: 1.2})
        .raw()
        .toBuffer({resolveWithObject: true})
        .catch(rethrowClassifiedSharpError);

    assert(channels === 3 || channels === 4);

    return FileImagePreviewPlaceholder.fromSerialized([channels === 4, width, outputData]);
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
            width: metadata.width,
            height: metadata.height,
            scale: 1,
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

export const pdfPasswordRequiredErrorDisplayMessage = errorDisplayMessage`A password is required to read this file. Try opening the file in a PDF reader that supports password protected files.`;

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
