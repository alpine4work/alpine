import {FileContentType} from "~/shared/files/file_content_type.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

/**
 * Get a user friendly noun for the file content type. For example a `.png` file
 * will be called "image".
 */
export function getFileContentTypeNoun(contentType: FileContentType | undefined): string {
    switch (contentType) {
        case "image/apng":
        case "image/avif":
        case "image/gif":
        case "image/jpeg":
        case "image/png":
        case "image/svg+xml":
        case "image/webp":
        case "image/bmp":
        case "image/ico":
        case "image/tiff":
        case "image/heif":
            return "image";
        case "video/webm":
        case "video/mp4":
        case "video/quicktime":
        case "video/mpeg":
        case "video/x-matroska":
            return "video";
        case "audio/mpeg":
        case "audio/wav":
        case "audio/webm":
        case "audio/ogg":
        case "audio/mp4":
            return "audio";
        case undefined:
        case "application/octet-stream":
        case "application/pdf":
        case "application/msword":
        case "application/vnd.ms-excel":
        case "application/vnd.ms-powerpoint":
        case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
        case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
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
            return "file";
        default:
            throw exhaustive(contentType);
    }
}

/**
 * Get a capitalized user friendly noun for the file content type to be used at the
 * start of sentences. For example a `.png` file will be called "Image".
 */
export function getFileContentTypeStartOfSentenceNoun(
    contentType: FileContentType | undefined,
): string {
    switch (contentType) {
        case "image/apng":
        case "image/avif":
        case "image/gif":
        case "image/jpeg":
        case "image/png":
        case "image/svg+xml":
        case "image/webp":
        case "image/bmp":
        case "image/ico":
        case "image/tiff":
        case "image/heif":
            return "Image";
        case "video/webm":
        case "video/mp4":
        case "video/quicktime":
        case "video/mpeg":
        case "video/x-matroska":
            return "Video";
        case "audio/mpeg":
        case "audio/wav":
        case "audio/webm":
        case "audio/ogg":
        case "audio/mp4":
            return "Audio";
        case undefined:
        case "application/octet-stream":
        case "application/pdf":
        case "application/msword":
        case "application/vnd.ms-excel":
        case "application/vnd.ms-powerpoint":
        case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
        case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
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
            return "File";
        default:
            throw exhaustive(contentType);
    }
}
