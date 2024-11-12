import {IncomingMessage, ServerResponse} from "http";
import prettyBytes from "pretty-bytes";
import sharp from "sharp";
import {Readable as ReadableStream} from "stream";
import {FileUploader, startUploadingAndProcessingFile} from "~/server/files/data/files_table.js";
import {
    FileUploadServiceActionContext,
    FileUploadServiceSessionActionContext,
} from "~/server/files/upload/file_upload_service_context.js";
import {ReplayStream} from "~/server/files/upload/helpers/replay_stream.js";
import {createFileCodeProcessor} from "~/server/files/upload/processors/file_code_processor.js";
import {createFileIcoImageProcessor} from "~/server/files/upload/processors/file_ico_image_processor.js";
import {createFileMicrosoftOfficeDocumentProcessor} from "~/server/files/upload/processors/file_microsoft_office_document_file_processor.js";
import {createFilePdfDocumentProcessor} from "~/server/files/upload/processors/file_pdf_document_processor.js";
import {FileProcessor, fileNoopProcessor} from "~/server/files/upload/processors/file_processor.js";
import {ffprobeExecutablePath} from "~/server/files/upload/processors/file_video_and_audio_processor_base.js";
import {createFileWebSafeAudioProcessor} from "~/server/files/upload/processors/file_web_safe_audio_processor.js";
import {createFileWebSafeImageProcessor} from "~/server/files/upload/processors/file_web_safe_image_processor.js";
import {createFileWebSafeVideoProcessor} from "~/server/files/upload/processors/file_web_safe_video_processor.js";
import {createFileWebUnsafeAudioProcessor} from "~/server/files/upload/processors/file_web_unsafe_audio_processor.js";
import {createFileWebUnsafeImageProcessor} from "~/server/files/upload/processors/file_web_unsafe_image_processor.js";
import {createFileWebUnsafeVideoProcessor} from "~/server/files/upload/processors/file_web_unsafe_video_processor.js";
import {filesBucketName} from "~/server/helpers/files_cloudflare_r2_bucket_name.js";
import {runProcess} from "~/server/helpers/node/run_process.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {authorizeSpaceAccess} from "~/server/spaces/spaces_table.js";
import {
    CancelledError,
    DeadlineExceededError,
    ErrorBase,
    InvalidArgumentError,
    PermissionDeniedError,
} from "~/shared/error/error.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {
    FileContentType,
    FileMp4AudioContentType,
    FileMp4VideoContentType,
    canonicalizeFileContentTypeIfExists,
} from "~/shared/files/file_content_type.js";
import {
    UploadFileEvent,
    UploadFileEventSchema,
    uploadFileTimeoutMs,
} from "~/shared/files/upload_file_event.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {isObject} from "~/shared/helpers/object/is_object.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {isId} from "~/shared/id/id.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

// Make sure we're using our custom `sharp` `libvips` build built from
// [`cyberworlds/sharp-libvips`][1] by checking that additional modules are
// available. We put this assertion here so production will loudly fail if
// we're using the wrong `sharp` module.
//
// [1]: https://github.com/cyberworlds/sharp-libvips
assert((sharp.versions as any).de265 === "1.0.15");
assert((sharp.versions as any).graphicsmagick === "1.3.45");
assert((sharp.versions as any).pdfium === "chromium/6679");

export async function uploadFile(
    context: FileUploadServiceActionContext,
    span: TracerSpan,
    req: IncomingMessage,
    res: ServerResponse<IncomingMessage>,
    options: {
        url: URL;
        spaceId: SpaceId;
        headers: Headers;
        temporaryDirectoryPath: string;
    },
): Promise<void> {
    const sendEvent = (event: UploadFileEvent) => {
        if (!res.headersSent) {
            res.writeHead(200, {"content-type": "application/x-ndjson"});
        }

        if (!res.writableEnded) {
            res.write(JSON.stringify(UploadFileEventSchema.serialize(event)) + "\n");
        }
    };

    try {
        const promise = actuallyUploadFile(context, span, req, sendEvent, options);

        // Make sure the server doesn't shutdown while we're uploading and processing a
        // file. Otherwise we may leave the database in a bad state if we don't finish
        // cleaning up after an error, for instance.
        context.process.waitUntil(
            promise.catch(() => {
                // Ignore any errors. Errors from this promise will be handled by our
                // catch below.
            }),
        );

        await promise;

        if (!res.writableEnded) {
            res.end();
        }
    } catch (error) {
        span.addException(error);

        // If we haven't sent headers yet, make sure we write the head with an error
        // status code. If we've already sent an event we're unfortunately stuck with
        // a 200 status code. Clients will still read the error event and interpret the
        // response appropriately.
        if (!res.headersSent) {
            const status = isSystemError(error) ? 500 : 400;
            res.writeHead(status, {"content-type": "application/x-ndjson"});
        }

        if (!res.writableEnded) {
            sendEvent({type: "Error", error});
            res.end();
        }
    }
}

/**
 * Maximum size for a file uploaded to our service: 1 GB. This is the same
 * maximum file size as Slack.
 */
const maxFileByteSize = 1e9;

async function actuallyUploadFile(
    originalContext: FileUploadServiceActionContext,
    span: TracerSpan,
    req: IncomingMessage,
    sendEvent: (event: UploadFileEvent) => void,
    {
        url,
        spaceId,
        headers,
        temporaryDirectoryPath,
    }: {
        url: URL;
        spaceId: SpaceId;
        headers: Headers;
        temporaryDirectoryPath: string;
    },
): Promise<void> {
    // Make sure we've been proxied through `EdgeService` when uploading a file. We
    // don't support uploading directly from other services like `JobQueueService`.
    if (originalContext.actor.serviceName !== "EdgeService")
        throw new PermissionDeniedError("Only `EdgeService` can upload a file");

    const providedFileId = url.searchParams.get("id");
    if (providedFileId !== null && !isId<FileId>(providedFileId)) {
        throw new InvalidArgumentError('Invalid "id" URL search param');
    }

    const context = originalContext.actor.authorizeSession();

    await authorizeSpaceAccess(context, spaceId);

    if (req.method !== "POST") throw new InvalidArgumentError('Must use "POST" method');

    const originalContentType = headers.get("content-type");
    if (originalContentType === null)
        throw new InvalidArgumentError('"Content-Type" header is required');

    const contentType = canonicalizeFileContentTypeIfExists(originalContentType);

    if (contentType === null) {
        throw new InvalidArgumentError(
            quote`Unsupported "Content-Type" header ${originalContentType}`,
        );
    }

    const contentLengthString = headers.get("content-length");
    if (contentLengthString === null) {
        throw new InvalidArgumentError('"Content-Length" header is required');
    }

    const contentLength = parseInt(contentLengthString, 10);
    if (isNaN(contentLength) || !/^\d+$/.test(contentLengthString)) {
        throw new InvalidArgumentError('"Content-Length" header must be an integer');
    }

    // If the client sends more bytes than what they declared in `Content-Length`
    // then Node.js will truncate the data to `Content-Length` bytes. This behavior
    // from Node.js is important to make sure attackers can't upload files bigger
    // than 1 GB. We have a test that exercises this behavior from Node.js.
    if (contentLength > maxFileByteSize) {
        throw new InvalidArgumentError(
            `"Content-Length" of ${prettyBytes(
                contentLength,
            )} is more than our maximum file size of ${prettyBytes(maxFileByteSize)}`,
        );
    }

    let stream: ReadableStream = req;
    let fileProcessor: FileProcessor;

    // Make sure the stream (request body at this point) hasn't started outputting
    // data yet. See:
    // https://nodejs.org/api/stream.html#three-states
    assert(stream.readableFlowing === null);

    if (contentType !== "video/mp4" && contentType !== "audio/mp4") {
        fileProcessor = fileProcessorByContentType[contentType];
    } else {
        const replayStream = stream.pipe(new ReplayStream());

        // In order to know what file processor type to use for an MP4 video file we
        // need to get the codecs from the MP4 file. If the codecs are all web safe
        // then we can use a web safe processor. If the codecs are web unsafe then we
        // have to use our web unsafe video processor which is more expensive.
        fileProcessor = await selectFileMp4VideoOrAudioProcessor(
            span,
            contentType,
            contentLength,
            stream,
        );

        replayStream.ready();
        stream = replayStream;
    }

    // Make sure the stream hasn't started outputting data yet. See:
    // https://nodejs.org/api/stream.html#three-states
    assert(stream.readableFlowing === null);

    span.addData({
        file: {
            contentType,
            contentLength,
            processorType: fileProcessor.type,
        },
    });

    const abortController = new AbortController();

    const abortTimeout = createTimeout(() => {
        if (!abortController.signal.aborted) {
            abortController.abort(new DeadlineExceededError("Upload file timeout exceeded"));
        }
    }, uploadFileTimeoutMs);

    // If the request receives the `close` event before the `end` event then abort
    // the file upload since the client didn't finish sending us data.
    const handleEnd = () => {
        req.off("end", handleEnd);
        req.off("close", handleClose);
    };
    const handleClose = () => {
        if (!abortController.signal.aborted) {
            abortController.abort(new CancelledError("Upload file request closed prematurely"));
        }
    };
    req.on("end", handleEnd);
    req.on("close", handleClose);

    try {
        const fileUploader = await startUploadingAndProcessingFile(context, {
            spaceId,
            fileId: providedFileId,
            contentType,
            contentLength,
            hasAlternative: !!fileProcessor.hasAlternative,
            hasPreview: fileProcessor.hasPreview,
        });

        span.addPropagatedData({context: {fileId: fileUploader.fileId}});

        await uploadAndProcessFile(context, {
            spaceId,
            contentType,
            contentLength,
            fileProcessor,
            fileUploader,
            stream,
            sendEvent,
            signal: abortController.signal,
            temporaryDirectoryPath,
            createAbortCatcher: message => error => {
                if (!abortController.signal.aborted) {
                    abortController.abort(new CancelledError(message, {cause: error}));
                }
                throw error;
            },
        });
    } finally {
        abortTimeout.clear();
        req.off("end", handleEnd);
        req.off("close", handleClose);
    }
}

async function uploadAndProcessFile(
    context: FileUploadServiceSessionActionContext,
    {
        spaceId,
        contentType,
        contentLength,
        fileProcessor,
        fileUploader,
        stream,
        sendEvent,
        temporaryDirectoryPath,
        signal,
        createAbortCatcher,
    }: {
        spaceId: SpaceId;
        contentType: FileContentType;
        contentLength: number;
        fileProcessor: FileProcessor;
        fileUploader: FileUploader;
        stream: ReadableStream;
        sendEvent: (event: UploadFileEvent) => void;
        temporaryDirectoryPath: string;
        signal: AbortSignal;
        createAbortCatcher: (message: string) => (error: unknown) => never;
    },
) {
    // The client won't be able to use the preview URL until the preview has
    // finished processing. But given the URL expires in 10 minutes processing
    // should finish before the URL expires.
    const signedUrl = await context.files.dangerouslySignFileUrlWithoutAuthorization(
        spaceId,
        fileUploader.fileId,
    );

    sendEvent({
        type: "Start",
        fileId: fileUploader.fileId,
        hasAlternative: !!fileProcessor.hasAlternative,
        hasPreview: fileProcessor.hasPreview,
        signedUrlSearch: signedUrl.search,
    });

    // Make sure the stream hasn't started outputting data yet. See:
    // https://nodejs.org/api/stream.html#three-states
    assert(stream.readableFlowing === null);

    // NOTE(calebmer, 2024-08-26): May be worth considering multipart uploads
    // someday if we want to support users on spotty internet connections or speed
    // up large file uploads (for files >100 MB). For now, the simplicity of doing
    // all processing in one shot within `FileUploadService` is nice.
    const uploadPromise = (async () => {
        // TODO(calebmer, #files): Consider transitioning objects to infrequent access
        // after 1-3 months?
        // https://developers.cloudflare.com/r2/buckets/object-lifecycles

        // NOTE: We don't `Promise.race()` `PutObject()` with
        // `waitForAbort(signal)` since we need to wait for the `PutObject()` to
        // finish in order for `fileUploader.cleanupAfterUnacceptableError()` to
        // successfully cleanup the object.
        //
        // `PutObject()` should respect `signal` so we can handle the case where the
        // request closes before it ends.
        await context.r2.PutObject(
            {
                Bucket: filesBucketName,
                Key: `${spaceId}/${fileUploader.fileId}`,
                ContentType: contentType,
                Body: stream,
            },
            {signal},
        );

        if (signal.aborted) throw signal.reason;

        await fileUploader.finishUploading(context);
    })().catch(createAbortCatcher("File uploading failed"));

    const actualCreateAbortCatcher = createAbortCatcher;

    let processPromise: Promise<void> | null;

    if (!fileProcessor.hasPreview) {
        processPromise = null;
    } else {
        processPromise = context.tracer.withSpan("Process file", async (context, span) => {
            span.addData({
                file: {
                    contentType,
                    contentLength,
                    processorType: fileProcessor.type,
                },
            });

            const {
                extraPromise,
                alternativePromise,
                imagePreviewSizePromise,
                imagePreviewPlaceholderPromise,
                imagePreviewContentPromise,
                imagePreviewVideoDurationPromise,
                audioPreviewDurationPromise,
                audioPreviewMetadataPromise,
                codePreviewContentPromise,
            } = fileProcessor.process(stream, signal, {
                span,
                fileId: fileUploader.fileId,
                contentLength,
                temporaryDirectoryPath,
            });

            let hasAcceptedPreviewError = false;

            const createAbortCatcherWithoutAcceptError = actualCreateAbortCatcher;

            const createAbortCatcher = (message: string) => {
                const abortCatcher = createAbortCatcherWithoutAcceptError(message);

                return async (error: unknown) => {
                    if (hasAcceptedPreviewError) throw error;

                    if (!signal.aborted && error instanceof ErrorBase && error.displayMessage) {
                        const acceptError = fileProcessor.acceptError?.(
                            error,
                            error.displayMessage,
                        );

                        if (acceptError) {
                            hasAcceptedPreviewError = true;

                            // NOTE(calebmer, 2024-09-10): Currently `acceptError` only works with image
                            // previews. There's no reason we couldn't support other types of previews.
                            // We're waiting on examples of other types of previews with acceptable errors.
                            await fileUploader.finishProcessingImagePreviewAfterAcceptableError(
                                context,
                                {
                                    code: error.code,
                                    displayMessage: error.displayMessage,
                                },
                            );

                            sendEvent({
                                type: "PreviewError",
                                error: {
                                    code: error.code,
                                    displayMessage: error.displayMessage,
                                },
                            });
                            throw error;
                        }
                    }

                    return abortCatcher(error);
                };
            };

            // We wait for the extra promise to finish before we consider processing to be
            // complete. But the extra promise doesn't return any data. Useful if you've
            // resolved all other promises with streams but want a promise that'll wait for
            // the stream to complete.
            const actualExtraPromise = extraPromise?.catch(createAbortCatcherWithoutAcceptError);

            const actualAlternativePromise = alternativePromise
                ? (async () => {
                      const alternative = await alternativePromise;
                      if (signal.aborted) throw signal.reason;

                      let dataContentLength: number = 0;
                      if (alternative.data instanceof Buffer) {
                          dataContentLength = alternative.data.length;
                      } else {
                          alternative.data.on("data", (chunk: Buffer) => {
                              dataContentLength += chunk.length;
                          });
                      }

                      // NOTE: We don't `Promise.race()` `PutObject()` with
                      // `waitForAbort(signal)` since we need to wait for the `PutObject()` to
                      // finish in order for `fileUploader.cleanupAfterUnacceptableError()` to
                      // successfully cleanup the object.
                      await context.r2.PutObject(
                          {
                              Bucket: filesBucketName,
                              Key: `${spaceId}/${fileUploader.fileId}-alternative`,
                              ContentType: alternative.contentType,
                              Body: alternative.data,
                          },
                          {signal},
                      );

                      await fileUploader.finishProcessingAlternative(context, {
                          contentType: alternative.contentType,
                          contentLength: dataContentLength,
                      });

                      sendEvent({
                          type: "Alternative",
                          contentType: alternative.contentType,
                          contentLength: dataContentLength,
                          isImagePreviewContent: false,
                      });

                      return {
                          file: {
                              alternative: {
                                  contentType: alternative.contentType,
                                  contentLength: dataContentLength,
                                  contentLengthRatio: dataContentLength / contentLength,
                              },
                          },
                      };
                  })().catch(
                      // We don't currently allow errors from alternative file generation to be
                      // accepted. If a file has an alternative then the alternative must be
                      // generated. Also, accepted errors are stored in `preview`. This would leave
                      // `alternative` in a processing state forever.
                      createAbortCatcherWithoutAcceptError("File alternative processing failed"),
                  )
                : null;

            const actualImagePreviewSizePromise = imagePreviewSizePromise
                ? (async () => {
                      const {videoDuration, ...size} = await imagePreviewSizePromise;
                      if (signal.aborted) throw signal.reason;
                      if (hasAcceptedPreviewError) return;

                      await fileUploader.finishProcessingImagePreviewSize(
                          context,
                          size,
                          videoDuration !== undefined
                              ? {alsoPreviewVideoDuration: videoDuration}
                              : undefined,
                      );

                      sendEvent({
                          type: "ImagePreviewSize",
                          size,
                      });

                      if (videoDuration !== undefined) {
                          sendEvent({
                              type: "ImagePreviewVideoDuration",
                              videoDuration,
                          });
                      }

                      return {
                          file: {
                              preview: {
                                  imageWidth: size.width,
                                  imageHeight: size.height,
                                  imageScale: size.scale,
                                  imageHasAlpha: size.hasAlpha,
                                  imageVideoDurationMs: videoDuration,
                              },
                          },
                      };
                  })().catch(createAbortCatcher("File image preview size processing failed"))
                : null;

            const actualImagePreviewPlaceholderPromise = imagePreviewPlaceholderPromise
                ? (async () => {
                      const placeholder = await imagePreviewPlaceholderPromise;
                      if (signal.aborted) throw signal.reason;
                      if (hasAcceptedPreviewError) return;

                      await fileUploader.finishProcessingImagePreviewPlaceholder(
                          context,
                          placeholder,
                      );

                      sendEvent({
                          type: "ImagePreviewPlaceholder",
                          placeholder,
                      });
                  })().catch(createAbortCatcher("File image preview placeholder processing failed"))
                : null;

            const actualImagePreviewContentPromise = imagePreviewContentPromise
                ? (async () => {
                      const content = await imagePreviewContentPromise;
                      if (signal.aborted) throw signal.reason;
                      if (hasAcceptedPreviewError) return;

                      let dataContentLength: number = 0;
                      if (content.data instanceof Buffer) {
                          dataContentLength = content.data.length;
                      } else {
                          content.data.on("data", (chunk: Buffer) => {
                              dataContentLength += chunk.length;
                          });
                      }

                      // NOTE: We don't `Promise.race()` `PutObject()` with
                      // `waitForAbort(signal)` since we need to wait for the `PutObject()` to
                      // finish in order for `fileUploader.cleanupAfterUnacceptableError()` to
                      // successfully cleanup the object.
                      await context.r2.PutObject(
                          {
                              Bucket: filesBucketName,
                              Key: `${spaceId}/${fileUploader.fileId}-preview`,
                              ContentType: content.contentType,
                              Body: content.data,
                          },
                          {signal},
                      );

                      if (signal.aborted) throw signal.reason;
                      if (hasAcceptedPreviewError) return;

                      await fileUploader.finishProcessingImagePreviewContent(context, {
                          contentType: content.contentType,
                          contentLength: dataContentLength,
                          isAlternative: fileProcessor.hasAlternative === "ImagePreviewContent",
                      });

                      sendEvent({
                          type: "ImagePreviewContent",
                          contentType: content.contentType,
                          contentLength: dataContentLength,
                      });

                      if (fileProcessor.hasAlternative === "ImagePreviewContent") {
                          sendEvent({
                              type: "Alternative",
                              contentType: content.contentType,
                              contentLength: dataContentLength,
                              isImagePreviewContent: true,
                          });
                      }

                      return {
                          file: {
                              preview: {
                                  contentType: content.contentType,
                                  contentLength: dataContentLength,
                                  contentLengthRatio: dataContentLength / contentLength,
                              },
                              alternative:
                                  fileProcessor.hasAlternative === "ImagePreviewContent"
                                      ? {
                                            contentType: content.contentType,
                                            contentLength: dataContentLength,
                                            contentLengthRatio: dataContentLength / contentLength,
                                        }
                                      : undefined,
                          },
                      };
                  })().catch(createAbortCatcher("File image preview content processing failed"))
                : null;

            const actualImagePreviewVideoDurationPromise = imagePreviewVideoDurationPromise
                ? (async () => {
                      const videoDuration = await imagePreviewVideoDurationPromise;
                      if (signal.aborted) throw signal.reason;
                      if (hasAcceptedPreviewError) return;

                      const {wasUpdated} =
                          await fileUploader.finishProcessingImagePreviewVideoDurationIfNeeded(
                              context,
                              videoDuration,
                          );

                      if (wasUpdated) {
                          sendEvent({
                              type: "ImagePreviewVideoDuration",
                              videoDuration,
                          });
                      }

                      return {
                          file: {preview: {imageVideoDurationMs: videoDuration}},
                          // Record if there was no update (since `imagePreviewSizePromise` saved the video
                          // duration). The `child` key will only be added to `childSpan` and not our
                          // parent processor span.
                          child: {common: {didNothing: !wasUpdated}},
                      };
                  })().catch(
                      createAbortCatcher("File image preview video duration processing failed"),
                  )
                : null;

            const actualAudioPreviewDurationPromise = audioPreviewDurationPromise
                ? (async () => {
                      const duration = await audioPreviewDurationPromise;
                      if (signal.aborted) throw signal.reason;
                      if (hasAcceptedPreviewError) return;

                      await fileUploader.finishProcessingAudioPreviewDuration(context, duration);

                      sendEvent({
                          type: "AudioPreviewDuration",
                          duration,
                      });

                      return {
                          file: {preview: {audioDurationMs: duration}},
                      };
                  })().catch(createAbortCatcher("File audio preview duration processing failed"))
                : null;

            const actualAudioPreviewMetadataPromise = audioPreviewMetadataPromise
                ? (async () => {
                      const metadata = await audioPreviewMetadataPromise;
                      if (signal.aborted) throw signal.reason;
                      if (hasAcceptedPreviewError) return;

                      await fileUploader.finishProcessingAudioPreviewMetadata(context, metadata);

                      sendEvent({
                          type: "AudioPreviewMetadata",
                          metadata,
                      });
                  })().catch(createAbortCatcher("File audio preview metadata processing failed"))
                : null;

            const actualCodePreviewContentPromise = codePreviewContentPromise
                ? (async () => {
                      const content = await codePreviewContentPromise;
                      if (signal.aborted) throw signal.reason;
                      if (hasAcceptedPreviewError) return;

                      await fileUploader.finishProcessingCodePreviewContent(context, content);

                      sendEvent({
                          type: "CodePreviewContent",
                          content,
                      });

                      return {
                          file: {preview: {codeContentLength: content.serialize().length}},
                      };
                  })().catch(createAbortCatcher("File code preview content processing failed"))
                : null;

            const sharedChildSpanData = {
                file: {
                    contentType,
                    contentLength,
                    processorType: fileProcessor.type,
                },
            };

            // Specific file processors often have dependencies on one another, e.g.
            // "Process file preview size" depends on "Process file alternative" for Microsoft Word
            // documents. However, we intentionally measure spans from the start of file processing
            // so that when we look at the duration we get the user duration perceived by the user
            // (since as each of these resolves we `sendEvent()` to the user).
            await runAllPromises([
                actualExtraPromise,
                actualAlternativePromise
                    ? span.withSpan("Process file alternative", async childSpan => {
                          childSpan.addData(sharedChildSpanData);
                          const spanData = await actualAlternativePromise;
                          childSpan.addData(spanData);
                          span.addData(spanData);
                      })
                    : null,
                actualImagePreviewSizePromise
                    ? span.withSpan("Process file image preview size", async childSpan => {
                          childSpan.addData(sharedChildSpanData);
                          const spanData = await actualImagePreviewSizePromise;
                          if (spanData) {
                              childSpan.addData(spanData);
                              span.addData(spanData);
                          }
                      })
                    : null,
                actualImagePreviewPlaceholderPromise
                    ? span.withSpan("Process file image preview placeholder", async childSpan => {
                          childSpan.addData(sharedChildSpanData);
                          await actualImagePreviewPlaceholderPromise;
                      })
                    : null,
                actualImagePreviewContentPromise
                    ? span.withSpan("Process file image preview image", async childSpan => {
                          childSpan.addData(sharedChildSpanData);
                          const spanData = await actualImagePreviewContentPromise;
                          if (spanData) {
                              childSpan.addData(spanData);
                              span.addData(spanData);
                          }
                      })
                    : null,
                actualImagePreviewVideoDurationPromise
                    ? span.withSpan(
                          "Process file image preview video duration",
                          async childSpan => {
                              childSpan.addData(sharedChildSpanData);
                              const spanData = await actualImagePreviewVideoDurationPromise;
                              if (spanData) {
                                  const {child: childSpanData, ...sharedSpanData} = spanData;
                                  childSpan.addData(childSpanData);
                                  childSpan.addData(sharedSpanData);
                                  span.addData(sharedSpanData);
                              }
                          },
                      )
                    : null,
                actualAudioPreviewDurationPromise
                    ? span.withSpan("Process file audio preview duration", async childSpan => {
                          childSpan.addData(sharedChildSpanData);
                          const spanData = await actualAudioPreviewDurationPromise;
                          if (spanData) {
                              childSpan.addData(spanData);
                              span.addData(spanData);
                          }
                      })
                    : null,
                actualAudioPreviewMetadataPromise
                    ? span.withSpan("Process file audio preview metadata", async childSpan => {
                          childSpan.addData(sharedChildSpanData);
                          await actualAudioPreviewMetadataPromise;
                      })
                    : null,
                actualCodePreviewContentPromise
                    ? span.withSpan("Process file code preview content", async childSpan => {
                          childSpan.addData(sharedChildSpanData);
                          const spanData = await actualCodePreviewContentPromise;
                          if (spanData) {
                              childSpan.addData(spanData);
                              span.addData(spanData);
                          }
                      })
                    : null,
            ]).catch(error => {
                // If we caught the processing error, then don't fail our entire upload job. We
                // finished processing but stored an error in the database.
                if (hasAcceptedPreviewError) return;

                throw error;
            });
        });
    }

    await runAllPromises([uploadPromise, processPromise]).catch(async error => {
        await fileUploader.cleanupAfterUnacceptableError(context);
        throw error;
    });

    sendEvent({type: "Finish"});
}

const createFileProcessorByContentType: {
    [Key in Exclude<FileContentType, FileMp4VideoContentType | FileMp4AudioContentType>]: (
        contentType: Key,
    ) => FileProcessor;
} = {
    "application/octet-stream": () => fileNoopProcessor,
    "image/apng": createFileWebSafeImageProcessor,
    "image/avif": createFileWebSafeImageProcessor,
    "image/gif": createFileWebSafeImageProcessor,
    "image/jpeg": createFileWebSafeImageProcessor,
    "image/png": createFileWebSafeImageProcessor,
    "image/svg+xml": createFileWebSafeImageProcessor,
    "image/webp": createFileWebSafeImageProcessor,
    "image/bmp": createFileWebUnsafeImageProcessor,
    "image/ico": createFileIcoImageProcessor,
    "image/tiff": createFileWebUnsafeImageProcessor,
    "image/heif": createFileWebUnsafeImageProcessor,
    "application/pdf": createFilePdfDocumentProcessor,
    "application/msword": createFileMicrosoftOfficeDocumentProcessor,
    "application/vnd.ms-excel": createFileMicrosoftOfficeDocumentProcessor,
    "application/vnd.ms-powerpoint": createFileMicrosoftOfficeDocumentProcessor,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        createFileMicrosoftOfficeDocumentProcessor,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
        createFileMicrosoftOfficeDocumentProcessor,
    "application/vnd.openxmlformats-officedocument.presentationml.presentation":
        createFileMicrosoftOfficeDocumentProcessor,
    "video/webm": createFileWebSafeVideoProcessor,
    "video/quicktime": createFileWebUnsafeVideoProcessor,
    "video/mpeg": createFileWebUnsafeVideoProcessor,
    "video/x-matroska": createFileWebUnsafeVideoProcessor,
    "audio/mpeg": createFileWebSafeAudioProcessor,
    "audio/wav": createFileWebSafeAudioProcessor,
    "audio/webm": createFileWebSafeAudioProcessor,
    "audio/ogg": createFileWebUnsafeAudioProcessor,
    "text/plain": createFileCodeProcessor,
    "text/javascript": createFileCodeProcessor,
    "text/html": createFileCodeProcessor,
    "text/css": createFileCodeProcessor,
    "application/sql": createFileCodeProcessor,
    "text/x-python": createFileCodeProcessor,
    "text/x-typescript": createFileCodeProcessor,
    "application/x-sh": createFileCodeProcessor,
    "text/x-java": createFileCodeProcessor,
    "application/json": createFileCodeProcessor,
    "text/markdown": createFileCodeProcessor,
    "text/x-csharp": createFileCodeProcessor,
    "text/x-c++src": createFileCodeProcessor,
    "text/x-csrc": createFileCodeProcessor,
    "application/x-httpd-php": createFileCodeProcessor,
    "text/x-go": createFileCodeProcessor,
    "application/yaml": createFileCodeProcessor,
    "application/x-powershell": createFileCodeProcessor,
    "text/rust": createFileCodeProcessor,
    "text/x-kotlin": createFileCodeProcessor,
    "application/x-ruby": createFileCodeProcessor,
    "text/x-lua": createFileCodeProcessor,
    "application/xml": createFileCodeProcessor,
    "application/vnd.dart": createFileCodeProcessor,
    "text/x-swift": createFileCodeProcessor,
    "text/x-asm": createFileCodeProcessor,
    "application/wasm": createFileCodeProcessor,
    "text/x-scala": createFileCodeProcessor,
    "text/x-r": createFileCodeProcessor,
    "text/x-elixir": createFileCodeProcessor,
    "text/x-objcsrc": createFileCodeProcessor,
    "text/x-perl": createFileCodeProcessor,
    "text/x-haskell": createFileCodeProcessor,
    "text/x-solidity": createFileCodeProcessor,
    "text/x-clojure": createFileCodeProcessor,
    "text/x-erlang": createFileCodeProcessor,
    "text/x-ocaml": createFileCodeProcessor,
};

const fileProcessorByContentType: {
    [Key in Exclude<
        FileContentType,
        FileMp4VideoContentType | FileMp4AudioContentType
    >]: FileProcessor;
} = mapObjectValues(createFileProcessorByContentType, (createFileProcessor, contentType) =>
    (createFileProcessor as any)(contentType),
);

const fileWebSafeMp4VideoProcessor = createFileWebSafeVideoProcessor("video/mp4");
const fileWebUnsafeMp4VideoProcessor = createFileWebUnsafeVideoProcessor("video/mp4");
const fileWebSafeMp4AudioProcessor = createFileWebSafeAudioProcessor("audio/mp4");
const fileWebUnsafeMp4AudioProcessor = createFileWebUnsafeAudioProcessor("audio/mp4");

const ffmpegWebSafeMp4CodecNames = new Set([
    "av1",
    "libaom-av1",
    "h264",
    "vp9",
    "libvpx-vp9",
    "flac",
    "mp3",
    "mp3float",
    "opus",
    "libopus",
    "aac",
    "aac_fixed",
    "aac_at",
]);

function selectFileMp4VideoOrAudioProcessor(
    span: TracerSpan,
    contentType: FileMp4VideoContentType | FileMp4AudioContentType,
    contentLength: number,
    stream: ReadableStream,
): Promise<FileProcessor> {
    // Even though technically we're using the FFprobe executable we still name the
    // span "FFmpeg ..." which'll make it easier for us to search for spans that
    // call one of the FFmpeg tools.
    return span.withSpan("FFmpeg get codecs", async span => {
        span.addData({
            file: {contentType, contentLength},
        });

        const codecNamesString = await runProcess(
            ffprobeExecutablePath,
            [
                ["-v", "error"],
                ["-show_entries", "stream=codec_name"],
                ["-of", "default=noprint_wrappers=1:nokey=1"],
                "-",
            ],
            {
                cwd: runfilesPath,
                stdin: stream,
                onStdinError: error => {
                    // `EPIPE` errors are expected. FFmpeg will close its side of stdin once it has
                    // found the video's metadata. We can unpipe `pausedStream` once we get an `EPIPE`
                    // error as we don't need data from our input anymore.
                    if (isObject(error) && error.code === "EPIPE") {
                        return {preventDefault: true};
                    }
                },
            },
        );

        const codecNames = codecNamesString.trim().split("\n");
        let webSafeCodecCount = 0;

        for (const codecName of codecNames) {
            if (ffmpegWebSafeMp4CodecNames.has(codecName)) {
                webSafeCodecCount++;
            }
        }

        // If there are at least 2 web safe codecs in the file (for video) then we
        // consider the MP4 to be web safe.
        const expectedWebSafeCodecCount = contentType === "audio/mp4" ? 1 : 2;

        let processor: FileProcessor;
        if (
            Math.min(webSafeCodecCount, expectedWebSafeCodecCount) ===
            Math.min(codecNames.length, expectedWebSafeCodecCount)
        ) {
            processor =
                contentType === "audio/mp4"
                    ? fileWebSafeMp4AudioProcessor
                    : fileWebSafeMp4VideoProcessor;
        } else {
            processor =
                contentType === "audio/mp4"
                    ? fileWebUnsafeMp4AudioProcessor
                    : fileWebUnsafeMp4VideoProcessor;
        }

        span.addData({
            ffmpeg: {codecs: codecNames.join("/")},
            file: {processorType: processor.type},
        });

        return processor;
    });
}
