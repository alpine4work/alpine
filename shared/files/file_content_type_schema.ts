import {
    FileContentType,
    FileImageContentType,
    fileContentTypes,
    getFileImageContentTypes,
} from "~/shared/files/file_content_type.open_source.js";
import {Schema} from "~/shared/schema/schema.js";

/** The schema for image content types accepted by file upload APIs. */
export const FileImageContentTypeSchema = Schema.enum<FileImageContentType>(
    getFileImageContentTypes(),
);

/** The schema for all normalized file content types supported by Alpine. */
export const FileContentTypeSchema = Schema.enum<FileContentType>(fileContentTypes);
