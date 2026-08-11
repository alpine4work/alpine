import {authorizeDocumentAccessIfPossible} from "~/server/documents/data/documents_actions.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {FileAuthorizer} from "~/server/files/data/file_authorizer.js";
import {
    MessageStreamAttributesSchema,
    MessageStreamPartSchema,
} from "~/server/messaging/helpers/message_stream_schema.js";
import {AccessPolicySchema} from "~/shared/access/access_policy.js";
import {
    DocumentContentSchema,
    DocumentContentStepSchema,
    DocumentWithOptionalTitleContentSchema,
    dangerousLegacyDefaultDocumentAccessPolicy,
} from "~/shared/documents/document_content_schema.js";
import {DocumentCreatorFromSchema} from "~/shared/documents/document_creator_from.js";
import {mapResult} from "~/shared/helpers/control/map_result.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {decodeIdInto, encodeId, idByteLength} from "~/shared/id/id.open_source.js";
import {
    AccountId,
    ContentEditorClientId,
    DocumentCommentThreadId,
    DocumentId,
    SpaceId,
} from "~/shared/id/types/id_types.open_source.js";
import {MessagePayloadSchema} from "~/shared/messaging/message_schema.js";
import {AddMarksAfterRemoveAllStepRangeSchema} from "~/shared/prosemirror/create_schema_for_prosemirror_schema.js";
import {createSchemaLazyTransformClass} from "~/shared/schema/helpers/create_schema_lazy_transform_class.js";
import {TimeZoneSchema} from "~/shared/schema/helpers/time_zone_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

const DocumentCommentThreadAttributesSchema = Schema.object({
    /** The time at which the thread was created. */
    createdTime: Schema.date,

    /** The time zone the thread was created in. */
    createdTimeZone: TimeZoneSchema.default(defaultTimeZone),

    /**
     * When all instances of a comment thread's mark are removed from a document we
     * save a content snippet to the comment thread object so we know what the comment
     * thread was about even after it has been deleted.
     *
     * Saving a content snippet is best effort. While very unlikely there may be a case
     * where you have an archived comment thread with no content snippet. You may also
     * have a referenced comment thread with a content snippet. In that case, use a
     * snippet from the current document instead of the snippet saved in the comment
     * thread object.
     */
    fallbackContentSnippet: Schema.object({
        version: Schema.integer,
        node: DocumentWithOptionalTitleContentSchema,
    })
        .nullable()
        .default(null),

    /**
     * Information regarding the comment thread. Nested in an object so we can update
     * it at once.
     */
    commentsSummary: Schema.object({
        /**
         * The index of the next comment.
         */
        nextCommentIndex: Schema.integer.min(0),

        /**
         * All the accounts which have commented in this thread and the number of comments
         * they have made. The map is ordered by when the account first commented on the
         * document comment thread.
         *
         * This map can grow unbounded. When a user deletes a comment it leaves a
         * gravestone so comment counts should never be decremented.
         */
        commentCountByAuthorId: Schema.map(Schema.id<AccountId>(), Schema.integer.min(1)),

        /**
         * All the accounts which have been mentioned at some point in this document
         * comment thread.
         *
         * Accounts that exist in the map with a mention count of zero have a special
         * meaning:
         *
         * - If an account exists in the map they were mentioned at some point
         * - If an account exists in the map with a mention count of zero then they were
         *   mentioned at some point but all mentions have been removed by updates
         * - If an account does not exist in the map they were never mentioned in the post
         */
        mentionCountByAccountId: Schema.map(Schema.id<AccountId>(), Schema.integer.min(0)).default(
            new Map(),
        ),
    }),

    /**
     * Whether this comment thread is in a resolved or unresolved state. Comment
     * threads all start in an unresolved state. Comment resolution state is controlled
     * by the user and is a convenient way to dismiss a comment from a document once
     * the comment's contents have been addressed.
     *
     * Resolved comment threads include the ranges of text that had this comment's mark
     * when the thread was unresolved. This way if the user wants to unresolve a
     * comment we can place the marks back in the document where they originally were.
     * We may need to rebase the ranges in case content shifted around.
     *
     * Comment thread resolved/unresolved state is not to be confused with comment
     * referenced/archived state. Referenced means there's a comment mark in the
     * document referencing this comment thread. Archived means there is no comment
     * mark referencing this comment thread. An unresolved comment may either be
     * referenced or archived. Same with a resolved comment. Though usually resolved
     * comments are archived and unresolved comments are referenced.
     */
    resolutionState: Schema.union({
        Unresolved: Schema.object({
            type: Schema.value("Unresolved"),
        }),
        Resolved: Schema.object({
            type: Schema.value("Resolved"),
            version: Schema.integer,
            ranges: Schema.array(AddMarksAfterRemoveAllStepRangeSchema),
        }),
    }).default({
        type: "Unresolved",
    }),
});

export type DocumentIndexSearchEntityJob = SchemaType<typeof DocumentIndexSearchEntityJobSchema>;

const DocumentIndexSearchEntityJobSchema = Schema.object({
    sendTime: Schema.date,
    // NOTE(calebmer, 2025-01-31): Prior to this date we didn't have a generation
    // number for this object.
    generation: Schema.integer.min(0).default(0),
    // NOTE(calebmer, 2025-01-31): We used to always use 60 as the job's `delaySeconds`
    // prior to this date.
    delaySeconds: Schema.integer.default(60),
    updatedTraits: Schema.union({
        Any: Schema.object({type: Schema.value("Any")}),
        Some: Schema.object({
            type: Schema.value("Some"),
            traits: Schema.array(Schema.enum(["Title", "Authorization"])),
        }),
    }),
});

type DocumentStepCountByAccountId = InstanceType<typeof DocumentStepCountByAccountId>;

const DocumentStepCountByAccountId = createSchemaLazyTransformClass<
    Uint8Array,
    ReadonlyMap<AccountId, number>
>(Schema.bytes, {
    serialize: stepCountByAccountId => {
        const bytes = new Uint8Array(stepCountByAccountId.size * (idByteLength + 4));
        const view = new DataView(bytes.buffer);

        let byteOffset = 0;
        for (const [accountId, stepCount] of stepCountByAccountId) {
            decodeIdInto(accountId, bytes, byteOffset);
            byteOffset += idByteLength;

            view.setUint32(byteOffset, stepCount);
            byteOffset += 4;
        }

        return bytes;
    },
    deserialize: bytes => {
        const view = new DataView(bytes.buffer);
        const stepCountByAccountId = new Map<AccountId, number>();

        let byteOffset = 0;
        while (byteOffset + idByteLength + 4 <= bytes.byteLength) {
            const accountId = encodeId<AccountId>(bytes, byteOffset);
            byteOffset += idByteLength;

            const stepCount = view.getUint32(byteOffset);
            byteOffset += 4;

            stepCountByAccountId.set(accountId, stepCount);
        }

        return stepCountByAccountId;
    },
});

export {DocumentStepCountByAccountId as InternalDocumentStepCountByAccountId};

export const DocumentsTable = DynamoTableSchema.new({
    name: "Documents",
    partitions: [
        {
            name: "Document",
            partitionKeyAttributes: {
                documentId: DynamoKeyAttributeSchema.id<DocumentId>(),
            },
            sortRanges: [
                /**
                 * A preview of the beginning of the document's content. This previewed content may
                 * be stale. It's updated during by the `IndexSearchEntity` job. This preview is
                 * used when you just want to show the beginning of the document and, for
                 * performance reasons, you don't want to load the whole thing. For example, in
                 * document `file` content previews.
                 *
                 * This exists in a sort range above `Attributes` so you can load
                 * `ContentPreview` + `Attributes` in one query but you don't load `ContentPreview`
                 * when reading `Attributes` and the rest of the document.
                 */
                {
                    name: "ContentPreview",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        /**
                         * The version of our preview. Will always be less than the `version` number of
                         * `Attributes`.
                         */
                        version: Schema.integer,

                        /**
                         * The current previewed content.
                         */
                        content: DocumentContentSchema,
                    }),
                },

                /**
                 * Any information about the document not stored in its content.
                 *
                 * The content of a document is the document snapshot and any steps in the
                 * `StepsAfterSnapshot` range.
                 */
                {
                    name: "Attributes",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        createdTime: Schema.date,
                        spaceId: Schema.id<SpaceId>(),

                        /**
                         * The creator of the document. They're automatically subscribed to new comment
                         */
                        creator: Schema.object({
                            // The ID of the account that created this document
                            id: Schema.id<AccountId>().nullable().default(null),
                            // If this document was created by something else, on behalf of the account ID.
                            from: DocumentCreatorFromSchema.wrapOriginalPropertyInUnionVariant(
                                "Bot",
                                "accountId",
                                {},
                            )
                                .nullable()
                                .default(null)
                                .originalPropertyKey("fromBotAccountId"),
                        })
                            .wrapOriginalPropertyInObject("id", {from: null})
                            .originalPropertyKey("ownerId"),

                        /**
                         * The current version of the document.
                         *
                         * The snapshot may be at an earlier version. If it is, we should have
                         * `attributes.version - snapshot.version` steps after the snapshot.
                         */
                        version: Schema.integer,

                        /**
                         * The title of the document extracted from the latest content.
                         *
                         * We want the document title to be easily accessible so you don't need to load the
                         * snapshot and apply any new steps to get the title.
                         */
                        titleWithoutFallback: Schema.string,

                        /**
                         * The access policy for the document. Declares who can access the document and
                         * what they can do with the document.
                         *
                         * This is a copy of `content.attrs.accessPolicy` which canonically stores the
                         * current access policy. We have a copy here so the access policy is easily
                         * accessible and you don't need to load the document snapshot to use it.
                         */
                        accessPolicy: AccessPolicySchema.default(
                            dangerousLegacyDefaultDocumentAccessPolicy,
                        ),

                        /**
                         * Information about the last time we sent an `IndexSearchEntity` job for this
                         * document. Since a document may be updated many times in quick succession we want
                         * to throttle how often we reindex the document to capture many changes at once.
                         */
                        lastIndexSearchEntityJob: DocumentIndexSearchEntityJobSchema.default({
                            // NOTE(calebmer): Documents created/updated before this date did not have this
                            // property. This default should cause us to always schedule new indexing jobs when
                            // updating those documents.
                            sendTime: new Date("2023-12-07T16:35:04.622Z"),
                            generation: 0,
                            delaySeconds: 60,
                            updatedTraits: {type: "Any"},
                        }),

                        /**
                         * Keep track of the number of steps contributed by various `AccountId`s after
                         * `version` 0. Excluding steps contributed by `creatorId`. You can compute
                         * `creatorId`'s `stepCount` by adding all step counts in this map then subtracting
                         * that from `version`.
                         *
                         * This is a simple way to determine who's contributed to the document and by what
                         * amount. However, this is only a valid measure of the amount each account has
                         * contributed assuming the relative added content size of each step is the same.
                         * It's possible an account pastes a lot of content and that's only counted as one
                         * step. Approaches of measuring contribution that take pastes into effect would be
                         * less efficient and more prone to error.
                         *
                         * We serialize the map to binary. An `Id` is 128 bits in binary and 208 bits in
                         * UTF-8. That means for one 4kb DynamoDB read unit we can fit 250 `Id`s in binary
                         * but only 153 `Id`s in UTF-8.
                         *
                         * This map was not around prior to 2024-01-01. So documents created before then
                         * (and until this deploys) will not have an accurate step count map. All steps
                         * will be counted towards the `creatorId`.
                         */
                        stepCountByAccountId: DocumentStepCountByAccountId.schema.default(
                            new DocumentStepCountByAccountId(new Map()),
                        ),

                        /**
                         * Have we added a feed candidate entry for the document? We add an entry when the
                         * document is shared with some `defaultGrant`. But if you revoke the
                         * `defaultGrant` then add it again we don't want to add another feed candidate
                         * entry.
                         */
                        hasAddedFeedCandidateEntry: Schema.boolean.default(false),

                        /**
                         * Information about when this document was soft-deleted and by whom. We keep a
                         * record of deleted documents so they can still be referenced in search results
                         * and mentions.
                         */
                        deleted: Schema.object({
                            time: Schema.date,
                            deletor: Schema.object({
                                /**
                                 * The account that soft-deleted this document.
                                 */
                                id: Schema.id<AccountId>().nullable().default(null),

                                /**
                                 * What soft-deleted this document on behalf of the account ID, if anything.
                                 */
                                from: Schema.union({
                                    Bot: Schema.object({
                                        type: Schema.value("Bot"),
                                        accountId: Schema.id<AccountId>(),
                                    }),
                                })
                                    .nullable()
                                    .default(null),
                            }),
                        })
                            .nullable()
                            .default(null),
                    }),
                },

                /**
                 * Step transactions applied to the document after our latest snapshot.
                 *
                 * Every character the user types creates a step so we save them to the database in
                 * transactions.
                 *
                 * As a user is actively typing in the document we don't save the full snapshot to
                 * the database as that would be expensive. Instead we schedule a new snapshot to
                 * be taken later.
                 *
                 * When we update our snapshot, steps in this sort range will be moved to
                 * `StepTransactionsBeforeSnapshot` asynchronously. Since this happens
                 * asynchronously, keep in mind that:
                 *
                 * - Steps before the snapshot may temporarily exist in
                 *   `StepTransactionsAfterSnapshot` after the snapshot was updated.
                 * - Steps may temporarily exist in both `StepTransactionsAfterSnapshot` and
                 *   `StepTransactionsBeforeSnapshot`.
                 */
                {
                    name: "StepTransactionsAfterSnapshot",
                    sortKeyAttributes: {
                        /**
                         * The version this step transaction is applied onto.
                         *
                         * The document version after the transaction will be
                         * `startVersion + steps.length`.
                         */
                        startVersion: DynamoKeyAttributeSchema.integer,
                    },
                    attributes: Schema.object({
                        createdTime: Schema.date,

                        /**
                         * The steps applied to the document in this transaction.
                         */
                        steps: Schema.array(DocumentContentStepSchema),

                        /**
                         * The inverse of the steps applied to the document in this transaction.
                         *
                         * We need to store inverted steps to be able to restore older versions of the
                         * document. For instance, when you delete content the inverted step will contain
                         * the content that was deleted.
                         *
                         * This array is in reverse order of `steps`.
                         */
                        invertedSteps: Schema.array(DocumentContentStepSchema),

                        /**
                         * A `ContentEditorClientId` identifying the client who applied this step.
                         *
                         * We generate a new client id every time the content editor is rendered. This
                         * means a user may have many client ids. They can be editing from two browser tabs
                         * at once or even two editors on-screen at the same time.
                         */
                        clientId: Schema.id<ContentEditorClientId>(),

                        /**
                         * The account that applied this step transaction.
                         *
                         * Nullable because step transactions created before this field was added won't
                         * have an `accountId`.
                         */
                        accountId: Schema.id<AccountId>().nullable().default(null),

                        /**
                         * If this step transaction was applied by a bot, the bot's account ID. The
                         * `accountId` field will be the account the bot acted on behalf of.
                         */
                        fromBotAccountId: Schema.id<AccountId>().nullable().default(null),
                    }),
                },

                /**
                 * The last full snapshot we took of the document.
                 */
                {
                    name: "Snapshot",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        /**
                         * The version we took the snapshot at. Will be less than or equal to the document
                         * version.
                         */
                        version: Schema.integer,

                        /**
                         * The full document content for the snapshot.
                         */
                        content: DocumentContentSchema,
                    }),
                },

                /**
                 * An item representing a document comment thread. The comments in the thread live
                 * in the `DocumentCommentThread` partition. We put this item in the `Document`
                 * partition so that you can query comment threads together with the document. Then
                 * when you open a comment thread you can query the thread's partition.
                 *
                 * This sort range is an approximation of all the comment threads currently
                 * referenced in the document's content. The `ArchivedCommentThread` range
                 * represents comment threads that used to be in the document's content but were
                 * removed. Perhaps the user resolved the comment thread or deleted the content
                 * which contained it. Comment threads are moved between these two sort ranges with
                 * eventual consistency. (Currently during document snapshot updates.) So you are
                 * not guaranteed that an archived comment thread is unreferenced or that a
                 * referenced comment thread is actually unreferenced.
                 */
                {
                    name: "ReferencedCommentThread",
                    sortKeyAttributes: {
                        commentThreadId: DynamoKeyAttributeSchema.id<DocumentCommentThreadId>(),
                    },
                    attributes: DocumentCommentThreadAttributesSchema,
                },

                /**
                 * See the documentation for `ReferencedCommentThread` to understand this sort
                 * range.
                 */
                {
                    name: "ArchivedCommentThread",
                    sortKeyAttributes: {
                        commentThreadId: DynamoKeyAttributeSchema.id<DocumentCommentThreadId>(),
                    },
                    attributes: DocumentCommentThreadAttributesSchema,
                },

                /**
                 * Step transactions applied to the document before our latest snapshot.
                 *
                 * We keep around old steps for historical purposes. We will read these steps when
                 * showing the document history.
                 */
                // TODO(calebmer): Maybe we should create a new table with an infrequent access
                // mode for step transactions before the snapshot. Since they're only used when
                // rendering history which is rare?
                {
                    name: "StepTransactionsBeforeSnapshot",
                    sortKeyAttributes: {
                        /**
                         * The version this step transaction is applied onto.
                         *
                         * The document version after the transaction will be
                         * `startVersion + steps.length`.
                         */
                        startVersion: DynamoKeyAttributeSchema.integer,
                    },
                    attributes: Schema.object({
                        createdTime: Schema.date,

                        /**
                         * The steps applied to the document.
                         */
                        steps: Schema.array(DocumentContentStepSchema),

                        /**
                         * The inverse of the steps applied to the document in this transaction.
                         *
                         * We need to store inverted steps to be able to restore older versions of the
                         * document. For instance, when you delete content the inverted step will contain
                         * the content that was deleted.
                         *
                         * This array is in reverse order of `steps`.
                         */
                        invertedSteps: Schema.array(DocumentContentStepSchema),

                        /**
                         * A `ContentEditorClientId` identifying the client who applied this step.
                         *
                         * We generate a new client id every time the content editor is rendered. This
                         * means a user may have many client ids. They can be editing from two browser tabs
                         * at once or even two editors on-screen at the same time.
                         */
                        clientId: Schema.id<ContentEditorClientId>(),

                        /**
                         * The account that applied this step transaction.
                         *
                         * Nullable because step transactions created before this field was added won't
                         * have an `accountId`.
                         */
                        accountId: Schema.id<AccountId>().nullable().default(null),

                        /**
                         * If this step transaction was applied by a bot, the bot's account ID. The
                         * `accountId` field will be the account the bot acted on behalf of.
                         */
                        fromBotAccountId: Schema.id<AccountId>().nullable().default(null),
                    }),
                },
            ],
        },

        /**
         * Users can leave comments on ranges of text in a document. We annotate the
         * commented range with a ProseMirror mark and store the comments back in our
         * DynamoDB table here.
         *
         * What would normally be an `Attributes` item in this partition instead lives in
         * the `Document` partition as `ReferencedCommentThread` and
         * `ArchivedCommentThread`. This way we can query all the information regarding
         * comment threads when loading a document at once. Then when you open a comment
         * thread you load comments from this partition.
         */
        {
            name: "DocumentCommentThread",
            partitionKeyAttributes: {
                documentId: DynamoKeyAttributeSchema.id<DocumentId>(),
                commentThreadId: DynamoKeyAttributeSchema.id<DocumentCommentThreadId>(),
            },
            sortRanges: [
                /**
                 * Comments in the thread. Has all the attributes needed for a message in
                 * `MessageInterface`.
                 */
                {
                    name: "Comments",
                    sortKeyAttributes: {
                        commentIndex: DynamoKeyAttributeSchema.integer,
                    },
                    attributes: Schema.object({
                        authorId: Schema.id<AccountId>(),
                        createdTime: Schema.date,
                        createdTimeZone: TimeZoneSchema.default(defaultTimeZone),
                        payload: MessagePayloadSchema,
                    }),
                    childSortRanges: [
                        {
                            name: "Stream",
                            sortKeyAttributes: {},
                            attributes: MessageStreamAttributesSchema,
                        },
                        {
                            name: "StreamPart",
                            sortKeyAttributes: {
                                partIndex: DynamoKeyAttributeSchema.integer,
                            },
                            attributes: MessageStreamPartSchema,
                        },
                    ],
                },

                /**
                 * Whenever a message is updated we add a `MessageUpdates` item. So when clients
                 * need to backfill realtime events they missed while disconnected from a WebSocket
                 * server they can query this sort range to catch up.
                 *
                 * The event includes the `messageIndex` and the new `version` of the message.
                 * During backfill we load the new version of the item.
                 *
                 * This sort range has a similar design to the `Events` sort range in
                 * `RynamoTableSchema`.
                 *
                 * IMPORTANT: This does not include realtime events for streaming messages!
                 * Streaming messages are updated with a different realtime system that's more
                 * efficient for the streaming use case.
                 *
                 * Named `MessageUpdates` instead of `CommentUpdates` so we can have shared
                 * utilities for querying this sort range that work across all messaging surfaces.
                 */
                {
                    name: "MessageUpdates",
                    sortKeyAttributes: {
                        // NOTE(calebmer): Reversed so if we ever wanted to backfill in one query we could.
                        // Through a query that starts at the client's last `messageIndex` and ends at the
                        // checkpoint's `eventTime`.
                        eventTime: DynamoKeyAttributeSchema.date.reverse(),
                        // All the data is in the key so we can safely use create-or-replace to add items
                        // to the table without worrying we're overriding some other data.
                        messageIndex: DynamoKeyAttributeSchema.integer,
                        version: DynamoKeyAttributeSchema.integer,
                    },
                    withExpirationTime: "Required",
                    attributes: Schema.object({}),
                },

                // NOTE(calebmer, 2025-10-13): We changed the format for messaging realtime events
                // to a new sort range: `MessageUpdates`. Leaving this around until all old
                // `CommentChangeLog` items expire. At which point we can remove this from the
                // DynamoDB schema.
                {
                    name: "CommentChangeLog",
                    sortKeyAttributes: {
                        changeTime: DynamoKeyAttributeSchema.date,
                    },
                    withExpirationTime: "Required",
                    attributes: Schema.object({
                        commentIndex: Schema.integer,
                        change: Schema.unknown(),
                    }),
                },
            ],
        },
    ],
});

// Authorizers must be declared next to their respective Tables
const FileDocumentAuthorizer = FileAuthorizer.new(
    DocumentsTable,
    "Document",
    async (context, target, expectedAccessLevel, options) =>
        mapResult(
            await authorizeDocumentAccessIfPossible(
                context,
                target.documentId,
                expectedAccessLevel,
                options,
            ),
            () => {},
        ),
);

export {FileDocumentAuthorizer as InternalFileDocumentAuthorizer};
