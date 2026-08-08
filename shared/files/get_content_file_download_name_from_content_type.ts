import {
    FileContentType,
    getFileContentTypePreferredExtension,
} from "~/shared/files/file_content_type.open_source.js";
import {getFileContentTypeNoun} from "~/shared/files/get_file_content_type_noun.open_source.js";

export function getContentFileDownloadNameFromContentType(contentType: FileContentType) {
    return (
        getFileContentTypeNoun(contentType) +
        "." +
        getFileContentTypePreferredExtension(contentType)
    );
}
