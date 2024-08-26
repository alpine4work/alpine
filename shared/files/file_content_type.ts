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

// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
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
 * This list is based on MDN's “[Common image file types][1].”
 *
 * [1]: https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Image_types#common_image_file_types
 */
// TODO(calebmer, #files): "image/bmp" | "image/ico" | "image/tiff"
export type WebUnsafeImageFileContentType = never;

const fileContentTypesMap: {[Key in FileContentType]: true} = {
    "image/apng": true,
    "image/avif": true,
    "image/gif": true,
    "image/jpeg": true,
    "image/png": true,
    "image/svg+xml": true,
    "image/webp": true,
};

/**
 * A set of all our `FileContentType`s.
 */
export const fileContentTypes = new Set(
    Object.keys(fileContentTypesMap),
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
