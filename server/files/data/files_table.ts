import prettyBytes from "pretty-bytes";
import {CloudflareR2ContextModule} from "~/server/cloudflare/r2/cloudflare_r2_context_module.js";
import {
    ServerActionContext,
    ServerActionContextModules,
    ServerSessionActionContext,
    ServerSessionActionContextModules,
} from "~/server/context/server_action_context.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {DynamoReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {
    DynamoTableItemKeyType,
    DynamoTableItemType,
    DynamoTableSchema,
} from "~/server/dynamo/core/dynamo_table_schema.js";
import {DynamoGeneralRealtimeTableSchema} from "~/server/dynamo/core/general_realtime/dynamo_general_realtime_table_schema.js";
import {filesBucketName} from "~/server/helpers/files_cloudflare_r2_bucket_name.js";
import {authorizeSpaceAccess} from "~/server/spaces/spaces_table.js";
import {ContextCache} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {
    FailedPreconditionError,
    InternalError,
    InvalidArgumentError,
    NotFoundError,
    PermissionDeniedError,
} from "~/shared/error/error.js";
import {ErrorCode} from "~/shared/error/error_code.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.js";
import {
    FileAttachmentTarget,
    FileAttachmentTargetByArea,
} from "~/shared/files/file_attachment_target.js";
import {FileCodePreviewContent} from "~/shared/files/file_code_preview_content.js";
import {FileContentType, FileContentTypeSchema} from "~/shared/files/file_content_type.js";
import {FileImagePreviewPlaceholder} from "~/shared/files/file_image_preview_placeholder.js";
import {FileAlternativeSchema, FileModel} from "~/shared/files/file_model.js";
import {
    FileHasPreview,
    FileImagePreviewSize,
    FilePreview,
    FilePreviewSchema,
} from "~/shared/files/file_preview.js";
import {MutexValue} from "~/shared/helpers/async/mutex_value.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {If} from "~/shared/helpers/types/if.js";
import {generateChronologicalId, getChronologicalIdTime} from "~/shared/id/chronological_id.js";
import {
    AccountId,
    ChannelId,
    ChatId,
    DocumentCommentThreadId,
    DocumentId,
    FileId,
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
                // file from the document. That file should eventually be removed from our
                // database and not count against your space byte count.
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
                    name: "ChatMessageAttachmentTarget",
                    sortKeyAttributes: {
                        chatId: DynamoKeyAttributeSchema.id<ChatId>(),
                        messageIndex: DynamoKeyAttributeSchema.integer,
                    },
                    attributes: Schema.object({
                        createdTime: Schema.date,
                    }),
                },
                {
                    name: "ChannelDescriptionAttachmentTarget",
                    sortKeyAttributes: {
                        channelId: DynamoKeyAttributeSchema.id<ChannelId>(),
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
                    name: "DocumentCommentAttachmentTarget",
                    sortKeyAttributes: {
                        documentId: DynamoKeyAttributeSchema.id<DocumentId>(),
                        commentThreadId: DynamoKeyAttributeSchema.id<DocumentCommentThreadId>(),
                        commentIndex: DynamoKeyAttributeSchema.integer,
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
                    name: "PostCommentAttachmentTarget",
                    sortKeyAttributes: {
                        postId: DynamoKeyAttributeSchema.id<PostId>(),
                        commentIndex: DynamoKeyAttributeSchema.integer,
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
                    name: "TaskCommentAttachmentTarget",
                    sortKeyAttributes: {
                        taskId: DynamoKeyAttributeSchema.id<TaskId>(),
                        commentIndex: DynamoKeyAttributeSchema.integer,
                    },
                    attributes: Schema.object({
                        createdTime: Schema.date,
                    }),
                },
            ],
        },
    ],
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
        case "ChatMessage": {
            return {
                partitionType: "File",
                sortRangeType: "ChatMessageAttachmentTarget",
                spaceId,
                fileId,
                chatId: target.chatId,
                messageIndex: target.messageIndex,
            };
        }
        case "ChannelDescription": {
            return {
                partitionType: "File",
                sortRangeType: "ChannelDescriptionAttachmentTarget",
                spaceId,
                fileId,
                channelId: target.channelId,
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
        case "DocumentComment": {
            return {
                partitionType: "File",
                sortRangeType: "DocumentCommentAttachmentTarget",
                spaceId,
                fileId,
                documentId: target.documentId,
                commentThreadId: target.commentThreadId,
                commentIndex: target.commentIndex,
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
        case "PostComment": {
            return {
                partitionType: "File",
                sortRangeType: "PostCommentAttachmentTarget",
                spaceId,
                fileId,
                postId: target.postId,
                commentIndex: target.commentIndex,
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
        case "TaskComment": {
            return {
                partitionType: "File",
                sortRangeType: "TaskCommentAttachmentTarget",
                spaceId,
                fileId,
                taskId: target.taskId,
                commentIndex: target.commentIndex,
            };
        }
        default:
            throw exhaustive(target);
    }
}

/**
 * If a file upload doesn't complete within this amount of time, we abort the
 * file upload.
 */
export const uploadFileTimeoutMs = 1000 * 60 * 10;

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
 * Reserve space for a file you're going to upload. You're only allowed to
 * upload a file if it's within your space's file size limits. So we check that
 * you're within your space's file size limits before we start uploading the
 * file.
 *
 * Returns a `FileUploader` object which the file uploading action uses to
 * update the file item in DynamoDB as we hit certain milestones. (e.g. When
 * `preview.size` has finished processing.)
 */
// TODO(calebmer, #files): Build file cleanup script (maybe via
// `MigrationService`) which runs monthly that:
//
// 1. Scans all files in Cloudflare R2 and makes sure there is a corresponding
//    item in DynamoDB (can use DynamoDB queries to do this efficiently)
//
// 2. Scans all file items in DynamoDB to cleanup any uploads that have timed
//    out.
//
// 3. Garbage collects files that are no longer referenced by any content.
export async function startUploadingAndProcessingFile(
    context: ServerSessionActionContext,
    {
        spaceId,
        fileId: providedFileId = null,
        contentType,
        contentLength,
        hasAlternative,
        hasPreview,
    }: {
        spaceId: SpaceId;
        fileId?: FileId | null;
        contentType: FileContentType;
        contentLength: number;
        hasAlternative: boolean;
        hasPreview: FileHasPreview | null;
    },
): Promise<FileUploader> {
    await authorizeSpaceAccess(context, spaceId);

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
        if (fileTotalsItem.contentLength > maxFileTotalContentLengthForSpace) {
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
        ]);

        return new FileUploader(fileItem);
    });
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

    /**
     * Finish processing the file's alternative if the file has an alternative. If
     * the file was not declared to have an alternative upon creation then this
     * method will throw an error.
     */
    public async finishProcessingAlternative(
        context: ServerSessionActionContext,
        alternative: {contentType: FileContentType; contentLength: number},
    ) {
        if (this.uploaderId !== context.actor.getAccountId()) {
            throw new PermissionDeniedError("Account is not the file's uploader account");
        }

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
                        throw new InternalError("File doesn't have an alternative");
                    }
                    if (!item.alternative.isProcessing) {
                        throw new InternalError(
                            "File has already finished processing its alternative",
                        );
                    }

                    return {
                        ...item,
                        alternative: {
                            isProcessing: false,
                            contentType: alternative.contentType,
                            contentLength: alternative.contentLength,
                            isImagePreviewContent: false,
                        },
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
        context: ServerSessionActionContext,
        size: FileImagePreviewSize,
        {alsoPreviewVideoDuration}: {alsoPreviewVideoDuration?: number} = {},
    ) {
        if (this.uploaderId !== context.actor.getAccountId()) {
            throw new PermissionDeniedError("Account is not the file's uploader account");
        }

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
                        throw new InternalError("File doesn't have a preview");
                    }
                    if (item.preview.type !== "Image") {
                        throw new InternalError("File doesn't have an image preview");
                    }
                    if (!item.preview.isProcessing) {
                        throw new InternalError(
                            "File has already finished processing its image preview",
                        );
                    }
                    if (item.preview.size !== "Processing") {
                        throw new InternalError(
                            "File has already finished processing its image preview size",
                        );
                    }
                    if (alsoPreviewVideoDuration !== undefined) {
                        if (item.preview.videoDuration === undefined) {
                            throw new InternalError(
                                "File doesn't have a image preview video duration",
                            );
                        }
                        if (item.preview.videoDuration !== "Processing") {
                            throw new InternalError(
                                "File has already finished processing its image preview video duration",
                            );
                        }
                    }

                    return {
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
                                      size,
                                      placeholder: item.preview.placeholder,
                                      content: item.preview.content,
                                      videoDuration: (alsoPreviewVideoDuration ??
                                          item.preview.videoDuration) as number | undefined,
                                  }
                                : {
                                      type: "Image",
                                      isProcessing: true,
                                      size,
                                      placeholder: item.preview.placeholder,
                                      content: item.preview.content,
                                      videoDuration:
                                          alsoPreviewVideoDuration ?? item.preview.videoDuration,
                                  },
                    };
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
        context: ServerSessionActionContext,
        placeholder: FileImagePreviewPlaceholder,
    ) {
        if (this.uploaderId !== context.actor.getAccountId()) {
            throw new PermissionDeniedError("Account is not the file's uploader account");
        }

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
                        throw new InternalError("File doesn't have a preview");
                    }
                    if (item.preview.type !== "Image") {
                        throw new InternalError("File doesn't have an image preview");
                    }
                    if (!item.preview.isProcessing) {
                        throw new InternalError(
                            "File has already finished processing its image preview",
                        );
                    }
                    if (item.preview.placeholder !== "Processing") {
                        throw new InternalError(
                            "File has already finished processing its image preview placeholder",
                        );
                    }

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
        context: ServerSessionActionContext,
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
        if (this.uploaderId !== context.actor.getAccountId()) {
            throw new PermissionDeniedError("Account is not the file's uploader account");
        }

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
                        throw new InternalError("File doesn't have a preview");
                    }
                    if (item.preview.type !== "Image") {
                        throw new InternalError("File doesn't have an image preview");
                    }
                    if (!item.preview.isProcessing) {
                        throw new InternalError(
                            "File has already finished processing its image preview",
                        );
                    }
                    if (item.preview.content !== "Processing") {
                        if (item.preview.content === undefined) {
                            throw new InternalError("File doesn't have image preview content");
                        } else {
                            throw new InternalError(
                                "File has already finished processing its image preview content",
                            );
                        }
                    }
                    if (isAlternative) {
                        if (!item.alternative) {
                            throw new InternalError("File doesn't have an alternative");
                        }
                        if (!item.alternative.isProcessing) {
                            throw new InternalError(
                                "File has already finished processing its alternative",
                            );
                        }
                    }

                    return {
                        ...item,
                        alternative: isAlternative
                            ? {
                                  isProcessing: false,
                                  contentType,
                                  contentLength,
                                  isImagePreviewContent: true,
                              }
                            : item.alternative,
                        preview:
                            item.preview.size !== "Processing" &&
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
                                  },
                    };
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
        context: ServerSessionActionContext,
        videoDuration: number,
    ): Promise<{wasUpdated: boolean}> {
        if (this.uploaderId !== context.actor.getAccountId()) {
            throw new PermissionDeniedError("Account is not the file's uploader account");
        }

        return this._item.withLock(async itemRef => {
            if (!itemRef.current.preview) {
                throw new InternalError("File doesn't have a preview");
            }
            if (itemRef.current.preview.type !== "Image") {
                throw new InternalError("File doesn't have an image preview");
            }

            // If we've already updated the item with our expected video duration then we
            // don't need to update DynamoDB again.
            if (
                !(!itemRef.current.preview.isProcessing && !itemRef.current.preview.ok) &&
                itemRef.current.preview.videoDuration === videoDuration
            ) {
                return {wasUpdated: false};
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
                        throw new InternalError("File doesn't have a preview");
                    }
                    if (item.preview.type !== "Image") {
                        throw new InternalError("File doesn't have an image preview");
                    }
                    if (!item.preview.isProcessing) {
                        throw new InternalError(
                            "File has already finished processing its image preview",
                        );
                    }
                    if (item.preview.videoDuration === undefined) {
                        throw new InternalError("File doesn't have a image preview video duration");
                    }
                    if (item.preview.videoDuration !== "Processing") {
                        throw new InternalError(
                            "File has already finished processing its image preview video duration",
                        );
                    }

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

            return {wasUpdated: true};
        });
    }

    /**
     * When we're done processing `preview.duration` for a file with an audio
     * preview this function is called. Since audio previews only need a duration
     * the file is immediately considered to have finished processing after
     * this function is called.
     */
    public async finishProcessingAudioPreviewDuration(
        context: ServerSessionActionContext,
        duration: number,
    ): Promise<void> {
        if (this.uploaderId !== context.actor.getAccountId()) {
            throw new PermissionDeniedError("Account is not the file's uploader account");
        }

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
                        throw new InternalError("File doesn't have a preview");
                    }
                    if (item.preview.type !== "Audio") {
                        throw new InternalError("File doesn't have an audio preview");
                    }
                    if (!item.preview.isProcessing) {
                        throw new InternalError("File has already finished processing its preview");
                    }
                    if (item.preview.duration !== "Processing") {
                        throw new InternalError(
                            "File has already finished processing its audio preview duration",
                        );
                    }

                    return {
                        ...item,
                        preview: {
                            type: "Audio",
                            isProcessing: false,
                            duration,
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
        context: ServerSessionActionContext,
        content: FileCodePreviewContent,
    ): Promise<void> {
        if (this.uploaderId !== context.actor.getAccountId()) {
            throw new PermissionDeniedError("Account is not the file's uploader account");
        }

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
                        throw new InternalError("File doesn't have a preview");
                    }
                    if (item.preview.type !== "Code") {
                        throw new InternalError("File doesn't have a code preview");
                    }
                    if (!item.preview.isProcessing) {
                        throw new InternalError("File has already finished processing its preview");
                    }
                    if (item.preview.content !== "Processing") {
                        throw new InternalError(
                            "File has already finished processing its code preview content",
                        );
                    }

                    return {
                        ...item,
                        preview: {
                            type: "Code",
                            isProcessing: false,
                            content,
                        },
                    };
                },
                {initialItem: itemRef.current},
            );
        });
    }

    /**
     * If there was an acceptable error while processing the file then we want to
     * finish uploading the file but mark the preview with an error so the user
     * knows why there's no preview.
     *
     * There are two types of errors when uploading files:
     *
     * 1. Unacceptable errors that abort the upload
     * 2. Acceptable errors where the upload finishes but without a processed
     *    preview
     *
     * An example of an unacceptable error is the user tries to upload a
     * `image/jpeg` file which has a corrupted format. In this case we stop the
     * upload and show an error to the user in the UI that their file upload didn't
     * work.
     *
     * An example of an acceptable error is if the user tries to upload an
     * `application/pdf` file with a password. In this case we can't show a preview
     * since we can't read a password protected PDF since it's encrypted. We allow
     * the upload to finish and instead of showing a preview we show the user some
     * text along the lines of "can't show a password protected PDF".
     *
     * Acceptable errors call this function and leave a `FileItem` in the database.
     * The user can still download the file we just can't preview it. Unacceptable
     * errors should end up deleting the `FileItem` from DynamoDB altogether with
     * the `cleanupAfterUnacceptableError()` function.
     */
    public async finishProcessingImagePreviewAfterAcceptableError(
        context: ServerSessionActionContext,
        error: {code: ErrorCode; displayMessage: ErrorDisplayMessage},
    ) {
        if (this.uploaderId !== context.actor.getAccountId()) {
            throw new PermissionDeniedError("Account is not the file's uploader account");
        }

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
                        throw new InternalError("File doesn't have a preview");
                    }
                    if (item.preview.type !== "Image") {
                        throw new InternalError("File doesn't have an image preview");
                    }
                    if (!item.preview.isProcessing) {
                        throw new InternalError("File has already finished processing its preview");
                    }

                    return {
                        ...item,
                        preview: {
                            type: "Image",
                            isProcessing: false,
                            ok: false,
                            error,
                            size: item.preview.size === "Processing" ? "Error" : item.preview.size,
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
                },
                {initialItem: itemRef.current},
            );
        });
    }

    /**
     * When we're done uploading a file, this `finishUploading()` method should be
     * called. It'll set the `isUploading` flag on the file to false.
     */
    public async finishUploading(context: ServerSessionActionContext) {
        if (this.uploaderId !== context.actor.getAccountId()) {
            throw new PermissionDeniedError("Account is not the file's uploader account");
        }

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
                    if (!item.isUploading) {
                        throw new InternalError("File has already finished uploading");
                    }
                    return {...item, isUploading: false};
                },
                {initialItem: itemRef.current},
            );
        });
    }

    /**
     * If there was an error while uploading a file then this function is called to
     * cleanup our database. It deletes the associated Cloudflare R2 object,
     * deletes the file DynamoDB item, and updates the `FileTotals` item counters.
     */
    public async cleanupAfterUnacceptableError(
        context: Context<ServerSessionActionContextModules & {r2: CloudflareR2ContextModule}>,
    ) {
        if (this.uploaderId !== context.actor.getAccountId()) {
            throw new PermissionDeniedError("Account is not the file's uploader account");
        }

        await this._item.withLock(async itemRef => {
            await actuallyCleanupFileItem(context, itemRef.current);
        });
    }
}

async function actuallyCleanupFileItem(
    context: Context<ServerActionContextModules & {r2: CloudflareR2ContextModule}>,
    fileItem: FileItem,
) {
    const {spaceId, fileId} = fileItem;

    // Make sure the R2 object associated with the file is deleted if an object
    // exists. `DeleteObject` is idempotent. It won't throw an error if the object
    // doesn't exist.
    //
    // We unconditionally try and delete the alternative object and preview object
    // since `fileItem` may not have successfully updated after the objects were
    // uploaded.
    await runAllPromises([
        context.r2.DeleteObject({
            Bucket: filesBucketName,
            Key: `${spaceId}/${fileId}`,
        }),
        context.r2.DeleteObject({
            Bucket: filesBucketName,
            Key: `${spaceId}/${fileId}-alternative`,
        }),
        context.r2.DeleteObject({
            Bucket: filesBucketName,
            Key: `${spaceId}/${fileId}-preview`,
        }),
    ]);

    let hasAttempted = false;
    const initialFileItem = fileItem;

    // Delete the file item from DynamoDB and remove its allocated `contentLength`
    // from `FileTotals` so it doesn't count against the space's file upload limit.
    await context.dynamo.retryTransaction(async context => {
        const isInitialAttempt = !hasAttempted;
        hasAttempted = true;

        const [fileTotalsItem, fileItem] = await runAllPromises([
            FilesTable.getItem(context, {
                partitionType: "Space",
                sortRangeType: "FileTotals",
                spaceId,
            }),
            isInitialAttempt
                ? initialFileItem
                : FilesTable.getItem(context, {
                      partitionType: "Space",
                      sortRangeType: "File",
                      spaceId,
                      fileId,
                  }),
        ]);

        await DynamoTableSchema.executeTransaction(context, [
            FilesTable.transactionDirectlyUpdateItem({
                ...fileTotalsItem,
                count: fileTotalsItem.count - 1,
                contentLength: fileTotalsItem.contentLength - fileItem.contentLength,
            }),
            FilesTable.transactionDeleteItemIfExists(fileItem),
        ]);
    });
}

const FileItemContextCache = new ContextCache<`${SpaceId}:${FileId}`, FileItem | null>();

function getFileItemIfExistsWithCache(
    context: ServerActionContext,
    spaceId: SpaceId,
    fileId: FileId,
    {
        consistency = "Eventual",
        allowsEventualReadConsistency = false,
    }: {
        consistency?: DynamoReadConsistency;
        allowsEventualReadConsistency?: boolean;
    } = {},
): Promise<FileItem | null> {
    const get = async () => {
        const item = await FilesTable.getItemIfExists(
            context,
            {
                partitionType: "Space",
                sortRangeType: "File",
                spaceId,
                fileId,
            },
            {consistency, allowsEventualReadConsistency},
        );

        if (!item) return null;

        await authorizeSpaceAccess(context, item.spaceId);

        return item;
    };

    // We can't use a cached value when reading with strong consistency but we can
    // save the read value to the cache for later.
    if (consistency === "Strong") {
        const getPromise = get();
        FileItemContextCache.set(context, `${spaceId}:${fileId}`, getPromise);
        return getPromise;
    } else {
        return FileItemContextCache.get(context, `${spaceId}:${fileId}`, get);
    }
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
    {consistency = "Eventual"}: {consistency?: DynamoReadConsistency} = {},
): Promise<FileModel | null> {
    const [, item] = await runAllPromises([
        authorizeSpaceAccess(context, spaceId),
        getFileItemIfExistsWithCache(context, spaceId, fileId, {consistency}),
    ]);
    if (!item) return null;

    switch (context.actor.type) {
        case "System": {
            // System actors have access to all files in the space. We already validated
            // above that we have access to the space.
            break;
        }
        case "Session": {
            // other than the uploader to read a file.
            if (item.uploaderId !== context.actor.getAccountId()) {
                throw new PermissionDeniedError("Account didn't upload file");
            }
            break;
        }
        default:
            throw exhaustive(context.actor);
    }

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
        (context: ServerActionContext, expectedAccessLevel: "View" | "Edit") => Promise<void>,
        null
    >;

    protected constructor(
        target: If<Bound, FileAttachmentTarget, null>,
        authorizeTargetAccess: If<
            Bound,
            (context: ServerActionContext, expectedAccessLevel: "View" | "Edit") => Promise<void>,
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
        expectedAccessLevel: "View" | "Edit",
    ) => Promise<unknown>;

    constructor(
        tableSchema: DynamoTableSchema<any> | DynamoGeneralRealtimeTableSchema<any, any>,
        area: Area,
        authorizeTargetAccess: (
            context: ServerActionContext,
            target: FileAttachmentTargetByArea[Area],
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
            case "Channel":
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
        return new FileAuthorizer(target, async (context, expectedAccessLevel) => {
            await this._authorizeTargetAccess(context, target, expectedAccessLevel);
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
    fileAuthorizer: FileAuthorizer,
    {consistency = "Eventual"}: {consistency?: DynamoReadConsistency} = {},
): Promise<FileModel | null> {
    const [item, , , targetItem] = await runAllPromises([
        getFileItemIfExistsWithCache(context, spaceId, fileId, {consistency}),

        // 1. Make sure we have access to the space the file is in
        authorizeSpaceAccess(context, spaceId),

        // 2. Make sure we have access to the file's attachment target
        fileAuthorizer.authorizeTargetAccess(context, "View"),

        // 3. Make sure the file is actually attached to the provided target
        (async () => {
            let targetItem = await FilesTable.getItemIfExists(
                context,
                getFileAttachmentTargetItemKey(spaceId, fileId, fileAuthorizer.target),
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
                    getFileAttachmentTargetItemKey(spaceId, fileId, fileAuthorizer.target),
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
        throw new PermissionDeniedError("File isn't attached to target");
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
    fileAuthorizer: FileAuthorizer,
    options?: {consistency?: DynamoReadConsistency},
): Promise<FileModel> {
    const file = await getFileIfExistsFromAttachment(
        context,
        spaceId,
        fileId,
        fileAuthorizer,
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
// TODO(calebmer, #files): What's our story around detaching? If we don't
// detach we should at least explain why.
export async function attachFileAsUploader(
    context: ServerActionContext,
    spaceId: SpaceId,
    fileId: FileId,
    fileAuthorizer: FileAuthorizer,
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
        fileAuthorizer.authorizeTargetAccess(context, "Edit"),
    ]);

    await FilesTable.createOrReplaceItem(context, {
        ...getFileAttachmentTargetItemKey(spaceId, fileId, fileAuthorizer.target),
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
    {from: fromFileAuthorizer, to: toFileAuthorizer}: {from: FileAuthorizer; to: FileAuthorizer},
): Promise<FileModel> {
    const [file] = await runAllPromises([
        // Make sure the file exists and our actor is the uploader.
        getFileFromAttachment(context, spaceId, fileId, fromFileAuthorizer),
        // Make sure we have access to the new file authorizer.
        toFileAuthorizer.authorizeTargetAccess(context, "Edit"),
    ]);

    await FilesTable.createOrReplaceItem(context, {
        ...getFileAttachmentTargetItemKey(spaceId, fileId, toFileAuthorizer.target),
        createdTime: new Date(),
    });

    return file;
}
