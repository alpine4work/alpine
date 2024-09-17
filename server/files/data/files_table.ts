import prettyBytes from "pretty-bytes";
import {CloudflareR2ContextModule} from "~/server/cloudflare/r2/cloudflare_r2_context_module.js";
import {filesBucketName} from "~/server/cloudflare/r2/files_bucket_name.js";
import {
    ServerActionContext,
    ServerActionContextModules,
    ServerSessionActionContext,
    ServerSessionActionContextModules,
} from "~/server/context/server_action_context.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {DynamoReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {DynamoTableItemType, DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {authorizeSpaceAccess} from "~/server/spaces/spaces_table.js";
import {Context} from "~/shared/context/context.js";
import {
    InternalError,
    NotFoundError,
    PermissionDeniedError,
    UnimplementedError,
} from "~/shared/error/error.js";
import {ErrorCode} from "~/shared/error/error_code.js";
import {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.js";
import {FileCodePreviewContent} from "~/shared/files/file_code_preview_content.js";
import {FileContentType, FileContentTypeSchema} from "~/shared/files/file_content_type.js";
import {FileImagePreviewPlaceholder} from "~/shared/files/file_image_preview_placeholder.js";
import {FileAlternativeSchema, FileModel} from "~/shared/files/file_model.js";
import {FileImagePreviewSize, FilePreview, FilePreviewSchema} from "~/shared/files/file_preview.js";
import {MutexValue} from "~/shared/helpers/async/mutex_value.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {AccountId, FileId, SpaceId} from "~/shared/id/types/id_types.js";
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
    ],
});

type FileItem = DynamoTableItemType<typeof FilesTable, "Space", "File">;

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
        contentType,
        contentLength,
        hasAlternative,
        hasPreview,
    }: {
        spaceId: SpaceId;
        contentType: FileContentType;
        contentLength: number;
        hasAlternative: boolean;
        hasPreview:
            | {type: "Image"; hasContent: boolean; hasVideoDuration: boolean}
            | {type: "Audio"}
            | {type: "Code"}
            | null;
    },
): Promise<FileUploader> {
    await authorizeSpaceAccess(context, spaceId);

    const fileId = generateChronologicalId<FileId>();

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

        if (fileTotalsItem.contentLength + contentLength > maxFileTotalContentLengthForSpace) {
            throw new UnimplementedError(
                `Uploading files beyond our ${prettyBytes(
                    maxFileTotalContentLengthForSpace,
                )} limit is currently unsupported. Eventually we should: 1) Increase the limit for paying customers, 2) Archive old uploaded files to create more space`,
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
            FilesTable.transactionCreateOrReplaceItem(fileItem),
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

/**
 * Get a file if the file exists. Can only be called by system action contexts.
 * In order for an account to load a file they must be granted access to the
 * file. Throws a `PermissionDeniedError` if you don't have access to the file.
 */
export async function getFileIfExists(
    context: ServerActionContext,
    spaceId: SpaceId,
    fileId: FileId,
    {consistency = "Eventual"}: {consistency?: DynamoReadConsistency} = {},
): Promise<FileModel | null> {
    await authorizeSpaceAccess(context, spaceId);

    const item = await FilesTable.getItemIfExists(
        context,
        {
            partitionType: "Space",
            sortRangeType: "File",
            spaceId,
            fileId,
        },
        {consistency},
    );
    if (!item) return null;

    switch (context.actor.type) {
        case "System": {
            // System actors have access to all files in the space.
            break;
        }
        case "Session": {
            // TODO(calebmer, #files): We need some grant system that enables accounts
            // other than the uploader to read a file.
            if (item.uploaderId !== context.actor.getAccountId()) {
                throw new PermissionDeniedError("Account doesn't have access to file");
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
 * Get a file. If the file doesn't exist, throws an error. See
 * `getFileIfExists()` for more information.
 */
export async function getFile(
    context: ServerActionContext,
    spaceId: SpaceId,
    fileId: FileId,
    options?: {consistency?: DynamoReadConsistency},
): Promise<FileModel> {
    const file = await getFileIfExists(context, spaceId, fileId, options);

    if (!file) {
        throw new NotFoundError("File not found");
    }

    return file;
}
