import {
    FileContentType,
    getFileContentTypePreferredExtension,
} from "~/shared/files/file_content_type.js";
import {getFileContentTypeNoun} from "~/shared/files/get_file_content_type_noun.js";

export function getContentFileDownloadNameFromContentType(contentType: FileContentType) {
    return (
        getFileContentTypeNoun(contentType) +
        "." +
        getFileContentTypePreferredExtension(contentType)
    );
}
