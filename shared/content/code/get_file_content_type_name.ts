import {contentCodeBlockLanguageById} from "~/shared/content/code/content_code_block_language.js";
import {
    FileContentType,
    getFileContentTypeContentCodeBlockLanguageId,
} from "~/shared/files/file_content_type.js";
import {getFileContentTypeNoun} from "~/shared/files/get_file_content_type_noun.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

/**
 * Get a human readable name for the content type which includes the format of the
 * file. For format names, we use the name of the format from Wikipedia. Exactly as
 * it's spelled on Wikipedia.
 *
 * This function is in `~/shared/content/code` because it depends on
 * `contentCodeBlockLanguageById` from
 * `~/shared/content/code/content_code_block_language.js` which isn't available in
 * `~/shared/files`.
 */
export function getFileContentTypeName(contentType: FileContentType): string {
    return `${getFileContentTypeFormatName(contentType)} ${getFileContentTypeNoun(contentType)}`;
}

function getFileContentTypeFormatName(contentType: FileContentType): string {
    switch (contentType) {
        // https://en.wikipedia.org/wiki/PNG
        case "image/apng":
        case "image/png":
            return "PNG";

        // https://en.wikipedia.org/wiki/AVIF
        case "image/avif":
            return "AVIF";

        // https://en.wikipedia.org/wiki/GIF
        case "image/gif":
            return "GIF";

        // https://en.wikipedia.org/wiki/JPEG
        case "image/jpeg":
            return "JPEG";

        // https://en.wikipedia.org/wiki/SVG
        case "image/svg+xml":
            return "SVG";

        // https://en.wikipedia.org/wiki/WebP
        case "image/webp":
            return "WebP";

        // https://en.wikipedia.org/wiki/BMP_file_format
        case "image/bmp":
            return "BMP";

        // https://en.wikipedia.org/wiki/ICO_(file_format)
        case "image/ico":
            return "ICO";

        // https://en.wikipedia.org/wiki/TIFF
        case "image/tiff":
            return "TIFF";

        // https://en.wikipedia.org/wiki/High_Efficiency_Image_File_Format
        case "image/heif":
            return "HEIF";

        // https://en.wikipedia.org/wiki/WebM
        case "video/webm":
            return "WebM";

        // https://en.wikipedia.org/wiki/MP4_file_format
        case "video/mp4":
            return "MP4";

        // https://en.wikipedia.org/wiki/QuickTime_File_Format
        case "video/quicktime":
            return "QuickTime";

        // https://en.wikipedia.org/wiki/Moving_Picture_Experts_Group
        case "video/mpeg":
            return "MPEG";

        // https://en.wikipedia.org/wiki/Matroska
        case "video/x-matroska":
            return "Matroska";

        // https://en.wikipedia.org/wiki/Moving_Picture_Experts_Group
        case "audio/mpeg":
            return "MPEG";

        // https://en.wikipedia.org/wiki/WAV
        case "audio/wav":
            return "WAV";

        // https://en.wikipedia.org/wiki/WebM
        case "audio/webm":
            return "WebM";

        // https://en.wikipedia.org/wiki/Ogg
        case "audio/ogg":
            return "Ogg";

        // https://en.wikipedia.org/wiki/MP4_file_format
        case "audio/mp4":
            return "MP4";

        case undefined:
        case "application/octet-stream":
            return "Unknown";

        // https://en.wikipedia.org/wiki/PDF
        case "application/pdf":
            return "PDF";

        // https://en.wikipedia.org/wiki/Microsoft_Word
        case "application/msword":
        case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
            return "Microsoft Word";

        // https://en.wikipedia.org/wiki/Microsoft_Excel
        case "application/vnd.ms-excel":
        case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
            return "Microsoft Excel";

        // https://en.wikipedia.org/wiki/Microsoft_PowerPoint
        case "application/vnd.ms-powerpoint":
        case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
            return "Microsoft PowerPoint";

        case "text/plain":
        case "text/javascript":
        case "text/html":
        case "text/css":
        case "application/sql":
        case "text/x-python":
        case "text/x-typescript":
        case "application/x-sh":
        case "text/x-java":
        case "application/json":
        case "text/markdown":
        case "text/x-csharp":
        case "text/x-c++src":
        case "text/x-csrc":
        case "application/x-httpd-php":
        case "text/x-go":
        case "application/yaml":
        case "application/x-powershell":
        case "text/rust":
        case "text/x-kotlin":
        case "application/x-ruby":
        case "text/x-lua":
        case "application/xml":
        case "application/vnd.dart":
        case "text/x-swift":
        case "text/x-asm":
        case "application/wasm":
        case "text/x-scala":
        case "text/x-r":
        case "text/x-elixir":
        case "text/x-objcsrc":
        case "text/x-perl":
        case "text/x-haskell":
        case "text/x-solidity":
        case "text/x-clojure":
        case "text/x-erlang":
        case "text/x-ocaml":
            return contentCodeBlockLanguageById[
                getFileContentTypeContentCodeBlockLanguageId(contentType)
            ].name;

        default:
            throw exhaustive(contentType);
    }
}
