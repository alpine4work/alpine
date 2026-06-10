import {AbortedError, UnknownError} from "~/shared/error/error.js";

/**
 * Uploads a file to a presigned S3 URL using XMLHttpRequest for progress tracking.
 */
export function uploadFileToPresignedUrl({
    file,
    presignedUrl,
    contentType,
    onProgress,
    onSuccess,
    onError,
}: {
    file: File;
    presignedUrl: string;
    contentType: string;
    onProgress: (progress: number) => void;
    onSuccess: () => void;
    onError: (error: Error) => void;
}): {abort: () => void} {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener("progress", event => {
        if (event.lengthComputable) {
            onProgress(event.loaded / event.total);
        }
    });

    xhr.addEventListener("load", () => {
        if (xhr.status >= 200 && xhr.status < 300) {
            onProgress(1);
            onSuccess();
        } else {
            onError(new UnknownError(`Upload failed with status ${xhr.status}`));
        }
    });

    xhr.addEventListener("error", () => {
        onError(new UnknownError("Upload network request failed"));
    });

    xhr.addEventListener("abort", () => {
        onError(new AbortedError("Upload was aborted"));
    });

    xhr.open("PUT", presignedUrl, true);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.send(file);

    return {
        abort: () => {
            if (xhr.readyState !== XMLHttpRequest.DONE) {
                xhr.abort();
            }
        },
    };
}
