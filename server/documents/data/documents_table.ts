import {differenceInMinutes} from "date-fns";
import {Node} from "prosemirror-model";
import {Step} from "prosemirror-transform";
import {getContentReferencesForNode} from "~/server/content/get_content_references.js";
import {
    applyMentionCountByAccountIdDifferenceFromContentUpdate,
    getMentionCountByAccountIdInContent,
    getMentionedAccountIdsInContent,
} from "~/server/content/get_mentioned_account_ids_in_content.js";
import {
    ServerActionContext,
    ServerSessionActionContext,
    ServerSessionActionContextModules,
} from "~/server/context/server_action_context.js";
import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {DynamoReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {DynamoTableItemType, DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {DynamoTransactionEntry} from "~/server/dynamo/core/dynamo_transaction_entry.js";
import {isDynamoConditionCheckError} from "~/server/dynamo/core/is_dynamo_condition_check_error.js";
import {TestCheckpoint} from "~/server/helpers/test/test_checkpoint.js";
import {TestCounter} from "~/server/helpers/test/test_counter.js";
import {createMessagePayloadModel} from "~/server/messaging/helpers/create_message_payload_model.js";
import {getMessageChangeLogExpirationTimeFromChangeTime} from "~/server/messaging/helpers/get_message_change_log_expiration_time_from_change_time.js";
import {getNotificationMessageContentSnippet} from "~/server/notifications/core/get_notification_content_snippet.js";
import {NotificationsContextModuleBase} from "~/server/notifications/core/notifications_context_module_base.js";
import {authorizeSpaceAccess, getAccount} from "~/server/spaces/spaces_table.js";
import {getCollaborativelyUpdateContentResult} from "~/shared/content/get_collaboratively_update_content_result.js";
import {ContextCache} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {
    DocumentContent,
    DocumentContentSchema,
    DocumentContentStepSchema,
    isDocumentContent,
} from "~/shared/documents/document_content_schema.js";
import {
    DocumentCommentModel,
    DocumentCommentThreadModel,
    DocumentModel,
    DocumentPreviewModel,
    getDocumentContentTitleWithoutFallback,
} from "~/shared/documents/document_model.js";
import {
    DataLossError,
    FailedPreconditionError,
    InternalError,
    InvalidArgumentError,
    NotFoundError,
    PermissionDeniedError,
} from "~/shared/error/error.js";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isNonNullable} from "~/shared/helpers/control/is_non_nullable.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {filterIterable} from "~/shared/helpers/iterable/filter_iterable.js";
import {flatMapIterable} from "~/shared/helpers/iterable/flat_map_iterable.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {parallelMapAsyncIterableToArray} from "~/shared/helpers/iterable/parallel_map_async_iterable_to_array.js";
import {reduceIterable} from "~/shared/helpers/iterable/reduce_iterable.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {clamp} from "~/shared/helpers/number/clamp.js";
import {Replace} from "~/shared/helpers/types/replace.js";
import {assertId, generateId, getMaxId, getMinId} from "~/shared/id/id.js";
import {
    AccountId,
    ContentEditorClientId,
    ContentMentionAccountId,
    DocumentCommentThreadId,
    DocumentId,
    SpaceId,
} from "~/shared/id/types/id_types.js";
import {MessageChange, getMessageChangeTime} from "~/shared/messaging/message_change_schema.js";
import {MessageContent, MessageContentSchema} from "~/shared/messaging/message_content_schema.js";
import {MessagePayload, MessagePayloadSchema} from "~/shared/messaging/message_model.js";
import {
    visitProsemirrorNode,
    visitProsemirrorStep,
} from "~/shared/prosemirror/prosemirror_visitor.js";
import {Schema} from "~/shared/schema/schema.js";

const DocumentCommentThreadAttributesSchema = Schema.object({
    /** The time at which the thread was created. */
    createdTime: Schema.date,

    /**
     * Information regarding the comment thread. Nested in an object so we can
     * update it at once.
     */
    commentsSummary: Schema.object({
        /**
         * The index of the next comment.
         */
        nextCommentIndex: Schema.integer.min(0),

        /**
         * The last time a comment was changed. This should equal the `changeTime` of
         * the highest item in `CommentChangeLog`.
         */
        lastChangeTime: Schema.date.nullable().default(null),

        /**
         * All the accounts which have commented in this thread and the number of comments
         * they have made. The map is ordered by when the account first commented on
         * the document comment thread.
         *
         * This map can grow unbounded. When a user deletes a comment it leaves a
         * gravestone so comment counts should never be decremented.
         */
        commentCountByAuthorId: Schema.map(Schema.id<AccountId>(), Schema.integer.min(1)),

        /**
         * All the accounts which have been mentioned at some point in this document
         * comment thread.
         *
         * Accounts that exist in the map with a mention count of zero have a
         * special meaning:
         *
         * - If an account exists in the map they were mentioned at some point
         * - If an account exists in the map with a mention count of zero then they
         *   were mentioned at some point but all mentions have been removed by updates
         * - If an account does not exist in the map they were never mentioned in
         *   the post
         */
        mentionCountByAccountId: Schema.map(
            Schema.id<ContentMentionAccountId>(),
            Schema.integer.min(0),
        ).default(new Map()),
    }),
});

const DocumentsTable = DynamoTableSchema.new({
    name: "Documents",
    partitions: [
        {
            name: "Document",
            partitionKeyAttributes: {
                documentId: DynamoKeyAttributeSchema.id<DocumentId>(),
            },
            sortRanges: [
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
                         * The owner of the document starts as the document's creator and can perform
                         * certain administrative actions. In addition to being automatically
                         * subscribed to new comment thread notifications.
                         */
                        ownerId: Schema.id<AccountId>().nullable().default(null),

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
                         * We want the document title to be easily accessible so you don't need to load
                         * the snapshot and apply any new steps to get the title.
                         */
                        titleWithoutFallback: Schema.string,
                    }),
                },

                /**
                 * Step transactions applied to the document after our latest snapshot.
                 *
                 * Every character the user types creates a step so we save them to the
                 * database in transactions.
                 *
                 * As a user is actively typing in the document we don't save the full snapshot
                 * to the database as that would be expensive. Instead we schedule a new
                 * snapshot to be taken later.
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
                         * document. For instance, when you delete content the inverted step will
                         * contain the content that was deleted.
                         *
                         * This array is in reverse order of `steps`.
                         */
                        invertedSteps: Schema.array(DocumentContentStepSchema),

                        /**
                         * A `ContentEditorClientId` identifying the client who applied this step.
                         *
                         * We generate a new client id every time the content editor is rendered. This
                         * means a user may have many client ids. They can be editing from two browser
                         * tabs at once or even two editors on-screen at the same time.
                         */
                        clientId: Schema.id<ContentEditorClientId>(),
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
                         * The version we took the snapshot at. Will be less than or equal to the
                         * document version.
                         */
                        version: Schema.integer,

                        /**
                         * The full document content for the snapshot.
                         */
                        content: DocumentContentSchema,
                    }),
                },

                /**
                 * An item representing a document comment thread. The comments in the thread
                 * live in the `DocumentCommentThread` partition. We put this item in the
                 * `Document` partition so that you can query comment threads together with the
                 * document. Then when you open a comment thread you can query the thread's
                 * partition.
                 *
                 * This sort range is an approximation of all the comment threads currently
                 * referenced in the document's content. The `ArchivedCommentThread` range
                 * represents comment threads that used to be in the document's content but
                 * were removed. Perhaps the user resolved the comment thread or deleted the
                 * content which contained it. Comment threads are moved between these two
                 * sort ranges with eventual consistency. (Currently during document snapshot
                 * updates.) So you are not guaranteed that an archived comment thread is
                 * unreferenced or that a referenced comment thread is actually unreferenced.
                 */
                {
                    name: "ReferencedCommentThread",
                    sortKeyAttributes: {
                        commentThreadId: DynamoKeyAttributeSchema.id<DocumentCommentThreadId>(),
                    },
                    attributes: DocumentCommentThreadAttributesSchema,
                },

                /**
                 * See the documentation for `ReferencedCommentThread` to understand this
                 * sort range.
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
                 * We keep around old steps for historical purposes. We will read these steps
                 * when showing the document history.
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
                         * document. For instance, when you delete content the inverted step will
                         * contain the content that was deleted.
                         *
                         * This array is in reverse order of `steps`.
                         */
                        invertedSteps: Schema.array(DocumentContentStepSchema),

                        /**
                         * A `ContentEditorClientId` identifying the client who applied this step.
                         *
                         * We generate a new client id every time the content editor is rendered. This
                         * means a user may have many client ids. They can be editing from two browser
                         * tabs at once or even two editors on-screen at the same time.
                         */
                        clientId: Schema.id<ContentEditorClientId>(),
                    }),
                },
            ],
        },

        /**
         * Users can leave comments on ranges of text in a document. We annotate the
         * commented range with a ProseMirror mark and store the comments back in our
         * DynamoDB table here.
         *
         * What would normally be an `Attributes` item in this partition instead lives
         * in the `Document` partition as `ReferencedCommentThread` and
         * `ArchivedCommentThread`. This way we can query all the information regarding
         * comment threads when loading a document at once. Then when you open a
         * comment thread you load comments from this partition.
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
                        payload: MessagePayloadSchema,
                    }),
                },

                /**
                 * We keep a log of changes to comments so that when backfilling for realtime
                 * we can send any missed updates between the last time data was loaded and
                 * the backfill.
                 *
                 * `changeTime` should be monotonically increasing which is managed by
                 * `lastChangeTime` in `commentsSummary`.
                 *
                 * This log does not include when comments are created, only updated or
                 * deleted. Because comment indexes are dense we can take the last seen comment
                 * index and load comments after that to backfill.
                 *
                 * Log items will expire after a certain amount of time. If a client hasn't
                 * backfilled in a long time it will need to fully reload since we won't know
                 * what changed.
                 */
                {
                    name: "CommentChangeLog",
                    sortKeyAttributes: {
                        changeTime: DynamoKeyAttributeSchema.date,
                    },
                    withExpirationTime: "Required",
                    attributes: Schema.object({
                        commentIndex: Schema.integer,
                        change: Schema.union({
                            UpdateContent: Schema.object({
                                type: Schema.value("UpdateContent"),
                                content: MessageContentSchema,
                                // `contentUpdatedTime` is the `changeTime` sort key attribute. We don't
                                // duplicate it here.
                            }),
                            Delete: Schema.object({
                                type: Schema.value("Delete"),
                                // `deletedTime` is the `changeTime` sort key attribute. We don't
                                // duplicate it here.
                            }),
                        }),
                    }),
                },
            ],
        },
    ],
});

/**
 * We are not allowed to export our DynamoDB tables so instead export a
 * function that can only be used in test environments.
 */
export function getDocumentsTableForTest() {
    assert(process.env.NODE_ENV === "test");
    return DocumentsTable;
}

type DocumentAttributesItem = DynamoTableItemType<typeof DocumentsTable, "Document", "Attributes">;

type DocumentStepTransactionAfterSnapshotItem = DynamoTableItemType<
    typeof DocumentsTable,
    "Document",
    "StepTransactionsAfterSnapshot"
>;

type DocumentStepTransactionBeforeSnapshotItem = DynamoTableItemType<
    typeof DocumentsTable,
    "Document",
    "StepTransactionsBeforeSnapshot"
>;

type DocumentStepTransactionItem =
    | DocumentStepTransactionAfterSnapshotItem
    | DocumentStepTransactionBeforeSnapshotItem;

type DocumentSnapshotItem = DynamoTableItemType<typeof DocumentsTable, "Document", "Snapshot">;

type DocumentReferencedCommentThreadItem = DynamoTableItemType<
    typeof DocumentsTable,
    "Document",
    "ReferencedCommentThread"
>;

type DocumentArchivedCommentThreadItem = DynamoTableItemType<
    typeof DocumentsTable,
    "Document",
    "ArchivedCommentThread"
>;

type DocumentCommentItem = DynamoTableItemType<
    typeof DocumentsTable,
    "DocumentCommentThread",
    "Comments"
>;

/**
 * Creates a new document with no history using the initial content provided.
 */
export async function createDocument(
    context: ServerSessionActionContext,
    {
        id = generateId<DocumentId>(),
        spaceId,
        content,
    }: {
        id?: DocumentId;
        spaceId: SpaceId;
        content: DocumentContent;
    },
): Promise<{
    id: DocumentId;
    createdTime: Date;
    version: number;
}> {
    await authorizeSpaceAccess(context, spaceId);

    const createdTime = new Date();
    const version = 0;

    await DynamoTableSchema.executeTransaction(
        context,
        [
            DocumentsTable.transactionCreateItem({
                partitionType: "Document",
                sortRangeType: "Attributes",
                createdTime,
                spaceId,
                documentId: id,
                ownerId: context.actor.getAccountId(),
                version,
                titleWithoutFallback: getDocumentContentTitleWithoutFallback(content),
            }),
            DocumentsTable.transactionCreateOrReplaceItem({
                partitionType: "Document",
                documentId: id,
                sortRangeType: "Snapshot",
                version,
                content,
            }),
        ],
        {
            clientRequestToken: id,
        },
    );

    return {
        id,
        createdTime,
        version,
    };
}

const DocumentPreviewContextCache = new ContextCache<DocumentId, DocumentPreviewModel | null>();

/**
 * Get a preview of the document with the provided id.
 *
 * Cheaper than `getDocument()` since we don't return the full content.
 */
export function getDocumentPreviewIfExists(
    context: ServerActionContext,
    id: DocumentId,
    {consistency = "Eventual"}: {consistency?: DynamoReadConsistency} = {},
): Promise<DocumentPreviewModel | null> {
    const get = async () => {
        const attributes = await DocumentsTable.getItemIfExists(
            context,
            {
                partitionType: "Document",
                documentId: id,
                sortRangeType: "Attributes",
            },
            {consistency},
        );

        if (!attributes) return null;

        await authorizeSpaceAccess(context, attributes.spaceId);

        return new DocumentPreviewModel({
            id,
            createdTime: attributes.createdTime,
            spaceId: attributes.spaceId,
            version: attributes.version,
            titleWithoutFallback: attributes.titleWithoutFallback,
        });
    };

    // We can't use a cached value when reading with strong consistency but we can
    // save the read value to the cache for later.
    if (consistency === "Strong") {
        const getPromise = get();
        DocumentPreviewContextCache.set(context, id, getPromise);
        return getPromise;
    } else {
        return DocumentPreviewContextCache.get(context, id, get);
    }
}

/**
 * Get a preview of the document with the provided id.
 *
 * Cheaper than `getDocument()` since we don't return the full content.
 */
export async function getDocumentPreview(
    context: ServerActionContext,
    id: DocumentId,
    options?: {consistency?: DynamoReadConsistency},
): Promise<DocumentPreviewModel> {
    const document = await getDocumentPreviewIfExists(context, id, options);
    if (!document) throw new NotFoundError("Document not found");
    return document;
}

/**
 * Authorizes that the current request can access the document.
 *
 * This function is mostly strongly consistent. It's safe to use in strongly
 * consistent contexts. If an account just got access this function will pass
 * with strong consistency. If an account lost access we have to wait for
 * DynamoDB's eventual consistency lag before this function will start
 * throwing.
 */
export async function authorizeDocumentAccess(
    context: ServerActionContext,
    documentId: DocumentId,
): Promise<{spaceId: SpaceId}> {
    let document = await getDocumentPreviewIfExists(context, documentId);

    // If we couldn't find the document with eventual consistency, try again with
    // strong consistency in case it was just created.
    if (!document) {
        document = await getDocumentPreviewIfExists(context, documentId, {consistency: "Strong"});
    }

    if (!document) throw new NotFoundError("Document not found");
    return {spaceId: document.spaceId};
}

type InternalDocument = {
    readonly attributes: DocumentAttributesItem;
    readonly stepTransactionsAfterSnapshot: ReadonlyArray<DocumentStepTransactionAfterSnapshotItem>;
    readonly snapshot: DocumentSnapshotItem;
    readonly version: number;
    readonly content: DocumentContent;
};

export const getInternalDocumentTestCounter = new TestCounter();

async function getInternalDocumentIfExists(
    context: ServerActionContext,
    id: DocumentId,
    {consistency = "Eventual"}: {consistency?: DynamoReadConsistency} = {},
): Promise<InternalDocument | null> {
    getInternalDocumentTestCounter.incrementForTest(id);

    let attributes: DocumentAttributesItem | null = null;
    let stepTransactionsAfterSnapshot: Array<DocumentStepTransactionAfterSnapshotItem> = [];
    let maybeSnapshot: DocumentSnapshotItem | null = null;

    for await (const item of DocumentsTable.query(context, {
        partitionKey: {
            partitionType: "Document",
            documentId: id,
        },
        startSortKey: {
            sortRangeType: "Attributes",
        },
        endSortKey: {
            sortRangeType: "Snapshot",
        },
        limit: "All",
        // NOTE(calebmer): An optimization may be to do a strong read on the
        // `Attributes` item and if it disagrees with our eventually consistent
        // read then do a strongly consistent read of missing steps. That way the
        // entire query doesn't need to be strongly consistent.
        consistency,
    })) {
        switch (item.sortRangeType) {
            case "Attributes":
                attributes = item;
                break;
            case "StepTransactionsAfterSnapshot":
                stepTransactionsAfterSnapshot.push(item);
                break;
            case "Snapshot":
                maybeSnapshot = item;
                break;
            default:
                throw exhaustive(item);
        }
    }

    if (attributes === null) {
        assert(
            !maybeSnapshot && stepTransactionsAfterSnapshot.length === 0,
            "Document with no attributes should not have snapshot",
        );
        return null;
    }

    await authorizeSpaceAccess(context, attributes.spaceId);

    if (!maybeSnapshot)
        throw new DataLossError("Document with attributes should also have a snapshot");
    const snapshot = maybeSnapshot;

    if (snapshot.version > attributes.version)
        throw new DataLossError("Document snapshot version is ahead of version attribute");

    // If we have some steps before the snapshot in
    // `stepTransactionsAfterSnapshot`, that's fine. We may be in the middle of
    // moving steps into the `StepTransactionsBeforeSnapshot` sort range.
    //
    // Drop any steps before the snapshot.
    stepTransactionsAfterSnapshot = stepTransactionsAfterSnapshot.filter(stepTransaction => {
        if (stepTransaction.startVersion < snapshot.version) {
            // We assume step transactions are applied to the snapshot atomically. We don't
            // support some steps in a transaction being before the snapshot and some steps
            // in a transaction being after the snapshot. It's all or nothing for now.
            if (stepTransaction.startVersion + stepTransaction.steps.length > snapshot.version)
                throw new DataLossError(
                    "Document snapshot version is in the middle of a step transaction",
                );

            return false;
        }

        return true;
    });

    let version = snapshot.version;
    let content = snapshot.content;

    for (const stepTransaction of stepTransactionsAfterSnapshot) {
        if (stepTransaction.startVersion !== version)
            throw new DataLossError(
                "Mismatched document snapshot version and step transaction version",
            );

        for (const step of stepTransaction.steps) {
            const stepResult = step.apply(content);
            if (!stepResult.doc)
                throw new DataLossError(
                    `Step after document snapshot could not be applied: ${stepResult.failed!}`,
                );

            assert(isDocumentContent(stepResult.doc));
            content = stepResult.doc;
        }

        version += stepTransaction.steps.length;
    }

    return {
        attributes,
        stepTransactionsAfterSnapshot,
        snapshot,
        version,
        content,
    };
}

/**
 * Get the full document with the provided id.
 */
export async function getDocument(
    context: ServerActionContext,
    documentId: DocumentId,
): Promise<DocumentModel> {
    return (await getDocumentAndCommentThreads(context, {documentId, commentThreadIds: []}))
        .document;
}

/**
 * Get the document with the provided id and all the requested comment threads.
 *
 * The returned document model includes all referenced comment threads already,
 * so if you request any archived comment threads they are returned out of band
 * in the `archivedCommentThreadById` map.
 */
export async function getDocumentAndCommentThreads(
    context: ServerActionContext,
    {
        documentId,
        commentThreadIds: _requestedCommentThreadIds,
        spaceIdPromiseResolver,
    }: {
        documentId: DocumentId;
        // Allow `commentThreadIds` to be a promise so we can execute document loading
        // in parallel with code that loads which `commentThreadIds`.
        commentThreadIds:
            | Iterable<DocumentCommentThreadId>
            | Promise<Iterable<DocumentCommentThreadId>>;
        // If you pass this in, we will resolve the promise once we load the `SpaceId`
        // for the document.
        spaceIdPromiseResolver?: PromiseResolver<SpaceId>;
    },
): Promise<{
    document: DocumentModel;
    commentThreads: Array<DocumentCommentThreadModel>;
}> {
    try {
        let _attributes: DocumentAttributesItem | null = null;
        let stepTransactionsAfterSnapshot: Array<DocumentStepTransactionAfterSnapshotItem> = [];
        let maybeSnapshot: DocumentSnapshotItem | null = null;
        const staleReferencedCommentThreadById = new Map<
            DocumentCommentThreadId,
            DocumentReferencedCommentThreadItem
        >();

        for await (const item of DocumentsTable.query(context, {
            partitionKey: {
                partitionType: "Document",
                documentId,
            },
            startSortKey: {
                sortRangeType: "Attributes",
            },
            endSortKey: {
                sortRangeType: "ReferencedCommentThread",
                commentThreadId: getMaxId<DocumentCommentThreadId>(),
            },
            limit: "All",
        })) {
            switch (item.sortRangeType) {
                case "Attributes":
                    _attributes = item;
                    spaceIdPromiseResolver?.resolve(item.spaceId);
                    break;
                case "StepTransactionsAfterSnapshot":
                    stepTransactionsAfterSnapshot.push(item);
                    break;
                case "Snapshot":
                    maybeSnapshot = item;
                    break;
                case "ReferencedCommentThread":
                    staleReferencedCommentThreadById.set(item.commentThreadId, item);
                    break;
                default:
                    throw exhaustive(item);
            }
        }

        if (_attributes === null) {
            assert(
                !maybeSnapshot &&
                    stepTransactionsAfterSnapshot.length === 0 &&
                    staleReferencedCommentThreadById.size === 0,
                "Document with no attributes should not have snapshot",
            );
            throw new NotFoundError("Document not found");
        }
        const attributes = _attributes;

        await authorizeSpaceAccess(context, attributes.spaceId);

        if (!maybeSnapshot)
            throw new DataLossError("Document with attributes should also have a snapshot");
        const snapshot = maybeSnapshot;

        if (snapshot.version > attributes.version)
            throw new DataLossError("Document snapshot version is ahead of version attribute");

        // If we have some steps before the snapshot in
        // `stepTransactionsAfterSnapshot`, that's fine. We may be in the middle of
        // moving steps into the `StepTransactionsBeforeSnapshot` sort range.
        //
        // Drop any steps before the snapshot.
        stepTransactionsAfterSnapshot = stepTransactionsAfterSnapshot.filter(stepTransaction => {
            if (stepTransaction.startVersion < snapshot.version) {
                // We assume step transactions are applied to the snapshot atomically. We don't
                // support some steps in a transaction being before the snapshot and some steps
                // in a transaction being after the snapshot. It's all or nothing for now.
                if (stepTransaction.startVersion + stepTransaction.steps.length > snapshot.version)
                    throw new DataLossError(
                        "Document snapshot version is in the middle of a step transaction",
                    );

                return false;
            }

            return true;
        });

        let version = snapshot.version;
        let content = snapshot.content;

        for (const stepTransaction of stepTransactionsAfterSnapshot) {
            if (stepTransaction.startVersion !== version)
                throw new DataLossError(
                    "Mismatched document snapshot version and step transaction version",
                );

            for (const step of stepTransaction.steps) {
                const stepResult = step.apply(content);
                if (!stepResult.doc)
                    throw new DataLossError(
                        `Step after document snapshot could not be applied: ${stepResult.failed!}`,
                    );

                assert(isDocumentContent(stepResult.doc));
                content = stepResult.doc;
            }

            version += stepTransaction.steps.length;
        }

        const referencedCommentThreadIds = getReferencedDocumentCommentThreadIds(content);

        const getCommentThread = async (
            commentThreadId: DocumentCommentThreadId,
        ): Promise<[DocumentCommentThreadId, DocumentCommentThreadModel] | null> => {
            const commentThread =
                staleReferencedCommentThreadById.get(commentThreadId) ??
                // If our query didn't find the comment thread, it must be because our snapshot
                // update process hasn't moved it from the archive range back into the
                // referenced range. Try reading it from the archive range. Eventually the
                // comment thread should be in our referenced range.
                (await getDocumentCommentThreadItemIfExists(context, {
                    documentId,
                    commentThreadId,
                    // Try reading from the archive range first because we already queried the
                    // entire referenced comment thread range.
                    shouldTryArchiveFirst: true,
                }));

            if (!commentThread) return null;

            return [
                commentThread.commentThreadId,
                await createDocumentCommentThreadModelFromItem(
                    context,
                    attributes.spaceId,
                    commentThread,
                ),
            ];
        };

        const [
            contentReferences,
            referencedCommentThreadById,
            {requestedCommentThreadIds, archivedCommentThreadById},
        ] = await runAllPromises([
            getContentReferencesForNode(context, attributes.spaceId, content),
            runAllPromises(mapIterable(referencedCommentThreadIds, getCommentThread)).then(
                commentThreadById => new Map(filterIterable(commentThreadById, isNonNullable)),
            ),
            (async () => {
                const requestedCommentThreadIds = await _requestedCommentThreadIds;

                // All the requested comment threads that aren't part of the referenced comment
                // thread set we're already loading.
                const archivedCommentThreadIds = new Set(
                    filterIterable(
                        requestedCommentThreadIds,
                        commentThreadId => !referencedCommentThreadIds.has(commentThreadId),
                    ),
                );

                const archivedCommentThreadById = await runAllPromises(
                    mapIterable(archivedCommentThreadIds, getCommentThread),
                ).then(
                    commentThreadById => new Map(filterIterable(commentThreadById, isNonNullable)),
                );

                return {
                    requestedCommentThreadIds,
                    archivedCommentThreadById,
                };
            })(),
        ]);

        const requestedCommentThreads: Array<DocumentCommentThreadModel> = [];

        // Double check that all the comment threads that were requested are returned
        // in one of our two comment thread maps.
        for (const requestedCommentThreadId of requestedCommentThreadIds) {
            const commentThread =
                referencedCommentThreadById.get(requestedCommentThreadId) ??
                archivedCommentThreadById.get(requestedCommentThreadId);

            if (!commentThread) {
                throw new NotFoundError("Comment thread does not exist");
            }

            requestedCommentThreads.push(commentThread);
        }

        return {
            document: new DocumentModel({
                id: documentId,
                createdTime: attributes.createdTime,
                spaceId: attributes.spaceId,
                version: attributes.version,
                content: {
                    doc: content,
                    references: {
                        ...contentReferences,
                        commentThreadById: referencedCommentThreadById,
                    },
                },
            }),
            commentThreads: requestedCommentThreads,
        };
    } catch (error) {
        spaceIdPromiseResolver?.reject(error);
        throw error;
    }
}

/**
 * Get only the document's title. Very fast since this does not load the
 * document's full content.
 */
export async function getDocumentTitle(
    context: ServerActionContext,
    documentId: DocumentId,
    options?: {consistency?: DynamoReadConsistency},
): Promise<string> {
    const documentPreview = await getDocumentPreview(context, documentId, options);
    return documentPreview.getTitle();
}

/**
 * Get only the document's content. Does not load any references or comment
 * threads or anything else needed to construct a full `DocumentModel`.
 */
export async function getDocumentContent(
    context: ServerActionContext,
    documentId: DocumentId,
    options?: {consistency?: DynamoReadConsistency},
): Promise<DocumentContent> {
    const internalDocument = await getInternalDocumentIfExists(context, documentId, options);
    if (!internalDocument) throw new NotFoundError("Document not found");
    return internalDocument.content;
}

/**
 * Find all the `DocumentCommentThreadId`s currently referenced in the
 * provided `DocumentContent`.
 */
function getReferencedDocumentCommentThreadIds(content: Node): Set<DocumentCommentThreadId> {
    const commentThreadIds = new Set<DocumentCommentThreadId>();

    visitProsemirrorNode(content, {
        visitMark: mark => {
            if (mark.type.name === "comment") {
                commentThreadIds.add(assertId<DocumentCommentThreadId>(mark.attrs.commentThreadId));
            }
        },
    });

    return commentThreadIds;
}

async function createDocumentCommentThreadModelFromItem(
    context: ServerActionContext,
    spaceId: SpaceId,
    item: DocumentReferencedCommentThreadItem | DocumentArchivedCommentThreadItem,
) {
    const commentAuthors = await runAllPromises(
        mapIterable(item.commentsSummary.commentCountByAuthorId.keys(), accountId =>
            getAccount(context, spaceId, accountId),
        ),
    );

    return new DocumentCommentThreadModel({
        id: item.commentThreadId,
        documentId: item.documentId,
        createdTime: item.createdTime,
        commentCount: reduceIterable(
            item.commentsSummary.commentCountByAuthorId.values(),
            (commentCount, authorCommentCount) => commentCount + authorCommentCount,
            0,
        ),
        lastCommentChangeTime: item.commentsSummary.lastChangeTime,
        commentAuthors,
    });
}

/**
 * Get many comment threads in a document at once.
 *
 * This is not the most efficient of functions. We need to load each comment
 * thread separately. Use it sparingly.
 */
export async function batchGetDocumentCommentThreadsIfExists(
    context: ServerActionContext,
    {
        documentId,
        commentThreadIds,
    }: {
        documentId: DocumentId;
        commentThreadIds: Iterable<DocumentCommentThreadId>;
    },
): Promise<Array<DocumentCommentThreadModel | null>> {
    const {spaceId} = await authorizeDocumentAccess(context, documentId);

    const commentThreadItems = await runAllPromises(
        mapIterable(commentThreadIds, async commentThreadId => {
            const commentThreadItem = await getDocumentCommentThreadItemIfExists(context, {
                documentId,
                commentThreadId,
            });
            if (!commentThreadItem) return null;

            return createDocumentCommentThreadModelFromItem(context, spaceId, commentThreadItem);
        }),
    );

    return commentThreadItems;
}

/**
 * How long before we removed document content from our cache. This is a
 * debounce timer. Whenever a user updates the document, we cancel any pending
 * timer and start a new one with this expiration time. So if the user is
 * continuously editing then we keep the content cached the entire time.
 */
export const documentContentCacheEvictionTimeoutMs = 1000 * 60 * 5;

/**
 * We have an in-memory cache for document content that we use ONLY when
 * updating document content.
 *
 * (We only use this cache for updates since it makes the cache easier to
 * reason about.)
 *
 * Document content updates happen many times per second so it's important that
 * document content updates are fast. This cache allows us to avoid reading
 * document content from the database when we update it. If the document
 * content is in-memory we can read it from this cache.
 *
 * When we read a document from the cache, we double check with the database
 * to make sure the cached content version is equal to the content version in
 * the database. If there is another process updating our document content then
 * the cache may not be up-to-date!
 */
export class DocumentContentCacheForUpdate {
    private readonly _entries = new DocumentContentCacheForUpdateEntries();

    public async getAndCacheDocument(
        context: ServerActionContext,
        id: DocumentId,
    ): Promise<{
        readonly createdTime: Date;
        readonly spaceId: SpaceId;
        readonly ownerId: AccountId | null;
        readonly version: number;
        readonly content: DocumentContent;

        /**
         * Steps after the snapshot the content was loaded at.
         *
         * Some of these steps may be before the current document snapshot if the
         * document snapshot was updated after our cache loaded the document.
         */
        readonly stepsAfterInitialSnapshot: PushOnlyArraySlice<{
            readonly step: Step;
            readonly invertedStep: Step;
            readonly clientId: ContentEditorClientId;
        }>;

        /**
         * Update the cache with the provided content object and steps. We do not
         * validate that the new content or steps are correct and trust the caller to
         * do that!
         */
        updateCache(options: {
            newContent: DocumentContent;
            newSteps: ReadonlyArray<Step>;
            newInvertedSteps: ReadonlyArray<Step>;
            clientId: ContentEditorClientId;
        }): Promise<void>;
    } | null> {
        let wasEntryCached = true;

        const nullableEntry = await this._entries.getOrSetEntry(id, async () => {
            wasEntryCached = false;

            const internalDocument = await getInternalDocumentIfExists(context, id);
            if (!internalDocument) return null;

            return {
                createdTime: internalDocument.attributes.createdTime,
                spaceId: internalDocument.attributes.spaceId,
                ownerId: internalDocument.attributes.ownerId,
                version: internalDocument.version,
                content: internalDocument.content,
                stepsAfterInitialSnapshot: new PushOnlyArray(
                    flatMapIterable(
                        internalDocument.stepTransactionsAfterSnapshot,
                        ({steps, invertedSteps, clientId}) => {
                            return mapIterable(steps, (step, i) => {
                                const invertedStep = invertedSteps[i];
                                if (!invertedStep)
                                    throw new DataLossError("Missing inverted document step");

                                return {step, invertedStep, clientId};
                            });
                        },
                    ),
                ),
            };
        });

        if (!nullableEntry) return null;
        let entry = nullableEntry;

        // If our content was already cached, then we want to verify that the cached
        // content version is the same as the content version in the database.
        //
        // Another process may have written to the database in which case the cache in
        // this process wouldn't know. If another process wrote to the database we
        // can't use our cached entry so should update our cache appropriately.
        if (wasEntryCached) {
            let _attributes = await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                documentId: id,
                sortRangeType: "Attributes",
            });

            // The document was deleted from the database but not our cache.
            if (!_attributes) {
                this._entries.evictEntry(id);
                return null;
            }

            if (entry.version > _attributes.version) {
                // If we read a past version of the document that might be because we're using
                // DynamoDB eventual consistency and we can't yet read the latest write. So try
                // to load the document one more time but with strong consistency instead.
                _attributes = await DocumentsTable.getItemIfExists(
                    context,
                    {
                        partitionType: "Document",
                        documentId: id,
                        sortRangeType: "Attributes",
                    },
                    {consistency: "Strong"},
                );

                // The document was deleted from the database but not our cache.
                if (!_attributes) {
                    this._entries.evictEntry(id);
                    return null;
                }

                if (entry.version > _attributes.version) {
                    throw new InternalError(
                        "We've cached document content that has a version number ahead of what's in the database",
                    );
                }
            }

            // `const` reference so TypeScript doesn't think this is nullable.
            const attributes = _attributes;

            // If the version in our cache is less than what's in the database, then let's
            // load the steps we are missing and apply them to our content.
            if (entry.version < attributes.version) {
                const nullableEntry = await this._entries.updateEntry(id, async entry => {
                    if (!entry) return null;

                    // A concurrent updater may have moved our entry version all the way
                    // forward already.
                    if (entry.version >= attributes.version) return entry;

                    const steps = await getDocumentStepsBetweenValidatedVersionRange(context, {
                        id,
                        startVersion: entry.version,
                        endVersion: attributes.version,
                    });

                    let content = entry.content;

                    for (const step of steps) {
                        const stepResult = step.step.apply(content);
                        if (!stepResult.doc)
                            throw new DataLossError(
                                `Step after document snapshot could not be applied: ${stepResult.failed!}`,
                            );

                        assert(isDocumentContent(stepResult.doc));
                        content = stepResult.doc;

                        entry.stepsAfterInitialSnapshot.push(step);
                    }

                    return {
                        createdTime: entry.createdTime,
                        spaceId: entry.spaceId,
                        ownerId: entry.ownerId,
                        version: attributes.version,
                        content,
                        stepsAfterInitialSnapshot: entry.stepsAfterInitialSnapshot,
                    };
                });

                if (!nullableEntry) return null;
                entry = nullableEntry;
            }
        }

        return {
            createdTime: entry.createdTime,
            spaceId: entry.spaceId,
            ownerId: entry.ownerId,
            version: entry.version,
            content: entry.content,
            // Create a slice of `stepsAfterInitialSnapshot` so that when we mutate the
            // array from within this function, other code with a reference to the array
            // won't see the new values.
            stepsAfterInitialSnapshot: entry.stepsAfterInitialSnapshot.slice(),

            updateCache: async ({newContent, newSteps, newInvertedSteps, clientId}) => {
                const updatedEntry = entry;

                await this._entries.updateEntry(id, async entry => {
                    if (!entry) return null;

                    if (entry.version !== updatedEntry.version) return entry;

                    for (let i = 0; i < newSteps.length; i++) {
                        const step = newSteps[i]!;
                        const invertedStep = newInvertedSteps[i];
                        assert(invertedStep);
                        entry.stepsAfterInitialSnapshot.push({step, invertedStep, clientId});
                    }

                    return {
                        createdTime: entry.createdTime,
                        spaceId: entry.spaceId,
                        ownerId: entry.ownerId,
                        version: entry.version + newSteps.length,
                        content: newContent,
                        stepsAfterInitialSnapshot: entry.stepsAfterInitialSnapshot,
                    };
                });
            },
        };
    }
}

type DocumentContentCacheForUpdateEntry = {
    readonly createdTime: Date;
    readonly spaceId: SpaceId;
    readonly ownerId: AccountId | null;
    readonly version: number;
    readonly content: DocumentContent;
    /**
     * Steps after the snapshot the content was loaded at.
     *
     * Every new step applied to the document content will be pushed to this array.
     *
     * We never remove steps from this array which is why the name specifies
     * "initial snapshot". The snapshot may be different from when we loaded this
     * content but we won't evict steps from this list.
     *
     * By only pushing to this array it also means we can efficiently create
     * immutable slices in O(1) time instead of an O(n) time clone.
     */
    readonly stepsAfterInitialSnapshot: PushOnlyArray<{
        readonly step: Step;
        readonly invertedStep: Step;
        readonly clientId: ContentEditorClientId;
    }>;
};

type ReadonlyDocumentContentCacheForUpdateEntry = Replace<
    DocumentContentCacheForUpdateEntry,
    {
        readonly stepsAfterInitialSnapshot: PushOnlyArraySlice<{
            readonly step: Step;
            readonly invertedStep: Step;
            readonly clientId: ContentEditorClientId;
        }>;
    }
>;

/**
 * Small helper for managing `DocumentContentCacheForUpdate` that handles
 * cache eviction.
 *
 * You shouldn't have to worry about cache eviction outside of this class.
 */
class DocumentContentCacheForUpdateEntries {
    private readonly _entryByDocumentId = new Map<
        DocumentId,
        {
            evictionTimeout: Timeout;
            evict: () => void;
            promise: Promise<DocumentContentCacheForUpdateEntry | null>;
        }
    >();

    constructor() {
        // In our test environment, add a hook to evict all cached content at the end
        // of every test. That way we don't have timeouts sitting around and firing
        // randomly.
        if (import.meta.jest) {
            afterEach(() => {
                for (const entry of this._entryByDocumentId.values()) {
                    entry.evict();
                }
            });
        }
    }

    /**
     * Either get an existing entry for the provided document id or set an entry
     * using the provided function.
     */
    public getOrSetEntry(
        id: DocumentId,
        getData: () => Promise<DocumentContentCacheForUpdateEntry | null>,
    ): Promise<ReadonlyDocumentContentCacheForUpdateEntry | null> {
        const entry = this._entryByDocumentId.get(id);
        if (!entry) return this.updateEntry(id, getData);

        return entry.promise.then(entry => {
            if (!entry) return null;
            return {
                ...entry,
                // Create a slice of `stepsAfterInitialSnapshot` so that when we mutate the
                // array from within this function, other code with a reference to the array
                // won't see the new values.
                //
                // You can only push new values in the update callback.
                stepsAfterInitialSnapshot: entry.stepsAfterInitialSnapshot.slice(),
            };
        });
    }

    /**
     * Set the entry in our map for the provided id. If there is already an entry
     * for the provided id then we will evict that entry. Calling this method will
     * start an eviction timer at which point the entry you added will be evicted
     * from the cache.
     *
     * The update callback is queued behind previous concurrent updates.
     */
    public updateEntry(
        id: DocumentId,
        update: (
            entry: DocumentContentCacheForUpdateEntry | null,
        ) => Promise<DocumentContentCacheForUpdateEntry | null>,
    ): Promise<ReadonlyDocumentContentCacheForUpdateEntry | null> {
        // Evict the last entry before setting the new entry.
        const lastEntry = this._entryByDocumentId.get(id);
        lastEntry?.evict();

        const evict = () => {
            // If our entry was already evicted then don't evict it again.
            if (this._entryByDocumentId.get(id) !== nextEntry) return;

            nextEntry.evictionTimeout.clear();
            this._entryByDocumentId.delete(id);
        };

        const evictionTimeout = createTimeout(() => {
            evict();
        }, documentContentCacheEvictionTimeoutMs);

        const nextEntry = {
            evictionTimeout,
            evict,
            promise: (lastEntry?.promise ?? Promise.resolve(null)).then(update).then(
                data => {
                    // Immediately evict if the document doesn't exist.
                    if (data === null) evict();
                    return data;
                },
                error => {
                    // Immediately evict if we failed to get the data.
                    evict();
                    throw error;
                },
            ),
        };
        this._entryByDocumentId.set(id, nextEntry);

        return nextEntry.promise.then(entry => {
            if (!entry) return null;
            return {
                ...entry,
                // Create a slice of `stepsAfterInitialSnapshot` so that when we mutate the
                // array from within this function, other code with a reference to the array
                // won't see the new values.
                //
                // You can only push new values in the update callback.
                stepsAfterInitialSnapshot: entry.stepsAfterInitialSnapshot.slice(),
            };
        });
    }

    /**
     * Evict the entry for the provided id. noop if the entry doesn't exist.
     */
    public evictEntry(id: DocumentId) {
        this._entryByDocumentId.get(id)?.evict();
    }
}

/**
 * Small helper which allows us to create a slice of an append-only array
 * without cloning the array. A naive implementation of the native
 * `Array.slice()` method will clone the entire array.
 */
class PushOnlyArray<Item> implements Iterable<Item> {
    private readonly _array: Array<Item>;

    constructor(iterable: Iterable<Item>) {
        // Create a new array so we can make sure nothing else can mutate
        // the array.
        this._array = Array.from(iterable);
    }

    public get length(): number {
        return this._array.length;
    }

    public get(index: number): Item | undefined {
        return this._array[index];
    }

    public push(item: Item): void {
        this._array.push(item);
    }

    public slice(start: number = 0, end: number = this.length): PushOnlyArraySlice<Item> {
        return new PushOnlyArraySlice(this, start, end);
    }

    public *[Symbol.iterator](): Iterator<Item> {
        // Cache length so if an item is appended it won't appear in this iterator.
        const length = this._array.length;
        for (let i = 0; i < length; i++) yield this._array[i]!;
    }
}

class PushOnlyArraySlice<Item> implements Iterable<Item> {
    private readonly _array: PushOnlyArray<Item>;
    private readonly _start: number;
    private readonly _end: number;

    constructor(array: PushOnlyArray<Item>, start: number, end: number) {
        this._array = array;
        this._start = clamp(0, Math.floor(start), array.length);
        this._end = clamp(this._start, Math.floor(end), array.length);
    }

    public get length() {
        return this._end - this._start;
    }

    public slice(start: number = 0, end: number = this.length): PushOnlyArraySlice<Item> {
        return new PushOnlyArraySlice(
            this._array,
            this._start + clamp(0, start, this.length),
            this._start + clamp(0, end, this.length),
        );
    }

    public *[Symbol.iterator](): Iterator<Item> {
        for (let i = this._start; i < this._end; i++) yield this._array.get(i)!;
    }
}

const globalDocumentContentCacheForUpdate = new DocumentContentCacheForUpdate();

export const updateDocumentContentBeforeExecuteTransactionTestCheckpoint = new TestCheckpoint<{
    id: DocumentId;
    clientId: ContentEditorClientId;
}>();

/**
 * Updates our document by applying some steps.
 *
 * The version number must be less than or equal to the current document
 * version. If the version is less than we will rebase the steps you provided
 * against the new document steps.
 *
 * ### Comments
 *
 * You may use this method to atomically create a comment thread along with
 * updating the document's content. You will do this by adding a `comment` mark
 * to some text and creating a comment thread with the same
 * `DocumentCommentThreadId` as what is in your mark.
 *
 * You MAY NOT create a comment thread (with the `createCommentThread` option)
 * if the comment thread is not somehow represented in the update steps.
 *
 * You MAY use the `comment` mark in steps with a comment thread that was
 * previously created (maybe you are copy/pasting or undoing a change).
 *
 * We do not validate that `comment` marks you use correspond to a comment
 * thread in the database. To do this we'd have to fetch all referenced comment
 * threads in your steps which could get expensive if you were pasting a large
 * amount of content.
 *
 * ### Performance
 *
 * This function will be called a lot while a user is updating a document. So
 * we've tried to carefully optimize this function to have O(steps) performance
 * and not O(contentSize) performance.
 *
 * We do this by:
 *
 * - Caching the current content in memory so we don't need to load it from the
 *   database on every update.
 * - Only saving the full content back to the database every 20-100 steps. For
 *   the majority of updates we only save the steps.
 */
export async function updateDocumentContent(
    context: Context<
        ServerSessionActionContextModules & {
            notifications: NotificationsContextModuleBase;
        }
    >,
    {
        id,
        version: clientVersion,
        steps: clientSteps,
        clientId,
        createCommentThreads = [],
        cacheOverrideForTest,
    }: {
        id: DocumentId;
        version: number;
        steps: ReadonlyArray<Step>;
        clientId: ContentEditorClientId;
        createCommentThreads?: ReadonlyArray<{
            commentThreadId: DocumentCommentThreadId;
            initialCommentContent: MessageContent;
            /**
             * Optionally allow the caller to specify the time at which we report the
             * thread was created. Used by our document collaboration service to use the
             * optimistic creation time of the comment thread.
             */
            createdTime?: Date;
        }>;
        cacheOverrideForTest?: DocumentContentCacheForUpdate;
    },
): Promise<{
    /**
     * The new version of the document after applying our update.
     *
     * If there are no `conflictingSteps` then this should be
     * `version + steps.length`.
     */
    newVersion: number;
    /**
     * The `steps` array we passed in but transformed with a rebase against
     * `conflictingSteps`.
     *
     * These steps were applied after `conflictingSteps`.
     */
    newSteps: ReadonlyArray<Step>;
    /**
     * The inverted steps of the returned `newSteps`.
     */
    newInvertedSteps: ReadonlyArray<Step>;
    /**
     * If the client passed in a `version` that was not equal to the actual version
     * of the document, then this function will have loaded steps between the
     * client provided `version` and the actual document version and used those
     * steps to rebase the client provided `steps`. The steps between the client
     * `version` and actual version are the conflicting steps and are
     * returned here.
     *
     * Since these steps come from other clients making collaborative edits
     * `clientId` is included.
     */
    conflictingSteps: ReadonlyArray<{step: Step; clientId: ContentEditorClientId}>;
}> {
    const result = await context.dynamo.retryTransaction(async context => {
        if (!Number.isSafeInteger(clientVersion) || clientVersion < 0)
            throw new InvalidArgumentError("Expected a positive integer version number");

        // NOTE(calebmer): Do we really need the cache anymore now that we're using
        // Durable Objects for updating documents? For now, probably yes? The Durable
        // Object sends updates to `AppService` so in theory the cache helps persist
        // updates faster. The problem is `AppService` is behind a load balancer so
        // Durable Objects would need [sticky sessions][1] to make sure it goes to the
        // same `AppService` with the right cache. Though who knows, maybe the cache
        // only helps a marginal amount even when configured properly.
        //
        // [1]: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/sticky-sessions.html
        const cache = cacheOverrideForTest ?? globalDocumentContentCacheForUpdate;
        assert(
            cache === globalDocumentContentCacheForUpdate || import.meta.jest,
            "Can only override the cache in Jest tests",
        );

        const currentTime = new Date();

        if (createCommentThreads.length > 0) {
            const stepCommentThreadIds = new Set<DocumentCommentThreadId>();

            for (const step of clientSteps) {
                visitProsemirrorStep(step, {
                    visitMark: mark => {
                        if (mark.type.name === "comment") {
                            stepCommentThreadIds.add(assertId(mark.attrs.commentThreadId));
                        }
                    },
                });
            }

            for (const createCommentThread of createCommentThreads) {
                if (!stepCommentThreadIds.has(createCommentThread.commentThreadId)) {
                    throw new InvalidArgumentError(
                        "When creating a comment thread the `commentThreadId` must be referenced in document update steps",
                    );
                }

                // `createdTime` shouldn't be wholly inaccurate but allow for some clock drift.
                // In some cases `createdTime` may be set a couple minutes before when
                // optimistically creating comment threads.
                if (
                    createCommentThread.createdTime &&
                    Math.abs(differenceInMinutes(currentTime, createCommentThread.createdTime)) > 20
                ) {
                    throw new InvalidArgumentError(
                        "When creating a comment thread `createdTime` should be within 20 minutes of the current time",
                    );
                }
            }
        }

        const internalDocument = await cache.getAndCacheDocument(context, id);
        if (!internalDocument)
            throw new NotFoundError("Can not update document that doesn't exist");

        // Double check that we can update the document. Another user with access may
        // have cached the document.
        await authorizeSpaceAccess(context, internalDocument.spaceId);

        const {newContent, steps, invertedSteps, conflictingSteps} =
            await getCollaborativelyUpdateContentResult({
                currentVersion: internalDocument.version,
                currentContent: internalDocument.content,
                clientVersion,
                clientSteps,
                getSteps: async (startVersion, endVersion) => {
                    // As an optimization, we assume implementation details about which range of
                    // steps this function is requesting and use our internal data structures to
                    // attempt at efficiently returning a value for this function.
                    assert(startVersion === clientVersion);
                    assert(endVersion === internalDocument.version);

                    // Get the steps that were applied to bring our document from the provided
                    // version to the document's current version.
                    //
                    // If we're lucky then the version we're trying to update is after our snapshot
                    // so we've already loaded all the steps after the snapshot. Otherwise we need
                    // to read new steps.
                    if (
                        clientVersion >=
                        internalDocument.version - internalDocument.stepsAfterInitialSnapshot.length
                    ) {
                        const stepCount = internalDocument.version - clientVersion;

                        return Array.from(
                            internalDocument.stepsAfterInitialSnapshot.slice(
                                internalDocument.stepsAfterInitialSnapshot.length - stepCount,
                            ),
                        );
                    } else {
                        const otherSteps = await getDocumentStepsBetweenValidatedVersionRange(
                            context,
                            {
                                id,
                                startVersion: clientVersion,
                                endVersion:
                                    internalDocument.version -
                                    internalDocument.stepsAfterInitialSnapshot.length,
                            },
                        );

                        return [...otherSteps, ...internalDocument.stepsAfterInitialSnapshot];
                    }
                },
            });

        assert(isDocumentContent(newContent));

        // This checkpoint allows us to write a test against our transaction's
        // condition.
        await updateDocumentContentBeforeExecuteTransactionTestCheckpoint.waitForTest({
            id,
            clientId,
        });

        const transaction: Array<DynamoTransactionEntry> = [];

        if (steps.length > 0) {
            transaction.push(
                DocumentsTable.transactionReplaceItem(
                    {
                        partitionType: "Document",
                        sortRangeType: "Attributes",
                        documentId: id,
                        createdTime: internalDocument.createdTime,
                        spaceId: internalDocument.spaceId,
                        ownerId: internalDocument.ownerId,
                        version: internalDocument.version + steps.length,
                        titleWithoutFallback: getDocumentContentTitleWithoutFallback(newContent),
                    },
                    {
                        condition: {
                            // Make sure a concurrent writer hasn't updated the document version before us.
                            version: internalDocument.version,
                        },
                    },
                ),
                DocumentsTable.transactionCreateOrReplaceItem({
                    partitionType: "Document",
                    documentId: id,
                    sortRangeType: "StepTransactionsAfterSnapshot",
                    startVersion: internalDocument.version,
                    steps,
                    invertedSteps,
                    clientId,
                    createdTime: currentTime,
                }),
            );
        }

        // If we were instructed to create a comment thread then extend our transaction
        // with entries that will atomically create a new comment thread within the
        // transaction.
        //
        // NOTE(calebmer): There is a limit to how many entries you can have in a
        // DynamoDB transaction. Currently it's 100. This means there's a limit on how
        // many comment threads you can create in an `updateDocumentContent()` call.
        // Reasonable clients should send one at a time. If a client is a bit behind it
        // might send multiple. If a client was offline and comes online and syncs
        // changes, that's when we might hit this limit. It may be reasonable to create
        // comment threads asynchronously instead of in the same transaction to get
        // around this limit should we find users hitting it.
        for (const createCommentThread of createCommentThreads) {
            const createdTime = createCommentThread.createdTime ?? currentTime;

            transaction.push(
                DocumentsTable.transactionCreateItem({
                    partitionType: "Document",
                    // Assume the new comment thread is referenced. The snapshot update process will
                    // move it if it's not.
                    sortRangeType: "ReferencedCommentThread",
                    documentId: id,
                    commentThreadId: createCommentThread.commentThreadId,
                    createdTime,
                    commentsSummary: {
                        nextCommentIndex: 1,
                        lastChangeTime: null,
                        commentCountByAuthorId: new Map([[context.actor.getAccountId(), 1]]),
                        mentionCountByAccountId: getMentionCountByAccountIdInContent(
                            createCommentThread.initialCommentContent,
                        ),
                    },
                }),
                // Make sure an archive comment thread item also does not exist.
                DocumentsTable.transactionDoesNotExistConditionCheck({
                    partitionType: "Document",
                    sortRangeType: "ArchivedCommentThread",
                    documentId: id,
                    commentThreadId: createCommentThread.commentThreadId,
                }),
                DocumentsTable.transactionCreateOrReplaceItem({
                    partitionType: "DocumentCommentThread",
                    sortRangeType: "Comments",
                    documentId: id,
                    commentThreadId: createCommentThread.commentThreadId,
                    commentIndex: 0,
                    authorId: context.actor.getAccountId(),
                    createdTime,
                    payload: {
                        type: "Content",
                        parentMessageIndex: null,
                        content: createCommentThread.initialCommentContent,
                        contentUpdatedTime: null,
                    },
                }),
            );
        }

        if (transaction.length > 0) {
            await DynamoTableSchema.executeTransaction(context, transaction);
        }

        if (steps.length > 0) {
            // Update our cache so that the next update from this process doesn't need to
            // read content from the database.
            await internalDocument.updateCache({
                newContent,
                newSteps: steps,
                newInvertedSteps: invertedSteps,
                clientId,
            });
        }

        for (const createCommentThread of createCommentThreads) {
            context.notifications.sendNotificationEvent({
                type: "CreateDocumentComment",
                id: generateId(),
                spaceId: internalDocument.spaceId,
                documentId: id,
                commentThreadId: createCommentThread.commentThreadId,
                commentIndex: 0,
                createdTime: createCommentThread.createdTime ?? currentTime,
                authorId: context.actor.getAccountId(),
                mentionedAccountIds: getMentionedAccountIdsInContent(
                    createCommentThread.initialCommentContent,
                ),
                contentSnippet: getNotificationMessageContentSnippet(
                    createCommentThread.initialCommentContent,
                ),
            });
        }

        return {
            oldVersion: internalDocument.version,
            newVersion: internalDocument.version + steps.length,
            newContent,
            newSteps: steps,
            newInvertedSteps: invertedSteps,
            conflictingSteps,
        };
    });

    const {oldVersion, newVersion, newContent, newSteps, newInvertedSteps, conflictingSteps} =
        result;

    const lastVersionToTriggerSnapshot =
        Math.floor(newVersion / updateDocumentSnapshotAfterStepCount) *
        updateDocumentSnapshotAfterStepCount;

    // Run a snapshot update task about every
    // `updateDocumentSnapshotAfterStepCount` steps.
    if (oldVersion < lastVersionToTriggerSnapshot) {
        context.process.waitUntil(
            updateDocumentSnapshotAfterUpdatingContent(context, {
                id,
                newVersion,
                newContent,
            }),
        );
    }

    return {
        newVersion,
        newSteps,
        newInvertedSteps,
        conflictingSteps,
    };
}

/**
 * The number of steps between document content snapshots.
 *
 * This isn't the exact number of steps between document content snapshots
 * because we may update the document with more than one step at a time. If we
 * update the document with, say, 10 steps then all 10 new steps will be
 * included in the snapshot regardless of whether we only needed 1 more step
 * for the next snapshot. The next snapshot will also then include fewer steps
 * if we included some extra steps in a given snapshot.
 */
const updateDocumentSnapshotAfterStepCount = 100;

export const updateDocumentSnapshotBeforeDeletingStepsTestCheckpoint =
    new TestCheckpoint<DocumentId>();

export const updateDocumentSnapshotBeforeMovingCommentThreadTestCheckpoint =
    new TestCheckpoint<DocumentId>();

async function updateDocumentSnapshotAfterUpdatingContent(
    context: DynamoContext,
    {
        id,
        newVersion,
        newContent,
    }: {
        id: DocumentId;
        newVersion: number;
        newContent: DocumentContent;
    },
) {
    await context.tracer.withSpan("Update document snapshot", async (context, span) => {
        span.addPropagatedData({context: {documentId: id}});

        const snapshot = await DocumentsTable.getPartialItemIfExists(
            context,
            {
                partitionType: "Document",
                documentId: id,
                sortRangeType: "Snapshot",
            },
            {
                attributes: ["version"],
            },
        );

        // If there is no snapshot, maybe the document was deleted? Ignore. When we try
        // to read the document there will be an error then.
        if (!snapshot) return;

        try {
            // First, update the snapshot. We can't start moving steps until we know the
            // snapshot has successfully updated.
            await DocumentsTable.replaceItem(
                context,
                {
                    partitionType: "Document",
                    documentId: id,
                    sortRangeType: "Snapshot",
                    version: newVersion,
                    content: newContent,
                },
                {
                    condition: {
                        version: snapshot.version,
                    },
                },
            );
        } catch (error) {
            // If some other process concurrently updated the snapshot, then we don't need
            // two processes updating the snapshot at once so we can bail out.
            if (isDynamoConditionCheckError(error)) return;
            throw error;
        }

        await runAllPromises([
            // Move steps from the `StepTransactionsBeforeSnapshot` range to the
            // `StepTransactionsAfterSnapshot` range. So we don't query unnecessary steps
            // when loading our document.
            context.tracer.withSpan("Moving step transactions", async context => {
                // Then, for all steps before our new snapshot version, move them into the
                // `StepTransactionsBeforeSnapshot` range so in the future when we read the
                // full document we don't read those steps.
                const stepTransactions = await arrayFromAsyncIterable(
                    DocumentsTable.query(context, {
                        partitionKey: {
                            partitionType: "Document",
                            documentId: id,
                        },
                        startSortKey: {
                            sortRangeType: "StepTransactionsAfterSnapshot",
                            startVersion: 0,
                        },
                        endSortKey: {
                            sortRangeType: "StepTransactionsAfterSnapshot",
                            startVersion: newVersion - 1,
                        },
                        limit: "All",
                    }),
                );

                // Our writes should be batched under the hood if we dispatch them
                // in parallel like this.
                await runAllPromises(
                    stepTransactions.map(async stepTransaction => {
                        await DocumentsTable.createOrReplaceItem(context, {
                            ...stepTransaction,
                            sortRangeType: "StepTransactionsBeforeSnapshot",
                        });

                        await updateDocumentSnapshotBeforeDeletingStepsTestCheckpoint.waitForTest(
                            id,
                        );

                        // It's important that we wait for our put in the
                        // `StepTransactionsBeforeSnapshot` to successfully complete before we delete.
                        await DocumentsTable.deleteItemWithKeyIfExists(context, stepTransaction);
                    }),
                );
            }),

            // Archive comment threads that are no longer referenced in the document so we
            // don't query them when loading our document.
            context.tracer.withSpan("Reconciling referenced comment threads", async () => {
                const actualReferencedCommentThreadIds =
                    getReferencedDocumentCommentThreadIds(newContent);

                const expectedReferencedCommentThreadItems = await arrayFromAsyncIterable(
                    DocumentsTable.query(context, {
                        partitionKey: {
                            partitionType: "Document",
                            documentId: id,
                        },
                        startSortKey: {
                            sortRangeType: "ReferencedCommentThread",
                            commentThreadId: getMinId<DocumentCommentThreadId>(),
                        },
                        endSortKey: {
                            sortRangeType: "ReferencedCommentThread",
                            commentThreadId: getMaxId<DocumentCommentThreadId>(),
                        },
                        limit: "All",
                    }),
                );

                const expectedReferencedCommentThreadIds = new Set(
                    expectedReferencedCommentThreadItems.map(
                        ({commentThreadId}) => commentThreadId,
                    ),
                );

                await runAllPromises([
                    // Move from `ReferencedCommentThread` to `ArchivedCommentThread`:
                    ...mapIterable(
                        expectedReferencedCommentThreadItems,
                        async expectedReferencedCommentThreadItem => {
                            // Yay! This comment thread is actually referenced in the document. Otherwise we
                            // need to archive the comment thread.
                            if (
                                actualReferencedCommentThreadIds.has(
                                    expectedReferencedCommentThreadItem.commentThreadId,
                                )
                            ) {
                                return;
                            }

                            let hasAttempted = false;

                            await context.dynamo.retryTransaction(async context => {
                                const isInitialAttempt = !hasAttempted;
                                hasAttempted = true;

                                // If we are retrying then load the latest comment thread item. We are probably
                                // retrying because the update lock version was changed.
                                const referencedCommentThreadItem = isInitialAttempt
                                    ? expectedReferencedCommentThreadItem
                                    : await DocumentsTable.getItemIfExists(
                                          context,
                                          expectedReferencedCommentThreadItem,
                                      );

                                // If we can't find the referenced comment thread when retrying then a
                                // concurrent writer probably moved it.
                                if (!referencedCommentThreadItem) return;

                                await updateDocumentSnapshotBeforeMovingCommentThreadTestCheckpoint.waitForTest(
                                    id,
                                );

                                // We move the comment thread in a transaction so only one version of the item
                                // exists at any given time. Since we need to make updates to the item it would
                                // be weird of two versions of the item exist at once and one has an update
                                // applied. How do we make sure that update is not lost? Or the history
                                // doesn't fork?
                                await DynamoTableSchema.executeTransaction(context, [
                                    DocumentsTable.transactionDeleteItem(
                                        referencedCommentThreadItem,
                                    ),
                                    DocumentsTable.transactionCreateOrReplaceItem({
                                        ...referencedCommentThreadItem,
                                        sortRangeType: "ArchivedCommentThread",
                                    }),
                                ]);
                            });
                        },
                    ),

                    // Move from `ArchivedCommentThread` to `ReferencedCommentThread`:
                    ...mapIterable(
                        actualReferencedCommentThreadIds,
                        async actualReferencedCommentThreadId => {
                            // Yay! This comment thread is in our referenced comment threads sort range. We
                            // don't have to move it from the archived comment threads sort range.
                            if (
                                expectedReferencedCommentThreadIds.has(
                                    actualReferencedCommentThreadId,
                                )
                            ) {
                                return;
                            }

                            await context.dynamo.retryTransaction(async context => {
                                const archivedCommentThreadItem =
                                    await DocumentsTable.getItemIfExists(context, {
                                        partitionType: "Document",
                                        sortRangeType: "ArchivedCommentThread",
                                        documentId: id,
                                        commentThreadId: actualReferencedCommentThreadId,
                                    });

                                // If there is no referenced or archived comment thread item then the comment
                                // thread may have never existed. Or a concurrent writer moved it.
                                if (!archivedCommentThreadItem) return;

                                await updateDocumentSnapshotBeforeMovingCommentThreadTestCheckpoint.waitForTest(
                                    id,
                                );

                                // We move the comment thread in a transaction so only one version of the item
                                // exists at any given time. Since we need to make updates to the item it would
                                // be weird of two versions of the item exist at once and one has an update
                                // applied. How do we make sure that update is not lost? Or the history
                                // doesn't fork?
                                await DynamoTableSchema.executeTransaction(context, [
                                    DocumentsTable.transactionDeleteItem(archivedCommentThreadItem),
                                    DocumentsTable.transactionCreateOrReplaceItem({
                                        ...archivedCommentThreadItem,
                                        sortRangeType: "ReferencedCommentThread",
                                    }),
                                ]);
                            });
                        },
                    ),
                ]);
            }),
        ]);
    });
}

/**
 * Force an update of the document's snapshot in a test environment.
 */
export async function updateDocumentSnapshotForTest(
    context: ServerActionContext,
    documentId: DocumentId,
): Promise<void> {
    assert(import.meta.jest);

    const document = await getInternalDocumentIfExists(context, documentId);
    if (!document) throw new NotFoundError("Document not found");

    await updateDocumentSnapshotAfterUpdatingContent(context, {
        id: documentId,
        newVersion: document.version,
        newContent: document.content,
    });
}

export const getDocumentContentStepsTestCounter = new TestCounter<{
    id: DocumentId;
    startVersion: number;
    endVersion: number;
}>();

/**
 * Reads all steps between `startVersion` (inclusive) and `endVersion` (exclusive).
 */
export async function getDocumentContentSteps(
    context: ServerActionContext,
    {
        id,
        startVersion,
        endVersion,
    }: {
        id: DocumentId;
        startVersion: number;
        endVersion: number;
    },
) {
    const document = await DocumentsTable.getPartialItemIfExists(
        context,
        {partitionType: "Document", documentId: id, sortRangeType: "Attributes"},
        {attributes: ["spaceId", "version"]},
    );

    if (!document) throw new NotFoundError("Document does not exist");

    await authorizeSpaceAccess(context, document.spaceId);

    if (startVersion < 0) throw new InvalidArgumentError("Start version is less than zero");
    if (startVersion > endVersion)
        throw new InvalidArgumentError("End version is greater than start version");
    if (startVersion === endVersion)
        throw new InvalidArgumentError("Start version is equal to end version");
    if (endVersion > document.version)
        throw new FailedPreconditionError(
            "End version is greater than the last version in the document",
        );

    getDocumentContentStepsTestCounter.incrementForTest({id, startVersion, endVersion});

    return getDocumentStepsBetweenValidatedVersionRange(context, {id, startVersion, endVersion});
}

/**
 * Reads all steps between `startVersion` (inclusive) and `endVersion` (exclusive).
 *
 * We assume you have checked that `endVersion` is a version that exists! We
 * will throw a `DataLossError` if we don't find steps up to `endVersion`.
 *
 * We also assert that `versionStart` is less than `endVersion` and
 * `versionStart` is greater than zero.
 *
 * We call this function "for validated version range" because we assume
 * `versionStart` and `endVersion` are valid.
 *
 * We start by looking in the `StepsBeforeSnapshot` range since it has all our
 * historical steps. If we can't find all the steps we need then we check the
 * `StepsAfterSnapshot` range.
 */
async function getDocumentStepsBetweenValidatedVersionRange(
    context: DynamoContext,
    {
        id,
        startVersion,
        endVersion,
    }: {
        id: DocumentId;
        startVersion: number;
        endVersion: number;
    },
): Promise<Array<{step: Step; invertedStep: Step; clientId: ContentEditorClientId}>> {
    const stepByVersion = new Map<
        number,
        {step: Step; invertedStep: Step; clientId: ContentEditorClientId}
    >();

    for await (const stepTransaction of getDocumentStepTransactionsBetweenValidatedVersionRange(
        context,
        {
            id,
            startVersion,
            endVersion,
        },
    )) {
        for (let i = 0; i < stepTransaction.steps.length; i++) {
            const version = stepTransaction.startVersion + i;
            const step = stepTransaction.steps[i]!;
            const invertedStep = stepTransaction.invertedSteps[i];
            if (!invertedStep) throw new DataLossError("Missing inverted document step");

            // We may get steps outside of the version range because they are in a
            // transaction that intersects with our version range. Don't set those steps to
            // our map.
            if (startVersion <= version && version < endVersion) {
                stepByVersion.set(version, {
                    step,
                    invertedStep,
                    clientId: stepTransaction.clientId,
                });
            }
        }
    }

    const steps = [];

    for (let version = startVersion; version < endVersion; version++) {
        const step = stepByVersion.get(version);
        if (!step) throw new DataLossError("Missing a document step");
        steps.push(step);
    }

    return steps;
}

/**
 * Gets all step transactions between a `startVersion` (inclusive) and an `endVersion`
 * (exclusive).
 *
 * We assume both versions exist in the document and that `startVersion` is
 * less than `endVersion`. If you violate these assumptions you will get
 * `DataLossError`s and `InternalError`s.
 *
 * Returns an async iterator that yields step transactions immediately when we
 * get them in no particular order.
 */
async function* getDocumentStepTransactionsBetweenValidatedVersionRange(
    context: DynamoContext,
    {
        id,
        startVersion,
        endVersion,
    }: {
        id: DocumentId;
        startVersion: number;
        endVersion: number;
    },
): AsyncIterableIterator<DocumentStepTransactionItem> {
    assert(Number.isSafeInteger(startVersion));
    assert(Number.isSafeInteger(endVersion));
    assert(startVersion < endVersion);
    assert(startVersion >= 0);

    const stepTransactionContainingStartVersion =
        await getDocumentStepTransactionContainingValidatedVersion(context, id, startVersion);

    yield stepTransactionContainingStartVersion;

    // If the transaction containing our start version also contains our end
    // version then we're done!
    //
    // As an optimization, we could start the request to get
    // `stepTransactionContainingEndVersion` AFTER this short circuit so that if we
    // only need one transaction we don't need to make the extra requests. However,
    // we expect most of the time when you call this function you need more than
    // one transaction.
    if (
        endVersion <=
        stepTransactionContainingStartVersion.startVersion +
            stepTransactionContainingStartVersion.steps.length
    ) {
        return;
    }

    switch (stepTransactionContainingStartVersion.sortRangeType) {
        // If we start in the after snapshot range then we will also end in the after
        // snapshot range.
        case "StepTransactionsAfterSnapshot": {
            for await (const stepTransaction of DocumentsTable.query(context, {
                partitionKey: {
                    partitionType: "Document",
                    documentId: id,
                },
                startSortKey: {
                    sortRangeType: "StepTransactionsAfterSnapshot",
                    startVersion:
                        stepTransactionContainingStartVersion.startVersion +
                        stepTransactionContainingStartVersion.steps.length,
                },
                endSortKey: {
                    sortRangeType: "StepTransactionsAfterSnapshot",
                    startVersion: endVersion - 1,
                },
                limit: "All",
            })) {
                yield stepTransaction;
            }
            return;
        }
        // If we start in the before snapshot range then we might not have all the
        // steps we need in the before snapshot range. So query the before snapshot
        // range and then determine if we also need to query the after snapshot range.
        case "StepTransactionsBeforeSnapshot": {
            const stepTransactionBeforeSnapshotIterator = DocumentsTable.query(context, {
                partitionKey: {
                    partitionType: "Document",
                    documentId: id,
                },
                startSortKey: {
                    sortRangeType: "StepTransactionsBeforeSnapshot",
                    startVersion:
                        stepTransactionContainingStartVersion.startVersion +
                        stepTransactionContainingStartVersion.steps.length,
                },
                endSortKey: {
                    sortRangeType: "StepTransactionsBeforeSnapshot",
                    startVersion: endVersion - 1,
                },
                limit: "All",
            });

            let lastStepTransactionBeforeSnapshot = null;

            for await (const stepTransaction of stepTransactionBeforeSnapshotIterator) {
                lastStepTransactionBeforeSnapshot = stepTransaction;
                yield stepTransaction;
            }

            // If the last step transaction we found in the before snapshot range contains
            // the end version then we're done! Otherwise we need to continue querying in
            // the after snapshot range.
            if (
                lastStepTransactionBeforeSnapshot &&
                endVersion <=
                    lastStepTransactionBeforeSnapshot.startVersion +
                        lastStepTransactionBeforeSnapshot.steps.length
            ) {
                return;
            }

            const stepTransactionAfterSnapshotIterator = DocumentsTable.query(context, {
                partitionKey: {
                    partitionType: "Document",
                    documentId: id,
                },
                startSortKey: {
                    sortRangeType: "StepTransactionsAfterSnapshot",
                    startVersion:
                        stepTransactionContainingStartVersion.startVersion +
                        stepTransactionContainingStartVersion.steps.length,
                },
                endSortKey: {
                    sortRangeType: "StepTransactionsAfterSnapshot",
                    startVersion: endVersion - 1,
                },
                limit: "All",
            });

            yield* stepTransactionAfterSnapshotIterator;
            return;
        }
        default:
            throw exhaustive(stepTransactionContainingStartVersion);
    }
}

/**
 * Get the step transaction which contains `version` in the provided document.
 *
 * Throws a `DataLossError` if the `version` does not exist in the document.
 * You're responsible for validating that `version` exists in the document
 * before calling this function. Hence why the name says "validated" version.
 */
// Given the way we layout our documents table, we can't query
// `transaction.startVersion = version`. Since a transaction may contain
// multiple steps and hence multiple versions. We don't know where the
// transaction boundaries lie without querying the table.
//
// Given the way DynamoDB works we also can't query
// `transaction.startVersion >= version AND version < transaction.startVersion + transaction.steps.length`
// since we have to query on sort keys (of which `transaction.steps` is not a
// part of).
//
// So the way this function is implemented is:
//
// 1. We query the `StepTransactionsBeforeSnapshot` sort range for the
//    transaction containing this version.
// 2. We query the `StepTransactionsAfterSnapshot` sort range for the
//    transaction containing this version.
//
// To query those sort ranges, we use `transaction.startVersion BETWEEN 0 AND version`
// in reverse with a limit of one. The first transaction in that range should
// contain our version.
async function getDocumentStepTransactionContainingValidatedVersion(
    context: DynamoContext,
    id: DocumentId,
    version: number,
): Promise<DocumentStepTransactionItem> {
    assert(Number.isSafeInteger(version));

    const queryStepTransactionsBeforeSnapshot = async () => {
        // Find the transaction which contains `version`. To do this, we need to query
        // `transaction.startVersion BETWEEN 0 AND version` in descending order and
        // return the first transaction we find.
        //
        // To understand why this works consider two cases:
        //
        // 1. The step for `version` is the first step of a transaction (the
        //    transaction's `startVersion`).
        // 2. The step for `version` is in the middle of some transaction.
        //
        // Now consider the following four transactions in the
        // `StepTransactionsBeforeSnapshot` sort range:
        //
        // ```
        // transaction1: startVersion = 0
        // transaction2: startVersion = 5
        // transaction3: startVersion = 6
        // transaction4: startVersion = 9
        // ```
        //
        // For case 1: We want to get a range of steps starting at version 6. So we
        // query `transaction.startVersion BETWEEN 0 AND 6` in descending order. The
        // last transaction in this range is `transaction3` which contains version 6 so
        // we're good.
        //
        // For case 2: We want to get a range of steps starting at version 8. So we
        // query `transaction.startVersion BETWEEN 0 AND 8` in descending order. The
        // last transaction in this range is `transaction3` which contains version 8 so
        // we're good.
        const stepTransactionBeforeSnapshotContainingVersionArray = await arrayFromAsyncIterable(
            DocumentsTable.query(context, {
                limit: 1,
                descending: true,
                partitionKey: {
                    partitionType: "Document",
                    documentId: id,
                },
                startSortKey: {
                    sortRangeType: "StepTransactionsBeforeSnapshot",
                    startVersion: 0,
                },
                endSortKey: {
                    sortRangeType: "StepTransactionsBeforeSnapshot",
                    startVersion: version,
                },
            }),
        );

        assert(stepTransactionBeforeSnapshotContainingVersionArray.length <= 1);
        const stepTransactionBeforeSnapshotContainingVersion =
            stepTransactionBeforeSnapshotContainingVersionArray[0];

        if (!stepTransactionBeforeSnapshotContainingVersion) return null;

        const actuallyContainsVersion =
            stepTransactionBeforeSnapshotContainingVersion.startVersion <= version &&
            version <
                stepTransactionBeforeSnapshotContainingVersion.startVersion +
                    stepTransactionBeforeSnapshotContainingVersion.steps.length;

        // The last transaction in our `transaction.startVersion BETWEEN 0 AND version`
        // range might not actually contain the version we are looking for!
        //
        // This will happen if `version` is after the snapshot version.
        //
        // Since in our `StepTransactionsBeforeSnapshot` sort range we will have
        // transactions from version 0 to the snapshot version. So if `version` is
        // after the snapshot version then we will return the first transaction after
        // the snapshot version.
        if (!actuallyContainsVersion) return null;

        return stepTransactionBeforeSnapshotContainingVersion;
    };

    const queryStepTransactionsAfterSnapshot = async () => {
        // Same as the query above but on the `StepTransactionsAfterSnapshot` sort
        // range instead of the `StepTransactionsBeforeSnapshot` sort range.
        const stepTransactionAfterSnapshotContainingVersionArray = await arrayFromAsyncIterable(
            DocumentsTable.query(context, {
                limit: 1,
                descending: true,
                partitionKey: {
                    partitionType: "Document",
                    documentId: id,
                },
                startSortKey: {
                    sortRangeType: "StepTransactionsAfterSnapshot",
                    startVersion: 0,
                },
                endSortKey: {
                    sortRangeType: "StepTransactionsAfterSnapshot",
                    startVersion: version,
                },
            }),
        );

        assert(stepTransactionAfterSnapshotContainingVersionArray.length <= 1);
        const stepTransactionAfterSnapshotContainingVersion =
            stepTransactionAfterSnapshotContainingVersionArray[0];
        if (!stepTransactionAfterSnapshotContainingVersion) return null;

        const actuallyContainsVersion =
            stepTransactionAfterSnapshotContainingVersion.startVersion <= version &&
            version <
                stepTransactionAfterSnapshotContainingVersion.startVersion +
                    stepTransactionAfterSnapshotContainingVersion.steps.length;

        // The last transaction in our `transaction.startVersion BETWEEN 0 AND version`
        // range might not actually contain the version we are looking for!
        //
        // This will happen while we are updating the snapshot.
        //
        // Consider two adjacent transactions, `transaction1` and `transaction2`.
        // `transaction1` comes before `transaction2`. The version we are looking for
        // is in `transaction2`. But our query will give us `transaction1` if we are in
        // the following state:
        //
        // 1. We deleted `transaction2` from `StepTransactionsAfterSnapshot` and moved
        //    it to `StepTransactionsBeforeSnapshot`.
        // 2. We have not yet deleted `transaction1` from
        //    `StepTransactionsAfterSnapshot`.
        //
        // In this case we need to scan `StepTransactionsBeforeSnapshot` for
        // `transaction2` which.
        if (!actuallyContainsVersion) return null;

        return stepTransactionAfterSnapshotContainingVersion;
    };

    const [stepTransactionBeforeSnapshot, stepTransactionAfterSnapshot] = await runAllPromises([
        queryStepTransactionsBeforeSnapshot(),
        queryStepTransactionsAfterSnapshot(),
    ]);

    // If we have both `stepTransactionBeforeSnapshot` and
    // `stepTransactionAfterSnapshot` then return the transaction from before the
    // snapshot since that's the new canonical transaction and soon we should
    // delete the step transaction after the snapshot.
    if (stepTransactionBeforeSnapshot) return stepTransactionBeforeSnapshot;
    if (stepTransactionAfterSnapshot) return stepTransactionAfterSnapshot;

    throw new DataLossError("Could not find step transaction containing step");
}

export const getDocumentCommentThreadItemAfterFirstGetItemTestCheckpoint =
    new TestCheckpoint<DocumentId>();

/**
 * A document comment thread could either be in the referenced or archived
 * sort range.
 *
 * This function should not be exported! It does not implement authorization.
 */
async function getDocumentCommentThreadItemIfExists(
    context: ServerActionContext,
    {
        documentId,
        commentThreadId,
        shouldTryArchiveFirst = false,
        consistency = "Eventual",
    }: {
        documentId: DocumentId;
        commentThreadId: DocumentCommentThreadId;
        /**
         * Performance optimization hint to try reading from the
         * `ArchivedCommentThread` range before the `ReferencedCommentThread`
         * range.
         */
        shouldTryArchiveFirst?: boolean;
        consistency?: DynamoReadConsistency;
    },
): Promise<DocumentReferencedCommentThreadItem | DocumentArchivedCommentThreadItem | null> {
    {
        const commentThreadItem = await DocumentsTable.getItemIfExists(context, {
            partitionType: "Document",
            sortRangeType: !shouldTryArchiveFirst
                ? "ReferencedCommentThread"
                : "ArchivedCommentThread",
            documentId,
            commentThreadId,
            consistency,
        });
        if (commentThreadItem) return commentThreadItem;
    }

    await getDocumentCommentThreadItemAfterFirstGetItemTestCheckpoint.waitForTest(documentId);

    {
        const commentThreadItem = await DocumentsTable.getItemIfExists(context, {
            partitionType: "Document",
            sortRangeType: !shouldTryArchiveFirst
                ? "ArchivedCommentThread"
                : "ReferencedCommentThread",
            documentId,
            commentThreadId,
            consistency,
        });
        if (commentThreadItem) return commentThreadItem;
    }

    // If we could not find the comment thread in two separate `getItem()`s, then
    // try a transaction that reads both at once. This way we support the case
    // where a transaction was committed between our two `getItem()` requests
    // moving the thread from one range to another.
    {
        const [commentThreadItem1, commentThreadItem2] =
            await DocumentsTable.executeGetItemsTransaction(context, [
                {
                    partitionType: "Document",
                    sortRangeType: "ReferencedCommentThread",
                    documentId,
                    commentThreadId,
                },
                {
                    partitionType: "Document",
                    sortRangeType: "ArchivedCommentThread",
                    documentId,
                    commentThreadId,
                },
            ]);
        if (commentThreadItem1) return commentThreadItem1;
        if (commentThreadItem2) return commentThreadItem2;
        return null;
    }
}

async function getDocumentCommentThreadItem(
    context: ServerActionContext,
    {
        documentId,
        commentThreadId,
        consistency = "Eventual",
    }: {
        documentId: DocumentId;
        commentThreadId: DocumentCommentThreadId;
        consistency?: DynamoReadConsistency;
    },
) {
    const item = await getDocumentCommentThreadItemIfExists(context, {
        documentId,
        commentThreadId,
        consistency,
    });
    if (!item) throw new NotFoundError("Could not find document comment thread");
    return item;
}

/**
 * Add a new comment to a document comment thread.
 */
export async function createDocumentComment(
    context: Context<
        ServerSessionActionContextModules & {
            notifications: NotificationsContextModuleBase;
        }
    >,
    {
        documentId,
        commentThreadId,
        parentCommentIndex,
        content,
    }: {
        documentId: DocumentId;
        commentThreadId: DocumentCommentThreadId;
        parentCommentIndex: number | null;
        content: MessageContent;
    },
): Promise<{
    index: number;
    createdTime: Date;
}> {
    return context.dynamo.retryTransaction(async context => {
        const [documentItem, commentThreadItem, parentCommentItem] = await runAllPromises([
            DocumentsTable.getItem(context, {
                partitionType: "Document",
                sortRangeType: "Attributes",
                documentId,
            }),
            getDocumentCommentThreadItem(context, {
                documentId,
                commentThreadId,
            }),
            typeof parentCommentIndex === "number"
                ? DocumentsTable.getItem(context, {
                      partitionType: "DocumentCommentThread",
                      sortRangeType: "Comments",
                      documentId,
                      commentThreadId,
                      commentIndex: parentCommentIndex,
                  })
                : null,
        ]);

        await authorizeSpaceAccess(context, documentItem.spaceId);

        const commentIndex = commentThreadItem.commentsSummary.nextCommentIndex;
        const createdTime = new Date();
        const authorId = context.actor.getAccountId();

        const newCommentCountByAuthorId = new Map(
            commentThreadItem.commentsSummary.commentCountByAuthorId,
        );
        newCommentCountByAuthorId.set(authorId, (newCommentCountByAuthorId.get(authorId) ?? 0) + 1);

        const newMentionCountByAccountId = applyMentionCountByAccountIdDifferenceFromContentUpdate(
            commentThreadItem.commentsSummary.mentionCountByAccountId,
            null,
            content,
        );

        await DynamoTableSchema.executeTransaction(context, [
            DocumentsTable.transactionCreateItem({
                partitionType: "DocumentCommentThread",
                sortRangeType: "Comments",
                documentId,
                commentThreadId,
                commentIndex,
                authorId,
                createdTime,
                payload: {
                    type: "Content",
                    parentMessageIndex: parentCommentItem?.commentIndex ?? null,
                    content,
                    contentUpdatedTime: null,
                },
            }),
            DocumentsTable.transactionDirectlyUpdateItemAttribute(
                commentThreadItem,
                "commentsSummary",
                {
                    nextCommentIndex: commentThreadItem.commentsSummary.nextCommentIndex + 1,
                    lastChangeTime: commentThreadItem.commentsSummary.lastChangeTime,
                    commentCountByAuthorId: newCommentCountByAuthorId,
                    mentionCountByAccountId: newMentionCountByAccountId,
                },
                {updateLockVersion: commentThreadItem.updateLockVersion},
            ),
        ]);

        context.notifications.sendNotificationEvent({
            type: "CreateDocumentComment",
            id: generateId(),
            spaceId: documentItem.spaceId,
            documentId,
            commentThreadId,
            commentIndex,
            createdTime,
            authorId,
            mentionedAccountIds: getMentionedAccountIdsInContent(content),
            contentSnippet: getNotificationMessageContentSnippet(content),
        });

        return {
            index: commentIndex,
            createdTime,
        };
    });
}

/**
 * Get a single document comment.
 */
export async function getDocumentComment(
    context: ServerActionContext,
    {
        documentId,
        commentThreadId,
        commentIndex,
    }: {
        documentId: DocumentId;
        commentThreadId: DocumentCommentThreadId;
        commentIndex: number;
    },
): Promise<DocumentCommentModel> {
    const {spaceId, commentItem} = await getDocumentCommentItem(context, {
        documentId,
        commentThreadId,
        commentIndex,
    });

    return createDocumentCommentModelFromItem(context, spaceId, commentItem);
}

/**
 * Get a single document comment's payload.
 */
export async function getDocumentCommentPayload(
    context: ServerActionContext,
    {
        documentId,
        commentThreadId,
        commentIndex,
        consistency = "Eventual",
    }: {
        documentId: DocumentId;
        commentThreadId: DocumentCommentThreadId;
        commentIndex: number;
        consistency?: DynamoReadConsistency;
    },
): Promise<MessagePayload> {
    const {commentItem} = await getDocumentCommentItem(context, {
        documentId,
        commentThreadId,
        commentIndex,
        consistency,
    });

    return commentItem.payload;
}

/**
 * Get a document comment's author.
 */
export async function getDocumentCommentAuthorId(
    context: ServerActionContext,
    {
        documentId,
        commentThreadId,
        commentIndex,
    }: {
        documentId: DocumentId;
        commentThreadId: DocumentCommentThreadId;
        commentIndex: number;
    },
): Promise<AccountId> {
    const {commentItem} = await getDocumentCommentItem(context, {
        documentId,
        commentThreadId,
        commentIndex,
    });

    return commentItem.authorId;
}

async function getDocumentCommentItem(
    context: ServerActionContext,
    {
        documentId,
        commentThreadId,
        commentIndex,
        consistency = "Eventual",
    }: {
        documentId: DocumentId;
        commentThreadId: DocumentCommentThreadId;
        commentIndex: number;
        consistency?: DynamoReadConsistency;
    },
) {
    const [{spaceId}, , commentItem] = await runAllPromises([
        authorizeDocumentAccess(context, documentId),

        // Throws an error if the comment thread item doesn't exist.
        getDocumentCommentThreadItem(context, {
            documentId,
            commentThreadId,
            consistency,
        }),

        DocumentsTable.getItem(
            context,
            {
                partitionType: "DocumentCommentThread",
                sortRangeType: "Comments",
                documentId,
                commentThreadId,
                commentIndex,
            },
            {consistency},
        ),
    ]);

    return {
        spaceId,
        commentItem,
    };
}

async function createDocumentCommentModelFromItem(
    context: ServerActionContext,
    spaceId: SpaceId,
    item: DocumentCommentItem,
): Promise<DocumentCommentModel> {
    const [author, payload] = await runAllPromises([
        getAccount(context, spaceId, item.authorId),
        createMessagePayloadModel(context, spaceId, item.payload),
    ]);

    return new DocumentCommentModel({
        documentId: item.documentId,
        commentThreadId: item.commentThreadId,
        index: item.commentIndex,
        author,
        createdTime: item.createdTime,
        payload,
    });
}

/**
 * Update the content on one of your document comments.
 */
export function updateDocumentCommentContent(
    context: ServerSessionActionContext,
    {
        documentId,
        commentThreadId,
        commentIndex,
        content,
    }: {
        documentId: DocumentId;
        commentThreadId: DocumentCommentThreadId;
        commentIndex: number;
        content: MessageContent;
    },
): Promise<{
    contentUpdatedTime: Date;
}> {
    return context.dynamo.retryTransaction(async context => {
        const [, commentThreadItem, commentItem] = await runAllPromises([
            authorizeDocumentAccess(context, documentId),

            getDocumentCommentThreadItem(context, {
                documentId,
                commentThreadId,
            }),
            DocumentsTable.getItem(context, {
                partitionType: "DocumentCommentThread",
                sortRangeType: "Comments",
                documentId,
                commentThreadId,
                commentIndex,
            }),
        ]);

        if (commentItem.authorId !== context.actor.getAccountId())
            throw new PermissionDeniedError("Can only update comments you authored");

        if (commentItem.payload.type !== "Content")
            throw new FailedPreconditionError("Can not update comments with a non-content payload");

        const contentUpdatedTime = new Date(
            Math.max(
                (
                    commentThreadItem.commentsSummary.lastChangeTime ??
                    commentThreadItem.createdTime
                ).getTime() + 1,
                Date.now(),
            ),
        );

        // `lastChangeTime` should always be greater than or equal
        // to `contentUpdatedTime`.
        assert(
            !commentItem.payload.contentUpdatedTime ||
                contentUpdatedTime > commentItem.payload.contentUpdatedTime,
        );

        const newMentionCountByAccountId = applyMentionCountByAccountIdDifferenceFromContentUpdate(
            commentThreadItem.commentsSummary.mentionCountByAccountId,
            commentItem.payload.content,
            content,
        );

        await DynamoTableSchema.executeTransaction(context, [
            DocumentsTable.transactionDirectlyUpdateItem({
                ...commentItem,
                payload: {
                    ...commentItem.payload,
                    content,
                    contentUpdatedTime,
                },
            }),
            DocumentsTable.transactionDirectlyUpdateItemAttribute(
                commentThreadItem,
                "commentsSummary",
                {
                    nextCommentIndex: commentThreadItem.commentsSummary.nextCommentIndex,
                    lastChangeTime: contentUpdatedTime,
                    commentCountByAuthorId:
                        commentThreadItem.commentsSummary.commentCountByAuthorId,
                    mentionCountByAccountId: newMentionCountByAccountId,
                },
                {updateLockVersion: commentThreadItem.updateLockVersion},
            ),
            // Create-or-replace is safe because the change time is guaranteed to be unique
            // and monotonically increasing.
            DocumentsTable.transactionCreateOrReplaceItem({
                partitionType: "DocumentCommentThread",
                sortRangeType: "CommentChangeLog",
                documentId,
                commentThreadId,
                changeTime: contentUpdatedTime,
                commentIndex: commentItem.commentIndex,
                change: {
                    type: "UpdateContent",
                    content,
                },
                expirationTime: getMessageChangeLogExpirationTimeFromChangeTime(contentUpdatedTime),
            }),
        ]);

        return {contentUpdatedTime};
    });
}

/**
 * Delete a single document comment.
 */
export function deleteDocumentComment(
    context: ServerSessionActionContext,
    {
        documentId,
        commentThreadId,
        commentIndex,
    }: {
        documentId: DocumentId;
        commentThreadId: DocumentCommentThreadId;
        commentIndex: number;
    },
): Promise<{deletedTime: Date}> {
    return context.dynamo.retryTransaction(async context => {
        const [, commentThreadItem, commentItem] = await runAllPromises([
            authorizeDocumentAccess(context, documentId),

            getDocumentCommentThreadItem(context, {
                documentId,
                commentThreadId,
            }),
            DocumentsTable.getItem(context, {
                partitionType: "DocumentCommentThread",
                sortRangeType: "Comments",
                documentId,
                commentThreadId,
                commentIndex,
            }),
        ]);

        if (commentItem.authorId !== context.actor.getAccountId())
            throw new PermissionDeniedError("Can only delete comments you authored");

        if (commentItem.payload.type !== "Content")
            throw new FailedPreconditionError("Can not delete comments with a non-content payload");

        const deletedTime = new Date(
            Math.max(
                (
                    commentThreadItem.commentsSummary.lastChangeTime ??
                    commentThreadItem.createdTime
                ).getTime() + 1,
                Date.now(),
            ),
        );

        // `lastChangeTime` should always be greater than or equal
        // to `deletedTime`.
        assert(
            !commentItem.payload.contentUpdatedTime ||
                deletedTime > commentItem.payload.contentUpdatedTime,
        );

        const newMentionCountByAccountId = applyMentionCountByAccountIdDifferenceFromContentUpdate(
            commentThreadItem.commentsSummary.mentionCountByAccountId,
            commentItem.payload.content,
            null,
        );

        await DynamoTableSchema.executeTransaction(context, [
            DocumentsTable.transactionDirectlyUpdateItem({
                ...commentItem,
                payload: {type: "Deleted", deletedTime},
            }),
            DocumentsTable.transactionDirectlyUpdateItemAttribute(
                commentThreadItem,
                "commentsSummary",
                {
                    nextCommentIndex: commentThreadItem.commentsSummary.nextCommentIndex,
                    lastChangeTime: deletedTime,
                    commentCountByAuthorId:
                        commentThreadItem.commentsSummary.commentCountByAuthorId,
                    mentionCountByAccountId: newMentionCountByAccountId,
                },
                {updateLockVersion: commentThreadItem.updateLockVersion},
            ),
            // Create-or-replace is safe because the change time is guaranteed to be unique
            // and monotonically increasing.
            DocumentsTable.transactionCreateOrReplaceItem({
                partitionType: "DocumentCommentThread",
                sortRangeType: "CommentChangeLog",
                documentId,
                commentThreadId,
                changeTime: deletedTime,
                commentIndex: commentItem.commentIndex,
                change: {type: "Delete"},
                expirationTime: getMessageChangeLogExpirationTimeFromChangeTime(deletedTime),
            }),
        ]);

        return {deletedTime};
    });
}

/**
 * Get a document comment thread and some initial comments for that thread.
 */
export async function getDocumentCommentThreadAndInitialComments(
    context: ServerActionContext,
    {
        documentId,
        commentThreadId,
        limit,
    }: {
        documentId: DocumentId;
        commentThreadId: DocumentCommentThreadId;
        limit: number;
    },
): Promise<{
    commentThread: DocumentCommentThreadModel;
    initialComments: Array<DocumentCommentModel>;
    initialOtherReferencedComments: Array<DocumentCommentModel>;
}> {
    const documentAuthorizationPromise = authorizeDocumentAccess(context, documentId);

    const [, commentThread, {comments, otherReferencedComments}] = await runAllPromises([
        documentAuthorizationPromise,
        (async () => {
            const commentThreadItem = await getDocumentCommentThreadItem(context, {
                documentId,
                commentThreadId,
            });

            const {spaceId} = await documentAuthorizationPromise;
            return createDocumentCommentThreadModelFromItem(context, spaceId, commentThreadItem);
        })(),
        getDocumentCommentsFromStartAssumingAuthorizedCommentThread(context, {
            documentId,
            commentThreadId,
            getSpaceId: () => documentAuthorizationPromise.then(({spaceId}) => spaceId),
            limit,
            afterCommentIndex: null,
            beforeCommentIndex: null,
        }),
    ]);

    const lastCommentIndex = comments.length > 0 ? comments[comments.length - 1]!.index : -1;

    return {
        commentThread: commentThread.clone({
            commentCount: Math.max(
                commentThread.commentCount,
                // Make sure `commentCount` is consistent with `comments` in case of eventual
                // consistency race conditions.
                lastCommentIndex + 1,
            ),
        }),
        initialComments: comments,
        initialOtherReferencedComments: otherReferencedComments,
    };
}

/**
 * Get a document, some comment threads in the document, and initial comments
 * for these threads as if we are rendering the list of comment threads
 * in order.
 *
 * For instance, if we have a limit of 20 and the first comment thread has 15
 * comments and the second comment thread has 30 comments then we'd load 15
 * comments from the first thread and 5 comments from the second thread to meet
 * our 20 comment limit. We may load more comments than our limit since we load
 * some comment threads in parallel before we know how many comments they
 * contain.
 */
export async function getDocumentAndCommentThreadsWithInitialComments(
    context: ServerActionContext,
    {
        documentId,
        commentThreadIds,
        commentLimit,
        commentThreadCountAgainstLimit,
    }: {
        documentId: DocumentId;
        commentThreadIds:
            | Iterable<DocumentCommentThreadId>
            | Promise<Iterable<DocumentCommentThreadId>>;
        commentLimit: number;
        // Comment threads take some space in our rendered list of comment threads.
        // This number specifies how much we should decrease our limit for every
        // comment thread we load.
        //
        // For example, if this is set to 5 then we decrease the limit by 5 for every
        // comment thread between comments. So if we have a comment thread with 10
        // comments and a comment thread of 20 comments and we run this function with a
        // limit of 12 then we only load comments from the first thread because the
        // thread itself counts for 5 comments.
        //
        // This number can be fractional like 5.8.
        commentThreadCountAgainstLimit: number;
    },
): Promise<{
    document: DocumentModel;
    commentThreads: Array<DocumentCommentThreadModel>;
    initialCommentsByCommentThreadId: Map<
        DocumentCommentThreadId,
        {
            comments: Array<DocumentCommentModel>;
            otherReferencedComments: Array<DocumentCommentModel>;
        }
    >;
}> {
    const spaceIdPromiseResolver = createPromiseResolver<SpaceId>();

    const documentPromise = getDocumentAndCommentThreads(context, {
        documentId,
        commentThreadIds,
        spaceIdPromiseResolver,
    });

    const initialCommentsByCommentThreadIdPromise = (async () => {
        const commentThreadIdQueue = Array.from(await commentThreadIds);
        let currentCommentLimit = commentLimit;

        const initialCommentsByCommentThreadId = new Map<
            DocumentCommentThreadId,
            {
                comments: Array<DocumentCommentModel>;
                otherReferencedComments: Array<DocumentCommentModel>;
            }
        >();

        while (currentCommentLimit > 0 && commentThreadIdQueue.length > 0) {
            const commentThread1Id = commentThreadIdQueue.shift()!;
            const commentThread2Id = commentThreadIdQueue.shift();

            const [commentThread1Result, commentThread2Result] = await runAllPromises([
                getDocumentCommentsFromStartAssumingAuthorizedCommentThread(context, {
                    documentId,
                    commentThreadId: commentThread1Id,
                    getSpaceId: () => spaceIdPromiseResolver.promise,
                    limit: Math.ceil(currentCommentLimit),
                    afterCommentIndex: null,
                    beforeCommentIndex: null,
                }),
                commentThread2Id
                    ? getDocumentCommentsFromStartAssumingAuthorizedCommentThread(context, {
                          documentId,
                          commentThreadId: commentThread2Id,
                          getSpaceId: () => spaceIdPromiseResolver.promise,
                          limit: Math.ceil(currentCommentLimit),
                          afterCommentIndex: null,
                          beforeCommentIndex: null,
                      })
                    : null,
            ]);

            currentCommentLimit -= commentThreadCountAgainstLimit;
            currentCommentLimit -= commentThread1Result.comments.length;
            initialCommentsByCommentThreadId.set(commentThread1Id, commentThread1Result);

            if (commentThread2Result) {
                currentCommentLimit -= commentThreadCountAgainstLimit;
                currentCommentLimit -= commentThread2Result.comments.length;
                initialCommentsByCommentThreadId.set(commentThread2Id!, commentThread2Result);
            }
        }

        return initialCommentsByCommentThreadId;
    })();

    const [{document, commentThreads}, initialCommentsByCommentThreadId] = await runAllPromises([
        documentPromise,
        initialCommentsByCommentThreadIdPromise,
    ]);

    return {
        document,
        commentThreads,
        initialCommentsByCommentThreadId,
    };
}

/**
 * Paginate through document comments from start to finish.
 */
export async function getDocumentCommentsFromStart(
    context: ServerActionContext,
    {
        documentId,
        commentThreadId,
        limit,
        afterCommentIndex,
        beforeCommentIndex,
    }: {
        documentId: DocumentId;
        commentThreadId: DocumentCommentThreadId;
        limit: number;
        afterCommentIndex: number | null;
        beforeCommentIndex: number | null;
    },
): Promise<{
    commentCount: number;
    comments: Array<DocumentCommentModel>;
    otherReferencedComments: Array<DocumentCommentModel>;
    lastCommentChangeTime: Date | null;
}> {
    const documentAuthorizationPromise = authorizeDocumentAccess(context, documentId);

    const [, commentThreadItem, {comments, otherReferencedComments}] = await runAllPromises([
        documentAuthorizationPromise,
        getDocumentCommentThreadItem(context, {
            documentId,
            commentThreadId,
        }),
        getDocumentCommentsFromStartAssumingAuthorizedCommentThread(context, {
            documentId,
            commentThreadId,
            getSpaceId: () => documentAuthorizationPromise.then(({spaceId}) => spaceId),
            limit,
            afterCommentIndex,
            beforeCommentIndex,
        }),
    ]);

    const lastCommentIndex = comments.length > 0 ? comments[comments.length - 1]!.index : -1;

    return {
        commentCount: Math.max(
            reduceIterable(
                commentThreadItem.commentsSummary.commentCountByAuthorId.values(),
                (commentCount, authorCommentCount) => commentCount + authorCommentCount,
                0,
            ),
            // Make sure `commentCount` is consistent with `comments` in case of eventual
            // consistency race conditions.
            lastCommentIndex + 1,
        ),
        comments,
        otherReferencedComments,
        lastCommentChangeTime: commentThreadItem.commentsSummary.lastChangeTime,
    };
}

async function getDocumentCommentsFromStartAssumingAuthorizedCommentThread(
    context: ServerActionContext,
    {
        documentId,
        commentThreadId,
        getSpaceId,
        limit,
        afterCommentIndex,
        beforeCommentIndex,
        consistency,
    }: {
        documentId: DocumentId;
        commentThreadId: DocumentCommentThreadId;
        getSpaceId: () => Promise<SpaceId>;
        limit: number;
        afterCommentIndex: number | null;
        beforeCommentIndex: number | null;
        consistency?: DynamoReadConsistency;
    },
): Promise<{
    comments: Array<DocumentCommentModel>;
    otherReferencedComments: Array<DocumentCommentModel>;
}> {
    if (limit === 0) return {comments: [], otherReferencedComments: []};

    const commentItems = await arrayFromAsyncIterable(
        DocumentsTable.query(context, {
            partitionKey: {
                partitionType: "DocumentCommentThread",
                documentId,
                commentThreadId,
            },
            startSortKey: {
                sortRangeType: "Comments",
                commentIndex: typeof afterCommentIndex === "number" ? afterCommentIndex + 1 : 0,
            },
            endSortKey: {
                sortRangeType: "Comments",
                commentIndex:
                    typeof beforeCommentIndex === "number"
                        ? beforeCommentIndex - 1
                        : Number.MAX_SAFE_INTEGER,
            },
            limit,
            consistency,
        }),
    );

    if (commentItems.length === 0) return {comments: [], otherReferencedComments: []};

    const startCommentIndex = commentItems[0]!.commentIndex;
    const endCommentIndex = commentItems[commentItems.length - 1]!.commentIndex;

    const spaceId = await getSpaceId();

    let otherReferencedCommentPromiseByIndex = new Map<number, Promise<void>>();
    const otherReferencedComments: Array<DocumentCommentModel> = [];

    const loadOtherReferencedComment = (commentIndex: number) => {
        // If this message is already in our loaded messages range then we don't need
        // to load it again.
        if (startCommentIndex <= commentIndex && commentIndex <= endCommentIndex) return;

        const promise = getOrSetDefaultMapValue(
            otherReferencedCommentPromiseByIndex,
            commentIndex,
            async () => {
                const item = await DocumentsTable.getItemIfExists(
                    context,
                    {
                        partitionType: "DocumentCommentThread",
                        sortRangeType: "Comments",
                        documentId,
                        commentThreadId,
                        commentIndex,
                    },
                    {consistency},
                );
                if (!item) throw new InternalError("Parent comment not found");

                // Recursively load any referenced parent messages...
                if (item.payload.type === "Content" && item.payload.parentMessageIndex !== null) {
                    loadOtherReferencedComment(item.payload.parentMessageIndex);
                }

                otherReferencedComments.push(
                    await createDocumentCommentModelFromItem(context, spaceId, item),
                );
            },
        );

        // We await this promise later.
        void promise;
    };

    const comments = await runAllPromises(
        commentItems.map(item => {
            if (item.payload.type === "Content" && item.payload.parentMessageIndex !== null) {
                loadOtherReferencedComment(item.payload.parentMessageIndex);
            }

            // Don't propagate `consistency` when loading model references. We
            // accept references can have eventual consistency.
            return createDocumentCommentModelFromItem(context, spaceId, item);
        }),
    );

    // Keep loading other referenced comments until we have all of them. A
    // referenced comment may itself reference more comments.
    while (otherReferencedCommentPromiseByIndex.size > 0) {
        const promises = Array.from(otherReferencedCommentPromiseByIndex.values());
        otherReferencedCommentPromiseByIndex = new Map();
        await runAllPromises(promises);
    }

    return {
        comments,
        otherReferencedComments: otherReferencedComments.sort(
            (comment1, comment2) => comment1.index - comment2.index,
        ),
    };
}

/**
 * Paginate through document comments from finish to start.
 */
export async function getDocumentCommentsFromEnd(
    context: ServerActionContext,
    {
        documentId,
        commentThreadId,
        limit,
        afterCommentIndex,
        beforeCommentIndex,
    }: {
        documentId: DocumentId;
        commentThreadId: DocumentCommentThreadId;
        limit: number;
        afterCommentIndex: number | null;
        beforeCommentIndex: number | null;
    },
): Promise<{
    commentCount: number;
    comments: Array<DocumentCommentModel>;
    otherReferencedComments: Array<DocumentCommentModel>;
    lastCommentChangeTime: Date | null;
}> {
    const documentAuthorizationPromise = authorizeDocumentAccess(context, documentId);

    const [, commentThreadItem, {comments, otherReferencedComments}] = await runAllPromises([
        documentAuthorizationPromise,
        getDocumentCommentThreadItem(context, {
            documentId,
            commentThreadId,
        }),
        getDocumentCommentsFromEndAssumingAuthorizedCommentThread(context, {
            documentId,
            commentThreadId,
            getSpaceId: () => documentAuthorizationPromise.then(({spaceId}) => spaceId),
            limit,
            afterCommentIndex,
            beforeCommentIndex,
        }),
    ]);

    const lastCommentIndex = comments.length > 0 ? comments[comments.length - 1]!.index : -1;

    return {
        commentCount: Math.max(
            reduceIterable(
                commentThreadItem.commentsSummary.commentCountByAuthorId.values(),
                (commentCount, authorCommentCount) => commentCount + authorCommentCount,
                0,
            ),
            // Make sure `commentCount` is consistent with `comments` in case of eventual
            // consistency race conditions.
            lastCommentIndex + 1,
        ),
        comments,
        otherReferencedComments,
        lastCommentChangeTime: commentThreadItem.commentsSummary.lastChangeTime,
    };
}

async function getDocumentCommentsFromEndAssumingAuthorizedCommentThread(
    context: ServerActionContext,
    {
        documentId,
        commentThreadId,
        getSpaceId,
        limit,
        afterCommentIndex,
        beforeCommentIndex,
    }: {
        documentId: DocumentId;
        commentThreadId: DocumentCommentThreadId;
        getSpaceId: () => Promise<SpaceId>;
        limit: number;
        afterCommentIndex: number | null;
        beforeCommentIndex: number | null;
    },
): Promise<{
    comments: Array<DocumentCommentModel>;
    otherReferencedComments: Array<DocumentCommentModel>;
}> {
    if (limit === 0) return {comments: [], otherReferencedComments: []};

    const commentItems = await arrayFromAsyncIterable(
        typeof beforeCommentIndex !== "number" || beforeCommentIndex > 0
            ? DocumentsTable.query(context, {
                  partitionKey: {
                      partitionType: "DocumentCommentThread",
                      documentId,
                      commentThreadId,
                  },
                  startSortKey: {
                      sortRangeType: "Comments",
                      commentIndex:
                          typeof afterCommentIndex === "number" ? afterCommentIndex + 1 : 0,
                  },
                  endSortKey: {
                      sortRangeType: "Comments",
                      commentIndex:
                          typeof beforeCommentIndex === "number"
                              ? beforeCommentIndex - 1
                              : Number.MAX_SAFE_INTEGER,
                  },
                  limit,
                  // Scan backwards from `endSortKey` to `startSortKey` so we can get comments
                  // at the end instead of start.
                  descending: true,
              })
            : (async function* () {})(),
    );

    if (commentItems.length === 0) return {comments: [], otherReferencedComments: []};

    const endCommentIndex = commentItems[0]!.commentIndex;
    const startCommentIndex = commentItems[commentItems.length - 1]!.commentIndex;

    const spaceId = await getSpaceId();

    let otherReferencedCommentPromiseByIndex = new Map<number, Promise<void>>();
    const otherReferencedComments: Array<DocumentCommentModel> = [];

    const loadOtherReferencedComment = (commentIndex: number) => {
        // If this message is already in our loaded messages range then we don't need
        // to load it again.
        if (startCommentIndex <= commentIndex && commentIndex <= endCommentIndex) return;

        const promise = getOrSetDefaultMapValue(
            otherReferencedCommentPromiseByIndex,
            commentIndex,
            async () => {
                const item = await DocumentsTable.getItemIfExists(context, {
                    partitionType: "DocumentCommentThread",
                    sortRangeType: "Comments",
                    documentId,
                    commentThreadId,
                    commentIndex,
                });
                if (!item) throw new InternalError("Parent comment not found");

                // Recursively load any referenced parent messages...
                if (item.payload.type === "Content" && item.payload.parentMessageIndex !== null) {
                    loadOtherReferencedComment(item.payload.parentMessageIndex);
                }

                otherReferencedComments.push(
                    await createDocumentCommentModelFromItem(context, spaceId, item),
                );
            },
        );

        // We await this promise later.
        void promise;
    };

    const comments = await runAllPromises(
        commentItems.map(item => {
            if (item.payload.type === "Content" && item.payload.parentMessageIndex !== null) {
                loadOtherReferencedComment(item.payload.parentMessageIndex);
            }
            return createDocumentCommentModelFromItem(context, spaceId, item);
        }),
    );

    // Keep loading other referenced comments until we have all of them. A
    // referenced comment may itself reference more comments.
    while (otherReferencedCommentPromiseByIndex.size > 0) {
        const promises = Array.from(otherReferencedCommentPromiseByIndex.values());
        otherReferencedCommentPromiseByIndex = new Map();
        await runAllPromises(promises);
    }

    // We queried in descending order so put comments back in the right order.
    comments.reverse();

    return {
        comments,
        otherReferencedComments: otherReferencedComments.sort(
            (comment1, comment2) => comment1.index - comment2.index,
        ),
    };
}

export type DocumentCommentChangesResult =
    | {
          type: "Available";
          changes: Array<MessageChange>;
      }
    | {
          type: "Unavailable";
      };

/**
 * Backfills any missing comments or comment updates for a client. The client
 * provides what it knows to be the comment count and last change time then we
 * return any new comments or changes since then.
 *
 * We run this when the client establishes a new realtime connection to catch
 * the client up between their last data load and the time the realtime
 * connection was established.
 *
 * `newCommentLimit` allows you to load some new comments that the client
 * may be missing but only up to the limit.
 *
 * We do not keep a log of document comment changes around forever, so it's
 * possible that you get an `Unavailable` result for
 * `commentChangesResult`. When this happens you should throw away all data
 * your client has loaded and try loading the data again.
 */
export async function backfillDocumentComments(
    context: ServerActionContext,
    {
        documentId,
        commentThreadId,
        clientCommentCount,
        clientLastCommentChangeTime,
        newCommentLimit,
    }: {
        documentId: DocumentId;
        commentThreadId: DocumentCommentThreadId;
        clientCommentCount: number;
        clientLastCommentChangeTime: Date | null;
        newCommentLimit: number;
    },
): Promise<{
    commentCount: number;
    lastCommentChangeTime: Date | null;
    newComments: Array<DocumentCommentModel>;
    newOtherReferencedComments: Array<DocumentCommentModel>;
    commentChangesResult: DocumentCommentChangesResult;
}> {
    const documentAuthorizationPromise = authorizeDocumentAccess(context, documentId);

    const commentThreadItemPromise = getDocumentCommentThreadItem(context, {
        documentId,
        commentThreadId,
    });

    const [, commentThreadItem, {comments, otherReferencedComments}, commentChangesResult] =
        await runAllPromises([
            documentAuthorizationPromise,
            commentThreadItemPromise,
            getDocumentCommentsFromStartAssumingAuthorizedCommentThread(context, {
                documentId,
                commentThreadId,
                getSpaceId: () => documentAuthorizationPromise.then(({spaceId}) => spaceId),
                limit: newCommentLimit,
                afterCommentIndex: clientCommentCount - 1,
                beforeCommentIndex: null,
                // Use a strong read consistency when backfilling. This guarantees the caller
                // will observe all realtime events before this function call. Realtime events
                // that happen during the function call may be missed. You should be subscribed
                // to new realtime events before starting to backfill.
                consistency: "Strong",
            }),
            runAllPromises([documentAuthorizationPromise, commentThreadItemPromise]).then(
                ([documentPreview, commentThreadItem]) =>
                    queryDocumentCommentChangeLogAssumingAuthorizedDocumentCommentThread(context, {
                        spaceId: documentPreview.spaceId,
                        commentThreadItem,
                        lastCommentChangeTime: clientLastCommentChangeTime,
                        // Use a strong read consistency when backfilling. This guarantees the caller
                        // will observe all realtime events before this function call. Realtime events
                        // that happen during the function call may be missed. You should be subscribed
                        // to new realtime events before starting to backfill.
                        consistency: "Strong",
                    }),
            ),
        ]);

    const lastCommentIndex = comments.length > 0 ? comments[comments.length - 1]!.index : -1;

    const lastCommentChangeTime =
        commentChangesResult.type === "Available" && commentChangesResult.changes.length > 0
            ? getMessageChangeTime(
                  commentChangesResult.changes[commentChangesResult.changes.length - 1]!,
              )
            : null;

    return {
        commentCount: Math.max(
            reduceIterable(
                commentThreadItem.commentsSummary.commentCountByAuthorId.values(),
                (commentCount, authorCommentCount) => commentCount + authorCommentCount,
                0,
            ),
            // Make sure `commentCount` is consistent with `comments` in case of eventual
            // consistency race conditions.
            lastCommentIndex + 1,
        ),
        lastCommentChangeTime:
            lastCommentChangeTime &&
            // Make sure `lastCommentChangeTime` is consistent with
            // `commentChangesResult` in case of eventual consistency race conditions.
            (!commentThreadItem.commentsSummary.lastChangeTime ||
                lastCommentChangeTime > commentThreadItem.commentsSummary.lastChangeTime)
                ? lastCommentChangeTime
                : commentThreadItem.commentsSummary.lastChangeTime,
        newComments: comments,
        newOtherReferencedComments: otherReferencedComments,
        commentChangesResult,
    };
}

async function queryDocumentCommentChangeLogAssumingAuthorizedDocumentCommentThread(
    context: ServerActionContext,
    {
        spaceId,
        commentThreadItem,
        lastCommentChangeTime,
        consistency,
    }: {
        spaceId: SpaceId;
        commentThreadItem: DocumentReferencedCommentThreadItem | DocumentArchivedCommentThreadItem;
        lastCommentChangeTime: Date | null;
        consistency?: DynamoReadConsistency;
    },
): Promise<DocumentCommentChangesResult> {
    // No changes occurred during the backfill period, there is nothing we need
    // to query.
    if (
        commentThreadItem.commentsSummary.lastChangeTime?.getTime() ===
        lastCommentChangeTime?.getTime()
    ) {
        return {type: "Available", changes: []};
    }

    const lastCommentChangeExpirationTime = getMessageChangeLogExpirationTimeFromChangeTime(
        lastCommentChangeTime ?? commentThreadItem.createdTime,
    );

    // If our last change item has expired then other relevant changelog entries
    // may have also expired. The client will need to fully reset its state since
    // we don't have the data necessary to backfill.
    //
    // We subtract one day from the expiration time in this check in case our clock
    // disagrees with DynamoDB's time-to-live clock (clock skew). If our clock is
    // ahead and we believe an item exists that DynamoDB has in fact deleted that
    // would be sad. One day feels like sufficient clock skew buffer.
    if (lastCommentChangeExpirationTime.getTime() - 1000 * 60 * 60 * 24 < Date.now())
        return {type: "Unavailable"};

    const changes = await parallelMapAsyncIterableToArray(
        DocumentsTable.query(context, {
            partitionKey: {
                partitionType: "DocumentCommentThread",
                documentId: commentThreadItem.documentId,
                commentThreadId: commentThreadItem.commentThreadId,
            },
            startSortKey: {
                sortRangeType: "CommentChangeLog",
                changeTime: new Date(
                    (lastCommentChangeTime ?? commentThreadItem.createdTime).getTime() + 1,
                ),
            },
            endSortKey: {
                sortRangeType: "CommentChangeLog",
                changeTime: DynamoKeyAttributeSchema.date.maxValue,
            },
            limit: "All",
            consistency,
        }),
        async (item): Promise<MessageChange> => {
            switch (item.change.type) {
                case "UpdateContent": {
                    return {
                        type: "UpdateContent",
                        index: item.commentIndex,
                        content: {
                            doc: item.change.content,
                            // Don't propagate `consistency` when loading content references. We
                            // accept references can have eventual consistency.
                            references: await getContentReferencesForNode(
                                context,
                                spaceId,
                                item.change.content,
                            ),
                        },
                        contentUpdatedTime: item.changeTime,
                    };
                }
                case "Delete": {
                    return {
                        type: "Delete",
                        index: item.commentIndex,
                        deletedTime: item.changeTime,
                    };
                }
                default:
                    throw exhaustive(item.change);
            }
        },
    );

    return {type: "Available", changes};
}

/**
 * Get accounts subscribed to notifications for the provided document comment
 * thread. For the first comment in a comment thread, the document owner is
 * also considered a subscriber.
 */
export async function getDocumentCommentThreadNotificationSubscribers(
    context: ServerActionContext,
    {
        documentId,
        commentThreadId,
        isFirstComment,
        consistency = "Eventual",
    }: {
        documentId: DocumentId;
        commentThreadId: DocumentCommentThreadId;
        isFirstComment: boolean;
        consistency?: DynamoReadConsistency;
    },
): Promise<{
    accountIds: Set<AccountId | ContentMentionAccountId>;
}> {
    const [documentItem, commentThreadItem] = await runAllPromises([
        (async () => {
            const documentItem = await DocumentsTable.getItem(
                context,
                {
                    partitionType: "Document",
                    sortRangeType: "Attributes",
                    documentId,
                },
                {consistency},
            );

            await authorizeSpaceAccess(context, documentItem.spaceId);

            return documentItem;
        })(),
        getDocumentCommentThreadItem(context, {
            documentId,
            commentThreadId,
            consistency,
        }),
    ]);

    const accountIds = new Set<ContentMentionAccountId>(
        concatIterables(
            isFirstComment && documentItem.ownerId ? [documentItem.ownerId] : [],
            commentThreadItem.commentsSummary.commentCountByAuthorId.keys(),
            commentThreadItem.commentsSummary.mentionCountByAccountId.keys(),
        ),
    );

    return {accountIds};
}
