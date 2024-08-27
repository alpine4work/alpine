import prettyBytes from "pretty-bytes";
import {CloudflareR2ContextModule} from "~/server/cloudflare/r2/cloudflare_r2_context_module.js";
import {filesBucketName} from "~/server/cloudflare/r2/files_bucket_name.js";
import {
    ServerActionContextModules,
    ServerSessionActionContext,
    ServerSessionActionContextModules,
    ServerSystemActionContext,
} from "~/server/context/server_action_context.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {DynamoTableItemType, DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {authorizeSpaceAccess} from "~/server/spaces/spaces_table.js";
import {Context} from "~/shared/context/context.js";
import {
    FailedPreconditionError,
    PermissionDeniedError,
    UnimplementedError,
} from "~/shared/error/error.js";
import {FileContentType, FileContentTypeSchema} from "~/shared/files/file_content_type.js";
import {FileModel} from "~/shared/files/file_model.js";
import {FilePreviewPlaceholder} from "~/shared/files/file_preview_placeholder.js";
import {MutexValue} from "~/shared/helpers/async/mutex_value.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
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
                         * File previews are immutable after the file has been uploaded. However, while
                         * the file is uploading various attributes may be null as we process the file.
                         * For example, `size` will be null until we parse the file and figure out its
                         * dimensions.
                         *
                         * Documentation for each property:
                         *
                         * - `size`: The width/height of the preview image.
                         *
                         *   We include dimensions in this object since `preview` is null for files
                         *   which don't have a visual representation (e.g. audio files) and non-null
                         *   for files which have a visual preview.
                         *
                         *   For images and videos, the dimensions in this object are the same as the
                         *   underlying file's dimensions. For documents like a PDF, the dimensions in
                         *   this object are the dimensions of the first page in the document.
                         *
                         * - `placeholder`: Before the preview image loads, we immediately show a
                         *   blurred placeholder representing the preview image. The placeholder is
                         *   <700 bytes so it's cheap to send over the network.
                         */
                        preview: Schema.booleanUnion(
                            "isProcessing",
                            Schema.object({
                                isProcessing: Schema.value(true),
                                size: Schema.object({
                                    width: Schema.integer,
                                    height: Schema.integer,
                                }).nullable(),
                                placeholder: FilePreviewPlaceholder.schema.nullable(),
                            }),
                            Schema.object({
                                isProcessing: Schema.value(false),
                                size: Schema.object({
                                    width: Schema.integer,
                                    height: Schema.integer,
                                }),
                                placeholder: FilePreviewPlaceholder.schema,
                            }),
                        ).nullable(),
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
        hasPreview,
    }: {
        spaceId: SpaceId;
        contentType: FileContentType;
        contentLength: number;
        hasPreview: boolean;
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

        const fileItem: FileItem = {
            partitionType: "Space",
            sortRangeType: "File",
            spaceId,
            fileId,
            contentType,
            contentLength,
            uploaderId: context.actor.getAccountId(),
            isUploading: true,
            preview: hasPreview
                ? {
                      isProcessing: true,
                      size: null,
                      placeholder: null,
                  }
                : null,
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
     * When we're done processing `preview.size` we call this method to add the
     * preview size to DynamoDB. If we've finished processing both `preview.size`
     * and `preview.placeholder` then we can set `preview.isProcessing` to false.
     */
    public async finishProcessingPreviewSize(
        context: ServerSessionActionContext,
        size: {width: number; height: number},
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
                        throw new FailedPreconditionError("File doesn't have a preview");
                    }
                    if (!item.preview.isProcessing) {
                        throw new FailedPreconditionError(
                            "File has already finished processing its preview",
                        );
                    }
                    if (item.preview.size) {
                        throw new FailedPreconditionError(
                            "File has already finished processing its preview size",
                        );
                    }

                    return {
                        ...item,
                        preview: item.preview.placeholder
                            ? {isProcessing: false, size, placeholder: item.preview.placeholder}
                            : {isProcessing: true, size, placeholder: item.preview.placeholder},
                    };
                },
                {initialItem: itemRef.current},
            );
        });
    }

    /**
     * When we're done processing `preview.placeholder` we call this method to add
     * the preview placeholder to DynamoDB. If we've finished processing both
     * `preview.size` and `preview.placeholder` then we can set
     * `preview.isProcessing` to false.
     */
    public async finishProcessingPreviewPlaceholder(
        context: ServerSessionActionContext,
        placeholder: FilePreviewPlaceholder,
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
                        throw new FailedPreconditionError("File doesn't have a preview");
                    }
                    if (!item.preview.isProcessing) {
                        throw new FailedPreconditionError(
                            "File has already finished processing its preview",
                        );
                    }
                    if (item.preview.placeholder) {
                        throw new FailedPreconditionError(
                            "File has already finished processing its preview placeholder",
                        );
                    }

                    return {
                        ...item,
                        preview: item.preview.size
                            ? {isProcessing: false, size: item.preview.size, placeholder}
                            : {isProcessing: true, size: item.preview.size, placeholder},
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
                        throw new FailedPreconditionError("File has already finished uploading");
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
    public async cleanupAfterError(
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
    await context.r2.DeleteObject({Bucket: filesBucketName, Key: `${spaceId}/${fileId}`});

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
 * Get a file. Can only be called by system action contexts. In order for an
 * account to load a file they must be granted access to the file.
 */
export async function getFile(
    context: ServerSystemActionContext,
    fileId: FileId,
): Promise<FileModel> {
    context.actor.authorizeSystem();

    const item = await FilesTable.getItem(context, {
        partitionType: "Space",
        sortRangeType: "File",
        spaceId: context.actor.getSpaceId(),
        fileId,
    });

    return new FileModel({
        id: item.fileId,
        contentType: item.contentType,
        contentLength: item.contentLength,
        isUploading: item.isUploading,
        preview: item.preview,
    });
}
