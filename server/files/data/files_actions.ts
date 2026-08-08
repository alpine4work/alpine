import prettyBytes from "pretty-bytes";
import {
    ServerAccountActionContext,
    ServerActionContext,
} from "~/server/context/server_action_context.js";
import {DynamoContextCache} from "~/server/dynamo/core/dynamo_context_cache.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {getDynamoSeedConstants} from "~/server/dynamo/core/dynamo_seed_constants.js";
import {
    DynamoTableItemKeyType,
    DynamoTableItemType,
    DynamoTableSchema,
} from "~/server/dynamo/core/dynamo_table_schema.js";
import {FileAuthorizer, FileAuthorizerUnbound} from "~/server/files/data/file_authorizer.js";
import {
    FileDataAccountActionContext,
    FileDataActionContext,
    FileDataSystemActionContext,
} from "~/server/files/data/file_processor_context.js";
import {fileProcessorDeclarationByContentType} from "~/server/files/data/file_processor_declaration_by_content_type.js";
import {
    FilesTable,
    PostDraftFile2AttachmentsIndex,
} from "~/server/files/data/internal/files_table.js";
import {routeFileToProcessor} from "~/server/files/data/route_file_to_processor.js";
import {unauthenticatedSessionError} from "~/server/helpers/unauthenticated_session_error.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {
    FailedPreconditionError,
    InternalError,
    InvalidArgumentError,
    NotFoundError,
    PermissionDeniedError,
} from "~/shared/error/error.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {FileCodePreviewContent} from "~/shared/files/file_code_preview_content.js";
import {maxFileContentLength} from "~/shared/files/file_constants.js";
import {FileContentType} from "~/shared/files/file_content_type.open_source.js";
import {FileImagePreviewPlaceholder} from "~/shared/files/file_image_preview_placeholder.js";
import {FileModel} from "~/shared/files/file_model.js";
import {
    FileAudioPreviewMetadata,
    FileImagePreviewSize,
    FilePreview,
} from "~/shared/files/file_preview.js";
import {FileProcessorError} from "~/shared/files/file_processor_error.js";
import {MutexValue} from "~/shared/helpers/async/mutex_value.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {isDeepEqualForUnknownValues} from "~/shared/helpers/control/is_deep_equal.open_source.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {mapAsyncIterableIterator} from "~/shared/helpers/iterable/map_async_iterable_iterator.js";
import {
    generateChronologicalId,
    getChronologicalIdTime,
} from "~/shared/id/chronological_id.open_source.js";
import {
    AccountId,
    DocumentId,
    FileId,
    PostDraftId,
    SpaceId,
} from "~/shared/id/types/id_types.open_source.js";
import {alpineCompanyKnownSpaceId} from "~/shared/spaces/known_space_ids.js";

/**
 * NOTE: this file is currently being split up. We do not anticipate adding more
 * methods here.
 */

type FileItem = DynamoTableItemType<typeof FilesTable, "File2", "Attributes">;

type FileAttachmentTargetItemKey = DynamoTableItemKeyType<
    typeof FilesTable,
    "File2",
    `${string}AttachmentTarget`
>;

function getFileAttachmentTargetItemKey(
    fileId: FileId,
    target: FileAttachmentTarget,
): FileAttachmentTargetItemKey {
    switch (target.type) {
        case "ChatMessages": {
            return {
                partitionType: "File2",
                sortRangeType: "ChatMessagesAttachmentTarget",
                fileId,
                chatId: target.chatId,
            };
        }
        case "Document": {
            return {
                partitionType: "File2",
                sortRangeType: "DocumentAttachmentTarget",
                fileId,
                documentId: target.documentId,
            };
        }
        case "DocumentComments": {
            return {
                partitionType: "File2",
                sortRangeType: "DocumentCommentsAttachmentTarget",
                fileId,
                documentId: target.documentId,
            };
        }
        case "Post": {
            return {
                partitionType: "File2",
                sortRangeType: "PostAttachmentTarget",
                fileId,
                postId: target.postId,
            };
        }
        case "PostDraft": {
            return {
                partitionType: "File2",
                sortRangeType: "PostDraftAttachmentTarget",
                fileId,
                accountId: target.accountId,
                draftId: target.draftId,
            };
        }
        case "PostComments": {
            return {
                partitionType: "File2",
                sortRangeType: "PostCommentsAttachmentTarget",
                fileId,
                postId: target.postId,
            };
        }
        case "TaskNotes": {
            return {
                partitionType: "File2",
                sortRangeType: "TaskNotesAttachmentTarget",
                fileId,
                taskId: target.taskId,
            };
        }
        case "TaskComments": {
            return {
                partitionType: "File2",
                sortRangeType: "TaskCommentsAttachmentTarget",
                fileId,
                taskId: target.taskId,
            };
        }
        default:
            throw exhaustive(target);
    }
}

/**
 * Create (or replace) a file attachment target record. This is used by code
 * outside `files_actions.ts` that needs to create attachment records without
 * access to the private `getFileAttachmentTargetItemKey` helper.
 */
export async function createFileAttachmentTarget(
    context: ServerActionContext,
    fileId: FileId,
    target: FileAttachmentTarget,
): Promise<void> {
    await FilesTable.createOrReplaceItem(context, {
        ...getFileAttachmentTargetItemKey(fileId, target),
        createdTime: new Date(),
    });
}

/**
 * Get a file and its uploader account ID, verifying it exists in the given space.
 * Returns `null` if the file doesn't exist or belongs to a different space. Used
 * by bot file attachment so the authorization read can also supply the file data
 * needed by the caller.
 */
export async function getFileWithUploaderIdIfExists(
    context: ServerActionContext,
    fileId: FileId,
    spaceId: SpaceId,
): Promise<{file: FileModel; uploaderId: AccountId} | null> {
    const item = await getFileItemIfExistsWithCache(context, fileId, {
        consistency: "StrongWithinCache",
    });
    if (!item) return null;
    if (item.spaceId !== spaceId) return null;
    return {file: createFileModelFromItem(item), uploaderId: item.uploaderId};
}

/**
 * The total number of bytes you're allowed to store in an Alpine space on the free
 * plan (5 GB). After you exceed this amount we'll start deleting old files. This
 * is the same as Slack's file limit for their free plan.
 *
 * We should allow paying users to upload more but this is a fine starting place.
 */
const maxFileTotalContentLengthForSpace = 5e9;

/**
 * The upper bound of "infinite" file uploads for a space (250GB). During our
 * import process, we allow files to be uploaded beyond the space's limit, but we
 * shouldn't allow an unlimited number of files. If someone hits this limit, we
 * should have them contact us.
 */
const dangerousMaxFileTotalContentLengthForSpaceWithAllowedOverage = 250e9;

/**
 * Which services are allowed to upload files.
 *
 * We only allow file uploads from EdgeService (client uploads) and ImporterService
 * (Notion imports, etc.).
 */
const allowedUploadServices = new Set(["EdgeService", "ImporterService"]);

/**
 * Called by `EdgeService` before writing our file to Cloudflare R2. Makes sure the
 * space has enough storage for the file and creates a file item in DynamoDB
 * containing information about the file.
 *
 * Throws an error if not called by `EdgeService`. A complete file upload is
 * orchestrated by `EdgeService` and involves three parts:
 *
 * 1. `startUploadFile()`
 * 2. Uploading the file to Cloudflare R2
 * 3. `finishUploadingAndStartProcessingFile()` (which submits a job to our job
 *    queue to process the file)
 *
 * If there's an error and we don't complete one of those three steps the resulting
 * file item in DynamoDB won't be very useful.
 */
// ServerAccountActionContext with optional attachTargetAuthorizer
export async function startUploadingFile(
    context: ServerAccountActionContext,
    options: {
        spaceId: SpaceId;
        fileId?: FileId | null;
        contentType: FileContentType;
        contentLength: number;
        attachTargetAuthorizer?: FileAuthorizer | null;
    },
): Promise<{fileId: FileId}>;
// FileDataAccountActionContext (minimal context type), no attachTargetAuthorizer
// allowed
export async function startUploadingFile(
    context: FileDataAccountActionContext,
    options: {
        spaceId: SpaceId;
        fileId?: FileId | null;
        contentType: FileContentType;
        contentLength: number;
        dangerouslyAllowSpaceLimitOverage?: boolean;
    },
): Promise<{fileId: FileId}>;
export async function startUploadingFile(
    context: ServerAccountActionContext | FileDataAccountActionContext,
    {
        spaceId,
        fileId: providedFileId = null,
        contentType,
        contentLength,
        attachTargetAuthorizer = null,
        dangerouslyAllowSpaceLimitOverage = false,
    }: {
        spaceId: SpaceId;
        fileId?: FileId | null;
        contentType: FileContentType;
        contentLength: number;
        attachTargetAuthorizer?: FileAuthorizer | null;
        /**
         * This allows us to upload files beyond the space's limit. This is used by
         * importers to temporarily allow us to upload files beyond the space's limit. This
         * is dangerous and should only be used in limited cases.
         */
        dangerouslyAllowSpaceLimitOverage?: boolean;
    },
): Promise<{fileId: FileId}> {
    await authorizeSpaceAccess(context, spaceId);

    // If we're attaching the file to a target as a part of the upload, verify we have
    // edit access to the target. When attachTargetAuthorizer is provided, the overload
    // signature guarantees context is ServerAccountActionContext.
    if (attachTargetAuthorizer) {
        // Runtime check: Our types should not allow this case, but let's add another check
        // to make sure we have the right context type for authorizeTargetAccess. The
        // authorizer calls functions like authorizeDocumentAccess which require entity
        // injections. This function can be called by importers which do not have a full
        // action context.
        assert(
            "documentsInjection" in context,
            "attachTargetAuthorizer requires ServerAccountActionContext",
        );

        await attachTargetAuthorizer.authorizeTargetAccess(context, "Edit");
    }

    // Only allow file uploads from EdgeService (client uploads) and ImporterService
    // (Notion imports, etc.).
    if (!import.meta.jest && !allowedUploadServices.has(context.actor.serviceName)) {
        throw new PermissionDeniedError("Only allowed services can upload files");
    }

    if (!(0 < contentLength && contentLength <= maxFileContentLength)) {
        throw new InvalidArgumentError(
            `File content length must be between 0 and ${prettyBytes(maxFileContentLength)}`,
        );
    }

    const fileProcessorDeclaration = fileProcessorDeclarationByContentType[contentType];
    const {
        hasAlternative,
        hasAnalysis = false,
        hasPreview,
        hasTranscript = false,
    } = fileProcessorDeclaration;

    let fileId: FileId;
    if (providedFileId === null) {
        fileId = generateChronologicalId();
    } else {
        // ImporterService uses pre-generated deterministic file IDs that may not have
        // valid timestamps. Skip the time check for imports.
        const isImportService = context.actor.serviceName === "ImporterService";

        if (!isImportService) {
            const time = getChronologicalIdTime(providedFileId);
            const currentTime = Date.now();

            // Make sure the time provided by the client is reasonable so our files table is
            // still roughly sorted by creation time.
            if (Math.abs(time - currentTime) > 1000 * 60 * 2) {
                throw new FailedPreconditionError(
                    "Provided `FileId` must be within a 4 minute window of the current time",
                );
            }
        }

        fileId = providedFileId;
    }

    return await context.dynamo.retryTransaction(async context => {
        const fileTotalsItem = (await FilesTable.getItemIfExists(context, {
            partitionType: "Space",
            sortRangeType: "FileTotals",
            spaceId,
        })) ?? {
            partitionType: "Space",
            sortRangeType: "FileTotals",
            spaceId,
            count: 0,
            contentLength: 0,
        };

        // If we're in the default development space then we'll allow infinite file uploads
        // so developers can test file uploads without limits.
        const isFileLimitEnforced =
            (process.env.NODE_ENV !== "development" ||
                spaceId !== getDynamoSeedConstants().defaultSpaceId) &&
            // We also disable the file limit for our own space.
            spaceId !== alpineCompanyKnownSpaceId;

        const maxFileTotalContentLength = dangerouslyAllowSpaceLimitOverage
            ? dangerousMaxFileTotalContentLengthForSpaceWithAllowedOverage
            : maxFileTotalContentLengthForSpace;

        // We allow one file to be uploaded beyond the space's max content length. This
        // allows us to say "you've reached your limit" in our error message.
        if (isFileLimitEnforced && fileTotalsItem.contentLength > maxFileTotalContentLength) {
            throw new InvalidArgumentError(
                `Uploading files beyond our ${prettyBytes(
                    maxFileTotalContentLength,
                )} limit is currently unsupported. Eventually we should: 1) Increase the limit for paying customers, 2) Archive old uploaded files to create more space`,
                {
                    displayMessage: errorDisplayMessage`This space has exceeded its ${prettyBytes(
                        maxFileTotalContentLength,
                    )} storage limit. Can\u2019t upload more files. To raise this space\u2019s storage limit contact ${
                        errorDisplayMessage.supportLink
                    }.`,
                },
            );
        }

        let preview: FilePreview | null = null;

        if (hasPreview) {
            switch (hasPreview.type) {
                case "Image": {
                    preview = {
                        type: "Image",
                        isProcessing: true,
                        size: "Processing",
                        placeholder: "Processing",
                        content: hasPreview.hasContent ? "Processing" : undefined,
                        videoDuration: hasPreview.hasVideoDuration ? "Processing" : undefined,
                    };
                    break;
                }
                case "Audio": {
                    preview = {
                        type: "Audio",
                        isProcessing: true,
                        duration: "Processing",
                        metadata: "Processing",
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
                    throw exhaustive(hasPreview);
            }
        }

        const fileItem: FileItem = {
            partitionType: "File2",
            sortRangeType: "Attributes",
            fileId,
            spaceId,
            contentType,
            contentLength,
            uploaderId: context.actor.getPossiblyBotAccountId(),
            isUploading: true,
            alternative: hasAlternative ? {isProcessing: true} : null,
            analysis: hasAnalysis ? {isProcessing: true} : null,
            preview,
            transcript: hasTranscript ? {isProcessing: true} : null,
        };

        await DynamoTableSchema.executeTransaction(context, [
            FilesTable.transactionDirectlyUpdateItem({
                ...fileTotalsItem,
                count: fileTotalsItem.count + 1,
                contentLength: fileTotalsItem.contentLength + contentLength,
            }),

            providedFileId
                ? FilesTable.transactionCreateItem(fileItem)
                : FilesTable.transactionCreateOrReplaceItem(fileItem),

            ...(attachTargetAuthorizer
                ? [
                      FilesTable.transactionCreateOrReplaceItem({
                          ...getFileAttachmentTargetItemKey(fileId, attachTargetAuthorizer.target),
                          createdTime: new Date(),
                      }),
                  ]
                : []),
        ]);

        return {fileId};
    });
}

/**
 * Once `EdgeService` has finished uploading a file to Cloudflare R2 it calls this
 * function which marks the file as uploaded and starts processing the file. Throws
 * an error if not called by `EdgeService`. See the documentation on
 * `startUploadingFile()` for more information.
 */
export async function finishUploadingAndStartProcessingFile(
    context: FileDataAccountActionContext,
    {
        spaceId,
        fileId,
        validateContentLength,
        withoutProcessJobForTest,
        withoutProcessJob,
    }: {
        spaceId: SpaceId;
        fileId: FileId;
        validateContentLength?: number;
        withoutProcessJobForTest?: boolean;
        /**
         * Skip scheduling a file processor job. Use this when the caller will handle file
         * processing inline (e.g. during imports).
         */
        withoutProcessJob?: boolean;
    },
): Promise<FileModel> {
    if (!import.meta.jest && !allowedUploadServices.has(context.actor.serviceName)) {
        throw new PermissionDeniedError("Only allowed services can upload files");
    }

    if (withoutProcessJobForTest) {
        assert(process.env.NODE_ENV === "test");
    }

    return await context.dynamo.retryTransaction(async context => {
        let item = await getFileItemIfExistsAsUploader(context, fileId, {
            consistency: "Eventual",
        });

        // In case there's an eventual consistency lag, retry reading the item with strong
        // consistency.
        if (!item) {
            item = await getFileItemIfExistsAsUploader(context, fileId, {
                consistency: "Strong",
            });
        }

        if (!item) {
            throw new NotFoundError("File not found");
        }

        if (!item.isUploading) {
            throw new FailedPreconditionError("File has already finished uploading");
        }

        if (validateContentLength !== undefined && item.contentLength !== validateContentLength) {
            throw new FailedPreconditionError(
                `Expected file to be ${prettyBytes(
                    item.contentLength,
                )} but instead the file was ${prettyBytes(validateContentLength)}`,
            );
        }

        item = {
            ...item,
            isUploading: false,
        };

        await FilesTable.directlyUpdateItem(context, item);

        const {hasAlternative, hasPreview} =
            fileProcessorDeclarationByContentType[item.contentType];

        if (!withoutProcessJobForTest && !withoutProcessJob && (hasAlternative || hasPreview)) {
            // Now that the file has finished uploading we can start processing it. Wait for
            // the message to be added to our queue. If sending the process file message fails
            // we want to fail the entire upload.

            // Determine the appropriate processing tier based on content type and file size
            const {jobType, reason} = routeFileToProcessor(item);

            await context.jobs.sendAndWait({
                type: jobType,
                spaceId,
                fileId,
                contentType: item.contentType,
                reason,
            });
        }

        return createFileModelFromItem(item);
    });
}

/**
 * Get an instance of `FileUploader` we can use for finishing a file upload. Only
 * an uploader may get an instance of the `FileUploader` class.
 */
export async function getFileUploaderAsUploader(
    context: FileDataActionContext,
    fileId: FileId,
): Promise<FileUploader> {
    let fileItem = await getFileItemIfExistsAsUploader(context, fileId, {
        consistency: "Eventual",
    });

    // If we weren't able to find a file that might be because of eventual consistency
    // lag. Try again with strong consistency.
    if (!fileItem) {
        fileItem = await getFileItemIfExistsAsUploader(context, fileId, {
            consistency: "Strong",
        });
    }

    if (!fileItem) {
        throw new NotFoundError("File not found");
    }

    return new FileUploader(fileItem);
}

/**
 * Stateful object used to update our file in DynamoDB while it's uploading.
 *
 * It's useful to have a stateful object to save on read requests since the class
 * can hold onto the last value of `FileItem` so we don't need to read it from the
 * database.
 */
export class FileUploader {
    public readonly spaceId: SpaceId;
    public readonly fileId: FileId;
    public readonly uploaderId: AccountId;
    private readonly _item: MutexValue<FileItem>;

    constructor(item: FileItem) {
        this.spaceId = item.spaceId;
        this.fileId = item.fileId;
        this.uploaderId = item.uploaderId;
        this._item = new MutexValue(item);
    }

    public getContentType() {
        return this._item.getWithoutLock().contentType;
    }

    public getContentLength() {
        return this._item.getWithoutLock().contentLength;
    }

    private _authorize(context: FileDataActionContext) {
        switch (context.actor.type) {
            case "Session": {
                if (this.uploaderId !== context.actor.getAccountId()) {
                    throw new PermissionDeniedError(
                        "Account is not the file\u2019s uploader account",
                    );
                }
                break;
            }
            case "System": {
                if (this.spaceId !== context.actor.getSpaceId()) {
                    throw new PermissionDeniedError(
                        "System actor is not for the file\u2019s space",
                    );
                }
                break;
            }
            case "ImpersonatedAccount": {
                if (this.spaceId !== context.actor.getSpaceId()) {
                    throw new PermissionDeniedError(
                        "Impersonated account actor is not for the file\u2019s space",
                    );
                }
                if (this.uploaderId !== context.actor.getAccountId()) {
                    throw new PermissionDeniedError(
                        "Account is not the file\u2019s uploader account",
                    );
                }
                break;
            }
            case "Anonymous": {
                throw unauthenticatedSessionError();
            }
            case "Bot": {
                if (this.uploaderId !== context.actor.getBotAccountId()) {
                    throw new PermissionDeniedError(
                        "Account is not the file\u2019s uploader account",
                    );
                }
                break;
            }
            default:
                throw exhaustive(context.actor);
        }
    }

    /**
     * Finish processing the file's alternative if the file has an alternative. If the
     * file was not declared to have an alternative upon creation then this method will
     * throw an error.
     */
    public async finishProcessingAlternative(
        context: FileDataActionContext,
        alternative: {contentType: FileContentType; contentLength: number} | null,
    ) {
        this._authorize(context);

        await this._item.withLock(async itemRef => {
            itemRef.current = await FilesTable.updateItem(
                context,
                {
                    partitionType: "File2",
                    sortRangeType: "Attributes",
                    fileId: this.fileId,
                },
                item => {
                    if (!item.alternative) {
                        // Noop if we've already finished processing the alternative. This makes the
                        // function idempotent.
                        if (item.hasProcessedNullAlternative) return item;

                        throw new InternalError("File doesn\u2019t have an alternative");
                    }

                    // Noop if we've already finished processing the alternative. This makes the
                    // function idempotent.
                    if (!item.alternative.isProcessing) return item;

                    if (alternative === null) {
                        return {
                            ...item,
                            alternative: null,
                            hasProcessedNullAlternative: true,
                        };
                    } else {
                        return {
                            ...item,
                            alternative: {
                                isProcessing: false,
                                ok: true,
                                contentType: alternative.contentType,
                                contentLength: alternative.contentLength,
                                isImagePreviewContent: false,
                            },
                        };
                    }
                },
                {initialItem: itemRef.current},
            );
        });
    }

    /**
     * When we're done processing `preview.size` we call this method to add the preview
     * size to DynamoDB. If we've finished processing all of `preview.size`,
     * `preview.placeholder`, and `preview.content` then we can set
     * `preview.isProcessing` to false.
     *
     * May also finish processing the video duration if `alsoPreviewVideoDuration` is
     * provided as an option.
     */
    public async finishProcessingImagePreviewSize(
        context: FileDataActionContext,
        size: FileImagePreviewSize,
        {alsoPreviewVideoDuration}: {alsoPreviewVideoDuration?: number} = {},
    ) {
        this._authorize(context);

        await this._item.withLock(async itemRef => {
            itemRef.current = await FilesTable.updateItem(
                context,
                {
                    partitionType: "File2",
                    sortRangeType: "Attributes",
                    fileId: this.fileId,
                },
                item => {
                    if (!item.preview) {
                        throw new InternalError("File doesn\u2019t have a preview");
                    }
                    if (item.preview.type !== "Image") {
                        throw new InternalError("File doesn\u2019t have an image preview");
                    }

                    // Noop if we've already finished processing the preview. This makes the function
                    // idempotent.
                    if (!item.preview.isProcessing) return item;

                    if (
                        alsoPreviewVideoDuration !== undefined &&
                        item.preview.videoDuration === undefined
                    ) {
                        throw new InternalError(
                            "File doesn\u2019t have a image preview video duration",
                        );
                    }

                    const newItem: FileItem = {
                        ...item,
                        preview:
                            item.preview.placeholder !== "Processing" &&
                            item.preview.content !== "Processing" &&
                            (item.preview.videoDuration !== "Processing" ||
                                alsoPreviewVideoDuration !== undefined)
                                ? {
                                      type: "Image",
                                      isProcessing: false,
                                      ok: true,
                                      // Only update if size is processing. If we've already finished processing size
                                      // then we want to leave the old size in place. This makes the function idempotent.
                                      size:
                                          item.preview.size === "Processing"
                                              ? size
                                              : item.preview.size,
                                      placeholder: item.preview.placeholder,
                                      content: item.preview.content,
                                      videoDuration:
                                          // Only update if video duration is processing. If we've already finished
                                          // processing video duration then we want to leave the old video duration in place.
                                          // This makes the function idempotent.
                                          (item.preview.videoDuration === "Processing"
                                              ? (alsoPreviewVideoDuration ??
                                                item.preview.videoDuration)
                                              : item.preview.videoDuration) as number | undefined,
                                  }
                                : {
                                      type: "Image",
                                      isProcessing: true,
                                      // Only update if size is processing. If we've already finished processing size
                                      // then we want to leave the old size in place. This makes the function idempotent.
                                      size:
                                          item.preview.size === "Processing"
                                              ? size
                                              : item.preview.size,
                                      placeholder: item.preview.placeholder,
                                      content: item.preview.content,
                                      videoDuration:
                                          // Only update if video duration is processing. If we've already finished
                                          // processing video duration then we want to leave the old video duration in place.
                                          // This makes the function idempotent.
                                          item.preview.videoDuration === "Processing"
                                              ? (alsoPreviewVideoDuration ??
                                                item.preview.videoDuration)
                                              : item.preview.videoDuration,
                                  },
                    };

                    // Optimization: If we left both `item.preview.size` alone and
                    // `item.preview.videoDuration` alone then return the old item to skip a DynamoDB
                    // write.
                    if (isDeepEqualForUnknownValues(newItem, item)) return item;

                    return newItem;
                },
                {initialItem: itemRef.current},
            );
        });
    }

    /**
     * When we're done processing `preview.placeholder` we call this method to add the
     * preview placeholder to DynamoDB. If we've finished processing all of
     * `preview.size`, `preview.placeholder`, and `preview.content` then we can set
     * `preview.isProcessing` to false.
     */
    public async finishProcessingImagePreviewPlaceholder(
        context: FileDataActionContext,
        placeholder: FileImagePreviewPlaceholder,
    ) {
        this._authorize(context);

        await this._item.withLock(async itemRef => {
            itemRef.current = await FilesTable.updateItem(
                context,
                {
                    partitionType: "File2",
                    sortRangeType: "Attributes",
                    fileId: this.fileId,
                },
                item => {
                    if (!item.preview) {
                        throw new InternalError("File doesn\u2019t have a preview");
                    }
                    if (item.preview.type !== "Image") {
                        throw new InternalError("File doesn\u2019t have an image preview");
                    }

                    // Noop if we've already finished processing the preview. This makes the function
                    // idempotent.
                    if (!item.preview.isProcessing) return item;
                    if (item.preview.placeholder !== "Processing") return item;

                    return {
                        ...item,
                        preview:
                            item.preview.size !== "Processing" &&
                            item.preview.content !== "Processing" &&
                            item.preview.videoDuration !== "Processing"
                                ? {
                                      type: "Image",
                                      isProcessing: false,
                                      ok: true,
                                      size: item.preview.size,
                                      placeholder,
                                      content: item.preview.content,
                                      videoDuration: item.preview.videoDuration,
                                  }
                                : {
                                      type: "Image",
                                      isProcessing: true,
                                      size: item.preview.size,
                                      placeholder,
                                      content: item.preview.content,
                                      videoDuration: item.preview.videoDuration,
                                  },
                    };
                },
                {initialItem: itemRef.current},
            );
        });
    }

    /**
     * When we're done processing `preview.content` we call this method to add the
     * preview image to DynamoDB. If we've finished processing all of `preview.size`,
     * `preview.placeholder`, and `preview.content` then we can set
     * `preview.isProcessing` to false.
     */
    public async finishProcessingImagePreviewContent(
        context: FileDataActionContext,
        {
            contentType,
            contentLength,
            isAlternative,
        }: {
            contentType: FileContentType;
            contentLength: number;
            isAlternative: boolean;
        },
    ) {
        this._authorize(context);

        await this._item.withLock(async itemRef => {
            itemRef.current = await FilesTable.updateItem(
                context,
                {
                    partitionType: "File2",
                    sortRangeType: "Attributes",
                    fileId: this.fileId,
                },
                (item): FileItem => {
                    if (!item.preview) {
                        throw new InternalError("File doesn\u2019t have a preview");
                    }
                    if (item.preview.type !== "Image") {
                        throw new InternalError("File doesn\u2019t have an image preview");
                    }
                    if (item.preview.content === undefined) {
                        throw new InternalError("File doesn\u2019t have image preview content");
                    }
                    if (isAlternative && !item.alternative) {
                        throw new InternalError("File doesn\u2019t have an alternative");
                    }

                    const newItem: FileItem = {
                        ...item,
                        alternative:
                            // Only update if the alternative is processing. If we've already finished
                            // processing the alternative then we want to leave the old alternative in place.
                            // This makes the function idempotent.
                            isAlternative &&
                            item.alternative?.isProcessing &&
                            (item.preview.content === "Processing" ||
                                item.preview.content !== undefined)
                                ? {
                                      isProcessing: false,
                                      ok: true,
                                      contentType,
                                      contentLength,
                                      isImagePreviewContent: true,
                                  }
                                : item.alternative,
                        preview:
                            // Only update if preview content is processing. If we've already finished
                            // processing the alternative then we want to leave the old alternative in place.
                            // This makes the function idempotent.
                            item.preview.isProcessing && item.preview.content === "Processing"
                                ? item.preview.size !== "Processing" &&
                                  item.preview.placeholder !== "Processing" &&
                                  item.preview.videoDuration !== "Processing"
                                    ? {
                                          type: "Image",
                                          isProcessing: false,
                                          ok: true,
                                          size: item.preview.size,
                                          placeholder: item.preview.placeholder,
                                          content: {contentType, contentLength},
                                          videoDuration: item.preview.videoDuration,
                                      }
                                    : {
                                          type: "Image",
                                          isProcessing: true,
                                          size: item.preview.size,
                                          placeholder: item.preview.placeholder,
                                          content: {contentType, contentLength},
                                          videoDuration: item.preview.videoDuration,
                                      }
                                : item.preview,
                    };

                    // Optimization: If we left both `item.preview.content` alone and
                    // `item.alternative` alone then return the old item to skip a DynamoDB write.
                    if (isDeepEqualForUnknownValues(newItem, item)) return item;

                    return newItem;
                },
                {initialItem: itemRef.current},
            );
        });
    }

    /**
     * When we're done processing `preview.videoDuration` we call this method to add
     * the preview video duration to DynamoDB. If we've finished processing all the
     * data in `preview` then we can set `preview.isProcessing` to false.
     *
     * Calling this multiple times with the same `videoDuration` will noop. (Hence the
     * "if needed" in the name.) This is because sometimes preview video duration is
     * available at the same time preview size is available and so we write the video
     * duration with the preview size.
     */
    public async finishProcessingImagePreviewVideoDurationIfNeeded(
        context: FileDataActionContext,
        videoDuration: number,
    ): Promise<void> {
        this._authorize(context);

        return await this._item.withLock(async itemRef => {
            if (!itemRef.current.preview) {
                throw new InternalError("File doesn\u2019t have a preview");
            }
            if (itemRef.current.preview.type !== "Image") {
                throw new InternalError("File doesn\u2019t have an image preview");
            }

            itemRef.current = await FilesTable.updateItem(
                context,
                {
                    partitionType: "File2",
                    sortRangeType: "Attributes",
                    fileId: this.fileId,
                },
                item => {
                    if (!item.preview) {
                        throw new InternalError("File doesn\u2019t have a preview");
                    }
                    if (item.preview.type !== "Image") {
                        throw new InternalError("File doesn\u2019t have an image preview");
                    }

                    // Noop if we've already finished processing the preview. This makes the function
                    // idempotent.
                    if (!item.preview.isProcessing) return item;

                    if (item.preview.videoDuration === undefined) {
                        throw new InternalError(
                            "File doesn\u2019t have a image preview video duration",
                        );
                    }

                    // Noop if we've already finished processing the preview. This makes the function
                    // idempotent.
                    if (item.preview.videoDuration !== "Processing") return item;

                    return {
                        ...item,
                        preview:
                            item.preview.size !== "Processing" &&
                            item.preview.placeholder !== "Processing" &&
                            item.preview.content !== "Processing"
                                ? {
                                      type: "Image",
                                      isProcessing: false,
                                      ok: true,
                                      size: item.preview.size,
                                      placeholder: item.preview.placeholder,
                                      content: item.preview.content,
                                      videoDuration,
                                  }
                                : {
                                      type: "Image",
                                      isProcessing: true,
                                      size: item.preview.size,
                                      placeholder: item.preview.placeholder,
                                      content: item.preview.content,
                                      videoDuration,
                                  },
                    };
                },
                {initialItem: itemRef.current},
            );
        });
    }

    /**
     * When we're done processing `preview.duration` for a file with an audio preview
     * this function is called.
     */
    public async finishProcessingAudioPreviewDuration(
        context: FileDataActionContext,
        duration: number,
    ): Promise<void> {
        this._authorize(context);

        return await this._item.withLock(async itemRef => {
            itemRef.current = await FilesTable.updateItem(
                context,
                {
                    partitionType: "File2",
                    sortRangeType: "Attributes",
                    fileId: this.fileId,
                },
                item => {
                    if (!item.preview) {
                        throw new InternalError("File doesn\u2019t have a preview");
                    }
                    if (item.preview.type !== "Audio") {
                        throw new InternalError("File doesn\u2019t have an audio preview");
                    }

                    // Noop if we've already finished processing the preview. This makes the function
                    // idempotent.
                    if (!item.preview.isProcessing) return item;
                    if (item.preview.duration !== "Processing") return item;

                    return {
                        ...item,
                        preview:
                            item.preview.metadata !== "Processing"
                                ? {
                                      type: "Audio",
                                      isProcessing: false,
                                      ok: true,
                                      duration,
                                      metadata: item.preview.metadata,
                                  }
                                : {
                                      type: "Audio",
                                      isProcessing: true,
                                      duration,
                                      metadata: item.preview.metadata,
                                  },
                    };
                },
                {initialItem: itemRef.current},
            );
        });
    }

    /**
     * When we're done processing `preview.metadata` for a file with an audio preview
     * this function is called.
     */
    public async finishProcessingAudioPreviewMetadata(
        context: FileDataActionContext,
        metadata: FileAudioPreviewMetadata,
    ): Promise<void> {
        this._authorize(context);

        return await this._item.withLock(async itemRef => {
            itemRef.current = await FilesTable.updateItem(
                context,
                {
                    partitionType: "File2",
                    sortRangeType: "Attributes",
                    fileId: this.fileId,
                },
                item => {
                    if (!item.preview) {
                        throw new InternalError("File doesn\u2019t have a preview");
                    }
                    if (item.preview.type !== "Audio") {
                        throw new InternalError("File doesn\u2019t have an audio preview");
                    }

                    // Noop if we've already finished processing the preview. This makes the function
                    // idempotent.
                    if (!item.preview.isProcessing) return item;
                    if (item.preview.metadata !== "Processing") return item;

                    return {
                        ...item,
                        preview:
                            item.preview.duration !== "Processing"
                                ? {
                                      type: "Audio",
                                      isProcessing: false,
                                      ok: true,
                                      duration: item.preview.duration,
                                      metadata,
                                  }
                                : {
                                      type: "Audio",
                                      isProcessing: true,
                                      duration: item.preview.duration,
                                      metadata,
                                  },
                    };
                },
                {initialItem: itemRef.current},
            );
        });
    }

    /**
     * When we're done processing `preview.content` for a file with a code preview this
     * function is called. Since code previews only need the preview content the file
     * is immediately considered to have finished processing after this function is
     * called.
     */
    public async finishProcessingCodePreviewContent(
        context: FileDataActionContext,
        content: FileCodePreviewContent,
    ): Promise<void> {
        this._authorize(context);

        return await this._item.withLock(async itemRef => {
            itemRef.current = await FilesTable.updateItem(
                context,
                {
                    partitionType: "File2",
                    sortRangeType: "Attributes",
                    fileId: this.fileId,
                },
                item => {
                    if (!item.preview) {
                        throw new InternalError("File doesn\u2019t have a preview");
                    }
                    if (item.preview.type !== "Code") {
                        throw new InternalError("File doesn\u2019t have a code preview");
                    }

                    // Noop if we've already finished processing the preview. This makes the function
                    // idempotent.
                    if (!item.preview.isProcessing) return item;
                    if (item.preview.content !== "Processing") return item;

                    return {
                        ...item,
                        preview: {
                            type: "Code",
                            isProcessing: false,
                            ok: true,
                            content,
                        },
                    };
                },
                {initialItem: itemRef.current},
            );
        });
    }

    /**
     * Save model-produced analysis for the file.
     */
    public async finishProcessingAnalysis(
        context: FileDataActionContext,
        {
            caption,
            description,
            tags,
        }: {
            caption?: string;
            description?: string;
            tags: ReadonlyArray<string>;
        },
    ): Promise<void> {
        this._authorize(context);

        await this._item.withLock(async itemRef => {
            itemRef.current = await FilesTable.updateItem(
                context,
                {
                    partitionType: "File2",
                    sortRangeType: "Attributes",
                    fileId: this.fileId,
                },
                item => {
                    if (!item.analysis) {
                        throw new InternalError("File does not have analysis");
                    }

                    // No-op if we've already finished processing analysis. This makes the function
                    // idempotent.
                    if (!item.analysis.isProcessing) return item;

                    return {
                        ...item,
                        analysis: {
                            isProcessing: false,
                            ok: true,
                            result: {
                                ...(caption !== undefined ? {caption} : {}),
                                ...(description !== undefined ? {description} : {}),
                                tags: [...tags],
                            },
                        },
                    };
                },
                {initialItem: itemRef.current},
            );
        });
    }

    /**
     * Save an analysis generation failure for the file.
     */
    public async finishProcessingAnalysisWithError(
        context: FileDataActionContext,
        error: FileProcessorError,
    ): Promise<void> {
        this._authorize(context);

        await this._item.withLock(async itemRef => {
            itemRef.current = await FilesTable.updateItem(
                context,
                {
                    partitionType: "File2",
                    sortRangeType: "Attributes",
                    fileId: this.fileId,
                },
                item => {
                    if (!item.analysis) {
                        throw new InternalError("File does not have analysis");
                    }

                    if (!item.analysis.isProcessing && !item.analysis.ok) {
                        // Concurrent file processors can race to save an analysis error. Keep a specific
                        // error once we have one, but allow a later specific error to replace `Unknown`.
                        if (item.analysis.error.type !== "Unknown" || error.type === "Unknown") {
                            return item;
                        }

                        return {
                            ...item,
                            analysis: {
                                ...item.analysis,
                                error,
                            },
                        };
                    }

                    // No-op if we've already finished processing analysis. This makes the function
                    // idempotent.
                    if (!item.analysis.isProcessing) return item;

                    return {
                        ...item,
                        analysis: {
                            isProcessing: false,
                            ok: false,
                            error,
                        },
                    };
                },
                {initialItem: itemRef.current},
            );
        });
    }

    /**
     * Mark that a timestamped transcript has been stored for this file.
     */
    public async finishProcessingTranscript(
        context: FileDataActionContext,
        {
            isUnavailable,
        }: {
            readonly isUnavailable?: true;
        } = {},
    ): Promise<void> {
        this._authorize(context);

        await this._item.withLock(async itemRef => {
            itemRef.current = await FilesTable.updateItem(
                context,
                {
                    partitionType: "File2",
                    sortRangeType: "Attributes",
                    fileId: this.fileId,
                },
                item => {
                    if (!item.transcript) return item;

                    // No-op if we've already finished processing the transcript. This makes the
                    // function idempotent.
                    if (!item.transcript.isProcessing) return item;

                    return {
                        ...item,
                        transcript: {
                            isProcessing: false,
                            ok: true,
                            ...(isUnavailable ? {isUnavailable} : {}),
                        },
                    };
                },
                {initialItem: itemRef.current},
            );
        });
    }

    /**
     * Save a transcript generation failure for the file.
     */
    public async finishProcessingTranscriptWithError(
        context: FileDataActionContext,
        error: FileProcessorError,
    ): Promise<void> {
        this._authorize(context);

        await this._item.withLock(async itemRef => {
            itemRef.current = await FilesTable.updateItem(
                context,
                {
                    partitionType: "File2",
                    sortRangeType: "Attributes",
                    fileId: this.fileId,
                },
                item => {
                    if (!item.transcript) return item;

                    // No-op if we've already finished processing the transcript. This makes the
                    // function idempotent.
                    if (!item.transcript.isProcessing) return item;

                    return {
                        ...item,
                        transcript: {
                            isProcessing: false,
                            ok: false,
                            error,
                        },
                    };
                },
                {initialItem: itemRef.current},
            );
        });
    }

    public async finishProcessingAlternativeWithError(
        context: FileDataActionContext,
        error: FileProcessorError,
    ) {
        this._authorize(context);

        await this._item.withLock(async itemRef => {
            itemRef.current = await FilesTable.updateItem(
                context,
                {
                    partitionType: "File2",
                    sortRangeType: "Attributes",
                    fileId: this.fileId,
                },
                item => {
                    if (!item.alternative) {
                        // Noop if we've already finished processing the alternative. This makes the
                        // function idempotent.
                        if (item.hasProcessedNullAlternative) return item;

                        throw new InternalError("File doesn\u2019t have an alternative");
                    }

                    // Noop if we've already finished processing the alternative. This makes the
                    // function idempotent.
                    if (!item.alternative.isProcessing) return item;

                    return {
                        ...item,
                        alternative: {
                            isProcessing: false,
                            ok: false,
                            error,
                        },
                    };
                },
                {initialItem: itemRef.current},
            );
        });
    }

    public async finishProcessingPreviewWithError(
        context: FileDataActionContext,
        error: FileProcessorError,
    ) {
        this._authorize(context);

        await this._item.withLock(async itemRef => {
            itemRef.current = await FilesTable.updateItem(
                context,
                {
                    partitionType: "File2",
                    sortRangeType: "Attributes",
                    fileId: this.fileId,
                },
                item => {
                    if (!item.preview) {
                        throw new InternalError("File doesn\u2019t have a preview");
                    }

                    if (!item.preview.isProcessing && !item.preview.ok) {
                        // Concurrent file processors can race to save a preview error. For
                        // password-protected PDFs, sharp may sometimes report an unclassified error before
                        // another processor reports the real password-protected error. Keep a specific
                        // error once we have one, but allow a later specific error to replace `Unknown`.
                        if (item.preview.error.type !== "Unknown" || error.type === "Unknown") {
                            return item;
                        }

                        return {
                            ...item,
                            preview: {
                                ...item.preview,
                                error,
                            },
                        };
                    }

                    switch (item.preview.type) {
                        case "Image": {
                            // Noop if we've already finished processing the preview. This makes the function
                            // idempotent.
                            if (!item.preview.isProcessing) return item;

                            return {
                                ...item,
                                preview: {
                                    type: "Image",
                                    isProcessing: false,
                                    ok: false,
                                    error,
                                    size:
                                        item.preview.size === "Processing"
                                            ? "Error"
                                            : item.preview.size,
                                    placeholder:
                                        item.preview.placeholder === "Processing"
                                            ? "Error"
                                            : item.preview.placeholder,
                                    content:
                                        item.preview.content === "Processing"
                                            ? "Error"
                                            : item.preview.content,
                                    videoDuration:
                                        item.preview.videoDuration === "Processing"
                                            ? "Error"
                                            : item.preview.videoDuration,
                                },
                            };
                        }
                        case "Audio": {
                            // Noop if we've already finished processing the preview. This makes the function
                            // idempotent.
                            if (!item.preview.isProcessing) return item;

                            return {
                                ...item,
                                preview: {
                                    type: "Audio",
                                    isProcessing: false,
                                    ok: false,
                                    error,
                                    duration:
                                        item.preview.duration === "Processing"
                                            ? "Error"
                                            : item.preview.duration,
                                    metadata:
                                        item.preview.metadata === "Processing"
                                            ? "Error"
                                            : item.preview.metadata,
                                },
                            };
                        }
                        case "Code": {
                            // Noop if we've already finished processing the preview. This makes the function
                            // idempotent.
                            if (!item.preview.isProcessing) return item;

                            return {
                                ...item,
                                preview: {
                                    type: "Code",
                                    isProcessing: false,
                                    ok: false,
                                    error,
                                    content:
                                        item.preview.content === "Processing"
                                            ? "Error"
                                            : item.preview.content,
                                },
                            };
                        }
                        default:
                            throw exhaustive(item.preview);
                    }
                },
                {initialItem: itemRef.current},
            );
        });
    }
}

const FileItemContextCache = new DynamoContextCache<FileId, FileItem | null>({
    // Allow sharing this cache because the loaded DynamoDB item doesn't depend on who
    // the actor is.
    whenActorChanges: "DangerouslyShare",
});

function getFileItemIfExistsWithCache(
    context: FileDataActionContext,
    fileId: FileId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<FileItem | null> {
    return FileItemContextCache.get(context, consistency, fileId, consistency =>
        FilesTable.getItemIfExists(
            context,
            {
                partitionType: "File2",
                sortRangeType: "Attributes",
                fileId,
            },
            {consistency},
        ),
    );
}

async function getFileItemIfExistsAsUploader(
    context: FileDataActionContext,
    fileId: FileId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<FileItem | null> {
    const item = await getFileItemIfExistsWithCache(context, fileId, {consistency});
    if (!item) return null;

    switch (context.actor.type) {
        case "System": {
            await authorizeSpaceAccess(context, item.spaceId);
            break;
        }
        case "Session": {
            if (item.uploaderId !== context.actor.getAccountId()) {
                throw new PermissionDeniedError("Account didn\u2019t upload file");
            }
            break;
        }
        case "ImpersonatedAccount": {
            await authorizeSpaceAccess(context, item.spaceId);

            if (item.uploaderId !== context.actor.getAccountId()) {
                throw new PermissionDeniedError("Account didn\u2019t upload file");
            }
            break;
        }
        case "Anonymous": {
            throw unauthenticatedSessionError();
        }
        case "Bot": {
            if (item.uploaderId !== context.actor.getBotAccountId()) {
                throw new PermissionDeniedError("Account didn\u2019t upload file");
            }
            break;
        }
        default:
            throw exhaustive(context.actor);
    }

    return item;
}

/**
 * Get a file as the file's uploader. Returns null if the file doesn't exist.
 * Throws an error if you're not the account that upload the file. If we have a
 * system actor then the system actor may read all files.
 *
 * Prefer calling `getFileIfExistsFromAttachment()` since that will work for all
 * accounts with access to the file.
 */
export async function getFileIfExistsAsUploader(
    context: FileDataActionContext,
    fileId: FileId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<FileModel | null> {
    const item = await getFileItemIfExistsAsUploader(context, fileId, options);
    if (!item) return null;
    return createFileModelFromItem(item);
}

/**
 * Get a file as the file's uploader. Throws an error if the file doesn't exist.
 * Throws an error if you're not the account that upload the file. If we have a
 * system actor then the system actor may read all files.
 *
 * Prefer calling `getFileIfFromAttachment()` since that will work for all accounts
 * with access to the file.
 */
export async function getFileAsUploader(
    context: FileDataActionContext,
    fileId: FileId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<FileModel> {
    const file = await getFileIfExistsAsUploader(context, fileId, options);
    if (!file) throw new NotFoundError("File not found");
    return file;
}

export function getFileIfExistsAsSystem(
    context: FileDataSystemActionContext,
    fileId: FileId,
    options?: {consistency?: DynamoCacheReadConsistency},
) {
    context.actor.authorizeSystem();

    // `getFileIfExistsAsUploader()` works for system actors. This is a convenience
    // function with a nicer name for system actors.
    return getFileIfExistsAsUploader(context, fileId, options);
}

export function getFileAsSystem(
    context: FileDataSystemActionContext,
    fileId: FileId,
    options?: {consistency?: DynamoCacheReadConsistency},
) {
    context.actor.authorizeSystem();

    // `getFileAsUploader()` works for system actors. This is a convenience function
    // with a nicer name for system actors.
    return getFileAsUploader(context, fileId, options);
}

/**
 * Get a file attached to some entity. Returns null if the file doesn't exist.
 *
 * To authorize we need a `FileAuthorizer`. This object contains the target we're
 * viewing the file in the context of. We'll throw an error if the actor doesn't
 * have access to the attachment target or the file isn't actually attached to the
 * target.
 */
export async function getFileIfExistsFromAttachment(
    context: ServerActionContext,
    fileId: FileId,
    targetAuthorizer: FileAuthorizer,
    {
        consistency = "Eventual",
        accessLevel = "View",
    }: {
        consistency?: DynamoCacheReadConsistency;
        accessLevel?: "View" | "Edit";
    } = {},
): Promise<FileModel | null> {
    const [item, , targetItem] = await runAllPromises([
        getFileItemIfExistsWithCache(context, fileId, {consistency}),

        // 1. Make sure we have access to the file's attachment target
        targetAuthorizer.authorizeTargetAccess(context, accessLevel, {consistency}),

        // 2. Make sure the file is actually attached to the provided target
        (async () => {
            let targetItem = await FilesTable.getItemIfExists(
                context,
                getFileAttachmentTargetItemKey(fileId, targetAuthorizer.target),
                {consistency},
            );

            if (!targetItem && consistency === "Eventual") {
                targetItem = await FilesTable.getItemIfExists(
                    context,
                    getFileAttachmentTargetItemKey(fileId, targetAuthorizer.target),
                    {consistency: "Strong"},
                );
            }

            return targetItem;
        })(),
    ]);
    if (!item) return null;

    if (!targetItem) {
        throw new PermissionDeniedError("File isn\u2019t attached to target");
    }

    return createFileModelFromItem(item);
}

function createFileModelFromItem(item: FileItem) {
    return new FileModel({
        id: item.fileId,
        spaceId: item.spaceId,
        contentType: item.contentType,
        contentLength: item.contentLength,
        isUploading: item.isUploading,
        alternative: item.alternative,
        analysis: item.analysis,
        preview: item.preview,
        transcript: item.transcript,
    });
}

/**
 * Get a file attached to some entity. Throws an error if the file doesn't exist.
 *
 * To authorize we need a `FileAuthorizer`. This object contains the target we're
 * viewing the file in the context of. We'll throw an error if the actor doesn't
 * have access to the attachment target or the file isn't actually attached to the
 * target.
 */
export async function getFileFromAttachment(
    context: ServerActionContext,
    fileId: FileId,
    targetAuthorizer: FileAuthorizer,
    options?: {consistency?: DynamoCacheReadConsistency; accessLevel?: "View" | "Edit"},
): Promise<FileModel> {
    const file = await getFileIfExistsFromAttachment(context, fileId, targetAuthorizer, options);
    if (!file) throw new NotFoundError("File not found");
    return file;
}

/**
 * Attach a file to some `FileAttachmentTarget` (represented by a `FileAuthorizer`
 * instance) as the file's uploader. Throws an error if the file doesn't exist or
 * if the actor isn't the file's uploader.
 *
 * If you want to attach the file to another target and you're not the file's
 * uploader then use `attachFileFromAttachment()`.
 *
 * Attaching a file gives anyone with access to the `FileAttachmentTarget` the
 * ability to view the file.
 */
export async function attachFileAsUploader(
    context: ServerActionContext,
    fileId: FileId,
    targetAuthorizer: FileAuthorizer,
): Promise<FileModel> {
    const file = await (async () => {
        const file = await getFileIfExistsAsUploader(context, fileId, {
            consistency: "Eventual",
        });
        if (file) return file;
        return await getFileAsUploader(context, fileId, {consistency: "Strong"});
    })();

    await targetAuthorizer.authorizeTargetAccess(context, "Edit");

    await FilesTable.createOrReplaceItem(context, {
        ...getFileAttachmentTargetItemKey(fileId, targetAuthorizer.target),
        createdTime: new Date(),
    });

    return file;
}

/**
 * Attach a file to a document as a system actor, bypassing authorization.
 *
 * This is used by the importer service to attach files to documents during import.
 * The importer uploads files and creates documents, but the file attachment
 * records need to be created separately.
 *
 * WARNING: This bypasses all authorization checks. Only use for trusted system
 * operations where the caller has already verified that the file exists and the
 * attachment is valid.
 */
export async function attachFileToDocumentAsSystem(
    context: FileDataSystemActionContext,
    fileId: FileId,
    documentId: DocumentId,
): Promise<void> {
    context.actor.authorizeSystem();

    await FilesTable.createOrReplaceItem(context, {
        ...getFileAttachmentTargetItemKey(fileId, {type: "Document", documentId}),
        createdTime: new Date(),
    });
}

/**
 * Attach a file to some `FileAttachmentTarget` (`to`) based on the actor's access
 * to the file through a different `FileAttachmentTarget` (`from`).
 *
 * See `attachFileAsUploader()` for more information. You call this method when
 * there's a file you already have you want to attach to another target (e.g.
 * through copy/pasting).
 */
export async function attachFileFromAttachment(
    context: ServerActionContext,
    fileId: FileId,
    {
        from,
        to,
        dangerouslySkipToAuthorizeTargetAccess,
    }: {
        from: FileAuthorizer;
        to: FileAuthorizer;
        dangerouslySkipToAuthorizeTargetAccess?: boolean;
    },
): Promise<FileModel> {
    const file = await getFileFromAttachment(context, fileId, from);

    if (!dangerouslySkipToAuthorizeTargetAccess) {
        await to.authorizeTargetAccess(context, "Edit");
    }

    await FilesTable.createOrReplaceItem(context, {
        ...getFileAttachmentTargetItemKey(fileId, to.target),
        createdTime: new Date(),
    });

    return file;
}

/**
 * Detach a file from the provided attachment target. Noop if the file attachment
 * doesn't exist but throws if the file doesn't exist.
 */
export async function detachFile(
    context: ServerActionContext,
    fileId: FileId,
    targetAuthorizer: FileAuthorizer,
): Promise<void> {
    // Make sure the file exists with the provided authorizer. This will call
    // `targetAuthorizer.authorizeTargetAccess()`.
    await getFileFromAttachment(context, fileId, targetAuthorizer, {
        accessLevel: "Edit",
    });

    await FilesTable.deleteItemWithKeyIfExists(context, {
        ...getFileAttachmentTargetItemKey(fileId, targetAuthorizer.target),
        createdTime: new Date(),
    });
}

/**
 * Get all file attachments for a post draft.
 */
export async function getPostDraftFileAttachments(
    context: ServerActionContext,
    spaceId: SpaceId,
    accountId: AccountId,
    draftId: PostDraftId,
    targetUnboundAuthorizer: FileAuthorizerUnbound<"Post">,
): Promise<Array<FileId>> {
    await targetUnboundAuthorizer
        .bind({type: "PostDraft", spaceId, accountId, draftId})
        .authorizeTargetAccess(context, "View");

    return await arrayFromAsyncIterable(
        mapAsyncIterableIterator(
            PostDraftFile2AttachmentsIndex.query(context, {
                partitionKey: {accountId, draftId},
                limit: "All",
            }),
            item => item.fileId,
        ),
    );
}
