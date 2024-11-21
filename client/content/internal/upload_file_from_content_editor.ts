import {ContentFilePollerContext} from "~/client/content/internal/content_file_poller.js";
import {ProgressValueStoreWithCancel} from "~/client/content/internal/progress_store.js";
import {AppContext} from "~/client/context/app_context.js";
import {getGlobalContext} from "~/client/helpers/global_context.js";
import {delayScreenTransitionLoadingIndicatorLimitMs} from "~/shared/design/core/timing.js";
import {ErrorBase, InvalidArgumentError, UnavailableError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {
    FileAttachmentTarget,
    serializeFileAttachmentTargetString,
} from "~/shared/files/file_attachment_target.js";
import {
    FileContentType,
    canonicalizeFileContentTypeIfExists,
    getPathFileContentTypeIfExists,
} from "~/shared/files/file_content_type.js";
import {FileModel, UploadFileResponseSchema} from "~/shared/files/file_model.js";
import {getFileContentTypeNoun} from "~/shared/files/get_file_content_type_noun.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {waitForReadableStreamUint8Array} from "~/shared/helpers/binary/wait_for_readable_stream_uint8_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {ReadonlyTuple} from "~/shared/helpers/types/tuple.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.js";
import {ConstStore} from "~/shared/store/const_store.js";
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

export const uploadFileFromContentEditorProgressCompositeStoreWeights = [1, 1, 8] as const;

export function uploadFileFromContentEditor(
    context: AppContext,
    options: {
        spaceId: SpaceId;
        fileId?: FileId;
        attachmentTarget: FileAttachmentTarget;
        input: UploadFileFromContentEditorInput;
        progressStores: ReadonlyTuple<ProgressValueStoreWithCancel, 3>;
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
        progressStores: [downloadProgressStore, uploadProgressStore, processProgressStore],
        onAttach,
    }: {
        spaceId: SpaceId;
        fileId?: FileId;
        attachmentTarget: FileAttachmentTarget;
        input: UploadFileFromContentEditorInput;
        progressStores: ReadonlyTuple<ProgressValueStoreWithCancel, 3>;
        onAttach: (options: {signedUrlSearch: string; fileStore: Store<FileModel>}) => void;
    },
) {
    const uploadUrl = new URL(`/api/files/${spaceId}/upload`, window.location.href);
    if (fileId) uploadUrl.searchParams.set("id", fileId);

    // Once the file has been created, attach it to our attachment target.
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
    uploadUrl.searchParams.set("target", serializeFileAttachmentTargetString(attachmentTarget));

    let contentType: FileContentType | undefined;
    let contentLength: number | undefined;
    let body: File | Uint8Array | ReadableStream<Uint8Array> | undefined;
    let extraPromise: Promise<unknown> | undefined;

    switch (input.type) {
        case "File": {
            downloadProgressStore.cancel();

            // Get the file's content type. We prefer determining the content type based on
            // the file extension. That way if the operating system disagrees with us on
            // what the type of a file should be (based on file extension) our
            // determination will win.
            contentType =
                getPathFileContentTypeIfExists(input.file.name) ??
                canonicalizeFileContentTypeIfExists(input.file.type) ??
                "application/octet-stream";

            contentLength = input.file.size;

            // Unfortunately, `ReadableStream` request bodies are only available over
            // HTTP/2 and HTTP/3. In development we use HTTP/1 and we don't even use HTTPS.
            // So for now, in development, we can't use `input.file.stream()` which means
            // we can't measure upload progress.
            //
            // We test for the `https://` protocol to check if we're in development. If we
            // ever switch our development server to use HTTPS instead of HTTP then we
            // should also switch our development server to use HTTP/2.
            //
            // TODO(calebmer, #files): Test that streaming works in production?
            if (uploadUrl.protocol !== "https:") {
                body = input.file;
            } else {
                body = input.file.stream();
            }
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

                    let responseBody =
                        response.body ??
                        new ReadableStream({start: controller => controller.close()});

                    if (responseContentLength === null) {
                        // No `Content-Length` header available. Hard to estimate download time. We'll
                        // say 3s which works well medium files on a fast network but not small or
                        // large files.
                        downloadProgressStore.ease(3000);
                    } else {
                        let count = 0;

                        responseBody = responseBody.pipeThrough(
                            new TransformStream({
                                transform: (chunk, controller) => {
                                    count += chunk.length;
                                    downloadProgressStore.set(count / responseContentLength);
                                    controller.enqueue(chunk);
                                },
                                flush: () => {
                                    downloadProgressStore.set(1);
                                },
                            }),
                        );
                    }

                    if (
                        // Unfortunately, if the request did not provide a `Content-Length` header then
                        // we need to load the entire file into memory to get its byte length. Then we
                        // can start an upload.
                        responseContentLength === null ||
                        // Also unfortunately, `ReadableStream` request bodies are only available over
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
                        // We won't be able to measure upload time if body isn't a stream. So
                        // preemptively cancel upload progress store.
                        uploadProgressStore.cancel();

                        body = await waitForReadableStreamUint8Array(responseBody);
                        contentLength = body.byteLength;
                        readyPromiseResolver.resolve();
                    }
                    // If we got a `Content-Length` header we can immediately start streaming the
                    // result of our fetch into `FileProcessorService`. Nice.
                    else {
                        const [responseBody1, responseBody2] = responseBody.tee();

                        contentLength = responseContentLength;
                        body = responseBody1;
                        readyPromiseResolver.resolve();

                        // Wait until we've finished downloading the response body to resolve this
                        // `fetchWithTracer()` span.
                        await responseBody2.pipeTo(new WritableStream());
                    }

                    if (responseContentLength === null) {
                        downloadProgressStore.set(1);
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

    assert(body !== undefined);
    assert(contentType !== undefined);
    assert(contentLength !== undefined);

    if (!(body instanceof ReadableStream)) {
        uploadProgressStore.cancel();
    } else {
        let count = 0;

        body = body.pipeThrough(
            new TransformStream({
                transform: (chunk, controller) => {
                    count += chunk.length;
                    uploadProgressStore.set(count / contentLength!);
                    controller.enqueue(chunk);
                },
                flush: () => {
                    uploadProgressStore.set(1);
                },
            }),
        );
    }

    const uploadAndProcessPromise = (async () => {
        const {signedUrlSearch, file: initialFile} = await fetchWithTracer(
            context.tracer.getTracer(),
            uploadUrl,
            {
                serviceName: "FileProcessorService",
                method: "POST",
                route: "/api/files/:spaceId/upload",
                headers: {
                    "content-type": contentType,
                    "content-length": String(contentLength),
                },
                duplex: "half",
                body,
            },
            async response => {
                const responseBody = UploadFileResponseSchema.deserialize(await response.json());
                if (!responseBody.ok) throw responseBody.error;
                return responseBody;
            },
        );

        if (initialFile.getAttachReadiness() === "Ready") {
            processProgressStore.set(1);
            onAttach({signedUrlSearch, fileStore: new ConstStore(initialFile)});
            return;
        }

        const fileStore = new ValueStore(initialFile);

        const processDurationMsEstimate = estimateProcessFileDurationMs(contentType, contentLength);
        processProgressStore.ease(processDurationMsEstimate);

        let hasCalledOnAttach = false;
        let callOnAttachTimeout: Timeout | null = null;
        const promiseResolver = createPromiseResolver();

        const stopPolling = getGlobalContext(ContentFilePollerContext).startPolling(() => context, {
            spaceId,
            fileId: initialFile.id,
            target: attachmentTarget,
            onPoll: ({signedUrlSearch, file: newFile}) => {
                const attachReadiness = newFile.getAttachReadiness();

                switch (attachReadiness) {
                    case "PreviewUnavailable": {
                        fileStore.set(newFile);

                        // Don't attach yet...
                        break;
                    }
                    case "PreviewPartiallyAvailable": {
                        fileStore.set(newFile);

                        if (!hasCalledOnAttach) {
                            // Wait a bit to call `onAttach()` in case the server quickly gives us the data
                            // we need to show a full preview so we can avoid showing the user a loading
                            // spinner.
                            callOnAttachTimeout ??= createTimeout(() => {
                                hasCalledOnAttach = true;
                                callOnAttachTimeout = null;
                                try {
                                    onAttach({signedUrlSearch, fileStore});
                                } catch (error) {
                                    scheduleUncaughtError(error);
                                }

                                // Use the screen transition delay since attaching a file is a big layout
                                // shift. Ideally we'd have the data we need to render a good preview.
                            }, delayScreenTransitionLoadingIndicatorLimitMs);
                        }
                        break;
                    }
                    case "Ready": {
                        fileStore.finalSet(newFile);

                        stopPolling();
                        promiseResolver.resolve();

                        if (!hasCalledOnAttach) {
                            hasCalledOnAttach = true;
                            callOnAttachTimeout?.clear();
                            callOnAttachTimeout = null;
                            try {
                                onAttach({signedUrlSearch, fileStore});
                            } catch (error) {
                                scheduleUncaughtError(error);
                            }
                        }
                        break;
                    }
                    default:
                        throw exhaustive(attachReadiness);
                }
            },
        });

        await promiseResolver.promise;

        processProgressStore.set(1);
    })();

    await runAllPromises([extraPromise, uploadAndProcessPromise]);

    // If this function finishes successfully then all our progress stores should
    // have either been cancelled or set their values to 1.
    assert(downloadProgressStore.isCancelled() || downloadProgressStore.getSnapshot() === 1);
    assert(uploadProgressStore.isCancelled() || uploadProgressStore.getSnapshot() === 1);
    assert(processProgressStore.getSnapshot() === 1);
}

/**
 * An absolutely terrible model for estimating `FileProcessorService`
 * processing time I've manually tuned based on some local data.
 *
 * The right way to implement this function is to use machine learning based on
 * real world data to train a small model we can include on the client. My
 * proposal: Collect a data set of file content type, file length, and maybe
 * even the first kilobyte or so of the file (which'll hopefully include
 * important metadata like codecs which can change how long the file takes to
 * process). Train a model to predict processing time based on this data.
 */
function estimateProcessFileDurationMs(
    contentType: FileContentType,
    contentLength: number,
): number {
    // This is a function I manually fit to some `video/mp4` processing times I
    // measured locally. It probably won't perfectly line up with processing times
    // in production.
    //
    // https://www.desmos.com/calculator/gt82e8u8wq
    const a = 20000;
    const b = 405000000;
    const cx = 234303;
    const cy = 315;
    const durationMs = (cy - a) * Math.exp((cx - contentLength) / b) + a;

    // I ran the test suite locally five times and recorded
    // `contentLength / durationMs` and took the average for each content type.
    // This is very unlikely to match real world processing times.
    //
    // https://docs.google.com/spreadsheets/d/1RQLVSJc8_2oPTX0c1fB7vUxu1PR9Duq9zp-ElAmf_IM/edit?usp=sharing
    let contentLengthPerMs: number;
    switch (contentType) {
        case "application/msword":
            contentLengthPerMs = 18.09815219;
            break;
        case "application/octet-stream":
            contentLengthPerMs = 93.80196523;
            break;
        case "application/pdf":
            contentLengthPerMs = 177.3403432;
            break;
        case "application/vnd.ms-excel":
            contentLengthPerMs = 2.743330625;
            break;
        case "application/vnd.ms-powerpoint":
            contentLengthPerMs = 44.84963899;
            break;
        case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
            contentLengthPerMs = 15.98706928;
            break;
        case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
            contentLengthPerMs = 2.123474362;
            break;
        case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
            contentLengthPerMs = 21.21859109;
            break;
        case "audio/mp4":
            contentLengthPerMs = 15744.46483;
            break;
        case "audio/mpeg":
            contentLengthPerMs = 4439.042376;
            break;
        case "audio/ogg":
            contentLengthPerMs = 1036.891891;
            break;
        case "audio/wav":
            contentLengthPerMs = 12387.85636;
            break;
        case "audio/webm":
            contentLengthPerMs = 2348.717498;
            break;
        case "image/apng":
            contentLengthPerMs = 2756.044911;
            break;
        case "image/avif":
            contentLengthPerMs = 1024.810509;
            break;
        case "image/bmp":
            contentLengthPerMs = 1479.78116;
            break;
        case "image/gif":
            contentLengthPerMs = 4615.565697;
            break;
        case "image/heif":
            contentLengthPerMs = 116.2905182;
            break;
        case "image/ico":
            contentLengthPerMs = 364.2978669;
            break;
        case "image/jpeg":
            contentLengthPerMs = 1724.788421;
            break;
        case "image/png":
            contentLengthPerMs = 4225.612074;
            break;
        case "image/svg+xml":
            contentLengthPerMs = 125.1264459;
            break;
        case "image/tiff":
            contentLengthPerMs = 475.0202789;
            break;
        case "image/webp":
            contentLengthPerMs = 3118.215873;
            break;
        case "text/plain":
            contentLengthPerMs = 103.9930099;
            break;
        case "text/x-haskell":
            contentLengthPerMs = 85.96719202;
            break;
        case "video/mp4":
            contentLengthPerMs = 874.4886418;
            break;
        case "video/mpeg":
            // NOTE(calebmer): From trying to upload actual files, seems to take FFmpeg a
            // long time to transcode videos so I added the `/ 100`. Maybe we should stop
            // showing the upload spinner after uploading has finished but while
            // transcoding is occurring?
            contentLengthPerMs = 195.85926 / 100;
            break;
        case "video/quicktime":
            // NOTE(calebmer): From trying to upload actual files, seems to take FFmpeg a
            // long time to transcode videos so I added the `/ 100`. Maybe we should stop
            // showing the upload spinner after uploading has finished but while
            // transcoding is occurring?
            contentLengthPerMs = 430.7018572 / 100;
            break;
        case "video/webm":
            contentLengthPerMs = 684.892905;
            break;
        case "video/x-matroska":
            // NOTE(calebmer): From trying to upload actual files, seems to take FFmpeg a
            // long time to transcode videos so I added the `/ 100`. Maybe we should stop
            // showing the upload spinner after uploading has finished but while
            // transcoding is occurring?
            contentLengthPerMs = 186.0862023 / 100;
            break;

        // Since this is based on our test suite I only got measurements for
        // `text/x-haskell`. Use the same time for all other code content types.
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
        case "text/x-solidity":
        case "text/x-clojure":
        case "text/x-erlang":
        case "text/x-ocaml":
            contentLengthPerMs = 85.96719202;
            break;

        default:
            throw exhaustive(contentType);
    }

    // Multiply the duration from the `video/mp4` model by how long the provided
    // content type takes to process relative to `video/mp4`. For example,
    // processing `application/msword` is very slow per byte so we end up
    // multiplying the duration by ~48 (874.4886418 / 18.09815219).
    return durationMs * (874.4886418 / contentLengthPerMs);
}
