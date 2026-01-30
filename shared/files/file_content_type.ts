import MIMEType from "whatwg-mimetype";
import {assert} from "~/shared/helpers/control/assert.js";
import {getObjectEntriesWithKeyofType} from "~/shared/helpers/object/get_object_entries_with_keyof_type.js";
import {getObjectKeysWithKeyofType} from "~/shared/helpers/object/get_object_keys_with_keyof_type.js";
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
    | FileVideoContentType
    | FileAudioContentType
    | FileCodeContentType;

export type FileImageContentType = FileWebSafeImageContentType | FileWebUnsafeImageContentType;

/**
 * Image types with broad web browser support (Chrome, Firefox, and Safari)
 * that are safe to serve in an `<img>` tag.
 *
 * This list is based on MDN's "[Common image file types][1]."
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
 * This list is based on MDN's "[Common image file types][1]." We include
 * `.heif` and `.heic` since [`.heic` is Apple's default image file format][2].
 * We consider `image/heif` and `image/heic` to be the same format. They're
 * registered with the same specification in the [IANA media types
 * database][3].
 *
 * [1]: https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Image_types#common_image_file_types
 * [2]: https://www.adobe.com/creativecloud/file-types/image/raster/heic-file.html
 * [3]: https://www.iana.org/assignments/media-types/media-types.xhtml
 */
export type FileWebUnsafeImageContentType = "image/bmp" | "image/ico" | "image/tiff" | "image/heif";

const fileImageContentTypes: {
    [Key in FileImageContentType]: Key extends FileWebSafeImageContentType ? true : false;
} = {
    "image/apng": true,
    "image/avif": true,
    "image/gif": true,
    "image/jpeg": true,
    "image/png": true,
    "image/svg+xml": true,
    "image/webp": true,
    "image/bmp": false,
    "image/ico": false,
    "image/tiff": false,
    "image/heif": false,
};

export function isFileImageContentType(contentType: string): contentType is FileImageContentType {
    return contentType in fileImageContentTypes;
}

export function isFileWebSafeImageContentType(
    contentType: string,
): contentType is FileWebSafeImageContentType {
    return isFileImageContentType(contentType) && fileImageContentTypes[contentType];
}

export function getFileImageContentTypes(): ReadonlyArray<FileImageContentType> {
    return getObjectKeysWithKeyofType(fileImageContentTypes);
}

export const FileImageContentTypeSchema = Schema.enum(getFileImageContentTypes());

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
 * "[Common MIME types][2]".
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

const fileMicrosoftOfficeDocumentContentTypes: {
    [Key in FileMicrosoftOfficeDocumentContentType]: true;
} = {
    "application/msword": true,
    "application/vnd.ms-excel": true,
    "application/vnd.ms-powerpoint": true,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": true,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": true,
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": true,
};
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
 *     - AAC, AVC (H.264), VP9, FLAC, MP3 (audio codec), and Opus have full
 *       browser compatibility.
 *     - AV1 is partially supported by all major browsers, Safari requires
 *       specific hardware support.
 *     - HEVC (H.265) is supported by all browsers except Firefox. Firefox won't
 *       add support for patent reasons.
 *     - MP4V-ES is only supported by Firefox.
 *     - MPEG-2 and ALAC are only supported by Safari.
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
 *     Matroska's video/audio codec support in Wikipedia's "[Comparison of
 *     video container formats][7]" article. It supports some video codecs with
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

const fileVideoContentTypes: {
    [Key in FileVideoContentType]: true;
} = {
    "video/webm": true,
    "video/mp4": true,
    "video/quicktime": true,
    "video/mpeg": true,
    "video/x-matroska": true,
};

export function isFileVideoContentType(
    contentType: FileContentType,
): contentType is FileVideoContentType {
    return contentType in fileVideoContentTypes;
}

export function getFileMicrosoftOfficeContentTypes(): ReadonlyArray<FileMicrosoftOfficeDocumentContentType> {
    return getObjectKeysWithKeyofType(fileMicrosoftOfficeDocumentContentTypes);
}

export function getFileVideoContentTypes(): ReadonlyArray<FileVideoContentType> {
    return getObjectKeysWithKeyofType(fileVideoContentTypes);
}

/**
 * Audio files we support. We support all the same video types as Canva. See
 * [Canva's upload formats][1]. Like video, audio container format and codec
 * support can be spotty across browsers. However, audio codecs have much
 * better browser compatibility in general than video codecs. The following is
 * a survey of the audio container files and their codecs's browser
 * compatibility notes based on MDN's "[Web audio codec guide][2]" and
 * [caniuse][3] for up-to-date browser compatibility information.
 *
 * - MP4 (aka M4A, MP4 is also a video container file format)
 *   - [AAC (Advanced Audio Coding)](https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Audio_codecs#aac_advanced_audio_coding)
 *     - Full browser compatibility. Firefox depends on native platform support
 *       which is fine for us to consider this codec web safe
 *   - [ALAC (Apple Lossless Audio Codec)](https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Audio_codecs#alac_apple_lossless_audio_codec)
 *     - Only supported by Safari
 *   - [FLAC (Free Lossless Audio Codec)](https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Audio_codecs#flac_free_lossless_audio_codec)
 *     - Full browser compatibility
 *   - [MP3 (MPEG-1 Audio Layer III)](https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Audio_codecs#mp3_mpeg-1_audio_layer_iii)
 *     - Full browser compatibility
 *   - [Opus](https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Audio_codecs#opus)
 *     - Partial browser compatibility. [According to caniuse](https://caniuse.com/opus)
 *       Opus is only supported in `.webm` containers in Safari
 *
 * - MP3
 *   - Technically MP3 is an audio codec not a container format. MP3 audio
 *     stored in an MPEG container with no video track is referred to as an MP3
 *     file.
 *   - Full browser compatibility.
 *
 * - [OGG](https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Containers#ogg)
 *   - [FLAC (Free Lossless Audio Codec)](https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Audio_codecs#flac_free_lossless_audio_codec)
 *     - Full browser compatibility
 *   - [Opus](https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Audio_codecs#opus)
 *     - Partial browser compatibility. [According to caniuse](https://caniuse.com/opus)
 *       Opus is only supported in `.webm` containers in Safari
 *   - [Vorbis](https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Audio_codecs#vorbis)
 *     - Partial browser compatibility. [According to caniuse](https://caniuse.com/ogg-vorbis)
 *       Vorbis is supported but not in an OGG container.
 *
 * - [WAV](https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Containers)
 *   - Uncompressed lossless audio format. While WAV files technically support
 *     many audio codecs basically all files use linear PCM.
 *   - Full browser compatibility [according to caniuse](https://caniuse.com/wav).
 *     Unclear if caniuse is considering all codecs supported by WAV files or
 *     not. We'll also assume basically all WAV files use PCM.
 *
 * - [WebM](https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Containers#webm)
 *   - [Opus](https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Audio_codecs#opus)
 *     - Full browser compatibility. [According to caniuse](https://caniuse.com/opus)
 *       Opus is only supported in `.webm` containers in Safari
 *   - [Vorbis](https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Audio_codecs#vorbis)
 *     - Full browser compatibility. [According to caniuse](https://caniuse.com/ogg-vorbis)
 *       Vorbis is supported but not in an OGG container.
 *
 * So of the video formats we support, the following are fully unsafe for web
 * and need to be converted to a web safe format:
 *
 * - OGG
 *
 * The following are fully safe for web and can be served as-is:
 *
 * - MP3
 * - WAV
 * - WebM
 *
 * ...and the following are sometimes safe for web, sometimes unsafe, depends
 * on the video and audio codec used:
 *
 * - MP4 (aka M4A)
 *
 * [1]: https://www.canva.com/help/upload-formats-requirements
 * [2]: https://developer.mozilla.org/en-US/docs/Web/Media/Formats/Audio_codecs
 * [3]: https://caniuse.com
 */
export type FileAudioContentType =
    | FileWebSafeAudioContentType
    | FileWebUnsafeAudioContentType
    | FileMp4AudioContentType;

export type FileWebSafeAudioContentType = "audio/mpeg" | "audio/wav" | "audio/webm";

export type FileMp4AudioContentType = "audio/mp4";

export type FileWebUnsafeAudioContentType = "audio/ogg";

const fileAudioContentTypes: {
    [Key in FileAudioContentType]: Key extends FileWebSafeAudioContentType ? true : false;
} = {
    "audio/mpeg": true,
    "audio/wav": true,
    "audio/webm": true,
    "audio/mp4": false,
    "audio/ogg": false,
};

export function isFileAudioContentType(
    contentType: FileContentType,
): contentType is FileAudioContentType {
    return contentType in fileAudioContentTypes;
}

export function isFileWebSafeAudioContentType(
    contentType: FileContentType,
): contentType is FileWebSafeAudioContentType {
    return isFileAudioContentType(contentType) && fileAudioContentTypes[contentType];
}

export function getFileAudioContentTypes(): ReadonlyArray<FileAudioContentType> {
    return getObjectKeysWithKeyofType(fileAudioContentTypes);
}

/**
 * Content types representing code. Code files are considered to be text based
 * and rendered with a UTF-8 character encoding.
 */
export type FileCodeContentType =
    (typeof fileContentTypeByCodeBlockLanguageId)[keyof typeof fileContentTypeByCodeBlockLanguageId];

/**
 * Content type for each of the programming languages we support in
 * `CodeBlockLanguageId`. If you upload a file from one of the programming
 * languages we support you can view the file with syntax highlighting in
 * Alpine.
 *
 * To find the MIME type for a programming language we go through the following
 * list. We use the MIME type from the first source to contain a MIME type for
 * the programming language.
 *
 * 1. [MDN's common MIME types documentation][1]
 * 2. [IANA's media types database][2]
 * 3. The MIME type database from [Debian's `mime-support` package][3]
 * 4. The MIME type database from [XDG's `shared-mime-info` package][4]
 *
 * We've found `shared-mime-info` (source 4) the most comprehensive source but
 * consider MDN (source 1) and IANA (source 2) are more authoritative.
 *
 * If we can't find a language's mime type in any of these sources then we use
 * the mime type `text/x-${languageId}`. We can't find a mime type for
 * `typescript`, `swift`, `r`, `solidity`.
 *
 * To prevent a cyclic dependency, `shared/files` doesn't depend on
 * `shared/content`. Instead `shared/content` depends on `shared/files`
 * and asserts that every value in the `CodeBlockLanguageId` enum has a
 * content type.
 *
 * [1]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/MIME_types/Common_types
 * [2]: https://www.iana.org/assignments/media-types/media-types.xhtml
 * [3]: https://sources.debian.org/src/mime-support/3.62/mime.types/
 * [4]: https://gitlab.freedesktop.org/xdg/shared-mime-info/-/blob/master/data/freedesktop.org.xml.in
 */
export const fileContentTypeByCodeBlockLanguageId = {
    text: "text/plain",
    javascript: "text/javascript",
    html: "text/html",
    css: "text/css",
    sql: "application/sql",
    python: "text/x-python",
    typescript: "text/x-typescript",
    shell: "application/x-sh",
    java: "text/x-java",
    json: "application/json",
    markdown: "text/markdown",
    csharp: "text/x-csharp",
    cpp: "text/x-c++src",
    c: "text/x-csrc",
    php: "application/x-httpd-php",
    go: "text/x-go",
    yaml: "application/yaml",
    powershell: "application/x-powershell",
    rust: "text/rust",
    kotlin: "text/x-kotlin",
    ruby: "application/x-ruby",
    lua: "text/x-lua",
    xml: "application/xml",
    dart: "application/vnd.dart",
    swift: "text/x-swift",
    assembly: "text/x-asm",
    webassembly: "application/wasm",
    scala: "text/x-scala",
    r: "text/x-r",
    elixir: "text/x-elixir",
    objectivec: "text/x-objcsrc",
    perl: "text/x-perl",
    haskell: "text/x-haskell",
    solidity: "text/x-solidity",
    clojure: "text/x-clojure",
    erlang: "text/x-erlang",
    ocaml: "text/x-ocaml",
} as const;

export function isFileCodeContentType(
    contentType: FileContentType,
): contentType is FileCodeContentType {
    return !!getFileContentTypeContentCodeBlockLanguageIdIfExists(contentType);
}

let codeBlockLanguageIdByFileContentType: Map<
    FileContentType,
    keyof typeof fileContentTypeByCodeBlockLanguageId
> | null = null;

export function getFileContentTypeContentCodeBlockLanguageIdIfExists(
    contentType: FileContentType,
): keyof typeof fileContentTypeByCodeBlockLanguageId | null {
    codeBlockLanguageIdByFileContentType ??= new Map(
        getObjectEntriesWithKeyofType(fileContentTypeByCodeBlockLanguageId).map(
            ([languageId, contentType]): [
                FileContentType,
                keyof typeof fileContentTypeByCodeBlockLanguageId,
            ] => [contentType, languageId],
        ),
    );
    return codeBlockLanguageIdByFileContentType.get(contentType) ?? null;
}

export function getFileContentTypeContentCodeBlockLanguageId(
    contentType: FileCodeContentType,
): keyof typeof fileContentTypeByCodeBlockLanguageId {
    return getFileContentTypeContentCodeBlockLanguageIdIfExists(contentType)!;
}

export function getContentCodeBlockLanguageIdFileContentType(
    languageId: keyof typeof fileContentTypeByCodeBlockLanguageId,
): FileCodeContentType {
    return fileContentTypeByCodeBlockLanguageId[languageId];
}

// Preferred extensions must be unique! So we can map back from the preferred
// extension to a `FileContentType`.
const filePreferredExtensionByContentType: {[Key in FileContentType]: string} = {
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
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/webm": "weba",
    "audio/ogg": "oga",
    "audio/mp4": "m4a",
    "text/plain": "txt",
    "text/javascript": "js",
    "text/html": "html",
    "text/css": "css",
    "application/sql": "sql",
    "text/x-python": "py",
    "text/x-typescript": "ts",
    "application/x-sh": "sh",
    "text/x-java": "java",
    "application/json": "json",
    "text/markdown": "md",
    "text/x-csharp": "cs",
    "text/x-c++src": "cpp",
    "text/x-csrc": "c",
    "application/x-httpd-php": "php",
    "text/x-go": "go",
    "application/yaml": "yaml",
    "application/x-powershell": "ps1",
    "text/rust": "rs",
    "text/x-kotlin": "kt",
    "application/x-ruby": "rb",
    "text/x-lua": "lua",
    "application/xml": "xml",
    "application/vnd.dart": "dart",
    "text/x-swift": "swift",
    "text/x-asm": "asm",
    "application/wasm": "wasm",
    "text/x-scala": "scala",
    "text/x-r": "r",
    "text/x-elixir": "ex",
    "text/x-objcsrc": "m",
    "text/x-perl": "pl",
    "text/x-haskell": "hs",
    "text/x-solidity": "sol",
    "text/x-clojure": "clj",
    "text/x-erlang": "erl",
    "text/x-ocaml": "ml",
};

/**
 * A set of all our `FileContentType`s.
 */
export const fileContentTypes: ReadonlySet<FileContentType> = new Set(
    getObjectKeysWithKeyofType(filePreferredExtensionByContentType),
);

export const FileContentTypeSchema = Schema.enum(fileContentTypes);

/**
 * Is the provided string a `FileContentType`?
 */
export function isFileContentType(contentType: string): contentType is FileContentType {
    return fileContentTypes.has(contentType as any);
}

function normalizeParsedContentType(contentType: string): MIMEType {
    const parsedContentType = new MIMEType(contentType);

    // `charset` is case insensitive so normalize it to lower case. Source:
    // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Type#directives
    const charsetParameter = parsedContentType.parameters.get("charset");
    if (charsetParameter !== undefined) {
        parsedContentType.parameters.set("charset", charsetParameter.toLowerCase());
    }

    return parsedContentType;
}

/**
 * Normalize content type to a normalized representation. Case insensitive
 * parts are lowercased and unnecessary spacing is removed.
 */
export function normalizeContentType(contentType: string): string {
    return normalizeParsedContentType(contentType).toString();
}

/**
 * Take any mime type and canonicalize it to a `FileContentType` supported by
 * our application if we have a `FileContentType` that matches the provided
 * mime type. Removes any letter casing differences, useless parameters, and
 * maps additional content types to their canonical representation.
 */
export function canonicalizeFileContentTypeIfExists(contentType: string): FileContentType | null {
    const parsedContentType = normalizeParsedContentType(contentType);

    // Try to find the canonical `FileContentType` using parameters.
    //
    // First we check if the content type itself is a `FileContentType` and then we
    // check additional content types for a match.
    {
        const normalizedContentType = parsedContentType.toString();
        if (isFileContentType(normalizedContentType)) return normalizedContentType;

        const canonicalContentType =
            getFileCanonicalContentTypeByAdditionalContentType().get(normalizedContentType);
        if (canonicalContentType !== undefined) return canonicalContentType;
    }

    parsedContentType.parameters.clear();

    // Try to find the canonical `FileContentType` without parameters.
    //
    // First we check if the content type itself is a `FileContentType` and then we
    // check additional content types for a match.
    {
        const normalizedContentType = parsedContentType.toString();
        if (isFileContentType(normalizedContentType)) return normalizedContentType;

        const canonicalContentType =
            getFileCanonicalContentTypeByAdditionalContentType().get(normalizedContentType);
        if (canonicalContentType !== undefined) return canonicalContentType;
    }

    return null;
}

/**
 * Get the `FileContentType` for the provided path just based on the file's
 * extension.
 */
export function getPathFileContentTypeIfExists(path: string): FileContentType | null {
    const extensionMatch = path.match(/\.([a-zA-Z0-9]+)$/);
    const extension = extensionMatch?.[1]?.toLowerCase();
    if (!extension) return null;
    return getFileContentTypeByExtension().get(extension) ?? null;
}

/**
 * Get the preferred file extension for some `FileContentType`. We'll save
 * files of this type with that extension. Web browsers use MIME types to
 * determine the type of a file but OSes use file extensions to determine the
 * type of a file. So including a file extension on saved files helps the OS
 * render the file correctly.
 */
export function getFileContentTypePreferredExtension(contentType: FileContentType) {
    return filePreferredExtensionByContentType[contentType];
}

/**
 * Frequently, there are multiple different MIME types or file extensions that
 * represent the same underlying file. For example in the [IANA media type
 * database][1] `image/heif` and `image/heic` correspond to the same
 * specification. This object defines a mapping between canonical
 * `FileContentType`s and additional MIME types or file extensions that
 * represent the file.
 *
 * Functions like `canonicalizeFileContentTypeIfExists()` query this database
 * to determine whether a content type matches our canonical content types.
 *
 * This database was constructed from the [Shared MIME Info][2] package. This
 * package is used by GLib (a core dependency of many C programs) among others.
 * Shared MIME Info's data lives in [`data/freedesktop.org.xml.in`][3]. We
 * started by looking up all our content types in this file and added any
 * aliases or extensions defined in this file.
 *
 * We're free to extend this object beyond what's in the Shared MIME Info
 * package as needed.
 *
 * [1]: https://www.iana.org/assignments/media-types/media-types.xhtml
 * [2]: https://gitlab.freedesktop.org/xdg/shared-mime-info/-/tree/master
 * [3]: https://gitlab.freedesktop.org/xdg/shared-mime-info/-/blob/815b520eb01992a05d41a5434f1227a8be101e15/data/freedesktop.org.xml.in
 */
export const fileAdditionalContentTypesAndExtensionsByContentType: {
    readonly [Key in FileContentType]?: {
        readonly contentTypes?: ReadonlyArray<string>;
        readonly extensions?: ReadonlyArray<string>;
    };
} = {
    "image/apng": {
        contentTypes: ["image/vnd.mozilla.apng"],
    },
    "image/avif": {
        contentTypes: ["image/avif-sequence"],
        extensions: ["avifs"],
    },
    "image/jpeg": {
        contentTypes: ["image/pjpeg"],
        extensions: ["jpg", "jpe", "jfif"],
    },
    "image/bmp": {
        contentTypes: ["image/x-bmp", "image/x-ms-bmp"],
        extensions: ["dib"],
    },
    "image/tiff": {
        extensions: ["tif"],
    },
    "image/ico": {
        contentTypes: [
            "image/vnd.microsoft.icon",
            "application/ico",
            "image/icon",
            "image/x-ico",
            "image/x-icon",
            "text/ico",
        ],
    },
    "image/heif": {
        contentTypes: ["image/heic", "image/heif-sequence", "image/heic-sequence"],
        extensions: ["heic", "hif"],
    },
    "application/pdf": {
        contentTypes: [
            "application/x-pdf",
            "image/pdf",
            "application/acrobat",
            "application/nappdf",
        ],
    },
    "application/msword": {
        contentTypes: [
            "application/vnd.ms-word",
            "application/x-msword",
            "zz-application/zz-winassoc-doc",
        ],
    },
    "application/vnd.ms-excel": {
        contentTypes: [
            "application/msexcel",
            "application/x-msexcel",
            "zz-application/zz-winassoc-xls",
        ],
        extensions: ["xlc", "xll", "xlm", "xlw", "xla", "xlt", "xld"],
    },
    "application/vnd.ms-powerpoint": {
        contentTypes: [
            "application/powerpoint",
            "application/mspowerpoint",
            "application/x-mspowerpoint",
        ],
        extensions: ["ppz", "pps", "pot"],
    },
    "video/mp4": {
        contentTypes: ["video/x-m4v"],
        extensions: ["m4v", "f4v", "lrv"],
    },
    "video/mpeg": {
        contentTypes: ["video/x-mpeg", "video/mpeg-system", "video/x-mpeg-system", "video/x-mpeg2"],
        extensions: ["mpg", "mp2", "mpe", "vob"],
    },
    "video/quicktime": {
        extensions: ["qt", "moov", "qtvr"],
    },
    "audio/mpeg": {
        contentTypes: ["audio/x-mp3", "audio/x-mpg", "audio/x-mpeg", "audio/mp3"],
        extensions: ["mpga"],
    },
    "audio/wav": {
        contentTypes: ["audio/vnd.wave", "audio/x-wav"],
    },
    "audio/ogg": {
        contentTypes: ["audio/x-ogg"],
        extensions: ["ogg", "opus"],
    },
    "audio/mp4": {
        contentTypes: ["audio/x-m4a", "audio/m4a"],
        extensions: ["f4a"],
    },
    "text/javascript": {
        contentTypes: [
            "application/x-javascript",
            "application/javascript",
            "text/jscript",
            "application/ecmascript",
            "text/ecmascript",
        ],
        extensions: ["jsm", "mjs", "cjs", "jsx", "es"],
    },
    "text/html": {
        extensions: ["htm"],
    },
    "application/sql": {
        contentTypes: ["text/x-sql"],
    },
    "text/x-python": {
        extensions: ["wsgi"],
    },
    "text/x-typescript": {
        extensions: ["mts", "cts", "tsx"],
    },
    "application/x-sh": {
        contentTypes: ["application/x-shellscript", "text/x-sh"],
    },
    "text/markdown": {
        contentTypes: ["text/x-markdown"],
        extensions: ["mkd", "markdown"],
    },
    "text/x-c++src": {
        contentTypes: ["text/x-c++hdr"],
        extensions: ["cxx", "cc", "c++", "hh", "hp", "hpp", "h++", "hxx"],
    },
    "text/x-csrc": {
        contentTypes: ["text/x-c"],
        extensions: ["h"],
    },
    "application/x-httpd-php": {
        contentTypes: ["application/php"],
        extensions: ["php3", "php4", "php5", "phps"],
    },
    "application/yaml": {
        contentTypes: ["text/yaml", "text/x-yaml"],
        extensions: ["yml"],
    },
    "text/rust": {
        contentTypes: ["text/x-rust"],
    },
    "application/xml": {
        contentTypes: ["text/xml"],
        extensions: ["xbl", "xsd", "rng"],
    },
    "application/vnd.dart": {
        contentTypes: ["text/x-dart"],
    },
    "text/x-asm": {
        extensions: ["s"],
    },
    "text/x-scala": {
        extensions: ["sc"],
    },
    "text/x-elixir": {
        extensions: ["exs"],
    },
    "text/x-objcsrc": {
        contentTypes: ["text/x-objc++src"],
        extensions: ["mm"],
    },
    "text/x-perl": {
        contentTypes: ["application/perl"],
        extensions: ["pm", "al", "perl", "pod", "t"],
    },
    "text/x-clojure": {
        // From: https://en.wikipedia.org/wiki/Clojure
        extensions: ["cljs", "cljr", "cljc", "cljd", "edn"],
    },
    "text/x-ocaml": {
        extensions: ["mli"],
    },
};

export function getFileAdditionalContentTypesAndExtensionsByContentTypeForTest() {
    assert(import.meta.jest);
    return fileAdditionalContentTypesAndExtensionsByContentType;
}

let fileCanonicalContentTypeByAdditionalContentType: Map<string, FileContentType> | null = null;

function getFileCanonicalContentTypeByAdditionalContentType() {
    fileCanonicalContentTypeByAdditionalContentType ??= new Map(
        getObjectEntriesWithKeyofType(fileAdditionalContentTypesAndExtensionsByContentType).flatMap(
            ([contentType, {contentTypes: additionalContentTypes = []}]) =>
                additionalContentTypes.map((additionalContentType): [string, FileContentType] => [
                    additionalContentType,
                    contentType,
                ]),
        ),
    );
    return fileCanonicalContentTypeByAdditionalContentType;
}

let fileContentTypeByExtension: Map<string, FileContentType> | null = null;

function getFileContentTypeByExtension() {
    fileContentTypeByExtension ??= new Map([
        ...getObjectEntriesWithKeyofType(filePreferredExtensionByContentType).map(
            ([contentType, extension]): [string, FileContentType] => [extension, contentType],
        ),
        ...getObjectEntriesWithKeyofType(
            fileAdditionalContentTypesAndExtensionsByContentType,
        ).flatMap(([contentType, {extensions = []}]) =>
            extensions.map((extension): [string, FileContentType] => [extension, contentType]),
        ),
    ]);
    return fileContentTypeByExtension;
}
