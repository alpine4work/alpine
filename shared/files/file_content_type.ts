import MIMEType from "whatwg-mimetype";
import {Schema} from "~/shared/schema/schema.js";

/**
 * Supported content types for files uploaded to Alpine.
 *
 * A subset of normalized official [MIME types][1]. While mime types are
 * case-insensitive we normalize them to lowercase. If a type has a parameter
 * we omit spaces.
 *
 * [1]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/MIME_types
 */
export type FileContentType = ImageFileContentType;

export type ImageFileContentType = WebSafeImageFileContentType | WebUnsafeImageFileContentType;

/**
 * Image types with broad web browser support (Chrome, Firefox, and Safari)
 * that are safe to serve in an `<img>` tag.
 *
 * This list is based on MDN's “[Common image file types][1].”
 *
 * [1]: https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Image_types#common_image_file_types
 */
export type WebSafeImageFileContentType =
    | "image/apng"
    | "image/avif"
    | "image/gif"
    | "image/jpeg"
    | "image/png"
    | "image/svg+xml"
    | "image/webp";

/**
 * Somewhat popular image types that don't have broad web browser support. We
 * need to convert these images into a format with better web browser support.
 *
 * This list is based on MDN's “[Common image file types][1].” We include
 * `.heif` and `.heic` since [`.heic` is Apple's default image file format][2].
 *
 * [1]: https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Image_types#common_image_file_types
 * [2]: https://www.adobe.com/creativecloud/file-types/image/raster/heic-file.html
 */
export type WebUnsafeImageFileContentType =
    | "image/bmp"
    | "image/ico"
    | "image/tiff"
    | "image/heif"
    | "image/heic";

// Preferred extensions must be unique! So we can map back from the preferred
// extension to a `FileContentType`.
const preferredExtensionByFileContentType: {[Key in FileContentType]: string} = {
    "image/apng": "apng",
    "image/avif": "avif",
    "image/gif": "gif",
    "image/jpeg": "jpeg",
    "image/png": "png",
    "image/svg+xml": "svg",
    "image/webp": "webp",
    "image/bmp": "bmp",
    "image/ico": "ico",
    "image/tiff": "tiff",
    "image/heif": "heif",
    "image/heic": "heic",
};

/**
 * A set of all our `FileContentType`s.
 */
export const fileContentTypes = new Set(
    Object.keys(preferredExtensionByFileContentType),
) as ReadonlySet<FileContentType>;

export const FileContentTypeSchema = Schema.enum(fileContentTypes);

/**
 * Is the provided string a `FileContentType`?
 */
export function isFileContentType(contentType: string): contentType is FileContentType {
    return fileContentTypes.has(contentType as any);
}

/**
 * Normalize content type to a canonical representation.
 */
export function normalizeContentType(contentType: string): string {
    const parsedContentType = new MIMEType(contentType);

    // `charset` is case insensitive so normalize it to lower case. Source:
    // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Type#directives
    const charsetParameter = parsedContentType.parameters.get("charset");
    if (charsetParameter !== undefined) {
        parsedContentType.parameters.set("charset", charsetParameter.toLowerCase());
    }

    return parsedContentType.toString();
}

/**
 * Get the preferred file extension for some `FileContentType`. We'll save
 * files of this type with that extension. Web browsers use MIME types to
 * determine the type of a file but OSes use file extensions to determine the
 * type of a file. So including a file extension on saved files helps the OS
 * render the file correctly.
 */
export function getFileContentTypePreferredExtension(contentType: FileContentType) {
    return preferredExtensionByFileContentType[contentType];
}
