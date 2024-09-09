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
    | FileDocumentContentType
    | FileVideoContentType;

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

/**
 * Video files we support. We support all the same video types as Canva. See
 * [Canva's upload formats][1]. Many common video types do not have good
 * browser support. For example QuickTime (`.mov`) which is Apple's proprietary
 * format (you get it from e.g. a screen recording on a MacOS device) is only
 * supported in Safari. So we need to convert videos in formats browsers don't
 * support to formats browsers will support.
 *
 * MDN's documentation is _very_ helpful when navigating common video formats.
 * Video file types are typically a container format that contains video data
 * represented by some video codec and audio data represented by some audio
 * codec. Useful MDN documentation articles:
 *
 * - [Media container formats][2]
 * - [Web video codec guide][3]
 * - [Web audio codec guide][4]
 *
 * MDN also provides a [recommendation for which video file to use in different
 * scenarios][5]. We follow MDN's "Recommendations for everyday videos" when we
 * need to convert a video file that doesn't have good browser support to one
 * that does. As of 2024-09-06 MDN's recommendation is to use a WebM container
 * using the VP9 video codec and the Opus audio codec. These codecs are royalty
 * free, provide good performance, and are well-supported in recent browsers.
 * AV1 is likely the video format of the future (supported by WebM) but it's
 * [not well supported on iOS or Safari][6] which currently require a hardware
 * decoder.
 *
 * Video format reference:
 *
 * - [QuickTime (MOV)](https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Containers#quicktime)
 *   - Supported common video codecs:
 *     - [MPEG-1](https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Video_codecs#mpeg-1_part_2_video)
 *     - [MPEG-2](https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Video_codecs#mpeg-2_part_2_video)
 *   - Supported common audio codecs:
 *     - [ALAC](https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Audio_codecs#alac_apple_lossless_audio_codec)
 *   - Browser compatibility notes: None of QuickTime's common video codecs or
 *     audio codecs have sufficient browser compatibility. We must convert all
 *     QuickTime files to our standard video format.
 *
 * - [MPEG-4 (MP4)](https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Containers#mpeg-4_mp4)
 *   - Supported common video codecs:
 *     - [AV1](https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Video_codecs#av1)
 *     - [AVC (H.264)](https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Video_codecs#avc_h.264)
 *     - [HEVC (H.265)](https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Video_codecs#hevc_h.265)
 *     - [MP4V-ES](https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Video_codecs#mp4v-es)
 *     - [MPEG-2](https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Video_codecs#mpeg-2_part_2_video)
 *     - [VP9](https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Video_codecs#vp9)
 *   - Supported common audio codecs:
 *     - [AAC](https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Audio_codecs#aac_advanced_audio_coding)
 *     - [ALAC](https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Audio_codecs#alac_apple_lossless_audio_codec)
 *     - [FLAC](https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Audio_codecs#flac_free_lossless_audio_codec)
 *     - [MP3](https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Audio_codecs#mp3_mpeg-1_audio_layer_iii)
 *     - [Opus](https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Audio_codecs#opus)
 *   - Browser compatibility notes:
 *     - AVC (H.264), VP9, FLAC, MP3 (audio codec), and Opus have full browser
 *       compatibility.
 *     - AV1 is partially supported by all major browsers, Safari requires
 *       specific hardware support.
 *     - HEVC (H.265) is supported by all browsers except Firefox. Firefox won't
 *       add support for patent reasons.
 *     - MP4V-ES is only supported by Firefox.
 *     - MPEG-2 and ALAC are only supported by Safari.
 *     - AAC's compatibility is spotty.
 *
 * - [MPEG/MPEG-2](https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Containers#mpegmpeg-2)
 *   - Supported common video codecs:
 *     - [MPEG-1](https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Video_codecs#mpeg-1_part_2_video)
 *     - [MPEG-2](https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Video_codecs#mpeg-2_part_2_video)
 *   - Supported common audio codecs:
 *     - [MP3](https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Audio_codecs#mp3_mpeg-1_audio_layer_iii)
 *   - Browser compatibility notes: None of MPEG's common video codecs have
 *     sufficient browser compatibility. We must convert all MPEG files to our
 *     standard video format.
 *
 * - [Matroska (MKV)](https://en.wikipedia.org/wiki/Matroska)
 *   - MDN doesn't have documentation for the Matroska format. You can see
 *     Matroska's video/audio codec support in Wikipedia's “[Comparison of
 *     video container formats][7]” article. It supports some video codecs with
 *     browser support (e.g. VP9) and some video codecs which don't have broad
 *     browser support (e.g. MPEG-2).
 *
 *     We include support since it's even given we use FFmpeg and Canva
 *     supports it so there must be a reason why it's useful.
 *
 * - [WebM](https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Containers#webm)
 *   - Supported common video codecs:
 *     - [AV1](https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Video_codecs#av1)
 *     - [VP8](https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Video_codecs#vp8)
 *     - [VP9](https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Video_codecs#vp9)
 *   - Supported common audio codecs:
 *     - [Opus](https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Audio_codecs#opus)
 *     - [Vorbis](https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Audio_codecs#vorbis)
 *   - Browser compatibility notes: All video and audio codecs are supported
 *     across all browsers.
 *
 * So of the video formats we support, the following are fully unsafe for web
 * and need to be converted to a web safe format:
 *
 * - QuickTime (MOV)
 * - MPEG/MPEG-2
 * - Matroska (MKV)
 *
 * The following are fully safe for web and can be served as-is:
 *
 * - WebM
 *
 * ...and the following are sometimes safe for web, sometimes unsafe, depends
 * on the video and audio codec used:
 *
 * - MPEG-4 (MP4)
 *
 * [1]: https://www.canva.com/help/upload-formats-requirements
 * [2]: https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Containers
 * [3]: https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Video_codecs
 * [4]: https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Audio_codecs
 * [5]: https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Video_codecs#choosing_a_video_codec
 * [6]: https://caniuse.com/av1
 * [7]: https://en.wikipedia.org/wiki/Comparison_of_video_container_formats
 * [8]: https://caniuse.com/ogg-vorbis
 */
export type FileVideoContentType =
    | FileWebmVideoContentType
    | FileMp4VideoContentType
    | FileWebUnsafeVideoContentType;

export type FileWebmVideoContentType = "video/webm";

export type FileMp4VideoContentType = "video/mp4";

export type FileWebUnsafeVideoContentType = "video/quicktime" | "video/mpeg" | "video/x-matroska";

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
    "video/webm": "webm",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/mpeg": "mpeg",
    "video/x-matroska": "mkv",
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
