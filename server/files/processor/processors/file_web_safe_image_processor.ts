import {waitForReadableStreamBuffer} from "~/server/files/upload/helpers/wait_for_readable_stream_buffer.js";
import {processImageFile} from "~/server/files/upload/processors/file_image_processor_base.js";
import {FileProcessor} from "~/server/files/upload/processors/file_processor.js";
import {FileWebSafeImageContentType} from "~/shared/files/file_content_type.js";

export function createFileWebSafeImageProcessor(
    contentType: FileWebSafeImageContentType,
): FileProcessor {
    return {
        type: "WebSafeImage",
        hasAlternative: false,
        hasPreview: {
            type: "Image",
            hasContent: false,
            hasVideoDuration: false,
        },
        process: (stream, signal) => {
            // Unfortunately, `sharp` doesn't support efficient stream processing so it's
            // more efficient to await `dataPromise` than to use `stream`. See our comment
            // on `FileProcessor`.
            const dataPromise = waitForReadableStreamBuffer(stream, signal);

            return processImageFile(contentType, dataPromise);
        },
    };
}
