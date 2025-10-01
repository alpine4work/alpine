import prettyBytes from "pretty-bytes";
import {
    ServerAccountActionContext,
    ServerActionContext,
    ServerSystemActionContext,
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
import {FileProcessorActionContext} from "~/server/files/data/file_processor_context.js";
import {fileProcessorDeclarationByContentType} from "~/server/files/data/file_processor_declaration_by_content_type.js";
import {
    FilesTable,
    PostDraftFileAttachmentsIndex,
} from "~/server/files/data/internal/files_table.js";
import {routeFileToProcessor} from "~/server/files/data/route_file_to_processor.js";
import {unauthenticatedSessionError} from "~/server/helpers/unauthenticated_session_error.js";
import {authorizeSpaceAccess} from "~/server/spaces/spaces_actions.js";
import {
    FailedPreconditionError,
    InternalError,
    InvalidArgumentError,
    NotFoundError,
    PermissionDeniedError,
} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {FileCodePreviewContent} from "~/shared/files/file_code_preview_content.js";
import {maxFileContentLength} from "~/shared/files/file_constants.js";
import {FileContentType} from "~/shared/files/file_content_type.js";
import {FileImagePreviewPlaceholder} from "~/shared/files/file_image_preview_placeholder.js";
import {FileModel} from "~/shared/files/file_model.js";
import {
    FileAudioPreviewMetadata,
    FileImagePreviewSize,
    FilePreview,
} from "~/shared/files/file_preview.js";
import {FileProcessorError} from "~/shared/files/file_processor_error.js";
import {MutexValue} from "~/shared/helpers/async/mutex_value.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {mapAsyncIterableIterator} from "~/shared/helpers/iterable/map_async_iterable_iterator.js";
import {generateChronologicalId, getChronologicalIdTime} from "~/shared/id/chronological_id.js";
import {AccountId, FileId, PostDraftId, SpaceId} from "~/shared/id/types/id_types.js";
import {alpineCompanyKnownSpaceId} from "~/shared/spaces/known_space_ids.js";

/**
 * NOTE: this file is currently being split up. We do not anticipate adding more methods here.
 */

type FileItem = DynamoTableItemType<typeof FilesTable, "Space", "File">;

type FileAttachmentTargetItemKey = DynamoTableItemKeyType<
    typeof FilesTable,
    "File",
    `${string}AttachmentTarget`
>;

function getFileAttachmentTargetItemKey(
    spaceId: SpaceId,
    fileId: FileId,
    target: FileAttachmentTarget,
): FileAttachmentTargetItemKey {
    switch (target.type) {
        case "ChatMessages": {
            return {
                partitionType: "File",
                sortRangeType: "ChatMessagesAttachmentTarget",
                spaceId,
                fileId,
                chatId: target.chatId,
            };
        }
        case "Document": {
            return {
                partitionType: "File",
                sortRangeType: "DocumentAttachmentTarget",
                spaceId,
                fileId,
                documentId: target.documentId,
            };
        }
        case "DocumentComments": {
            return {
                partitionType: "File",
                sortRangeType: "DocumentCommentsAttachmentTarget",
                spaceId,
                fileId,
                documentId: target.documentId,
            };
        }
        case "Post": {
            return {
                partitionType: "File",
                sortRangeType: "PostAttachmentTarget",
                spaceId,
                fileId,
                postId: target.postId,
            };
        }
        case "PostDraft": {
            return {
                partitionType: "File",
                sortRangeType: "PostDraftAttachmentTarget",
                spaceId,
                fileId,
                accountId: target.accountId,
                draftId: target.draftId,
            };
        }
        case "PostComments": {
            return {
                partitionType: "File",
                sortRangeType: "PostCommentsAttachmentTarget",
                spaceId,
                fileId,
                postId: target.postId,
            };
        }
        case "TaskNotes": {
            return {
                partitionType: "File",
                sortRangeType: "TaskNotesAttachmentTarget",
                spaceId,
                fileId,
                taskId: target.taskId,
            };
        }
        case "TaskComments": {
            return {
                partitionType: "File",
                sortRangeType: "TaskCommentsAttachmentTarget",
                spaceId,
                fileId,
                taskId: target.taskId,
            };
        }
        default:
            throw exhaustive(target);
    }
}

/**
 * The total number of bytes you're allowed to store in an Alpine space on the
 * free plan (5 GB). After you exceed this amount we'll start deleting old
 * files. This is the same as Slack's file limit for their free plan.
 *
 * We should allow paying users to upload more but this is a fine starting
 * place.
 */
const maxFileTotalContentLengthForSpace = 5e9;

/**
 * Called by `EdgeService` before writing our file to Cloudflare R2. Makes sure
 * the space has enough storage for the file and creates a file item in
 * DynamoDB containing information about the file.
 *
 * Throws an error if not called by `EdgeService`. A complete file upload is
 * orchestrated by `EdgeService` and involves three parts:
 *
 * 1. `startUploadFile()`
 * 2. Uploading the file to Cloudflare R2
 * 3. `finishUploadingAndStartProcessingFile()` (which submits a job to our job
 *    queue to process the file)
 *
 * If there's an error and we don't complete one of those three steps the
 * resulting file item in DynamoDB won't be very useful.
 */
export async function startUploadingFile(
    context: ServerAccountActionContext,
    {
        spaceId,
        fileId: providedFileId = null,
        contentType,
        contentLength,
        attachTargetAuthorizer = null,
    }: {
        spaceId: SpaceId;
        fileId?: FileId | null;
        contentType: FileContentType;
        contentLength: number;
        attachTargetAuthorizer?: FileAuthorizer | null;
    },
): Promise<{fileId: FileId}> {
    await authorizeSpaceAccess(context, spaceId);

    // If we're attaching the file to a target as a part of the upload, verify we
    // have edit access to the target.
    await attachTargetAuthorizer?.authorizeTargetAccess(context, spaceId, "Edit");

    if (!import.meta.jest && context.actor.serviceName !== "EdgeService") {
        throw new PermissionDeniedError("Only `EdgeService` can upload files");
    }

    if (!(0 < contentLength && contentLength <= maxFileContentLength)) {
        throw new InvalidArgumentError(
            `File content length must be between 0 and ${prettyBytes(maxFileContentLength)}`,
        );
    }

    const {hasAlternative, hasPreview} = fileProcessorDeclarationByContentType[contentType];

    let fileId: FileId;
    if (providedFileId === null) {
        fileId = generateChronologicalId();
    } else {
        const time = getChronologicalIdTime(providedFileId);
        const currentTime = Date.now();

        // Make sure the time provided by the client is reasonable so our files table
        // is still roughly sorted by creation time.
        if (Math.abs(time - currentTime) > 1000 * 60 * 2) {
            throw new FailedPreconditionError(
                "Provided `FileId` must be within a 4 minute window of the current time",
            );
        }

        fileId = providedFileId;
    }

    return context.dynamo.retryTransaction(async context => {
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

        // If we're in the default development space then we'll allow infinite file
        // uploads so developers can test file uploads without limits.
        const isFileLimitEnforced =
            (process.env.NODE_ENV !== "development" ||
                spaceId !== getDynamoSeedConstants().defaultSpaceId) &&
            // We also disable the file limit for our own space.
            spaceId !== alpineCompanyKnownSpaceId;

        // We allow one file to be uploaded beyond the space's max content length. This
        // allows us to say "you've reached your limit" in our error message.
        if (
            isFileLimitEnforced &&
            fileTotalsItem.contentLength > maxFileTotalContentLengthForSpace
        ) {
            throw new InvalidArgumentError(
                `Uploading files beyond our ${prettyBytes(
                    maxFileTotalContentLengthForSpace,
                )} limit is currently unsupported. Eventually we should: 1) Increase the limit for paying customers, 2) Archive old uploaded files to create more space`,
                {
                    displayMessage: errorDisplayMessage`This space has exceeded its ${prettyBytes(
                        maxFileTotalContentLengthForSpace,
                    )} storage limit. Can’t upload more files. To raise this space’s storage limit contact ${
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
            partitionType: "Space",
            sortRangeType: "File",
            spaceId,
            fileId,
            contentType,
            contentLength,
            uploaderId: context.actor.getPossiblyBotAccountId(),
            isUploading: true,
            alternative: hasAlternative ? {isProcessing: true} : null,
            preview,
        };

        await DynamoTableSchema.executeTransaction(context, [
            FilesTable.transactionDirectlyUpdateItem({
                ...fileTotalsItem,
                count: fileTotalsItem.count + 1,
                contentLength: fileTotalsItem.contentLength + contentLength,
            }),

            // Don't allow creating duplicate files when providing a `FileId`.
            providedFileId
                ? FilesTable.transactionCreateItem(fileItem)
                : FilesTable.transactionCreateOrReplaceItem(fileItem),

            ...(attachTargetAuthorizer
                ? [
                      FilesTable.transactionCreateOrReplaceItem({
                          ...getFileAttachmentTargetItemKey(
                              spaceId,
                              fileId,
                              attachTargetAuthorizer.target,
                          ),
                          createdTime: new Date(),
                      }),
                  ]
                : []),
        ]);

        return {fileId};
    });
}

/**
 * Once `EdgeService` has finished uploading a file to Cloudflare R2 it calls
 * this function which marks the file as uploaded and starts processing the
 * file. Throws an error if not called by `EdgeService`. See the documentation
 * on `startUploadingFile()` for more information.
 */
export async function finishUploadingAndStartProcessingFile(
    context: ServerAccountActionContext,
    {
        spaceId,
        fileId,
        validateContentLength,
        withoutProcessJobForTest,
    }: {
        spaceId: SpaceId;
        fileId: FileId;
        validateContentLength?: number;
        withoutProcessJobForTest?: boolean;
    },
): Promise<FileModel> {
    if (!import.meta.jest && context.actor.serviceName !== "EdgeService") {
        throw new PermissionDeniedError("Only `EdgeService` can upload files");
    }

    if (withoutProcessJobForTest) {
        assert(process.env.NODE_ENV === "test");
    }

    return context.dynamo.retryTransaction(async context => {
        let item = await getFileItemIfExistsAsUploader(context, spaceId, fileId, {
            consistency: "Eventual",
        });

        // In case there's an eventual consistency lag, retry reading the item with
        // strong consistency.
        if (!item) {
            item = await getFileItemIfExistsAsUploader(context, spaceId, fileId, {
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

        if (!withoutProcessJobForTest && (hasAlternative || hasPreview)) {
            // Now that the file has finished uploading we can start processing it. Wait
            // for the message to be added to our queue. If sending the process file
            // message fails we want to fail the entire upload.

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
 * Get an instance of `FileUploader` we can use for finishing a file upload.
 * Only an uploader may get an instance of the `FileUploader` class.
 */
export async function getFileUploaderAsUploader(
    context: FileProcessorActionContext,
    spaceId: SpaceId,
    fileId: FileId,
): Promise<FileUploader> {
    let fileItem = await getFileItemIfExistsAsUploader(context, spaceId, fileId, {
        consistency: "Eventual",
    });

    // If we weren't able to find a file that might be because of eventual
    // consistency lag. Try again with strong consistency.
    if (!fileItem) {
        fileItem = await getFileItemIfExistsAsUploader(context, spaceId, fileId, {
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
 * It's useful to have a stateful object to save on read requests since the
 * class can hold onto the last value of `FileItem` so we don't need to read it
 * from the database.
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

    private _authorize(context: FileProcessorActionContext) {
        switch (context.actor.type) {
            case "Session": {
                if (this.uploaderId !== context.actor.getAccountId()) {
                    throw new PermissionDeniedError("Account is not the file’s uploader account");
                }
                break;
            }
            case "System": {
                if (this.spaceId !== context.actor.getSpaceId()) {
                    throw new PermissionDeniedError("System actor is not for the file’s space");
                }
                break;
            }
            case "ImpersonatedAccount": {
                if (this.spaceId !== context.actor.getSpaceId()) {
                    throw new PermissionDeniedError(
                        "Impersonated account actor is not for the file’s space",
                    );
                }
                if (this.uploaderId !== context.actor.getAccountId()) {
                    throw new PermissionDeniedError("Account is not the file’s uploader account");
                }
                break;
            }
            case "Anonymous": {
                throw unauthenticatedSessionError();
            }
            case "Bot": {
                if (this.uploaderId !== context.actor.getBotAccountId()) {
                    throw new PermissionDeniedError("Account is not the file’s uploader account");
                }
                break;
            }
            default:
                throw exhaustive(context.actor);
        }
    }

    /**
     * Finish processing the file's alternative if the file has an alternative. If
     * the file was not declared to have an alternative upon creation then this
     * method will throw an error.
     */
    public async finishProcessingAlternative(
        context: FileProcessorActionContext,
        alternative: {contentType: FileContentType; contentLength: number} | null,
    ) {
        this._authorize(context);

        await this._item.withLock(async itemRef => {
            itemRef.current = await FilesTable.updateItem(
                context,
                {
                    partitionType: "Space",
                    sortRangeType: "File",
                    spaceId: this.spaceId,
                    fileId: this.fileId,
                },
                item => {
                    if (!item.alternative) {
                        // Noop if we've already finished processing the alternative. This makes the
                        // function idempotent.
                        //
                        // We'll still error if we try to finish with a non-null `alternative` but
                        // there's no non-null `alternative` in the file as a precaution.
                        if (alternative === null) return item;

                        throw new InternalError("File doesn’t have an alternative");
                    }

                    // Noop if we've already finished processing the alternative. This makes the
                    // function idempotent.
                    if (!item.alternative.isProcessing) return item;

                    return {
                        ...item,
                        alternative:
                            alternative !== null
                                ? {
                                      isProcessing: false,
                                      ok: true,
                                      contentType: alternative.contentType,
                                      contentLength: alternative.contentLength,
                                      isImagePreviewContent: false,
                                  }
                                : null,
                    };
                },
                {initialItem: itemRef.current},
            );
        });
    }

    /**
     * When we're done processing `preview.size` we call this method to add the
     * preview size to DynamoDB. If we've finished processing all of
     * `preview.size`, `preview.placeholder`, and `preview.content` then we can set
     * `preview.isProcessing` to false.
     *
     * May also finish processing the video duration if `alsoPreviewVideoDuration`
     * is provided as an option.
     */
    public async finishProcessingImagePreviewSize(
        context: FileProcessorActionContext,
        size: FileImagePreviewSize,
        {alsoPreviewVideoDuration}: {alsoPreviewVideoDuration?: number} = {},
    ) {
        this._authorize(context);

        await this._item.withLock(async itemRef => {
            itemRef.current = await FilesTable.updateItem(
                context,
                {
                    partitionType: "Space",
                    sortRangeType: "File",
                    spaceId: this.spaceId,
                    fileId: this.fileId,
                },
                item => {
                    if (!item.preview) {
                        throw new InternalError("File doesn’t have a preview");
                    }
                    if (item.preview.type !== "Image") {
                        throw new InternalError("File doesn’t have an image preview");
                    }

                    // Noop if we've already finished processing the preview. This makes the
                    // function idempotent.
                    if (!item.preview.isProcessing) return item;

                    if (
                        alsoPreviewVideoDuration !== undefined &&
                        item.preview.videoDuration === undefined
                    ) {
                        throw new InternalError("File doesn’t have a image preview video duration");
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
                                      // Only update if size is processing. If we've already finished
                                      // processing size then we want to leave the old size in
                                      // place. This makes the function idempotent.
                                      size:
                                          item.preview.size === "Processing"
                                              ? size
                                              : item.preview.size,
                                      placeholder: item.preview.placeholder,
                                      content: item.preview.content,
                                      videoDuration:
                                          // Only update if video duration is processing. If we've already finished
                                          // processing video duration then we want to leave the old video duration in
                                          // place. This makes the function idempotent.
                                          (item.preview.videoDuration === "Processing"
                                              ? alsoPreviewVideoDuration ??
                                                item.preview.videoDuration
                                              : item.preview.videoDuration) as number | undefined,
                                  }
                                : {
                                      type: "Image",
                                      isProcessing: true,
                                      // Only update if size is processing. If we've already finished
                                      // processing size then we want to leave the old size in
                                      // place. This makes the function idempotent.
                                      size:
                                          item.preview.size === "Processing"
                                              ? size
                                              : item.preview.size,
                                      placeholder: item.preview.placeholder,
                                      content: item.preview.content,
                                      videoDuration:
                                          // Only update if video duration is processing. If we've already finished
                                          // processing video duration then we want to leave the old video duration in
                                          // place. This makes the function idempotent.
                                          item.preview.videoDuration === "Processing"
                                              ? alsoPreviewVideoDuration ??
                                                item.preview.videoDuration
                                              : item.preview.videoDuration,
                                  },
                    };

                    // Optimization: If we left both `item.preview.size` alone and
                    // `item.preview.videoDuration` alone then return the old item to skip a
                    // DynamoDB write.
                    if (isDeepEqual(newItem, item)) return item;

                    return newItem;
                },
                {initialItem: itemRef.current},
            );
        });
    }

    /**
     * When we're done processing `preview.placeholder` we call this method to add
     * the preview placeholder to DynamoDB. If we've finished processing all of
     * `preview.size`, `preview.placeholder`, and `preview.content` then we can set
     * `preview.isProcessing` to false.
     */
    public async finishProcessingImagePreviewPlaceholder(
        context: FileProcessorActionContext,
        placeholder: FileImagePreviewPlaceholder,
    ) {
        this._authorize(context);

        await this._item.withLock(async itemRef => {
            itemRef.current = await FilesTable.updateItem(
                context,
                {
                    partitionType: "Space",
                    sortRangeType: "File",
                    spaceId: this.spaceId,
                    fileId: this.fileId,
                },
                item => {
                    if (!item.preview) {
                        throw new InternalError("File doesn’t have a preview");
                    }
                    if (item.preview.type !== "Image") {
                        throw new InternalError("File doesn’t have an image preview");
                    }

                    // Noop if we've already finished processing the preview. This makes the
                    // function idempotent.
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
     * When we're done processing `preview.content` we call this method to add
     * the preview image to DynamoDB. If we've finished processing all of
     * `preview.size`, `preview.placeholder`, and `preview.content` then we can set
     * `preview.isProcessing` to false.
     */
    public async finishProcessingImagePreviewContent(
        context: FileProcessorActionContext,
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
                    partitionType: "Space",
                    sortRangeType: "File",
                    spaceId: this.spaceId,
                    fileId: this.fileId,
                },
                (item): FileItem => {
                    if (!item.preview) {
                        throw new InternalError("File doesn’t have a preview");
                    }
                    if (item.preview.type !== "Image") {
                        throw new InternalError("File doesn’t have an image preview");
                    }
                    if (item.preview.content === undefined) {
                        throw new InternalError("File doesn’t have image preview content");
                    }
                    if (isAlternative && !item.alternative) {
                        throw new InternalError("File doesn’t have an alternative");
                    }

                    const newItem: FileItem = {
                        ...item,
                        alternative:
                            // Only update if the alternative is processing. If we've already finished
                            // processing the alternative then we want to leave the old alternative in
                            // place. This makes the function idempotent.
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
                            // processing the alternative then we want to leave the old alternative in
                            // place. This makes the function idempotent.
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
                    if (isDeepEqual(newItem, item)) return item;

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
     * Calling this multiple times with the same `videoDuration` will noop. (Hence
     * the "if needed" in the name.) This is because sometimes preview video
     * duration is available at the same time preview size is available and so we
     * write the video duration with the preview size.
     */
    public async finishProcessingImagePreviewVideoDurationIfNeeded(
        context: FileProcessorActionContext,
        videoDuration: number,
    ): Promise<void> {
        this._authorize(context);

        return this._item.withLock(async itemRef => {
            if (!itemRef.current.preview) {
                throw new InternalError("File doesn’t have a preview");
            }
            if (itemRef.current.preview.type !== "Image") {
                throw new InternalError("File doesn’t have an image preview");
            }

            itemRef.current = await FilesTable.updateItem(
                context,
                {
                    partitionType: "Space",
                    sortRangeType: "File",
                    spaceId: this.spaceId,
                    fileId: this.fileId,
                },
                item => {
                    if (!item.preview) {
                        throw new InternalError("File doesn’t have a preview");
                    }
                    if (item.preview.type !== "Image") {
                        throw new InternalError("File doesn’t have an image preview");
                    }

                    // Noop if we've already finished processing the preview. This makes the
                    // function idempotent.
                    if (!item.preview.isProcessing) return item;

                    if (item.preview.videoDuration === undefined) {
                        throw new InternalError("File doesn’t have a image preview video duration");
                    }

                    // Noop if we've already finished processing the preview. This makes the
                    // function idempotent.
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
     * When we're done processing `preview.duration` for a file with an audio
     * preview this function is called.
     */
    public async finishProcessingAudioPreviewDuration(
        context: FileProcessorActionContext,
        duration: number,
    ): Promise<void> {
        this._authorize(context);

        return this._item.withLock(async itemRef => {
            itemRef.current = await FilesTable.updateItem(
                context,
                {
                    partitionType: "Space",
                    sortRangeType: "File",
                    spaceId: this.spaceId,
                    fileId: this.fileId,
                },
                item => {
                    if (!item.preview) {
                        throw new InternalError("File doesn’t have a preview");
                    }
                    if (item.preview.type !== "Audio") {
                        throw new InternalError("File doesn’t have an audio preview");
                    }

                    // Noop if we've already finished processing the preview. This makes the
                    // function idempotent.
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
     * When we're done processing `preview.metadata` for a file with an audio
     * preview this function is called.
     */
    public async finishProcessingAudioPreviewMetadata(
        context: FileProcessorActionContext,
        metadata: FileAudioPreviewMetadata,
    ): Promise<void> {
        this._authorize(context);

        return this._item.withLock(async itemRef => {
            itemRef.current = await FilesTable.updateItem(
                context,
                {
                    partitionType: "Space",
                    sortRangeType: "File",
                    spaceId: this.spaceId,
                    fileId: this.fileId,
                },
                item => {
                    if (!item.preview) {
                        throw new InternalError("File doesn’t have a preview");
                    }
                    if (item.preview.type !== "Audio") {
                        throw new InternalError("File doesn’t have an audio preview");
                    }

                    // Noop if we've already finished processing the preview. This makes the
                    // function idempotent.
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
     * When we're done processing `preview.content` for a file with a code
     * preview this function is called. Since code previews only need the preview
     * content the file is immediately considered to have finished processing after
     * this function is called.
     */
    public async finishProcessingCodePreviewContent(
        context: FileProcessorActionContext,
        content: FileCodePreviewContent,
    ): Promise<void> {
        this._authorize(context);

        return this._item.withLock(async itemRef => {
            itemRef.current = await FilesTable.updateItem(
                context,
                {
                    partitionType: "Space",
                    sortRangeType: "File",
                    spaceId: this.spaceId,
                    fileId: this.fileId,
                },
                item => {
                    if (!item.preview) {
                        throw new InternalError("File doesn’t have a preview");
                    }
                    if (item.preview.type !== "Code") {
                        throw new InternalError("File doesn’t have a code preview");
                    }

                    // Noop if we've already finished processing the preview. This makes the
                    // function idempotent.
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

    public async finishProcessingAlternativeWithError(
        context: FileProcessorActionContext,
        error: FileProcessorError,
    ) {
        this._authorize(context);

        await this._item.withLock(async itemRef => {
            itemRef.current = await FilesTable.updateItem(
                context,
                {
                    partitionType: "Space",
                    sortRangeType: "File",
                    spaceId: this.spaceId,
                    fileId: this.fileId,
                },
                item => {
                    if (!item.alternative) {
                        throw new InternalError("File doesn’t have an alternative");
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
        context: FileProcessorActionContext,
        error: FileProcessorError,
    ) {
        this._authorize(context);

        await this._item.withLock(async itemRef => {
            itemRef.current = await FilesTable.updateItem(
                context,
                {
                    partitionType: "Space",
                    sortRangeType: "File",
                    spaceId: this.spaceId,
                    fileId: this.fileId,
                },
                item => {
                    if (!item.preview) {
                        throw new InternalError("File doesn’t have a preview");
                    }

                    switch (item.preview.type) {
                        case "Image": {
                            // Noop if we've already finished processing the preview. This makes the
                            // function idempotent.
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
                            // Noop if we've already finished processing the preview. This makes the
                            // function idempotent.
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
                            // Noop if we've already finished processing the preview. This makes the
                            // function idempotent.
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

const FileItemContextCache = new DynamoContextCache<`${SpaceId}:${FileId}`, FileItem | null>({
    // Allow sharing this cache because the loaded DynamoDB item doesn't depend
    // on who the actor is.
    whenActorChanges: "DangerouslyShare",
});

function getFileItemIfExistsWithCache(
    context: FileProcessorActionContext,
    spaceId: SpaceId,
    fileId: FileId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<FileItem | null> {
    return FileItemContextCache.get(context, consistency, `${spaceId}:${fileId}`, consistency =>
        FilesTable.getItemIfExists(
            context,
            {
                partitionType: "Space",
                sortRangeType: "File",
                spaceId,
                fileId,
            },
            {consistency},
        ),
    );
}

async function getFileItemIfExistsAsUploader(
    context: FileProcessorActionContext,
    spaceId: SpaceId,
    fileId: FileId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<FileItem | null> {
    const item = await getFileItemIfExistsWithCache(context, spaceId, fileId, {consistency});
    if (!item) return null;

    switch (context.actor.type) {
        case "System": {
            await authorizeSpaceAccess(context, spaceId);
            break;
        }
        case "Session": {
            if (item.uploaderId !== context.actor.getAccountId()) {
                throw new PermissionDeniedError("Account didn’t upload file");
            }
            break;
        }
        case "ImpersonatedAccount": {
            await authorizeSpaceAccess(context, spaceId);

            if (item.uploaderId !== context.actor.getAccountId()) {
                throw new PermissionDeniedError("Account didn’t upload file");
            }
            break;
        }
        case "Anonymous": {
            throw unauthenticatedSessionError();
        }
        case "Bot": {
            if (item.uploaderId !== context.actor.getBotAccountId()) {
                throw new PermissionDeniedError("Account didn’t upload file");
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
 * Throws an error if you're not the account that upload the file. If we have
 * a system actor then the system actor may read all files.
 *
 * Prefer calling `getFileIfExistsFromAttachment()` since that will work for
 * all accounts with access to the file.
 */
export async function getFileIfExistsAsUploader(
    context: FileProcessorActionContext,
    spaceId: SpaceId,
    fileId: FileId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<FileModel | null> {
    const item = await getFileItemIfExistsAsUploader(context, spaceId, fileId, options);
    if (!item) return null;
    return createFileModelFromItem(item);
}

/**
 * Get a file as the file's uploader. Throws an error if the file doesn't
 * exist. Throws an error if you're not the account that upload the file. If we
 * have a system actor then the system actor may read all files.
 *
 * Prefer calling `getFileIfFromAttachment()` since that will work for all
 * accounts with access to the file.
 */
export async function getFileAsUploader(
    context: FileProcessorActionContext,
    spaceId: SpaceId,
    fileId: FileId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<FileModel> {
    const file = await getFileIfExistsAsUploader(context, spaceId, fileId, options);
    if (!file) throw new NotFoundError("File not found");
    return file;
}

export function getFileIfExistsAsSystem(
    context: ServerSystemActionContext,
    fileId: FileId,
    options?: {consistency?: DynamoCacheReadConsistency},
) {
    context.actor.authorizeSystem();

    // `getFileIfExistsAsUploader()` works for system actors. This is a convenience
    // function with a nicer name for system actors.
    return getFileIfExistsAsUploader(context, context.actor.getSpaceId(), fileId, options);
}

export function getFileAsSystem(
    context: ServerSystemActionContext,
    fileId: FileId,
    options?: {consistency?: DynamoCacheReadConsistency},
) {
    context.actor.authorizeSystem();

    // `getFileAsUploader()` works for system actors. This is a convenience
    // function with a nicer name for system actors.
    return getFileAsUploader(context, context.actor.getSpaceId(), fileId, options);
}

/**
 * Get a file attached to some entity. Returns null if the file doesn't exist.
 *
 * To authorize we need a `FileAuthorizer`. This object contains the target
 * we're viewing the file in the context of. We'll throw an error if the actor
 * doesn't have access to the attachment target or the file isn't actually
 * attached to the target.
 */
export async function getFileIfExistsFromAttachment(
    context: ServerActionContext,
    spaceId: SpaceId,
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
        getFileItemIfExistsWithCache(context, spaceId, fileId, {consistency}),

        // 1. Make sure we have access to the file's attachment target
        targetAuthorizer.authorizeTargetAccess(context, spaceId, accessLevel),

        // 2. Make sure the file is actually attached to the provided target
        (async () => {
            let targetItem = await FilesTable.getItemIfExists(
                context,
                getFileAttachmentTargetItemKey(spaceId, fileId, targetAuthorizer.target),
                {
                    consistency,
                    // It's ok to call this function when expecting strong read consistency.
                    // This authorization check is mostly strongly consistent since we retry with
                    // strong consistency below if our eventually consistent read fails.
                    allowsEventualReadConsistency: true,
                },
            );

            if (!targetItem && consistency === "Eventual") {
                targetItem = await FilesTable.getItemIfExists(
                    context,
                    getFileAttachmentTargetItemKey(spaceId, fileId, targetAuthorizer.target),
                    {consistency: "Strong"},
                );
            }

            return targetItem;
        })(),
    ]);
    if (!item) return null;

    // If the file doesn't exist we're ok returning null instead of throwing a not
    // attached error.
    if (!targetItem) {
        throw new PermissionDeniedError("File isn’t attached to target");
    }

    return createFileModelFromItem(item);
}

function createFileModelFromItem(item: FileItem) {
    return new FileModel({
        id: item.fileId,
        contentType: item.contentType,
        contentLength: item.contentLength,
        isUploading: item.isUploading,
        alternative: item.alternative,
        preview: item.preview,
    });
}

/**
 * Get a file attached to some entity. Throws an error if the file doesn't
 * exist.
 *
 * To authorize we need a `FileAuthorizer`. This object contains the target
 * we're viewing the file in the context of. We'll throw an error if the actor
 * doesn't have access to the attachment target or the file isn't actually
 * attached to the target.
 */
export async function getFileFromAttachment(
    context: ServerActionContext,
    spaceId: SpaceId,
    fileId: FileId,
    targetAuthorizer: FileAuthorizer,
    options?: {consistency?: DynamoCacheReadConsistency; accessLevel?: "View" | "Edit"},
): Promise<FileModel> {
    const file = await getFileIfExistsFromAttachment(
        context,
        spaceId,
        fileId,
        targetAuthorizer,
        options,
    );
    if (!file) throw new NotFoundError("File not found");
    return file;
}

/**
 * Attach a file to some `FileAttachmentTarget` (represented by a
 * `FileAuthorizer` instance) as the file's uploader. Throws an error if the
 * file doesn't exist or if the actor isn't the file's uploader.
 *
 * If you want to attach the file to another target and you're not the file's
 * uploader then use `attachFileFromAttachment()`.
 *
 * Attaching a file gives anyone with access to the `FileAttachmentTarget` the
 * ability to view the file.
 */
export async function attachFileAsUploader(
    context: ServerActionContext,
    spaceId: SpaceId,
    fileId: FileId,
    targetAuthorizer: FileAuthorizer,
): Promise<FileModel> {
    const [file] = await runAllPromises([
        // Make sure the file exists and our actor is the uploader.
        //
        // If we can't read the file with eventual consistency then retry with strong
        // consistency in case the file was just created and we're observing an
        // eventual consistency lag.
        (async () => {
            const file = await getFileIfExistsAsUploader(context, spaceId, fileId, {
                consistency: "Eventual",
            });
            if (file) return file;

            return getFileAsUploader(context, spaceId, fileId, {
                consistency: "Strong",
            });
        })(),

        // Make sure we have access to the new file authorizer.
        targetAuthorizer.authorizeTargetAccess(context, spaceId, "Edit"),
    ]);

    await FilesTable.createOrReplaceItem(context, {
        ...getFileAttachmentTargetItemKey(spaceId, fileId, targetAuthorizer.target),
        createdTime: new Date(),
    });

    return file;
}

/**
 * Attach a file to some `FileAttachmentTarget` (`to`) based on the actor's
 * access to the file through a different `FileAttachmentTarget` (`from`).
 *
 * See `attachFileAsUploader()` for more information. You call this method when
 * there's a file you already have you want to attach to another target (e.g.
 * through copy/pasting).
 */
export async function attachFileFromAttachment(
    context: ServerActionContext,
    spaceId: SpaceId,
    fileId: FileId,
    {
        from: fromTargetAuthorizer,
        to: toTargetAuthorizer,
    }: {from: FileAuthorizer; to: FileAuthorizer},
): Promise<FileModel> {
    const [file] = await runAllPromises([
        // Make sure the file exists with the provided authorizer.
        getFileFromAttachment(context, spaceId, fileId, fromTargetAuthorizer),
        // Make sure we have access to the new file authorizer.
        toTargetAuthorizer.authorizeTargetAccess(context, spaceId, "Edit"),
    ]);

    await FilesTable.createOrReplaceItem(context, {
        ...getFileAttachmentTargetItemKey(spaceId, fileId, toTargetAuthorizer.target),
        createdTime: new Date(),
    });

    return file;
}

/**
 * Detach a file from the provided attachment target. Noop if the file
 * attachment doesn't exist but throws if the file doesn't exist.
 */
export async function detachFile(
    context: ServerActionContext,
    spaceId: SpaceId,
    fileId: FileId,
    targetAuthorizer: FileAuthorizer,
): Promise<void> {
    // Make sure the file exists with the provided authorizer. This will call
    // `targetAuthorizer.authorizeTargetAccess()`.
    await getFileFromAttachment(context, spaceId, fileId, targetAuthorizer, {accessLevel: "Edit"});

    await FilesTable.deleteItemWithKeyIfExists(context, {
        ...getFileAttachmentTargetItemKey(spaceId, fileId, targetAuthorizer.target),
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
        .bind({type: "PostDraft", accountId, draftId})
        .authorizeTargetAccess(context, spaceId, "View");

    return arrayFromAsyncIterable(
        mapAsyncIterableIterator(
            PostDraftFileAttachmentsIndex.query(context, {
                partitionKey: {spaceId, accountId, draftId},
                limit: "All",
            }),
            item => item.fileId,
        ),
    );
}
