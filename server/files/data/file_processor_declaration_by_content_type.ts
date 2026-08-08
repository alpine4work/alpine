import {FileContentType} from "~/shared/files/file_content_type.open_source.js";
import {FileHasPreview} from "~/shared/files/file_preview.js";

/**
 * What the file processor for each content type will generate.
 */
type FileProcessorDeclaration = {
    readonly hasAlternative: boolean;
    readonly hasAnalysis?: boolean;
    readonly hasPreview: FileHasPreview | null;
    readonly hasTranscript?: boolean;
};

export const fileProcessorDeclarationByContentType: Readonly<
    Record<FileContentType, FileProcessorDeclaration>
> = {
    "application/octet-stream": {
        hasAlternative: false,
        hasPreview: null,
    },
    "image/apng": {
        hasAlternative: false,
        hasAnalysis: true,
        hasPreview: {type: "Image", hasContent: false, hasVideoDuration: false},
    },
    "image/avif": {
        hasAlternative: false,
        hasAnalysis: true,
        hasPreview: {type: "Image", hasContent: false, hasVideoDuration: false},
    },
    "image/gif": {
        hasAlternative: false,
        hasAnalysis: true,
        hasPreview: {type: "Image", hasContent: false, hasVideoDuration: false},
    },
    "image/jpeg": {
        hasAlternative: false,
        hasAnalysis: true,
        hasPreview: {type: "Image", hasContent: false, hasVideoDuration: false},
    },
    "image/png": {
        hasAlternative: false,
        hasAnalysis: true,
        hasPreview: {type: "Image", hasContent: false, hasVideoDuration: false},
    },
    "image/svg+xml": {
        hasAlternative: false,
        hasAnalysis: true,
        hasPreview: {type: "Image", hasContent: false, hasVideoDuration: false},
    },
    "image/webp": {
        hasAlternative: false,
        hasAnalysis: true,
        hasPreview: {type: "Image", hasContent: false, hasVideoDuration: false},
    },
    "image/bmp": {
        hasAlternative: true,
        hasAnalysis: true,
        hasPreview: {type: "Image", hasContent: true, hasVideoDuration: false},
    },
    "image/ico": {
        hasAlternative: true,
        hasAnalysis: true,
        hasPreview: {type: "Image", hasContent: true, hasVideoDuration: false},
    },
    "image/tiff": {
        hasAlternative: true,
        hasAnalysis: true,
        hasPreview: {type: "Image", hasContent: true, hasVideoDuration: false},
    },
    "image/heif": {
        hasAlternative: true,
        hasAnalysis: true,
        hasPreview: {type: "Image", hasContent: true, hasVideoDuration: false},
    },
    "application/pdf": {
        hasAlternative: false,
        hasAnalysis: true,
        hasPreview: {type: "Image", hasContent: true, hasVideoDuration: false},
    },
    "application/msword": {
        hasAlternative: true,
        hasAnalysis: true,
        hasPreview: {type: "Image", hasContent: true, hasVideoDuration: false},
    },
    "application/vnd.ms-excel": {
        hasAlternative: true,
        hasAnalysis: true,
        hasPreview: {type: "Image", hasContent: true, hasVideoDuration: false},
    },
    "application/vnd.ms-powerpoint": {
        hasAlternative: true,
        hasAnalysis: true,
        hasPreview: {type: "Image", hasContent: true, hasVideoDuration: false},
    },
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
        hasAlternative: true,
        hasAnalysis: true,
        hasPreview: {type: "Image", hasContent: true, hasVideoDuration: false},
    },
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
        hasAlternative: true,
        hasAnalysis: true,
        hasPreview: {type: "Image", hasContent: true, hasVideoDuration: false},
    },
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": {
        hasAlternative: true,
        hasAnalysis: true,
        hasPreview: {type: "Image", hasContent: true, hasVideoDuration: false},
    },
    "video/webm": {
        hasAlternative: false,
        hasAnalysis: true,
        hasPreview: {type: "Image", hasContent: true, hasVideoDuration: true},
        hasTranscript: true,
    },
    "video/mp4": {
        hasAlternative: true,
        hasAnalysis: true,
        hasPreview: {type: "Image", hasContent: true, hasVideoDuration: true},
        hasTranscript: true,
    },
    "video/quicktime": {
        hasAlternative: true,
        hasAnalysis: true,
        hasPreview: {type: "Image", hasContent: true, hasVideoDuration: true},
        hasTranscript: true,
    },
    "video/mpeg": {
        hasAlternative: true,
        hasAnalysis: true,
        hasPreview: {type: "Image", hasContent: true, hasVideoDuration: true},
        hasTranscript: true,
    },
    "video/x-matroska": {
        hasAlternative: true,
        hasAnalysis: true,
        hasPreview: {type: "Image", hasContent: true, hasVideoDuration: true},
        hasTranscript: true,
    },
    "audio/mpeg": {
        hasAlternative: false,
        hasAnalysis: true,
        hasPreview: {type: "Audio"},
        hasTranscript: true,
    },
    "audio/wav": {
        hasAlternative: false,
        hasAnalysis: true,
        hasPreview: {type: "Audio"},
        hasTranscript: true,
    },
    "audio/webm": {
        hasAlternative: false,
        hasAnalysis: true,
        hasPreview: {type: "Audio"},
        hasTranscript: true,
    },
    "audio/mp4": {
        hasAlternative: true,
        hasAnalysis: true,
        hasPreview: {type: "Audio"},
        hasTranscript: true,
    },
    "audio/ogg": {
        hasAlternative: true,
        hasAnalysis: true,
        hasPreview: {type: "Audio"},
        hasTranscript: true,
    },
    "text/plain": {hasAlternative: false, hasAnalysis: true, hasPreview: {type: "Code"}},
    "text/javascript": {hasAlternative: false, hasAnalysis: true, hasPreview: {type: "Code"}},
    "text/html": {hasAlternative: false, hasAnalysis: true, hasPreview: {type: "Code"}},
    "text/css": {hasAlternative: false, hasAnalysis: true, hasPreview: {type: "Code"}},
    "application/sql": {hasAlternative: false, hasAnalysis: true, hasPreview: {type: "Code"}},
    "text/x-python": {hasAlternative: false, hasAnalysis: true, hasPreview: {type: "Code"}},
    "text/x-typescript": {hasAlternative: false, hasAnalysis: true, hasPreview: {type: "Code"}},
    "application/x-sh": {hasAlternative: false, hasAnalysis: true, hasPreview: {type: "Code"}},
    "text/x-java": {hasAlternative: false, hasAnalysis: true, hasPreview: {type: "Code"}},
    "application/json": {hasAlternative: false, hasAnalysis: true, hasPreview: {type: "Code"}},
    "text/markdown": {hasAlternative: false, hasAnalysis: true, hasPreview: {type: "Code"}},
    "text/x-csharp": {hasAlternative: false, hasAnalysis: true, hasPreview: {type: "Code"}},
    "text/x-c++src": {hasAlternative: false, hasAnalysis: true, hasPreview: {type: "Code"}},
    "text/x-csrc": {hasAlternative: false, hasAnalysis: true, hasPreview: {type: "Code"}},
    "application/x-httpd-php": {
        hasAlternative: false,
        hasAnalysis: true,
        hasPreview: {type: "Code"},
    },
    "text/x-go": {hasAlternative: false, hasAnalysis: true, hasPreview: {type: "Code"}},
    "application/yaml": {hasAlternative: false, hasAnalysis: true, hasPreview: {type: "Code"}},
    "application/x-powershell": {
        hasAlternative: false,
        hasAnalysis: true,
        hasPreview: {type: "Code"},
    },
    "text/rust": {hasAlternative: false, hasAnalysis: true, hasPreview: {type: "Code"}},
    "text/x-kotlin": {hasAlternative: false, hasAnalysis: true, hasPreview: {type: "Code"}},
    "application/x-ruby": {hasAlternative: false, hasAnalysis: true, hasPreview: {type: "Code"}},
    "text/x-lua": {hasAlternative: false, hasAnalysis: true, hasPreview: {type: "Code"}},
    "application/xml": {hasAlternative: false, hasAnalysis: true, hasPreview: {type: "Code"}},
    "application/vnd.dart": {hasAlternative: false, hasAnalysis: true, hasPreview: {type: "Code"}},
    "text/x-swift": {hasAlternative: false, hasAnalysis: true, hasPreview: {type: "Code"}},
    "text/x-asm": {hasAlternative: false, hasAnalysis: true, hasPreview: {type: "Code"}},
    "application/wasm": {hasAlternative: false, hasAnalysis: true, hasPreview: {type: "Code"}},
    "text/x-scala": {hasAlternative: false, hasAnalysis: true, hasPreview: {type: "Code"}},
    "text/x-r": {hasAlternative: false, hasAnalysis: true, hasPreview: {type: "Code"}},
    "text/x-elixir": {hasAlternative: false, hasAnalysis: true, hasPreview: {type: "Code"}},
    "text/x-objcsrc": {hasAlternative: false, hasAnalysis: true, hasPreview: {type: "Code"}},
    "text/x-perl": {hasAlternative: false, hasAnalysis: true, hasPreview: {type: "Code"}},
    "text/x-haskell": {hasAlternative: false, hasAnalysis: true, hasPreview: {type: "Code"}},
    "text/x-solidity": {hasAlternative: false, hasAnalysis: true, hasPreview: {type: "Code"}},
    "text/x-clojure": {hasAlternative: false, hasAnalysis: true, hasPreview: {type: "Code"}},
    "text/x-erlang": {hasAlternative: false, hasAnalysis: true, hasPreview: {type: "Code"}},
    "text/x-ocaml": {hasAlternative: false, hasAnalysis: true, hasPreview: {type: "Code"}},
};
