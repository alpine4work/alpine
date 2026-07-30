import {isCloudflareR2ConditionConflictError} from "~/server/cloudflare/r2/cloudflare_r2_client.js";
import {FileProcessorActionContext} from "~/server/files/data/file_processor_context.js";
import {fileProcessorDeclarationByContentType} from "~/server/files/data/file_processor_declaration_by_content_type.js";
import {getFileUploaderAsUploader} from "~/server/files/data/files_actions.js";
import {getFileProcessorErrors} from "~/server/files/processor/error/file_processor_error.js";
import {FileProcessTranscriptJson} from "~/server/files/processor/process_file_analysis.js";
import {createFileCodeProcessor} from "~/server/files/processor/processors/file_code_processor.js";
import {createFileIcoImageProcessor} from "~/server/files/processor/processors/file_ico_image_processor.js";
import {createFileMicrosoftOfficeDocumentProcessor} from "~/server/files/processor/processors/file_microsoft_office_document_file_processor.js";
import {createFileMp4AudioProcessor} from "~/server/files/processor/processors/file_mp4_audio_processor.js";
import {createFileMp4VideoProcessor} from "~/server/files/processor/processors/file_mp4_video_processor.js";
import {createFilePdfDocumentProcessor} from "~/server/files/processor/processors/file_pdf_document_processor.js";
import {
    FileProcessor,
    fileNoopProcessor,
} from "~/server/files/processor/processors/file_processor.js";
import {createFileWebSafeAudioProcessor} from "~/server/files/processor/processors/file_web_safe_audio_processor.js";
import {createFileWebSafeImageProcessor} from "~/server/files/processor/processors/file_web_safe_image_processor.js";
import {createFileWebSafeVideoProcessor} from "~/server/files/processor/processors/file_web_safe_video_processor.js";
import {createFileWebUnsafeAudioProcessor} from "~/server/files/processor/processors/file_web_unsafe_audio_processor.js";
import {createFileWebUnsafeImageProcessor} from "~/server/files/processor/processors/file_web_unsafe_image_processor.js";
import {createFileWebUnsafeVideoProcessor} from "~/server/files/processor/processors/file_web_unsafe_video_processor.js";
import {filesBucketName} from "~/server/helpers/files_cloudflare_r2_bucket_name.js";
import {withTemporaryDirectory} from "~/server/helpers/node/with_temporary_directory.js";
import {createAggregateError} from "~/shared/error/aggregate_error.js";
import {
    AbortedError,
    DeadlineExceededError,
    FailedPreconditionError,
    InternalError,
} from "~/shared/error/error.js";
import {fileProcessorTimeoutMs} from "~/shared/files/file_constants.js";
import {
    FileContentType,
    canonicalizeFileContentTypeIfExists,
} from "~/shared/files/file_content_type.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

export async function processFile(
    context: FileProcessorActionContext,
    span: TracerSpan,
    {
        spaceId,
        fileId,
        contentType,
        temporaryDirectoryPath: parentTemporaryDirectoryPath,
    }: {
        spaceId: SpaceId;
        fileId: FileId;
        contentType: FileContentType;
        temporaryDirectoryPath: string;
    },
) {
    span.addPropagatedData({context: {spaceId, fileId}});

    const fileUploader = await getFileUploaderAsUploader(context, fileId);
    const contentLength = fileUploader.getContentLength();

    span.addPropagatedData({context: {accountId: fileUploader.uploaderId}});

    if (contentType !== fileUploader.getContentType()) {
        throw new FailedPreconditionError(
            quote`File content type mismatch, expected content type ${contentType} but content type is actually ${fileUploader.getContentType()}`,
        );
    }

    const fileProcessor = fileProcessorByContentType[contentType];

    span.addData({
        file: {
            contentType,
            contentLength,
            processorType: fileProcessor.type,
        },
    });

    if (!fileProcessor.hasPreview) return;

    const startTime = span.clock.now();

    const caughtErrors: Array<unknown> = [];

    const abortController = new AbortController();
    const signal = abortController.signal;

    const abortTimeout = createTimeout(() => {
        abortController.abort(new DeadlineExceededError("File processing timed out"));
    }, fileProcessorTimeoutMs);

    const promise = (async () => {
        const promises = await fileProcessor.process(context, {
            spaceId,
            fileId,
            signal,
            contentLength,
            parentTemporaryDirectoryPath,
            withTemporaryDirectory: () => {
                const temporaryDirectoryPathPromiseResolver = createPromiseResolver<string>();

                withTemporaryDirectory(
                    parentTemporaryDirectoryPath,
                    `${fileId}_`,
                    temporaryDirectoryPath => {
                        temporaryDirectoryPathPromiseResolver.resolve(temporaryDirectoryPath);
                        return promise;
                    },
                ).catch(error => {
                    temporaryDirectoryPathPromiseResolver.reject(error);
                });

                return temporaryDirectoryPathPromiseResolver.promise;
            },
        });

        const alternativePromise = promises.alternativePromise
            ? (async () => {
                  const alternative = await promises.alternativePromise;

                  let alternativeWithoutData: {
                      contentType: FileContentType;
                      contentLength: number;
                  } | null = alternative;

                  if (alternative !== null) {
                      try {
                          await context.r2.PutObject(
                              {
                                  Bucket: filesBucketName,
                                  Key: `${spaceId}/${fileUploader.fileId}-alternative`,
                                  ContentType: alternative.contentType,
                                  ContentLength: alternative.contentLength,
                                  Body: alternative.data,
                                  // Error if an object already exists at this key. We don't want to override objects
                                  // that already exist.
                                  IfNoneMatch: "*",
                              },
                              {signal},
                          );
                      } catch (error) {
                          if (!isCloudflareR2ConditionConflictError(error)) throw error;

                          // If an object already exists at the alternative key then we shouldn't override
                          // it! Instead, get the metadata of the existing object and use that to update our
                          // database.
                          const object = await context.r2.HeadObject({
                              Bucket: filesBucketName,
                              Key: `${spaceId}/${fileUploader.fileId}-alternative`,
                          });

                          const contentType = object.ContentType
                              ? canonicalizeFileContentTypeIfExists(object.ContentType)
                              : null;

                          const contentLength = object.ContentLength;

                          if (!contentType || contentLength === undefined) {
                              throw new InternalError(
                                  "Missing `Content-Type` or `Content-Length` header",
                              );
                          }

                          alternativeWithoutData = {contentType, contentLength};
                      }
                  }

                  await fileUploader.finishProcessingAlternative(context, alternativeWithoutData);

                  if (alternative !== null) {
                      span.addData({
                          file: {
                              alternative: {
                                  contentType: alternative.contentType,
                                  contentLength: alternative.contentLength,
                                  contentLengthRatio: alternative.contentLength / contentLength,
                              },
                          },
                      });
                  }
              })()
            : null;

        const imagePreviewSizePromise = promises.imagePreviewSizePromise
            ? (async () => {
                  const {videoDuration, ...size} = await promises.imagePreviewSizePromise;

                  await fileUploader.finishProcessingImagePreviewSize(
                      context,
                      size,
                      videoDuration !== undefined
                          ? {alsoPreviewVideoDuration: videoDuration}
                          : undefined,
                  );

                  span.addData({
                      file: {
                          preview: {
                              imageWidth: size.width,
                              imageHeight: size.height,
                              imageScale: size.scale,
                              imageHasAlpha: size.hasAlpha,
                              imageVideoDurationMs: videoDuration,
                          },
                      },
                  });
              })()
            : null;

        const imagePreviewPlaceholderPromise = promises.imagePreviewPlaceholderPromise
            ? (async () => {
                  const placeholder = await promises.imagePreviewPlaceholderPromise;

                  await fileUploader.finishProcessingImagePreviewPlaceholder(context, placeholder);
              })()
            : null;

        const imagePreviewContentPromise = promises.imagePreviewContentPromise
            ? (async () => {
                  const content = await promises.imagePreviewContentPromise;

                  let contentWithoutData: {
                      contentType: FileContentType;
                      contentLength: number;
                  } = content;

                  try {
                      await context.r2.PutObject(
                          {
                              Bucket: filesBucketName,
                              Key: `${spaceId}/${fileUploader.fileId}-preview`,
                              ContentType: content.contentType,
                              ContentLength: content.contentLength,
                              Body: content.data,
                              // Error if an object already exists at this key. We don't want to override objects
                              // that already exist.
                              IfNoneMatch: "*",
                          },
                          {signal},
                      );
                  } catch (error) {
                      if (!isCloudflareR2ConditionConflictError(error)) throw error;

                      // If an object already exists at the preview key then we shouldn't override it!
                      // Instead, get the metadata of the existing object and use that to update our
                      // database.
                      const object = await context.r2.HeadObject({
                          Bucket: filesBucketName,
                          Key: `${spaceId}/${fileUploader.fileId}-preview`,
                      });

                      const contentType = object.ContentType
                          ? canonicalizeFileContentTypeIfExists(object.ContentType)
                          : null;

                      const contentLength = object.ContentLength;

                      if (!contentType || contentLength === undefined) {
                          throw new InternalError(
                              "Missing `Content-Type` or `Content-Length` header",
                          );
                      }

                      contentWithoutData = {contentType, contentLength};
                  }

                  await fileUploader.finishProcessingImagePreviewContent(context, {
                      contentType: contentWithoutData.contentType,
                      contentLength: contentWithoutData.contentLength,
                      isAlternative: fileProcessor.hasAlternative === "ImagePreviewContent",
                  });

                  span.addData({
                      file: {
                          preview: {
                              contentType: content.contentType,
                              contentLength: content.contentLength,
                              contentLengthRatio: content.contentLength / contentLength,
                          },
                          alternative:
                              fileProcessor.hasAlternative === "ImagePreviewContent"
                                  ? {
                                        contentType: content.contentType,
                                        contentLength: content.contentLength,
                                        contentLengthRatio: content.contentLength / contentLength,
                                    }
                                  : undefined,
                      },
                  });
              })()
            : null;

        const imagePreviewVideoDurationPromise = promises.imagePreviewVideoDurationPromise
            ? (async () => {
                  const videoDuration = await promises.imagePreviewVideoDurationPromise;

                  await fileUploader.finishProcessingImagePreviewVideoDurationIfNeeded(
                      context,
                      videoDuration,
                  );

                  span.addData({
                      file: {preview: {imageVideoDurationMs: videoDuration}},
                  });

                  return videoDuration;
              })()
            : null;

        const audioPreviewDurationPromise = promises.audioPreviewDurationPromise
            ? (async () => {
                  const duration = await promises.audioPreviewDurationPromise;

                  await fileUploader.finishProcessingAudioPreviewDuration(context, duration);

                  span.addData({
                      file: {preview: {audioDurationMs: duration}},
                  });
              })()
            : null;

        const audioPreviewMetadataPromise = promises.audioPreviewMetadataPromise
            ? (async () => {
                  const metadata = await promises.audioPreviewMetadataPromise;

                  await fileUploader.finishProcessingAudioPreviewMetadata(context, metadata);
              })()
            : null;

        const codePreviewContentPromise = promises.codePreviewContentPromise
            ? (async () => {
                  const content = await promises.codePreviewContentPromise;

                  await fileUploader.finishProcessingCodePreviewContent(context, content);

                  span.addData({
                      file: {preview: {codeContentLength: content.serialize().length}},
                  });
              })()
            : null;

        const analysisPromise = promises.analysisPromise
            ? (async () => {
                  const analysis = await promises.analysisPromise;

                  if (analysis !== null) {
                      await fileUploader.finishProcessingAnalysis(context, analysis);
                  }

                  return analysis;
              })()
            : null;

        const transcriptPromise = promises.transcriptPromise
            ? (async () => {
                  const transcriptResult = await promises.transcriptPromise;

                  if (transcriptResult === null) return transcriptResult;
                  if (!transcriptResult.ok) throw transcriptResult.error;

                  if ("isUnavailable" in transcriptResult) {
                      await fileUploader.finishProcessingTranscript(context, {
                          isUnavailable: true,
                      });
                  } else {
                      await storeFileTranscript(context, {
                          fileId,
                          signal,
                          spaceId,
                          transcriptJson: transcriptResult.transcriptJson,
                      });
                      await fileUploader.finishProcessingTranscript(context);
                  }

                  return transcriptResult;
              })()
            : null;

        const analysisResultPromise = analysisPromise
            ? captureResultPromise(analysisPromise)
            : null;

        const transcriptResultPromise = transcriptPromise
            ? captureResultPromise(transcriptPromise)
            : null;

        const finallyAlternativePromise = async () => {
            const endTime = span.clock.now();

            span.addData({
                file: {processing: {alternativeDurationMs: endTime - startTime}},
            });

            let imagePreviewVideoDuration;

            try {
                imagePreviewVideoDuration = await imagePreviewVideoDurationPromise;
            } catch {
                // Ignore errors from the video duration promise here. They're handled elsewhere.
                return;
            }

            if (typeof imagePreviewVideoDuration === "number") {
                span.addData({
                    file: {
                        processing: {
                            imagePreviewVideoDurationToAlternativeProcessingDurationRatio:
                                imagePreviewVideoDuration / (endTime - startTime),
                        },
                    },
                });
            }
        };

        // Specific file processors often have dependencies on one another, e.g. "Process
        // file preview size" depends on "Process file alternative" for Microsoft Word
        // documents. However, we intentionally measure spans from the start of file
        // processing so that when we look at the duration we get the user duration
        // perceived by the user (since as each of these resolves we `sendEvent()` to the
        // user).
        await runAllPromises([
            alternativePromise?.then(finallyAlternativePromise, async error => {
                await runAllPromises([
                    finallyAlternativePromise(),
                    (async () => {
                        error = dedupeAggregateError(error);

                        // If processing failed due to a timeout then don't catch the error. Instead we
                        // want to retry the job.
                        if (isDeadlineExceededOrAbortedError(error)) throw error;

                        // When there's an error processing a file in development, log an error so the
                        // developer can see it in the console since they might not see it in the UI.
                        if (process.env.NODE_ENV !== "production") {
                            // eslint-disable-next-line no-console
                            console.error("File processing failed:", error);
                        }

                        caughtErrors.push(error);

                        const processorErrors = getFileProcessorErrors(error);

                        await fileUploader.finishProcessingAlternativeWithError(
                            context,
                            // We only get to show one processing error to the user even if we have multiple.
                            // Pick the first one.
                            processorErrors?.[0] ?? {type: "Unknown"},
                        );
                    })(),
                ]);
            }),
            runAllPromises([
                imagePreviewSizePromise?.finally(() => {
                    const endTime = span.clock.now();

                    span.addData({
                        file: {processing: {imagePreviewSizeDurationMs: endTime - startTime}},
                    });
                }),
                imagePreviewPlaceholderPromise?.finally(() => {
                    const endTime = span.clock.now();

                    span.addData({
                        file: {
                            processing: {imagePreviewPlaceholderDurationMs: endTime - startTime},
                        },
                    });
                }),
                imagePreviewContentPromise?.finally(() => {
                    const endTime = span.clock.now();

                    span.addData({
                        file: {processing: {imagePreviewContentDurationMs: endTime - startTime}},
                    });
                }),
                imagePreviewVideoDurationPromise?.finally(() => {
                    const endTime = span.clock.now();

                    span.addData({
                        file: {
                            processing: {imagePreviewVideoDurationDurationMs: endTime - startTime},
                        },
                    });
                }),
                audioPreviewDurationPromise?.finally(() => {
                    const endTime = span.clock.now();

                    span.addData({
                        file: {processing: {audioPreviewDurationDurationMs: endTime - startTime}},
                    });
                }),
                audioPreviewMetadataPromise?.finally(() => {
                    const endTime = span.clock.now();

                    span.addData({
                        file: {processing: {audioPreviewMetadataDurationMs: endTime - startTime}},
                    });
                }),
                codePreviewContentPromise?.finally(() => {
                    const endTime = span.clock.now();

                    span.addData({
                        file: {processing: {codePreviewContentDurationMs: endTime - startTime}},
                    });
                }),
            ]).catch(async error => {
                error = dedupeAggregateError(error);

                // If processing failed due to a timeout then don't catch the error. Instead we
                // want to retry the job.
                if (isDeadlineExceededOrAbortedError(error)) throw error;

                // When there's an error processing a file in development, log an error so the
                // developer can see it in the console since they might not see it in the UI.
                if (process.env.NODE_ENV !== "production") {
                    // eslint-disable-next-line no-console
                    console.error("File processing failed:", error);
                }

                caughtErrors.push(error);

                const processorErrors = getFileProcessorErrors(error);

                await fileUploader.finishProcessingPreviewWithError(
                    context,
                    // We only get to show one processing error to the user even if we have multiple.
                    // Pick the first one.
                    processorErrors[0] ?? {type: "Unknown"},
                );
            }),
            runAllPromises([
                analysisResultPromise?.finally(() => {
                    const endTime = span.clock.now();

                    span.addData({
                        file: {processing: {analysisDurationMs: endTime - startTime}},
                    });
                }),
                transcriptResultPromise?.finally(() => {
                    const endTime = span.clock.now();

                    span.addData({
                        file: {processing: {transcriptDurationMs: endTime - startTime}},
                    });
                }),
            ]),
        ]);

        const analysisResult = analysisResultPromise ? await analysisResultPromise : null;
        const transcriptResult = transcriptResultPromise ? await transcriptResultPromise : null;
        const analysisErrors = [
            ...(analysisResult?.ok === false ? [analysisResult.error] : []),
            ...(transcriptResult?.ok === false ? [transcriptResult.error] : []),
        ];

        if (analysisErrors.length > 0) {
            const analysisError = dedupeAggregateError(
                analysisErrors.length === 1
                    ? analysisErrors[0]!
                    : createAggregateError(analysisErrors),
            );

            // If analysis failed due to a timeout then don't catch the error. Instead we want
            // to retry the job.
            if (isDeadlineExceededOrAbortedError(analysisError)) throw analysisError;

            caughtErrors.push(analysisError);

            const analysisProcessorError =
                analysisResult?.ok === false
                    ? (getFileProcessorErrors(analysisResult.error)[0] ?? {
                          type: "Unknown" as const,
                      })
                    : null;
            const transcriptProcessorError =
                transcriptResult?.ok === false
                    ? (getFileProcessorErrors(transcriptResult.error)[0] ?? {
                          type: "Unknown" as const,
                      })
                    : null;

            // File analysis shares the file-processing job, but it is not required to make the
            // preview/alternative usable. For ordinary non-deadline failures, close only the
            // declared analysis slots with errors so clients stop polling those slots forever.
            await runAllPromises([
                analysisProcessorError
                    ? fileUploader.finishProcessingAnalysisWithError(
                          context,
                          analysisProcessorError,
                      )
                    : null,
                transcriptProcessorError
                    ? fileUploader.finishProcessingTranscriptWithError(
                          context,
                          transcriptProcessorError,
                      )
                    : null,
            ]);
        }
    })();

    try {
        await promise;

        // If we caught any errors then add them to the span. We don't want to throw an
        // aggregate error since we don't want to retry the job. However, we still want the
        // errors to show up in telemetry.
        if (caughtErrors.length > 0) {
            span.addException(createAggregateError(caughtErrors));
        }
    } catch (someError) {
        const error = dedupeAggregateError(someError);

        // If our promise failed when we had caught errors then create an `AggregateError`
        // that includes the caught errors and throw that.
        if (caughtErrors.length === 0) {
            throw error;
        } else {
            throw createAggregateError([error, ...caughtErrors]);
        }
    } finally {
        abortTimeout.clear();
    }
}

async function storeFileTranscript(
    context: FileProcessorActionContext,
    {
        fileId,
        signal,
        spaceId,
        transcriptJson,
    }: {
        readonly fileId: FileId;
        readonly signal: AbortSignal;
        readonly spaceId: SpaceId;
        readonly transcriptJson: FileProcessTranscriptJson;
    },
) {
    const body = JSON.stringify(transcriptJson);

    await context.r2.PutObject(
        {
            Bucket: filesBucketName,
            Key: `${spaceId}/${fileId}.transcript.json`,
            Body: body,
            ContentLength: Buffer.byteLength(body),
            ContentType: "application/json",
        },
        {signal},
    );
}

/**
 * Take an `AggregateError` and dedupe errors with the same message. Useful since
 * our file processor promises frequently depend on each other. If two promises
 * throw the same error we don't want to list the error twice in an
 * `AggregateError`.
 */
function dedupeAggregateError(error: unknown) {
    if (!(error instanceof AggregateError)) return error;

    const aggregateErrors: Array<unknown> = [];

    const pushAggregateError = (error: unknown) => {
        if (!(error instanceof AggregateError)) {
            if (
                aggregateErrors.every(
                    aggregateError =>
                        (error instanceof Error
                            ? `${error.name}: ${error.message}`
                            : String(error)) !==
                        (aggregateError instanceof Error
                            ? `${aggregateError.name}: ${aggregateError.message}`
                            : String(aggregateError)),
                )
            ) {
                aggregateErrors.push(error);
            }
        } else {
            for (const childError of error.errors) {
                pushAggregateError(childError);
            }
        }
    };

    pushAggregateError(error);

    return createAggregateError(aggregateErrors);
}

/**
 * Look for a timeout or abort error. We want to retry our processing job if there
 * was a timeout.
 */
function isDeadlineExceededOrAbortedError(error: unknown): boolean {
    if (error instanceof DeadlineExceededError) return true;
    if (error instanceof AbortedError) return true;

    // Look for an abort error from `AbortController`.
    // https://developer.mozilla.org/en-US/docs/Web/API/AbortController/abort
    if (error instanceof Error && error.name === "AbortError") return true;

    if (error instanceof AggregateError) return error.errors.some(isDeadlineExceededOrAbortedError);

    return false;
}

const createFileProcessorByContentType: {
    [Key in FileContentType]: (contentType: Key) => FileProcessor;
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
    "video/mp4": createFileMp4VideoProcessor,
    "audio/mpeg": createFileWebSafeAudioProcessor,
    "audio/wav": createFileWebSafeAudioProcessor,
    "audio/webm": createFileWebSafeAudioProcessor,
    "audio/ogg": createFileWebUnsafeAudioProcessor,
    "audio/mp4": createFileMp4AudioProcessor,
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
    [Key in FileContentType]: FileProcessor;
} = mapObjectValues(createFileProcessorByContentType, (createFileProcessor, contentType) =>
    (createFileProcessor as any)(contentType),
);

// Make sure our file processors in `FileProcessorService` match our file processor
// declarations in `fileProcessorDeclarationByContentType`.
assert(
    isDeepEqual(
        mapObjectValues(fileProcessorDeclarationByContentType, fileProcessorDeclaration => ({
            hasAlternative: fileProcessorDeclaration.hasAlternative,
            hasAnalysis:
                "hasAnalysis" in fileProcessorDeclaration
                    ? fileProcessorDeclaration.hasAnalysis
                    : false,
            hasPreview: fileProcessorDeclaration.hasPreview,
            hasTranscript:
                "hasTranscript" in fileProcessorDeclaration
                    ? fileProcessorDeclaration.hasTranscript
                    : false,
        })),
        mapObjectValues(fileProcessorByContentType, fileProcessor => ({
            hasAlternative: !!fileProcessor.hasAlternative,
            hasAnalysis: fileProcessor.hasAnalysis,
            hasPreview: fileProcessor.hasPreview,
            hasTranscript: fileProcessor.hasTranscript,
        })),
    ),
);
