import prettyBytes from "pretty-bytes";
import {
    ServerActionContext,
    ServerSessionActionContext,
} from "~/server/context/server_action_context.js";
import {DynamoContextCache} from "~/server/dynamo/core/dynamo_context_cache.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {
    DynamoCacheReadConsistency,
    DynamoReadConsistency,
} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {getDynamoSeedConstants} from "~/server/dynamo/core/dynamo_seed_constants.js";
import {
    DynamoTableItemKeyType,
    DynamoTableItemType,
    DynamoTableSchema,
} from "~/server/dynamo/core/dynamo_table_schema.js";
import {DynamoGeneralRealtimeTableSchema} from "~/server/dynamo/core/general_realtime/dynamo_general_realtime_table_schema.js";
import {fileProcessorDeclarationByContentType} from "~/server/files/data/file_processor_declaration_by_content_type.js";
import {unauthenticatedSessionError} from "~/server/helpers/unauthenticated_session_error.js";
import {authorizeSpaceAccess} from "~/server/spaces/spaces_table.js";
import {
    FailedPreconditionError,
    InternalError,
    InvalidArgumentError,
    NotFoundError,
    PermissionDeniedError,
} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {FileAlternativeSchema} from "~/shared/files/file_alternative.js";
import {
    FileAttachmentTarget,
    FileAttachmentTargetByArea,
} from "~/shared/files/file_attachment_target.js";
import {FileCodePreviewContent} from "~/shared/files/file_code_preview_content.js";
import {maxFileContentLength} from "~/shared/files/file_constants.js";
import {FileContentType, FileContentTypeSchema} from "~/shared/files/file_content_type.js";
import {FileImagePreviewPlaceholder} from "~/shared/files/file_image_preview_placeholder.js";
import {FileModel} from "~/shared/files/file_model.js";
import {
    FileAudioPreviewMetadata,
    FileImagePreviewSize,
    FilePreview,
    FilePreviewSchema,
} from "~/shared/files/file_preview.js";
import {FileProcessorError} from "~/shared/files/file_processor_error.js";
import {MutexValue} from "~/shared/helpers/async/mutex_value.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {mapAsyncIterableIterator} from "~/shared/helpers/iterable/map_async_iterable_iterator.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {If} from "~/shared/helpers/types/if.js";
import {generateChronologicalId, getChronologicalIdTime} from "~/shared/id/chronological_id.js";
import {
    AccountId,
    ChatId,
    DocumentId,
    FileId,
    PostDraftId,
    PostId,
    SpaceId,
    TaskId,
} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";

const FilesTable = DynamoTableSchema.new({
    name: "Files",
    partitions: [
        {
            name: "Space",
            partitionKeyAttributes: {
                spaceId: DynamoKeyAttributeSchema.id<SpaceId>(),
            },
            sortRanges: [
                /**
                 * Represents the total number of files uploaded to the space. Used to
                 * implement file metering. If a space passes the file storage limit for their
                 * paid plan then we'll start deleting old files.
                 */
                {
                    name: "FileTotals",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        /**
                         * How many files total have been uploaded to the space? Includes files that
                         * are currently uploading. Doesn't include deleted files.
                         */
                        count: Schema.integer,

                        /**
                         * What's the total size of files that have been uploaded to the space?
                         * Includes files that are currently uploading. Doesn't include deleted files.
                         */
                        contentLength: Schema.integer,
                    }),
                },

                /**
                 * A file uploaded to our product in a space.
                 *
                 * `FileId`s are chronologically ordered. So a DynamoDB query starting at
                 * `getMinId()` will return the first files uploaded to a space. This sorting
                 * is useful when a space exceeds its file upload quota and we need to delete
                 * old files.
                 *
                 * If you need the file's `createdTime` you can get it from the timestamp in
                 * its `FileId`.
                 *
                 * File items do not include any information about the entity which owns them.
                 * For example, if you upload an image to a document the fact that the image is
                 * associated with the document is stored in the documents table. This is
                 * because the same file can be referenced in multiple different places. If you
                 * copy a file in Alpine then paste it somewhere else in Alpine, we create a
                 * new reference to the file instead of reuploading the file.
                 *
                 * File content is immutable after it's been uploaded.
                 *
                 * The file is stored in Cloudflare R2 with the key `${spaceId}/${fileId}`.
                 */
                // TODO(calebmer): At some point we'll need to implement a file garbage
                // collector. For example, you add a file to a document then you delete the
                // document. That file should eventually be removed from our database and not
                // count against your space byte count.
                {
                    name: "File",
                    sortKeyAttributes: {
                        fileId: DynamoKeyAttributeSchema.id<FileId>(),
                    },
                    attributes: Schema.object({
                        /**
                         * The content type of this file.
                         *
                         * The file's content type doesn't change after upload. If we don't know the
                         * file's type after upload we set it to `application/octet-stream` (which
                         * means unknown binary file). This means if we later add support for a content
                         * type, previously uploaded files won't get support. Only newly uploaded
                         * files.
                         */
                        contentType: FileContentTypeSchema,

                        /**
                         * The length of the file in bytes.
                         */
                        contentLength: Schema.integer,

                        /**
                         * Which account uploaded this file?
                         */
                        uploaderId: Schema.id<AccountId>(),

                        /**
                         * Is the file content currently uploading? True before we've finished saving
                         * the file's content to Cloudflare R2. False afterwards.
                         *
                         * Just because the file is done uploading doesn't mean it's done processing.
                         * `isUploading` may be false while `preview.isProcessing` is true.
                         */
                        isUploading: Schema.boolean,

                        /**
                         * An (ideally lossless) alternative to the file we can render on the client.
                         * We support many more document types than what the client can actually
                         * render. For example, the user may upload a `.tiff` image but `.tiff` images
                         * can't be rendered in a web browser. Or the user may upload a Microsoft Word
                         * document but we need to convert such a document to `.pdf` before we can
                         * render it. This property records whether the file has an alternative.
                         *
                         * If non-null the file has an alternative that'll be rendered instead of the
                         * main file itself. If `isImagePreviewContent` is true then the alternative is
                         * the same as what's in `preview.content`. (`isImagePreviewContent` being true
                         * implies there must be a `preview.content`.)
                         *
                         * The alternative is only rendered in the fullscreen file viewer. Though a
                         * preview image may be generated from the alternative file.
                         *
                         * - If `alternative` has finished uploading and `isImagePreviewContent` is false
                         *   then the alternative file is stored in Cloudflare R2 with the key:
                         *   `${spaceId}/${fileId}-alternative`.
                         *
                         * - If `alternative` has finished uploading and `isImagePreviewContent` is true
                         *   then the alternative file is stored in Cloudflare R2 with the key:
                         *   `${spaceId}/${fileId}-preview`.
                         */
                        alternative: FileAlternativeSchema.nullable().default(null),

                        /**
                         * A visual preview image for the file. Previews are a scaled down, often
                         * non-interactive, display of a file. For example files displayed in a
                         * document image gallery are previews.
                         *
                         * If the user clicks on a file it then opens up a fullscreen file viewer where
                         * they'll see their file in full resolution.
                         *
                         * Ideally, every file has a preview. But some files don't have a useful visual
                         * representation. For example, audio files or unknown binary files. If a file
                         * doesn't have a preview then this object will be null.
                         *
                         * See the documentation on `FilePreview` for more information.
                         *
                         * If `preview.content` is available then the preview file is stored in
                         * Cloudflare R2 with the key: `${spaceId}/${fileId}-preview`.
                         */
                        preview: FilePreviewSchema.nullable(),
                    }),
                },
            ],
        },
        {
            name: "File",
            partitionKeyAttributes: {
                spaceId: DynamoKeyAttributeSchema.id<SpaceId>(),
                fileId: DynamoKeyAttributeSchema.id<FileId>(),
            },
            sortRanges: [
                {
                    name: "ChatMessagesAttachmentTarget",
                    sortKeyAttributes: {
                        chatId: DynamoKeyAttributeSchema.id<ChatId>(),
                    },
                    attributes: Schema.object({
                        createdTime: Schema.date,
                    }),
                },
                {
                    name: "DocumentAttachmentTarget",
                    sortKeyAttributes: {
                        documentId: DynamoKeyAttributeSchema.id<DocumentId>(),
                    },
                    attributes: Schema.object({
                        createdTime: Schema.date,
                    }),
                },
                {
                    name: "DocumentCommentsAttachmentTarget",
                    sortKeyAttributes: {
                        documentId: DynamoKeyAttributeSchema.id<DocumentId>(),
                    },
                    attributes: Schema.object({
                        createdTime: Schema.date,
                    }),
                },
                {
                    name: "PostAttachmentTarget",
                    sortKeyAttributes: {
                        postId: DynamoKeyAttributeSchema.id<PostId>(),
                    },
                    attributes: Schema.object({
                        createdTime: Schema.date,
                    }),
                },
                {
                    name: "PostDraftAttachmentTarget",
                    sortKeyAttributes: {
                        accountId: DynamoKeyAttributeSchema.id<AccountId>(),
                        draftId: DynamoKeyAttributeSchema.id<PostDraftId>(),
                    },
                    attributes: Schema.object({
                        createdTime: Schema.date,
                    }),
                },
                {
                    name: "PostCommentsAttachmentTarget",
                    sortKeyAttributes: {
                        postId: DynamoKeyAttributeSchema.id<PostId>(),
                    },
                    attributes: Schema.object({
                        createdTime: Schema.date,
                    }),
                },
                {
                    name: "TaskNotesAttachmentTarget",
                    sortKeyAttributes: {
                        taskId: DynamoKeyAttributeSchema.id<TaskId>(),
                    },
                    attributes: Schema.object({
                        createdTime: Schema.date,
                    }),
                },
                {
                    name: "TaskCommentsAttachmentTarget",
                    sortKeyAttributes: {
                        taskId: DynamoKeyAttributeSchema.id<TaskId>(),
                    },
                    attributes: Schema.object({
                        createdTime: Schema.date,
                    }),
                },
            ],
        },
    ],
});

const PostDraftFileAttachmentsIndex = FilesTable.addIndex({
    name: "PostDraftFileAttachments",
    itemTypes: [{partitionType: "File", sortRangeType: "PostDraftAttachmentTarget"}],
    partitionKeyAttributes: {
        spaceId: DynamoKeyAttributeSchema.id<SpaceId>(),
        accountId: DynamoKeyAttributeSchema.id<AccountId>(),
        draftId: DynamoKeyAttributeSchema.id<PostDraftId>(),
    },
    sortKeyAttributes: {
        fileId: DynamoKeyAttributeSchema.id<FileId>(),
    },
});

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
    context: ServerSessionActionContext,
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

        // We allow one file to be uploaded beyond the space's max content length. This
        // allows us to say "you've reached your limit" in our error message.
        //
        // If we're in the default development space then we'll allow infinite file
        // uploads so developers can test file uploads without limits.
        if (
            (process.env.NODE_ENV !== "development" ||
                spaceId !== getDynamoSeedConstants().defaultSpaceId) &&
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
            uploaderId: context.actor.getAccountId(),
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
    context: ServerSessionActionContext,
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
            await context.jobs.sendImmediately({
                type: "ProcessFile",
                spaceId,
                fileId,
                contentType: item.contentType,
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
    context: ServerActionContext,
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

    private _authorize(context: ServerActionContext) {
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
        context: ServerActionContext,
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
        context: ServerActionContext,
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
        context: ServerActionContext,
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
        context: ServerActionContext,
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
        context: ServerActionContext,
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
        context: ServerActionContext,
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
        context: ServerActionContext,
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
        context: ServerActionContext,
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
        context: ServerActionContext,
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
        context: ServerActionContext,
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
    context: ServerActionContext,
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
    context: ServerActionContext,
    spaceId: SpaceId,
    fileId: FileId,
    {consistency = "Eventual"}: {consistency?: DynamoReadConsistency} = {},
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
    context: ServerActionContext,
    spaceId: SpaceId,
    fileId: FileId,
    options?: {consistency?: DynamoReadConsistency},
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
    context: ServerActionContext,
    spaceId: SpaceId,
    fileId: FileId,
    options?: {consistency?: DynamoReadConsistency},
): Promise<FileModel> {
    const file = await getFileIfExistsAsUploader(context, spaceId, fileId, options);
    if (!file) throw new NotFoundError("File not found");
    return file;
}

const fileAuthorizerAttachmentTargetTypesByTableSchema = new WeakMap<object, Set<string>>();

/**
 * Authorizes file access through an attachment target.
 *
 * `FileAuthorizer`s can either be bound or unbound. You create unbound
 * `FileAuthorizer`s with `new()` then use that to create bound
 * `FileAuthorizer`s with `bind()`. Unbound `FileAuthorizer`s define how to
 * authorize entities of the attachment target type you pass to `new()`. Bound
 * `FileAuthorizer`s can be used to authorize an individual entity.
 *
 * The authorization function you provide in `FileAuthorizer.new()` should
 * cache results using `CacheContextModule`! We may call your authorization
 * function multiple times in the same action for the same target. By the time
 * you're loading files (e.g. via `getContentReferencesForNode()`) you've also
 * probably already loaded your entity's content so by leveraging the action
 * cache you shouldn't need to reauthorize at all.
 *
 * ### Why is the file authorization API designed this way?
 *
 * Simply, to avoid cyclic dependencies. To avoid cyclic dependencies the
 * `//server/files/data` package doesn't depend on attachment target type
 * packages. Instead the attachment target type packages depend on
 * `//server/files/data`.
 *
 * For example, `//server/documents/data` depends on `//server/files/data` but
 * `//server/files/data` doesn't depend on `//server/documents/data`. That
 * means `//server/files/data` can't call `authorizeDocumentAccess()`! So
 * instead we construct a `FileDocumentAuthorizer`
 * (from `FileAuthorizer.new()`) in `//server/documents/data` next to
 * `DocumentsTable` and pass the result of
 * `FileDocumentAuthorizer.bind(documentId)` to `//server/files/data` functions
 * that need to authorize files.
 *
 * To make sure instances of `FileAuthorizer` are trusted we require you to
 * pass a `DynamoTableSchema` to `FileAuthorizer.new()`. This proves you're in
 * the module that owns data manipulation and authorization for the
 * `DynamoTableSchema`. So you can create a trusted `FileAuthorizer` instance.
 *
 * Our protections depend on TypeScript and ESLint errors. You can trivially
 * get around them by casting to `any` or with an ESLint disable comment.
 * That's fine attackers shouldn't be able to inject code so we only need to
 * encourage the safe patterns for developers.
 */
export class FileAuthorizer<Bound extends boolean = true> {
    public readonly target: If<Bound, FileAttachmentTarget, null>;
    public readonly authorizeTargetAccess: If<
        Bound,
        (
            context: ServerActionContext,
            spaceId: SpaceId,
            expectedAccessLevel: "View" | "Edit",
        ) => Promise<void>,
        null
    >;

    protected constructor(
        target: If<Bound, FileAttachmentTarget, null>,
        authorizeTargetAccess: If<
            Bound,
            (
                context: ServerActionContext,
                spaceId: SpaceId,
                expectedAccessLevel: "View" | "Edit",
            ) => Promise<void>,
            null
        >,
    ) {
        this.target = target;
        this.authorizeTargetAccess = authorizeTargetAccess;
    }

    public static new<Area extends keyof FileAttachmentTargetByArea>(
        tableSchema: DynamoTableSchema<any> | DynamoGeneralRealtimeTableSchema<any, any>,
        area: Area,
        authorizeTargetAccess: (
            context: ServerActionContext,
            target: FileAttachmentTargetByArea[Area],
            spaceId: SpaceId,
            expectedAccessLevel: "View" | "Edit",
        ) => Promise<unknown>,
    ) {
        return new FileAuthorizerUnbound<Area>(tableSchema, area, authorizeTargetAccess);
    }
}

// `FileAuthorizerUnbound` extends `FileAuthorizer` so we can use
// `FileAuthorizer`'s protected constructor in this class.
export class FileAuthorizerUnbound<
    Area extends keyof FileAttachmentTargetByArea,
> extends FileAuthorizer<false> {
    public readonly area: Area;
    private readonly _authorizeTargetAccess: (
        context: ServerActionContext,
        target: FileAttachmentTargetByArea[Area],
        spaceId: SpaceId,
        expectedAccessLevel: "View" | "Edit",
    ) => Promise<unknown>;

    constructor(
        tableSchema: DynamoTableSchema<any> | DynamoGeneralRealtimeTableSchema<any, any>,
        area: Area,
        authorizeTargetAccess: (
            context: ServerActionContext,
            target: FileAttachmentTargetByArea[Area],
            spaceId: SpaceId,
            expectedAccessLevel: "View" | "Edit",
        ) => Promise<unknown>,
    ) {
        // We only want one authorizer instance per attachment target type. To enforce
        // this we require you to pass in a `DynamoTableSchema` with the right name
        // before the table has finished initializing.
        //
        // This leverages the infrastructure around `DynamoTableSchema` to make sure
        // no `DynamoTableSchema` is exported outside the file where it's constructed.
        // By tying file authorizers to `DynamoTableSchema` we also guarantee
        // authorizers are only created when you have exclusive access to the
        // underlying table.
        //
        // Authorizers may be exported.
        assert(
            tableSchema instanceof DynamoTableSchema ||
                tableSchema instanceof DynamoGeneralRealtimeTableSchema,
        );
        assert(!tableSchema.isInitialized());

        const attachmentTargetTypes = getOrSetDefaultMapValue(
            fileAuthorizerAttachmentTargetTypesByTableSchema,
            tableSchema,
            () => new Set(),
        );

        // Only allow one `FileAuthorizer` per attachment target type per table schema.
        assert(!attachmentTargetTypes.has(area));
        attachmentTargetTypes.add(area);

        switch (area) {
            case "Chat": {
                assert(tableSchema.getName() === "Chat");
                break;
            }
            case "Post": {
                assert(tableSchema.getName() === "ForumRealtime");
                break;
            }
            case "Document": {
                assert(tableSchema.getName() === "Documents");
                break;
            }
            case "Task": {
                assert(tableSchema.getName() === "Tasks");
                break;
            }
            default:
                throw exhaustive(area);
        }

        super(null, null);
        this.area = area;
        this._authorizeTargetAccess = authorizeTargetAccess;
    }

    public bind(target: FileAttachmentTargetByArea[Area]) {
        return new FileAuthorizer(target, async (context, spaceId, expectedAccessLevel) => {
            await this._authorizeTargetAccess(context, target, spaceId, expectedAccessLevel);
        });
    }
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
        consistency?: DynamoReadConsistency;
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

            if (!targetItem && consistency !== "Strong") {
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
    options?: {consistency?: DynamoReadConsistency; accessLevel?: "View" | "Edit"},
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
