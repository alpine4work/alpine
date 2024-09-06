import MIMEType from "whatwg-mimetype";
import {Schema} from "~/shared/schema/schema.js";

/**
 * Supported content types for files uploaded to Alpine.
 *
 * A subset of normalized official [MIME types][1]. While mime types are
 * case-insensitive we normalize them to lowercase. If a type has a parameter
 * we omit spaces.
 *
 * If we don't know the type of a file we treat it as
 * `application/octet-stream`. Which represents an unknown binary file. Could
 * be an executable, could be data, we don't know.
 *
 * [1]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/MIME_types
 */
export type FileContentType =
    | "application/octet-stream"
    | FileImageContentType
    | FileDocumentContentType;

// TODO(calebmer, #files): File types to support:
//
// - [x] Images
// - [x] Documents
// - [ ] Videos
// - [ ] Code (optional)
// - [ ] Audio (optional)
//
// A good reference for file types we should support is Canva:
// https://www.canva.com/help/upload-formats-requirements

export type FileImageContentType = FileWebSafeImageContentType | FileWebUnsafeImageContentType;

/**
 * Image types with broad web browser support (Chrome, Firefox, and Safari)
 * that are safe to serve in an `<img>` tag.
 *
 * This list is based on MDN's “[Common image file types][1].”
 *
 * [1]: https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Image_types#common_image_file_types
 */
export type FileWebSafeImageContentType =
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
export type FileWebUnsafeImageContentType =
    | "image/bmp"
    | "image/ico"
    | "image/tiff"
    | "image/heif"
    | "image/heic";

/**
 * Document file types. All documents file types are converted to [PDF
 * (Portable Document Format)][1] a versatile file format created by Adobe.
 * Microsoft Word, Microsoft PowerPoint, and Microsoft Excel files are
 * converted to PDF and displayed as a PDF in Alpine.
 *
 * At its simplest, PDFs are images with multiple pages. However, PDFs are a
 * rich format that may contain much more like text and even interactive form
 * inputs.
 *
 * You can find common MIME types and their file extensions in the MDN article
 * “[Common MIME types][2]”.
 *
 * [1]: https://www.adobe.com/acrobat/about-adobe-pdf.html
 * [2]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/MIME_types/Common_types
 */
export type FileDocumentContentType =
    | FilePdfDocumentContentType
    | FileMicrosoftOfficeDocumentContentType;

export type FilePdfDocumentContentType = "application/pdf";

export type FileMicrosoftOfficeDocumentContentType =
    | "application/msword"
    | "application/vnd.ms-excel"
    | "application/vnd.ms-powerpoint"
    | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    | "application/vnd.openxmlformats-officedocument.presentationml.presentation";

// Preferred extensions must be unique! So we can map back from the preferred
// extension to a `FileContentType`.
const preferredExtensionByFileContentType: {[Key in FileContentType]: string} = {
    "application/octet-stream": "bin",
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
    "application/pdf": "pdf",
    "application/msword": "doc",
    "application/vnd.ms-excel": "xls",
    "application/vnd.ms-powerpoint": "ppt",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
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
