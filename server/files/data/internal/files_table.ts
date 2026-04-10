import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {DynamoGeneralRealtimeTableSchema} from "~/server/dynamo/core/general_realtime/dynamo_general_realtime_table_schema.js";
import {FileAlternativeSchema} from "~/shared/files/file_alternative.js";
import {
    FileAttachmentTarget,
    FileAttachmentTargetByArea,
} from "~/shared/files/file_attachment_target.js";
import {FileContentTypeSchema} from "~/shared/files/file_content_type.js";
import {FilePreviewSchema} from "~/shared/files/file_preview.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {If} from "~/shared/helpers/types/if.js";
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

export const FilesTable = DynamoTableSchema.new({
    name: "Files",
    partitions: [
        {
            name: "Space",
            partitionKeyAttributes: {
                spaceId: DynamoKeyAttributeSchema.id<SpaceId>(),
            },
            sortRanges: [
                /**
                 * Represents the total number of files uploaded to the space. Used to implement
                 * file metering. If a space passes the file storage limit for their paid plan then
                 * we'll start deleting old files.
                 */
                {
                    name: "FileTotals",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        /**
                         * How many files total have been uploaded to the space? Includes files that are
                         * currently uploading. Doesn't include deleted files.
                         */
                        count: Schema.integer,

                        /**
                         * What's the total size of files that have been uploaded to the space? Includes
                         * files that are currently uploading. Doesn't include deleted files.
                         */
                        contentLength: Schema.integer,
                    }),
                },

                /**
                 * A file uploaded to our product in a space.
                 *
                 * `FileId`s are chronologically ordered. So a DynamoDB query starting at
                 * `getMinId()` will return the first files uploaded to a space. This sorting is
                 * useful when a space exceeds its file upload quota and we need to delete old
                 * files.
                 *
                 * If you need the file's `createdTime` you can get it from the timestamp in its
                 * `FileId`.
                 *
                 * File items do not include any information about the entity which owns them. For
                 * example, if you upload an image to a document the fact that the image is
                 * associated with the document is stored in the documents table. This is because
                 * the same file can be referenced in multiple different places. If you copy a file
                 * in Alpine then paste it somewhere else in Alpine, we create a new reference to
                 * the file instead of reuploading the file.
                 *
                 * File content is immutable after it's been uploaded.
                 *
                 * The file is stored in Cloudflare R2 with the key `${spaceId}/${fileId}`.
                 */
                // TODO(calebmer): At some point we'll need to implement a file garbage collector.
                // For example, you add a file to a document then you delete the document. That
                // file should eventually be removed from our database and not count against your
                // space byte count.
                {
                    name: "File",
                    sortKeyAttributes: {
                        fileId: DynamoKeyAttributeSchema.id<FileId>(),
                    },
                    attributes: Schema.object({
                        /**
                         * The content type of this file.
                         *
                         * The file's content type doesn't change after upload. If we don't know the file's
                         * type after upload we set it to `application/octet-stream` (which means unknown
                         * binary file). This means if we later add support for a content type, previously
                         * uploaded files won't get support. Only newly uploaded files.
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
                         * Is the file content currently uploading? True before we've finished saving the
                         * file's content to Cloudflare R2. False afterwards.
                         *
                         * Just because the file is done uploading doesn't mean it's done processing.
                         * `isUploading` may be false while `preview.isProcessing` is true.
                         */
                        isUploading: Schema.boolean,

                        /**
                         * An (ideally lossless) alternative to the file we can render on the client. We
                         * support many more document types than what the client can actually render. For
                         * example, the user may upload a `.tiff` image but `.tiff` images can't be
                         * rendered in a web browser. Or the user may upload a Microsoft Word document but
                         * we need to convert such a document to `.pdf` before we can render it. This
                         * property records whether the file has an alternative.
                         *
                         * If non-null the file has an alternative that'll be rendered instead of the main
                         * file itself. If `isImagePreviewContent` is true then the alternative is the same
                         * as what's in `preview.content`. (`isImagePreviewContent` being true implies
                         * there must be a `preview.content`.)
                         *
                         * The alternative is only rendered in the fullscreen file viewer. Though a preview
                         * image may be generated from the alternative file.
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
                         * True if `alternative` is now null but at some point in time `alternative` was
                         * set to `{isProcessing: true}`. This happens for the `video/mp4` and `audio/mp4`
                         * content types which might be web safe or web unsafe depending on the codecs
                         * used. So we set `alternative: {isProcessing: true}` until we figure out the
                         * codecs. If we have web safe codecs then we'll set `alternative` to `null` and
                         * this property to `true`.
                         */
                        hasProcessedNullAlternative: Schema.value(true).optional(),

                        /**
                         * A visual preview image for the file. Previews are a scaled down, often
                         * non-interactive, display of a file. For example files displayed in a document
                         * image gallery are previews.
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
                         * If `preview.content` is available then the preview file is stored in Cloudflare
                         * R2 with the key: `${spaceId}/${fileId}-preview`.
                         */
                        preview: FilePreviewSchema.nullable(),
                    }),
                },
            ],
        },
        {
            /**
             * MAJOR NOTE: This partition is no longer used! See File2 below.
             *
             * This partition should be removed when we're sure we no longer need it.
             */
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
        {
            // TODO: Rename to "File" to match the old "File" partition when we have that
            // ability.
            name: "File2",
            partitionKeyAttributes: {
                fileId: DynamoKeyAttributeSchema.id<FileId>(),
            },
            sortRanges: [
                {
                    name: "Attributes",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        /**
                         * The space this file belongs to.
                         */
                        spaceId: Schema.id<SpaceId>(),

                        /**
                         * The content type of this file.
                         *
                         * The file's content type doesn't change after upload. If we don't know the file's
                         * type after upload we set it to `application/octet-stream` (which means unknown
                         * binary file). This means if we later add support for a content type, previously
                         * uploaded files won't get support. Only newly uploaded files.
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
                         * Is the file content currently uploading? True before we've finished saving the
                         * file's content to Cloudflare R2. False afterwards.
                         *
                         * Just because the file is done uploading doesn't mean it's done processing.
                         * `isUploading` may be false while `preview.isProcessing` is true.
                         */
                        isUploading: Schema.boolean,

                        /**
                         * An (ideally lossless) alternative to the file we can render on the client. We
                         * support many more document types than what the client can actually render. For
                         * example, the user may upload a `.tiff` image but `.tiff` images can't be
                         * rendered in a web browser. Or the user may upload a Microsoft Word document but
                         * we need to convert such a document to `.pdf` before we can render it. This
                         * property records whether the file has an alternative.
                         *
                         * If non-null the file has an alternative that'll be rendered instead of the main
                         * file itself. If `isImagePreviewContent` is true then the alternative is the same
                         * as what's in `preview.content`. (`isImagePreviewContent` being true implies
                         * there must be a `preview.content`.)
                         *
                         * The alternative is only rendered in the fullscreen file viewer. Though a preview
                         * image may be generated from the alternative file.
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
                         * True if `alternative` is now null but at some point in time `alternative` was
                         * set to `{isProcessing: true}`. This happens for the `video/mp4` and `audio/mp4`
                         * content types which might be web safe or web unsafe depending on the codecs
                         * used. So we set `alternative: {isProcessing: true}` until we figure out the
                         * codecs. If we have web safe codecs then we'll set `alternative` to `null` and
                         * this property to `true`.
                         */
                        hasProcessedNullAlternative: Schema.value(true).optional(),

                        /**
                         * A visual preview image for the file. Previews are a scaled down, often
                         * non-interactive, display of a file. For example files displayed in a document
                         * image gallery are previews.
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
                         * If `preview.content` is available then the preview file is stored in Cloudflare
                         * R2 with the key: `${spaceId}/${fileId}-preview`.
                         */
                        preview: FilePreviewSchema.nullable(),
                    }),
                },
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

export const FilesBySpaceIndex = FilesTable.addIndex({
    name: "FilesBySpace",
    itemTypes: [{partitionType: "File2", sortRangeType: "Attributes"}],
    partitionKeyAttributes: {
        spaceId: DynamoKeyAttributeSchema.id<SpaceId>(),
    },
    sortKeyAttributes: {
        fileId: DynamoKeyAttributeSchema.id<FileId>(),
    },
});

// Old index kept for backwards compatibility. Reads have moved to
// PostDraftFile2AttachmentsIndex. This index will be removed in a future PR that
// cleans up the old "File" partition.
export const PostDraftFileAttachmentsIndex = FilesTable.addIndex({
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

export const PostDraftFile2AttachmentsIndex = FilesTable.addIndex({
    name: "PostDraftFile2Attachments",
    itemTypes: [{partitionType: "File2", sortRangeType: "PostDraftAttachmentTarget"}],
    partitionKeyAttributes: {
        accountId: DynamoKeyAttributeSchema.id<AccountId>(),
        draftId: DynamoKeyAttributeSchema.id<PostDraftId>(),
    },
    sortKeyAttributes: {
        fileId: DynamoKeyAttributeSchema.id<FileId>(),
    },
});

const fileAuthorizerAttachmentTargetTypesByTableSchema = new WeakMap<object, Set<string>>();

/**
 * Authorizes file access through an attachment target.
 *
 * `FileAuthorizer`s can either be bound or unbound. You create unbound
 * `FileAuthorizer`s with `new()` then use that to create bound `FileAuthorizer`s
 * with `bind()`. Unbound `FileAuthorizer`s define how to authorize entities of the
 * attachment target type you pass to `new()`. Bound `FileAuthorizer`s can be used
 * to authorize an individual entity.
 *
 * The authorization function you provide in `FileAuthorizer.new()` should cache
 * results using `CacheContextModule`! We may call your authorization function
 * multiple times in the same action for the same target. By the time you're
 * loading files (e.g. via `getContentReferencesForNode()`) you've also probably
 * already loaded your entity's content so by leveraging the action cache you
 * shouldn't need to reauthorize at all.
 *
 * ### Why is the file authorization API designed this way?
 *
 * Simply, to avoid cyclic dependencies. To avoid cyclic dependencies the
 * `//server/files/data` package doesn't depend on attachment target type packages.
 * Instead the attachment target type packages depend on `//server/files/data`.
 *
 * For example, `//server/documents/data` depends on `//server/files/data` but
 * `//server/files/data` doesn't depend on `//server/documents/data`. That means
 * `//server/files/data` can't call `authorizeDocumentAccess()`! So instead we
 * construct a `FileDocumentAuthorizer` (from `FileAuthorizer.new()`) in
 * `//server/documents/data` next to `DocumentsTable` and pass the result of
 * `FileDocumentAuthorizer.bind(documentId)` to `//server/files/data` functions
 * that need to authorize files.
 *
 * To make sure instances of `FileAuthorizer` are trusted we require you to pass a
 * `DynamoTableSchema` to `FileAuthorizer.new()`. This proves you're in the module
 * that owns data manipulation and authorization for the `DynamoTableSchema`. So
 * you can create a trusted `FileAuthorizer` instance.
 *
 * Our protections depend on TypeScript and ESLint errors. You can trivially get
 * around them by casting to `any` or with an ESLint disable comment. That's fine
 * attackers shouldn't be able to inject code so we only need to encourage the safe
 * patterns for developers.
 */
class FileAuthorizer<Bound extends boolean = true> {
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

export {FileAuthorizer as InternalFileAuthorizer};

// `FileAuthorizerUnbound` extends `FileAuthorizer` so we can use
// `FileAuthorizer`'s protected constructor in this class.
class FileAuthorizerUnbound<
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
        // We only want one authorizer instance per attachment target type. To enforce this
        // we require you to pass in a `DynamoTableSchema` with the right name before the
        // table has finished initializing.
        //
        // This leverages the infrastructure around `DynamoTableSchema` to make sure no
        // `DynamoTableSchema` is exported outside the file where it's constructed. By
        // tying file authorizers to `DynamoTableSchema` we also guarantee authorizers are
        // only created when you have exclusive access to the underlying table.
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
        return new FileAuthorizer(target, async (context, expectedAccessLevel) => {
            await this._authorizeTargetAccess(context, target, expectedAccessLevel);
        });
    }
}

export {FileAuthorizerUnbound as InternalFileAuthorizerUnbound};
