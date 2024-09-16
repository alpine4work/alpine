import {AppContext} from "~/client/context/app_context.js";
import {delayLoadingIndicatorLimitMs} from "~/client/design/timing_constants.js";
import {
    FileContentType,
    canonicalizeFileContentTypeIfExists,
    getPathFileContentTypeIfExists,
} from "~/shared/files/file_content_type.js";
import {FileModel} from "~/shared/files/file_model.js";
import {FilePreview} from "~/shared/files/file_preview.js";
import {UploadFileEventSchema} from "~/shared/files/upload_file_event.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {Store} from "~/shared/store/store.js";
import {ValueStore} from "~/shared/store/value_store.js";
import {fetchWithTracer} from "~/shared/tracer/fetch_with_tracer.js";

export async function uploadFileFromContentEditor(
    context: AppContext,
    spaceId: SpaceId,
    inputFile: File,
    {
        onAttach,
    }: {
        onAttach: (fileStore: Store<FileModel>) => void;
    },
) {
    // Get the file's content type. We prefer determining the content type based on
    // the file extension. That way if the operating system disagrees with us on
    // what the type of a file should be (based on file extension) our
    // determination will win.
    const contentType: FileContentType =
        getPathFileContentTypeIfExists(inputFile.name) ??
        canonicalizeFileContentTypeIfExists(inputFile.type) ??
        "application/octet-stream";

    const contentLength = inputFile.size;

    await fetchWithTracer(
        context.tracer.getTracer(),
        `/api/files/${spaceId}/upload`,
        {
            serviceName: "FileUploadService",
            method: "POST",
            route: "/api/files/:spaceId/upload",
            headers: {
                "content-type": contentType,
                "content-length": String(contentLength),
            },
            body: inputFile,
        },
        async response => {
            const decoder = new TextDecoder();
            const reader = assertExists(response.body).getReader();

            async function* read(): AsyncIterableIterator<string> {
                let unfinishedString = "";

                while (true) {
                    const result = await reader.read();

                    if (result.value) {
                        const chunkString = decoder.decode(result.value, {
                            stream: !result.done,
                        });

                        // If there's a newline in the output that means the content preceding the
                        // newline has at least one valid event maybe more.
                        let newLineIndex = chunkString.lastIndexOf("\n");

                        if (newLineIndex !== -1) {
                            newLineIndex += unfinishedString.length;
                        }

                        unfinishedString =
                            unfinishedString.length === 0
                                ? chunkString
                                : unfinishedString + chunkString;

                        if (newLineIndex !== -1) {
                            const finishedString = unfinishedString.slice(0, newLineIndex);
                            unfinishedString = unfinishedString.slice(newLineIndex + 1);

                            yield* finishedString.split("\n");
                        }
                    }

                    if (result.done) {
                        break;
                    }
                }

                // Once we're done reading, we assume the last string is also valid JSON.
                // Unless the string is empty. Then we assume it's a trailing newline.
                if (unfinishedString.length !== 0) {
                    yield unfinishedString;
                }
            }

            // NOTE(calebmer): If I write this as
            // `let fileStore: ValueStore<FileModel> | null = null` then annoyingly
            // TypeScript thinks `fileStore` will always be `null` even though we
            // definitely have an assignment to `fileStore` in our switch statement. The
            // `cast()` function works around TypeScript's literal assignment logic.
            let fileStore = cast<ValueStore<FileModel> | null>(null);

            let hasCalledOnAttach = false;
            let callOnAttachTimeout: Timeout | null = null;

            for await (const eventString of read()) {
                const event = UploadFileEventSchema.deserialize(JSON.parse(eventString));

                switch (event.type) {
                    case "Error": {
                        throw event.error;
                    }
                    case "Start": {
                        assert(!fileStore);

                        let preview: FilePreview | null = null;
                        if (event.hasPreview) {
                            switch (event.hasPreview.type) {
                                case "Image": {
                                    preview = {
                                        type: "Image",
                                        isProcessing: true,
                                        size: "Processing",
                                        placeholder: "Processing",
                                        content: event.hasPreview.hasContent
                                            ? "Processing"
                                            : undefined,
                                        videoDuration: event.hasPreview.hasVideoDuration
                                            ? "Processing"
                                            : undefined,
                                    };
                                    break;
                                }
                                case "Audio": {
                                    preview = {
                                        type: "Audio",
                                        isProcessing: true,
                                        duration: "Processing",
                                    };
                                    break;
                                }
                                case "Code": {
                                    preview = {
                                        type: "Code",
                                        isProcessing: true,
                                        content: "Processing",
                                    };
                                    break;
                                }
                                default:
                                    throw exhaustive(event.hasPreview);
                            }
                        }

                        fileStore = new ValueStore(
                            new FileModel({
                                id: event.fileId,
                                contentType,
                                contentLength,
                                isUploading: true,
                                alternative: event.hasAlternative ? {isProcessing: true} : null,
                                preview,
                            }),
                        );
                        break;
                    }
                    case "Finish": {
                        assertExists(fileStore).set(file => {
                            assert(file?.isUploading);

                            return file.clone({isUploading: false});
                        });
                        break;
                    }
                    case "Alternative": {
                        assertExists(fileStore).set(file => {
                            assert(file?.alternative?.isProcessing);

                            return file.clone({
                                alternative: {
                                    isProcessing: false,
                                    contentType: event.contentType,
                                    contentLength: event.contentLength,
                                    isImagePreviewContent: event.isImagePreviewContent,
                                },
                            });
                        });
                        break;
                    }
                    case "ImagePreviewSize": {
                        assertExists(fileStore).set(file => {
                            assert(file?.preview?.type === "Image");
                            assert(file.preview.isProcessing);

                            return file.clone({
                                preview:
                                    file.preview.placeholder !== "Processing" &&
                                    file.preview.content !== "Processing" &&
                                    file.preview.videoDuration !== "Processing"
                                        ? {
                                              type: "Image",
                                              isProcessing: false,
                                              ok: true,
                                              size: event.size,
                                              placeholder: file.preview.placeholder,
                                              content: file.preview.content,
                                              videoDuration: file.preview.videoDuration,
                                          }
                                        : {
                                              ...file.preview,
                                              size: event.size,
                                          },
                            });
                        });
                        break;
                    }
                    case "ImagePreviewPlaceholder": {
                        assertExists(fileStore).set(file => {
                            assert(file?.preview?.type === "Image");
                            assert(file.preview.isProcessing);

                            return file.clone({
                                preview:
                                    file.preview.size !== "Processing" &&
                                    file.preview.content !== "Processing" &&
                                    file.preview.videoDuration !== "Processing"
                                        ? {
                                              type: "Image",
                                              isProcessing: false,
                                              ok: true,
                                              size: file.preview.size,
                                              placeholder: event.placeholder,
                                              content: file.preview.content,
                                              videoDuration: file.preview.videoDuration,
                                          }
                                        : {
                                              ...file.preview,
                                              placeholder: event.placeholder,
                                          },
                            });
                        });
                        break;
                    }
                    case "ImagePreviewContent": {
                        assertExists(fileStore).set(file => {
                            assert(file?.preview?.type === "Image");
                            assert(file.preview.isProcessing);

                            return file.clone({
                                preview:
                                    file.preview.size !== "Processing" &&
                                    file.preview.placeholder !== "Processing" &&
                                    file.preview.videoDuration !== "Processing"
                                        ? {
                                              type: "Image",
                                              isProcessing: false,
                                              ok: true,
                                              size: file.preview.size,
                                              placeholder: file.preview.placeholder,
                                              content: {
                                                  contentType: event.contentType,
                                                  contentLength: event.contentLength,
                                              },
                                              videoDuration: file.preview.videoDuration,
                                          }
                                        : {
                                              ...file.preview,
                                              content: {
                                                  contentType: event.contentType,
                                                  contentLength: event.contentLength,
                                              },
                                          },
                            });
                        });
                        break;
                    }
                    case "ImagePreviewVideoDuration": {
                        assertExists(fileStore).set(file => {
                            assert(file?.preview?.type === "Image");
                            assert(file.preview.isProcessing);

                            return file.clone({
                                preview:
                                    file.preview.size !== "Processing" &&
                                    file.preview.placeholder !== "Processing" &&
                                    file.preview.content !== "Processing"
                                        ? {
                                              type: "Image",
                                              isProcessing: false,
                                              ok: true,
                                              size: file.preview.size,
                                              placeholder: file.preview.placeholder,
                                              content: file.preview.content,
                                              videoDuration: event.videoDuration,
                                          }
                                        : {
                                              ...file.preview,
                                              videoDuration: event.videoDuration,
                                          },
                            });
                        });
                        break;
                    }
                    case "AudioPreviewDuration": {
                        assertExists(fileStore).set(file => {
                            assert(file?.preview?.type === "Audio");
                            assert(file.preview.isProcessing);

                            return file.clone({
                                preview: {
                                    type: "Audio",
                                    isProcessing: false,
                                    duration: event.duration,
                                },
                            });
                        });
                        break;
                    }
                    case "CodePreviewContent": {
                        assertExists(fileStore).set(file => {
                            assert(file?.preview?.type === "Code");
                            assert(file.preview.isProcessing);

                            return file.clone({
                                preview: {
                                    type: "Code",
                                    isProcessing: false,
                                    content: event.content,
                                },
                            });
                        });
                        break;
                    }
                    case "PreviewError": {
                        assertExists(fileStore).set(file => {
                            assert(file?.preview?.type === "Image");
                            assert(file.preview.isProcessing);

                            return file.clone({
                                preview: {
                                    type: "Image",
                                    isProcessing: false,
                                    ok: false,
                                    error: event.error,
                                },
                            });
                        });
                        break;
                    }
                    default:
                        throw exhaustive(event);
                }

                if (fileStore && !hasCalledOnAttach) {
                    const attachReadiness = fileStore.getSnapshot().getAttachReadiness();

                    switch (attachReadiness) {
                        case "PreviewUnavailable": {
                            // Don't attach yet...
                            break;
                        }
                        case "PreviewPartiallyAvailable": {
                            // Wait a bit to call `onAttach()` in case the server quickly gives us the data
                            // we need to show a full preview so we can avoid showing the user a loading
                            // spinner.
                            callOnAttachTimeout ??= createTimeout(() => {
                                hasCalledOnAttach = true;
                                callOnAttachTimeout = null;
                                try {
                                    onAttach(fileStore!);
                                } catch (error) {
                                    scheduleUncaughtError(error);
                                }
                            }, delayLoadingIndicatorLimitMs);
                            break;
                        }
                        case "Ready": {
                            hasCalledOnAttach = true;
                            callOnAttachTimeout?.clear();
                            callOnAttachTimeout = null;
                            try {
                                onAttach(fileStore);
                            } catch (error) {
                                scheduleUncaughtError(error);
                            }
                            break;
                        }
                        default:
                            throw exhaustive(attachReadiness);
                    }
                }
            }
        },
    );
}
