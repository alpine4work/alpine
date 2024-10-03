import {AppContext} from "~/client/context/app_context.js";
import {delayLoadingIndicatorLimitMs} from "~/client/design/timing_constants.js";
import {ErrorBase, InvalidArgumentError, UnavailableError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {
    FileContentType,
    canonicalizeFileContentTypeIfExists,
    getPathFileContentTypeIfExists,
} from "~/shared/files/file_content_type.js";
import {FileModel} from "~/shared/files/file_model.js";
import {FilePreview} from "~/shared/files/file_preview.js";
import {getFileContentTypeNoun} from "~/shared/files/get_file_content_type_noun.js";
import {UploadFileEventSchema} from "~/shared/files/upload_file_event.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.js";
import {attachFileAsUploader} from "~/shared/rpc/files_rpc_definitions.js";
import {Store} from "~/shared/store/store.js";
import {ValueStore} from "~/shared/store/value_store.js";
import {fetchWithTracer} from "~/shared/tracer/fetch_with_tracer.js";

declare global {
    interface RequestInit {
        duplex?: "half";
    }
}

export type UploadFileFromContentEditorInput =
    | {
          readonly type: "File";
          readonly file: File;
      }
    | {
          readonly type: "Url";
          readonly url: URL;
      };

// TODO(calebmer, #files): Loading spinner before file is attached
export function uploadFileFromContentEditor(
    context: AppContext,
    options: {
        spaceId: SpaceId;
        fileId?: FileId;
        attachmentTarget: FileAttachmentTarget;
        input: UploadFileFromContentEditorInput;
        onAttach: (options: {signedUrlSearch: string; fileStore: Store<FileModel>}) => void;
    },
) {
    return context.tracer.withSpan("Content editor upload file", (context, span) => {
        span.addData({common: {type: `${options.input.type}Input`}});
        return actuallyUploadFileFromContentEditor(context, options);
    });
}

async function actuallyUploadFileFromContentEditor(
    context: AppContext,
    {
        spaceId,
        fileId,
        attachmentTarget,
        input,
        onAttach,
    }: {
        spaceId: SpaceId;
        fileId?: FileId;
        attachmentTarget: FileAttachmentTarget;
        input: UploadFileFromContentEditorInput;
        onAttach: (options: {signedUrlSearch: string; fileStore: Store<FileModel>}) => void;
    },
) {
    const uploadUrl = new URL(`/api/files/${spaceId}/upload`, window.location.href);
    if (fileId) uploadUrl.searchParams.set("id", fileId);

    let contentType: FileContentType | undefined;
    let contentLength: number | undefined;
    let body: BodyInit | undefined;
    let extraPromise: Promise<unknown> | undefined;

    switch (input.type) {
        case "File": {
            // Get the file's content type. We prefer determining the content type based on
            // the file extension. That way if the operating system disagrees with us on
            // what the type of a file should be (based on file extension) our
            // determination will win.
            contentType =
                getPathFileContentTypeIfExists(input.file.name) ??
                canonicalizeFileContentTypeIfExists(input.file.type) ??
                "application/octet-stream";

            contentLength = input.file.size;

            body = input.file;
            break;
        }
        case "Url": {
            const readyPromiseResolver = createPromiseResolver();

            const getErrorDisplayMessage = () => {
                const contentTypeNoun = getFileContentTypeNoun(
                    contentType ?? "application/octet-stream",
                );

                const linkSegment = errorDisplayMessage.link(
                    `${input.url.protocol}//${input.url.host}`,
                    `${input.url.protocol}//${input.url.host}`,
                );

                return errorDisplayMessage`Can’t add ${contentTypeNoun} from ${linkSegment} because the ${contentTypeNoun} is in an incorrect format. Try adding a different ${contentTypeNoun}.`;
            };

            extraPromise = fetchWithTracer(
                context.tracer.getTracer(),
                new URL(
                    `/files/cors-proxy/${encodeURIComponent(input.url.toString())}`,
                    window.location.href,
                ),
                {
                    serviceName: "EdgeService",
                    route: "/files/cors-proxy/:url",
                    method: "GET",
                },
                async response => {
                    const responseContentLengthString = response.headers.get("content-length");
                    const responseContentType = response.headers.get("content-type");

                    // When requesting a file from some URL, use the `Content-Type` set by the HTTP
                    // server if it exists. Otherwise fallback to looking for a file extension in
                    // the path.
                    contentType =
                        (responseContentType !== null
                            ? canonicalizeFileContentTypeIfExists(responseContentType)
                            : null) ??
                        getPathFileContentTypeIfExists(input.url.pathname) ??
                        "application/octet-stream";

                    const responseContentLength =
                        responseContentLengthString !== null
                            ? parseInt(responseContentLengthString, 10)
                            : null;

                    if (
                        responseContentLengthString !== null &&
                        (!/^[0-9]+$/.test(responseContentLengthString) ||
                            !Number.isSafeInteger(responseContentLength))
                    ) {
                        throw new InvalidArgumentError("Invalid `Content-Length` header", {
                            displayMessage: getErrorDisplayMessage(),
                        });
                    }

                    if (
                        // Unfortunately, if the request did not provide a `Content-Length` header then
                        // we need to load the entire file into memory to get its byte length. Then we
                        // can start an upload.
                        responseContentLength === null ||
                        // Also unfortunately, `ReadableStream` stream bodies are only available over
                        // HTTP/2 and HTTP/3. In development we use HTTP/1 and we don't even use HTTPS.
                        // So for now, in development, we need to fallback to loading the full file
                        // into memory.
                        //
                        // We test for the `https://` protocol to check if we're in development. If we
                        // ever switch our development server to use HTTPS instead of HTTP then we
                        // should also switch our development server to use HTTP/2.
                        //
                        // TODO(calebmer, #files): Test that streaming works in production?
                        uploadUrl.protocol !== "https:"
                    ) {
                        body = await response.arrayBuffer();
                        contentLength = body.byteLength;
                        readyPromiseResolver.resolve();
                    }
                    // If we got a `Content-Length` header we can immediately start streaming the
                    // result of our fetch into `FileUploadService`. Nice.
                    else {
                        const [responseBody1, responseBody2] = (
                            response.body ??
                            new ReadableStream({start: controller => controller.close()})
                        ).tee();

                        contentLength = responseContentLength;
                        body = responseBody1;
                        readyPromiseResolver.resolve();

                        // Wait until we've finished downloading the response body to resolve this
                        // `fetchWithTracer()` span.
                        await responseBody2.pipeTo(new WritableStream());
                    }
                },
            ).catch(error => {
                if (!(error instanceof ErrorBase)) {
                    error = new UnavailableError(
                        error instanceof Error ? error.message : String(error),
                        {displayMessage: getErrorDisplayMessage()},
                    );
                }

                readyPromiseResolver.reject(error);
                throw error;
            });

            // No unhandled promise exception warnings. Exceptions will be handled by the
            // `runAllPromises()` call below which includes this promise.
            extraPromise.catch(() => {});

            await readyPromiseResolver.promise;
            break;
        }
        default:
            throw exhaustive(input);
    }

    const uploadPromise = fetchWithTracer(
        context.tracer.getTracer(),
        uploadUrl,
        {
            serviceName: "FileUploadService",
            method: "POST",
            route: "/api/files/:spaceId/upload",
            headers: {
                "content-type": assertExists(contentType),
                "content-length": String(assertExists(contentLength)),
            },
            duplex: "half",
            body: assertExists(body),
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

            // NOTE(calebmer): If I write this without the `cast()` then annoyingly
            // TypeScript thinks `state` will always be `null` even though we
            // definitely have an assignment to `state` in our switch statement. The
            // `cast()` function works around TypeScript's literal assignment logic.
            let state = cast<{
                signedUrlSearch: string;
                fileStore: ValueStore<FileModel>;
            } | null>(null);

            let hasCalledOnAttach = false;
            let callOnAttachTimeout: Timeout | null = null;

            for await (const eventString of read()) {
                const event = UploadFileEventSchema.deserialize(JSON.parse(eventString));

                switch (event.type) {
                    case "Error": {
                        throw event.error;
                    }
                    case "Start": {
                        assert(!state);

                        if (fileId) {
                            assert(event.fileId === fileId);
                        }

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

                        state = {
                            signedUrlSearch: event.signedUrlSearch,
                            fileStore: new ValueStore(
                                new FileModel({
                                    id: event.fileId,
                                    contentType: assertExists(contentType),
                                    contentLength: assertExists(contentLength),
                                    isUploading: true,
                                    alternative: event.hasAlternative ? {isProcessing: true} : null,
                                    preview,
                                }),
                            ),
                        };

                        // Once the file has been created, attach it to our attachment target.
                        // `FileUploadService` will continue to process the file while the client waits
                        // for this RPC. By waiting here we also make sure we won't call `onAttach`
                        // until after this RPC completes.
                        //
                        // We don't pass `attachmentTarget` as an argument to our upload route and
                        // attach in `FileUploadService` because for security purposes
                        // `FileUploadService` doesn't have access to any tables other than the files
                        // table. And we need other tables to authorize the actor has access to the
                        // attachment target (e.g. we need the document table to authorize the actor
                        // has access to the document).
                        //
                        // We attach the file before persisting any changes to our content (e.g.
                        // persisting document steps or saving a newly created post). This is important
                        // since if other accounts are watching the attachment target in realtime then
                        // the attachment needs to exist for them to be able to see the file. However,
                        // by attaching early here it means we may successfully attach a file but fail
                        // to persist the content changes.
                        //
                        // We should consider building a file garbage collector that looks at all
                        // attachments and if they're still valid. Any attachments that aren't valid
                        // should get cleaned up.
                        //
                        // ## Implementation gotcha for documents
                        //
                        // We don't currently detach files from documents. Once a file is attached to a
                        // document it's there forever. Because even if you delete a file from a
                        // document's content you can still go into version history and bring an old
                        // version of the document back. Or you can see the file in a resolved document
                        // comment thread's preview snippet. This is the same behavior as text added to
                        // a document. Once you add text to a document it can be recovered at any point
                        // by a document editor. This isn't great for our security posture. Some
                        // thoughts:
                        //
                        // 1. We should add document deletion. Once a document is deleted then it's
                        //    safe to cleanup all its files.
                        //
                        // 2. We could consider changing permissions so that if a file is removed from
                        //    a document you need at least comment access to see it (comment access
                        //    lets you see it in a comment thread snippet, edit access lets you restore
                        //    from a previous version). However, if we give view-only users the ability
                        //    to look at a document's version history then view-only users still need
                        //    to see files that have been removed from the document.
                        await attachFileAsUploader(context, {
                            spaceId,
                            fileId: event.fileId,
                            target: attachmentTarget,
                        });
                        break;
                    }
                    case "Finish": {
                        assertExists(state).fileStore.set(file => {
                            assert(file?.isUploading);

                            return file.clone({isUploading: false});
                        });
                        break;
                    }
                    case "Alternative": {
                        assertExists(state).fileStore.set(file => {
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
                        assertExists(state).fileStore.set(file => {
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
                        assertExists(state).fileStore.set(file => {
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
                        assertExists(state).fileStore.set(file => {
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
                        assertExists(state).fileStore.set(file => {
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
                        assertExists(state).fileStore.set(file => {
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
                        assertExists(state).fileStore.set(file => {
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
                        assertExists(state).fileStore.set(file => {
                            assert(file?.preview?.type === "Image");
                            assert(file.preview.isProcessing);

                            return file.clone({
                                preview: {
                                    type: "Image",
                                    isProcessing: false,
                                    ok: false,
                                    error: event.error,
                                    size:
                                        file.preview.size === "Processing"
                                            ? "Error"
                                            : file.preview.size,
                                    placeholder:
                                        file.preview.placeholder === "Processing"
                                            ? "Error"
                                            : file.preview.placeholder,
                                    content:
                                        file.preview.content === "Processing"
                                            ? "Error"
                                            : file.preview.content,
                                    videoDuration:
                                        file.preview.videoDuration === "Processing"
                                            ? "Error"
                                            : file.preview.videoDuration,
                                },
                            });
                        });
                        break;
                    }
                    default:
                        throw exhaustive(event);
                }

                if (state && !hasCalledOnAttach) {
                    const attachReadiness = state.fileStore.getSnapshot().getAttachReadiness();

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
                                    onAttach(state!);
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
                                onAttach(state);
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

    await runAllPromises([extraPromise, uploadPromise]);
}
