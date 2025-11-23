import status from "statuses";
import {getFileRegistry} from "~/client/web/content/file_registry_context.js";
import {
    ProgressValueStore,
    ProgressValueStoreWithCancel,
    createProgressCompositeStore,
} from "~/client/web/content/internal/progress_store.js";
import {AppContext} from "~/client/web/context/app_context.js";
import {delayScreenTransitionLoadingIndicatorLimitMs} from "~/shared/design/core/timing.js";
import {createAggregateError} from "~/shared/error/aggregate_error.js";
import {
    AbortedError,
    ErrorBase,
    InternalError,
    InvalidArgumentError,
    UnavailableError,
    UnknownError,
} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {
    FileAttachmentTarget,
    serializeFileAttachmentTargetString,
} from "~/shared/files/file_attachment_target.js";
import {
    maxFileContentLength,
    maxFileMultipartUploadPartContentLength,
} from "~/shared/files/file_constants.js";
import {
    FileContentType,
    canonicalizeFileContentTypeIfExists,
    getPathFileContentTypeIfExists,
} from "~/shared/files/file_content_type.js";
import {FileModel, getFileModelDataAttachReadiness} from "~/shared/files/file_model.js";
import {getFileContentTypeNoun} from "~/shared/files/get_file_content_type_noun.js";
import {
    CompleteFileMultipartUploadRequestPart,
    CompleteFileMultipartUploadRequestSchema,
    CreateFileMultipartUploadRequestSchema,
    CreateFileMultipartUploadResponseSchema,
    PutFileMultipartUploadPartResponseSchema,
    UploadFileResponse,
    UploadFileResponseSchema,
} from "~/shared/files/upload_file_protocol.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {Mutex} from "~/shared/helpers/async/mutex.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {waitForAbort} from "~/shared/helpers/async/wait_for_abort.js";
import {waitForReadableStreamUint8Array} from "~/shared/helpers/binary/wait_for_readable_stream_uint8_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {clamp} from "~/shared/helpers/number/clamp.js";
import {lerp} from "~/shared/helpers/number/lerp.js";
import {ReadonlyTuple} from "~/shared/helpers/types/tuple.js";
import {idLength} from "~/shared/id/id.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.js";
import {Store} from "~/shared/store/store.js";
import {fetchWithTracer} from "~/shared/tracer/fetch_with_tracer.js";

declare global {
    interface RequestInit {
        duplex?: "half";
    }
}

export type UploadFileInput =
    | {
          readonly type: "File";
          readonly file: File;
      }
    | {
          readonly type: "Url";
          readonly url: URL;
      };

const uploadFileProgressCompositeStoreWeights = [1, 2, 1] as const;

export function uploadFile(
    context: AppContext,
    options: {
        spaceId: SpaceId;
        fileId?: FileId;
        attachmentTarget: FileAttachmentTarget | null;
        input: UploadFileInput;
        onAttach: (options: {signedUrlSearch: string; file: FileModel}) => void;
    },
): Promise<void> & {readonly progressStore: Store<number>} {
    const [progressCompositeStore, progressStores] = createProgressCompositeStore(
        uploadFileProgressCompositeStoreWeights,
    );

    const promise = context.tracer.withSpan("Upload file", (context, span) => {
        span.addData({common: {type: `${options.input.type}Input`}});
        return actuallyUploadFile(context, {...options, progressStores});
    });

    return Object.assign(promise, {progressStore: progressCompositeStore});
}

async function actuallyUploadFile(
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
        attachmentTarget: FileAttachmentTarget | null;
        input: UploadFileInput;
        progressStores: ReadonlyTuple<ProgressValueStoreWithCancel, 3>;
        onAttach: (options: {signedUrlSearch: string; file: FileModel}) => void;
    },
) {
    let contentType: FileContentType | undefined;
    let contentLength: number | undefined;
    let body: File | Uint8Array | ReadableStream<Uint8Array> | undefined;
    let downloadPromise: Promise<unknown> | undefined;

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

            body = input.file;
            break;
        }
        case "Url": {
            const readyPromiseResolver = createPromiseResolver();

            const getErrorDisplayMessage = () => {
                const contentTypeNoun = getFileContentTypeNoun(
                    contentType ?? "application/octet-stream",
                );

                return errorDisplayMessage`The ${contentTypeNoun} is in an incorrect format. Try adding a different ${contentTypeNoun}.`;
            };

            const currentUrl = new URL(window.location.href);

            const currentOrigin = currentUrl.origin;
            const resourceServiceOrigin = new URL(__RESOURCE_SERVICE_URL__, currentUrl).origin;

            const isSameOrigin = input.url.origin === currentOrigin;
            const isResourceService = input.url.origin === resourceServiceOrigin;

            downloadPromise = fetchWithTracer(
                context.tracer.getTracer(),
                // If `input.url` is from the same origin as `window.location.href` or from our resource service,
                // then we don't need to use our CORS proxy. Skip the CORS proxy for better
                // performance.
                isSameOrigin || isResourceService
                    ? input.url
                    : new URL(
                          `/files/cors-proxy/${encodeURIComponent(input.url.toString())}`,
                          currentUrl,
                      ),
                {
                    serviceName: isResourceService ? "ResourceService" : "EdgeService",
                    // If we're not using the CORS proxy our route needs to be `/*` since we don't
                    // know the route pattern. However, we do sniff to see if the route looks like
                    // `/files/:spaceId/:fileId` and use that pattern if possible.
                    route:
                        isSameOrigin || isResourceService
                            ? input.url.pathname.startsWith("/files/") &&
                              input.url.pathname.slice(7).length === idLength * 2 + 1
                                ? "/files/:spaceId/:fileId"
                                : "/*"
                            : "/files/cors-proxy/:url",
                    method: "GET",
                    // To use the CORS proxy you must be authenticated with Alpine to prevent abuse.
                    credentials: isSameOrigin || isResourceService ? undefined : "include",
                    // Allow cors requests to resource service since it implements CORS controls.
                    mode: isResourceService ? "cors" : undefined,
                },
                async response => {
                    // Throw an error instead of attaching HTML/JSON file if the response doesn't
                    // have a 200 status code.
                    if (!response.ok) {
                        const statusMessage = status.message[response.status];

                        throw new UnknownError(`Fetch failed with status code ${response.status}`, {
                            displayMessage:
                                statusMessage === undefined
                                    ? errorDisplayMessage`The file download failed with HTTP status code ${response.status}.`
                                    : errorDisplayMessage`The file download failed with HTTP status code ${response.status} (${statusMessage}).`,
                        });
                    }

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
                        // No `Content-Length` header available. So we can't estimate download time.
                        // We'll say 3s which works well for medium files on a fast network but not
                        // small or large files.
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
                        window.location.protocol !== "https:"
                    ) {
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
            downloadPromise.catch(() => {});

            await readyPromiseResolver.promise;
            break;
        }
        default:
            throw exhaustive(input);
    }

    assert(body !== undefined);
    assert(contentType !== undefined);
    assert(contentLength !== undefined);

    const uploadAndProcessPromise = (async () => {
        const fileReference = await uploadFileWithMultipartUploadIfNeeded(context, {
            spaceId,
            fileId: fileId ?? null,
            contentType,
            contentLength,
            attachTarget: attachmentTarget,
            body,
            uploadProgressStore,
        });

        if (getFileModelDataAttachReadiness(fileReference.file.initialData) === "Ready") {
            processProgressStore.set(1);
            onAttach(fileReference);
            return;
        }

        const processDurationMsEstimate = estimateProcessFileDurationMs(contentType, contentLength);
        processProgressStore.ease(processDurationMsEstimate);

        let hasCalledOnAttach = false;
        let callOnAttachTimeout: Timeout | null = null;
        const promiseResolver = createPromiseResolver();

        const fileStore = getFileRegistry(spaceId).getFileStore(fileReference);

        const update = () => {
            const file = fileStore.getSnapshot();
            const attachReadiness = getFileModelDataAttachReadiness(file);

            switch (attachReadiness) {
                case "PreviewUnavailable": {
                    // Don't attach yet...
                    break;
                }
                case "PreviewPartiallyAvailable": {
                    if (!hasCalledOnAttach) {
                        // Wait a bit to call `onAttach()` in case the server quickly gives us the data
                        // we need to show a full preview so we can avoid showing the user a loading
                        // spinner.
                        callOnAttachTimeout ??= createTimeout(() => {
                            hasCalledOnAttach = true;
                            callOnAttachTimeout = null;
                            try {
                                const file = fileStore.getSnapshot();

                                onAttach({
                                    signedUrlSearch: file.signedUrlSearch,
                                    file: new FileModel(file),
                                });
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
                    promiseResolver.resolve();

                    if (!hasCalledOnAttach) {
                        hasCalledOnAttach = true;
                        callOnAttachTimeout?.clear();
                        callOnAttachTimeout = null;
                        try {
                            const file = fileStore.getSnapshot();

                            onAttach({
                                signedUrlSearch: file.signedUrlSearch,
                                file: new FileModel(file),
                            });
                        } catch (error) {
                            scheduleUncaughtError(error);
                        }
                    }
                    break;
                }
                default:
                    throw exhaustive(attachReadiness);
            }
        };

        const unsubscribe = fileStore.subscribe(update);
        update();

        const stopMaintainingFile = getFileRegistry(spaceId).startMaintainingFile(
            () => context,
            fileReference,
            attachmentTarget ?? "Uploader",
        );

        try {
            await promiseResolver.promise;
        } finally {
            stopMaintainingFile();
            unsubscribe();
        }

        processProgressStore.set(1);
    })();

    await runAllPromises([downloadPromise, uploadAndProcessPromise]);

    // If this function finishes successfully then all our progress stores should
    // have either been cancelled or set their values to 1.
    assert(downloadProgressStore.isCancelled() || downloadProgressStore.getSnapshot() === 1);
    assert(uploadProgressStore.getSnapshot() === 1);
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

async function uploadFileWithMultipartUploadIfNeeded(
    context: AppContext,
    {
        spaceId,
        fileId: providedFileId,
        contentType,
        contentLength,
        attachTarget,
        body,
        uploadProgressStore,
    }: {
        spaceId: SpaceId;
        fileId: FileId | null;
        contentType: FileContentType;
        contentLength: number;
        attachTarget: FileAttachmentTarget | null;
        body: File | Uint8Array | ReadableStream<Uint8Array>;
        uploadProgressStore: ProgressValueStore;
    },
): Promise<UploadFileResponse & {ok: true}> {
    const initialProgress = clamp(
        0,
        lerp(0.4, 0, clamp(0, contentLength / maxFileContentLength, 1)),
        0.4,
    );

    let getProgress = () => 0;

    let progressEaseTimeout: Timeout | null = null;

    // Unfortunately, Chrome only emits the `XMLHttpRequest` `progress` event:
    //
    // - ~2 seconds after the upload starts
    // - Every ~1 second thereafter
    //
    // So smooth our progress store by running an `ease()` function every 2 seconds
    // to update our upload progress to the current value.
    const updateProgress = () => {
        if (progressEaseTimeout !== null) return;

        const progress = initialProgress + getProgress() * (1 - initialProgress);
        if (progress < uploadProgressStore.getSnapshot()) return;

        uploadProgressStore.ease(2000, uploadProgressStore.getSnapshot(), progress);

        progressEaseTimeout = createTimeout(() => {
            progressEaseTimeout = null;
            updateProgress();
        }, 1000);
    };

    updateProgress();

    // If the file is small enough, we can upload directly. Otherwise we'll need to
    // perform a multipart upload.
    if (contentLength <= maxFileMultipartUploadPartContentLength) {
        const uploadUrlSearchParams = new URLSearchParams();
        if (providedFileId) uploadUrlSearchParams.set("id", providedFileId);

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
        if (attachTarget)
            uploadUrlSearchParams.set("target", serializeFileAttachmentTargetString(attachTarget));

        const uploadUrlSearchParamsString =
            uploadUrlSearchParams.size > 0 ? `?${uploadUrlSearchParams.toString()}` : "";

        const uploadUrl = new URL(
            `/api/files/${spaceId}/upload${uploadUrlSearchParamsString}`,
            window.location.href,
        );

        let progress = 0;
        getProgress = () => progress;

        return fetchWithTracer(
            context.tracer.getTracer(),
            uploadUrl,
            {
                serviceName: "EdgeService",
                method: "POST",
                route: "/api/files/:spaceId/upload",
                headers: {
                    "content-type": contentType,
                    "content-length": String(contentLength),
                },
                // We provide our own `fetch()` implementation that uses `XMLHttpRequest` since
                // `XMLHttpRequest` emits a `progress` event that we show to the user to let
                // them know their file upload progress.
                //
                // You'll notice we don't pass `body` to this `fetchWithTracer()` call. Instead
                // opting to pass the body in directly here. Since if `body` is a `File` we
                // want the browser to stream the file from disk without loading any data to
                // memory.
                fetch: async request => {
                    return fetchWithXhr(request, {
                        body:
                            // Unfortunately, `XMLHttpRequest` doesn't support streaming request bodies. So
                            // we have to load the readable stream's entire data into memory. We could use
                            // `fetch()` which supports streaming request bodies in Chrome only. But since
                            // we need the `progress` event we're stuck with `XMLHttpRequest` since Safari
                            // doesn't give us a way to inspect progress in a `fetch()` request.
                            body instanceof ReadableStream
                                ? await waitForReadableStreamUint8Array(body)
                                : body,
                        onProgress: newProgress => {
                            progress = newProgress;
                            updateProgress();
                        },
                    });
                },
            },
            async response => {
                const responseBody = UploadFileResponseSchema.deserialize(await response.json());
                if (!responseBody.ok) throw responseBody.error;

                // Make sure the upload progress store is finished.
                uploadProgressStore.set(1);

                return responseBody;
            },
        );
    }

    let stream: ReadableStream<Uint8Array>;
    if (body instanceof File) {
        stream = body.stream();
    } else if (body instanceof Uint8Array) {
        stream = new ReadableStream({
            start: controller => {
                controller.enqueue(body);
                controller.close();
            },
        });
    } else {
        stream = body;
    }

    const reader = stream.getReader();

    const {fileId, uploadId} = await fetchWithTracer(
        context.tracer.getTracer(),
        new URL(`/api/files/${spaceId}/multipart-upload`, window.location.href),
        {
            serviceName: "EdgeService",
            method: "POST",
            route: "/api/files/:spaceId/multipart-upload",
            headers: {"content-type": "application/json"},
            body: JSON.stringify(
                CreateFileMultipartUploadRequestSchema.serialize({
                    fileId: providedFileId,
                    contentType,
                    contentLength,
                    attachTarget,
                }),
            ),
        },
        async response => {
            const responseBody = CreateFileMultipartUploadResponseSchema.deserialize(
                await response.json(),
            );
            if (!responseBody.ok) throw responseBody.error;
            return responseBody;
        },
    );

    // Only send 3 part upload requests to the server at once. Users with slow
    // internet upload speeds won't benefit from parallelism.
    const mutexes = createArrayWithLength(3, () => new Mutex());

    const partContentLength = maxFileMultipartUploadPartContentLength;
    const partCount = Math.ceil(contentLength / partContentLength);
    const partProgresses = createArrayWithLength(partCount, () => 0);

    getProgress = () => {
        let progress = 0;
        for (const partProgress of partProgresses) progress += partProgress;
        progress /= partProgresses.length;
        return progress;
    };

    const abortController = new AbortController();

    const partPromises: Array<Promise<CompleteFileMultipartUploadRequestPart>> = [];

    const promise = (async () => {
        let nextPartData = new Uint8Array(
            Math.min(partContentLength, contentLength - partPromises.length * partContentLength),
        );
        let nextPartOffset = 0;

        while (true) {
            // Stop our loop if we aborted.
            if (abortController.signal.aborted) throw abortController.signal.reason;

            const {done, value: chunkData} = await reader.read();
            if (!chunkData) break;

            let chunkOffset = 0;

            while (chunkOffset < chunkData.length) {
                // Stop our loop if we aborted.
                if (abortController.signal.aborted) throw abortController.signal.reason;

                if (partPromises.length >= partCount) {
                    throw new InternalError("More parts than expected");
                }

                const chunkRemainingLength = chunkData.length - chunkOffset;
                const nextPartRemainingLength = nextPartData.length - nextPartOffset;

                if (chunkRemainingLength < nextPartRemainingLength) {
                    nextPartData.set(chunkData.subarray(chunkOffset), nextPartOffset);
                    nextPartOffset += chunkRemainingLength;
                    chunkOffset += chunkRemainingLength;
                } else {
                    nextPartData.set(
                        chunkData.subarray(chunkOffset, chunkOffset + nextPartRemainingLength),
                        nextPartOffset,
                    );
                    nextPartOffset += nextPartRemainingLength;
                    chunkOffset += nextPartRemainingLength;

                    const partNumber = partPromises.length + 1;
                    const partData = nextPartData;

                    if (partNumber >= partCount) {
                        nextPartData = new Uint8Array(0);
                        nextPartOffset = 0;
                    } else {
                        nextPartData = new Uint8Array(
                            Math.min(
                                partContentLength,
                                contentLength - partNumber * partContentLength,
                            ),
                        );
                        nextPartOffset = 0;
                    }

                    // Wait for a mutex to become available before sending our request. By awaiting
                    // here we will also pause the `ReadableStream` reader loop. So we won't read
                    // more data from our stream until a mutex is available. This will avoid
                    // loading the entire file into memory.
                    const mutex = mutexes[(partNumber - 1) % mutexes.length]!;
                    const unlock = await mutex.lock();

                    partPromises.push(
                        fetchWithTracer(
                            context.tracer.getTracer(),
                            new URL(
                                `/api/files/${spaceId}/multipart-upload/${fileId}/part/${partNumber}?upload=${uploadId}`,
                                window.location.href,
                            ),
                            {
                                serviceName: "EdgeService",
                                method: "PUT",
                                route: "/api/files/:spaceId/multipart-upload/:fileId/part/:partNumber",
                                headers: {
                                    "content-type": "application/octet-stream",
                                    "content-length": String(partData.length),
                                },
                                // We provide our own `fetch()` implementation that uses `XMLHttpRequest` since
                                // `XMLHttpRequest` emits a `progress` event that we show to the user to let
                                // them know their file upload progress.
                                //
                                // You'll notice we don't pass `body` to this `fetchWithTracer()` call. Instead
                                // opting to pass the body in directly here. Since if `body` is a `File` we
                                // want the browser to stream the file from disk without loading any data to
                                // memory.
                                fetch: async request => {
                                    try {
                                        const response = await fetchWithXhr(request, {
                                            signal: abortController.signal,
                                            body: partData,
                                            onProgress: progress => {
                                                partProgresses[partNumber - 1] = progress;
                                                updateProgress();
                                            },
                                        });

                                        return response;
                                    } catch (error) {
                                        abortController.abort(error);
                                        throw error;
                                    }
                                },
                            },
                            async response => {
                                const responseBody =
                                    PutFileMultipartUploadPartResponseSchema.deserialize(
                                        await response.json(),
                                    );
                                if (!responseBody.ok) throw responseBody.error;
                                return responseBody;
                            },
                        ).finally(unlock),
                    );
                }
            }

            assert(chunkOffset === chunkData.length);

            if (done) break;
        }
    })();

    const parts = await Promise.race([waitForAbort(abortController.signal), promise]).then(
        () => runAllPromises(partPromises),

        // Even if an error is thrown, still wait for our `partPromises` in case there
        // are any additional errors we need to log.
        async error => {
            try {
                await runAllPromises(partPromises);
            } catch (otherError) {
                throw createAggregateError([error, otherError]);
            }

            throw error;
        },
    );

    if (parts.length !== partCount) {
        throw new InternalError(`Expected ${partCount} parts but got ${parts.length} parts`);
    }

    return fetchWithTracer(
        context.tracer.getTracer(),
        new URL(
            `/api/files/${spaceId}/multipart-upload/${fileId}/complete?upload=${uploadId}`,
            window.location.href,
        ),
        {
            serviceName: "EdgeService",
            method: "POST",
            route: "/api/files/:spaceId/multipart-upload/:fileId/complete",
            headers: {"content-type": "application/json"},
            body: JSON.stringify(CompleteFileMultipartUploadRequestSchema.serialize({parts})),
        },
        async response => {
            const responseBody = UploadFileResponseSchema.deserialize(await response.json());
            if (!responseBody.ok) throw responseBody.error;

            // Make sure the upload progress store is finished.
            uploadProgressStore.set(1);

            return responseBody;
        },
    );
}

function fetchWithXhr(
    request: Request,
    {
        signal,
        body,
        onProgress,
    }: {
        signal?: AbortSignal;
        body: Uint8Array | File;
        onProgress: (progress: number) => void;
    },
): Promise<Response> {
    const xhr = new XMLHttpRequest();
    xhr.responseType = "arraybuffer";

    signal?.addEventListener("abort", () => {
        if (xhr.readyState !== XMLHttpRequest.DONE) {
            xhr.abort();
        }
    });

    xhr.upload.addEventListener("progress", event => {
        if (event.lengthComputable) {
            onProgress(event.loaded / event.total);
        }
    });

    const responsePromise = new Promise<Response>((resolve, reject) => {
        xhr.addEventListener("load", () => {
            try {
                // Make sure progress is updated to 1 after we're done loading.
                onProgress(1);

                const responseHeaders = new Headers();
                const responseHeadersString = xhr.getAllResponseHeaders();

                for (const responseHeadersStringLine of responseHeadersString
                    .trim()
                    .split(/[\r\n]+/g)) {
                    const [headerName, headerValue] = responseHeadersStringLine.split(": ", 2);

                    responseHeaders.set(headerName!, headerValue ?? "");
                }

                resolve(
                    new Response(xhr.response, {
                        status: xhr.status,
                        statusText: xhr.statusText,
                        headers: responseHeaders,
                    }),
                );
            } catch (error) {
                reject(error);
            }
        });

        xhr.addEventListener("abort", () => {
            reject(new AbortedError("Upload HTTP request aborted"));
        });

        xhr.addEventListener("error", () => {
            reject(new UnknownError("Upload HTTP request failed"));
        });
    });

    xhr.open(request.method, request.url, true);

    for (const [headerName, headerValue] of request.headers) {
        xhr.setRequestHeader(headerName, headerValue);
    }

    xhr.send(
        // TODO(calebmer, #typescript-5.9.2): Discovered after TS version upgrade, not
        // fixing for now.
        // @ts-expect-error
        body,
    );

    return responsePromise;
}
