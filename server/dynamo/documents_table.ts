import {TextSelection} from "prosemirror-state";
import {Mapping, Step} from "prosemirror-transform";
import {DynamoConditionExpression} from "~/server/dynamo/internal/dynamo_condition";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/internal/dynamo_key_attribute_schema";
import {DynamoTableItemType, DynamoTableSchema} from "~/server/dynamo/internal/dynamo_table_schema";
import {isDynamoConditionCheckError} from "~/server/dynamo/internal/is_dynamo_condition_check_error";
import {retryDynamoConditionCheckErrors} from "~/server/dynamo/internal/retry_dynamo_condition_check_errors";
import {TestCheckpoint} from "~/server/helpers/test/test_checkpoint";
import {TestCounter} from "~/server/helpers/test/test_counter";
import {publishToNetworkChannel} from "~/server/network/publish_to_network_channel";
import {
    DocumentContent,
    DocumentContentSchema,
    DocumentContentStepSchema,
    isDocumentContent,
} from "~/shared/documents/document_content_schema";
import {
    DocumentModel,
    DocumentPreviewModel,
    getDocumentContentTitleWithoutFallback,
} from "~/shared/documents/document_model";
import {
    DataLossError,
    FailedPreconditionError,
    InternalError,
    InvalidArgumentError,
    NotFoundError,
} from "~/shared/error/error";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises";
import {assert} from "~/shared/helpers/control/assert";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable";
import {flatMapIterable} from "~/shared/helpers/iterable/flat_map_iterable";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable";
import {clamp} from "~/shared/helpers/number/clamp";
import {Id} from "~/shared/id/id";
import {
    DocumentChannel,
    DocumentEditorPresenceUpdateSchema,
} from "~/shared/network/documents_network_definition";
import {Schema, SchemaType} from "~/shared/schema/schema";

const DocumentsTable = DynamoTableSchema.new({
    name: "Documents",
    partitions: {
        Document: {
            partitionKeyAttributes: {
                documentId: DynamoKeyAttributeSchema.id,
            },
            sortRanges: {
                /**
                 * Any information about the document not stored in its content.
                 *
                 * The content of a document is the document snapshot and any steps in the
                 * `StepsAfterSnapshot` range.
                 */
                Attributes: {
                    sortKeyAttributes: {},
                    attributes: Schema.object({
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
                StepTransactionsAfterSnapshot: {
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
                         * An `Id` identifying the client who applied this step.
                         *
                         * We generate a new client id every time the content editor is rendered. This
                         * means a user may have many client ids. They can be editing from two browser
                         * tabs at once or even two editors on-screen at the same time.
                         */
                        clientId: Schema.id,
                    }),
                },

                /**
                 * The last full snapshot we took of the document.
                 */
                Snapshot: {
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
                 * Step transactions applied to the document before our latest snapshot.
                 *
                 * We keep around old steps for historical purposes. We will read these steps
                 * when showing the document history.
                 */
                // TODO(calebmer): Maybe we should create a new table with an infrequent access
                // mode for step transactions before the snapshot. Since they're only used when
                // rendering history which is rare?
                StepTransactionsBeforeSnapshot: {
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
                         * An `Id` identifying the client who applied this step.
                         *
                         * We generate a new client id every time the content editor is rendered. This
                         * means a user may have many client ids. They can be editing from two browser
                         * tabs at once or even two editors on-screen at the same time.
                         */
                        clientId: Schema.id,
                    }),
                },
            },
        },
    },
});

/**
 * We are not allowed to export our DynamoDB tables so instead export a
 * function that can only be used in Jest tests.
 */
export function getDocumentsTableForTest() {
    assert(typeof jest !== "undefined");
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

/**
 * Creates a new document with no history using the initial content provided.
 */
export async function createDocument({id, content}: {id: Id; content: DocumentContent}) {
    await DynamoTableSchema.executeTransaction(
        [
            DocumentsTable.transactionPutItem(
                {
                    partitionType: "Document",
                    documentId: id,
                    sortRangeType: "Attributes",
                    version: 0,
                    titleWithoutFallback: getDocumentContentTitleWithoutFallback(content),
                },
                {
                    condition: {
                        // Make sure a document with this id does not already exist by checking that a
                        // required property does not exist.
                        //
                        // If a document does exist, we don't want to put it in a broken state.
                        version: DynamoConditionExpression.exists().not(),
                    },
                },
            ),
            DocumentsTable.transactionPutItem({
                partitionType: "Document",
                documentId: id,
                sortRangeType: "Snapshot",
                version: 0,
                content,
            }),
        ],
        {
            clientRequestToken: id,
        },
    );
}

/**
 * Get the full document with the provided id.
 */
export async function getDocument(id: Id): Promise<DocumentModel | null> {
    const internalDocument = await getInternalDocument(id);
    return internalDocument?.model ?? null;
}

/**
 * Get a preview of the document with the provided id.
 *
 * Cheaper than `getDocument()` since we don't return the full content.
 */
export async function getDocumentPreview(id: Id): Promise<DocumentPreviewModel | null> {
    const attributes = await DocumentsTable.getItem({
        partitionType: "Document",
        documentId: id,
        sortRangeType: "Attributes",
    });

    if (!attributes) return null;

    return new DocumentPreviewModel({
        id,
        titleWithoutFallback: attributes.titleWithoutFallback,
    });
}

type InternalDocument = {
    readonly attributes: DocumentAttributesItem;
    readonly stepTransactionsAfterSnapshot: ReadonlyArray<DocumentStepTransactionAfterSnapshotItem>;
    readonly snapshot: DocumentSnapshotItem;
    readonly model: DocumentModel;
};

export const getInternalDocumentTestCounter = new TestCounter();

/**
 * Get the full document with the provided id.
 *
 * Not only returns the `Document` but also returns some of the document's
 * internal representation.
 */
async function getInternalDocument(id: Id): Promise<InternalDocument | null> {
    getInternalDocumentTestCounter.incrementForTest(id);

    let attributes: DocumentAttributesItem | null = null;
    let stepTransactionsAfterSnapshot: Array<DocumentStepTransactionAfterSnapshotItem> = [];
    let maybeSnapshot: DocumentSnapshotItem | null = null;

    for await (const item of DocumentsTable.query({
        startKey: {
            partitionType: "Document",
            documentId: id,
            sortRangeType: "Attributes",
        },
        endKey: {
            partitionType: "Document",
            documentId: id,
            sortRangeType: "Snapshot",
        },
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
        model: new DocumentModel({
            id: id,
            version: attributes.version,
            content,
        }),
    };
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
// NOTE(calebmer): I'm hoping that our serverless provider (Vercel)
// consistently routes updates from the same user to the same process. If
// Vercel doesn't do this then the cache is pointless since each process will
// have its own cache. I'd also hope that one day we can tune Vercel to route
// updates from the same space id to the same process.
export class DocumentContentCacheForUpdate {
    private readonly _entries = new DocumentContentCacheForUpdateEntries();

    public async getAndCacheDocument(id: Id): Promise<{
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
            readonly clientId: Id;
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
            clientId: Id;
        }): Promise<void>;
    } | null> {
        let wasEntryCached = true;

        const nullableEntry = await this._entries.getOrSetEntry(id, async () => {
            wasEntryCached = false;

            const internalDocument = await getInternalDocument(id);
            if (!internalDocument) return null;

            return {
                version: internalDocument.model.version,
                content: internalDocument.model.content,
                stepsAfterInitialSnapshot: new PushOnlyArray(
                    flatMapIterable(
                        internalDocument.stepTransactionsAfterSnapshot,
                        ({steps, invertedSteps, clientId}) => {
                            return mapIterable(steps, (step, i) => {
                                const invertedStep = invertedSteps[steps.length - i - 1];
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
            const attributes = await DocumentsTable.getItem({
                partitionType: "Document",
                documentId: id,
                sortRangeType: "Attributes",
            });

            // The document was deleted from the database but not our cache.
            if (!attributes) {
                this._entries.evictEntry(id);
                return null;
            }

            if (entry.version > attributes.version)
                throw new InternalError(
                    "We've cached document content that has a version number ahead of what's in the database",
                );

            // If the version in our cache is less than what's in the database, then let's
            // load the steps we are missing and apply them to our content.
            if (entry.version < attributes.version) {
                const nullableEntry = await this._entries.setEntry(id, async () => {
                    const steps = await getDocumentStepsBetweenValidatedVersionRange({
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
            version: entry.version,
            content: entry.content,
            // Create a slice of `stepsAfterInitialSnapshot` so that when we mutate the
            // array from within this function, other code with a reference to the array
            // won't see the new values.
            stepsAfterInitialSnapshot: entry.stepsAfterInitialSnapshot.slice(),

            updateCache: async ({newContent, newSteps, newInvertedSteps, clientId}) => {
                for (let i = 0; i < newSteps.length; i++) {
                    const step = newSteps[i]!;
                    const invertedStep = newInvertedSteps[newSteps.length - i - 1];
                    assert(invertedStep);
                    entry.stepsAfterInitialSnapshot.push({step, invertedStep, clientId});
                }

                await this._entries.setEntry(id, async () => ({
                    version: entry.version + newSteps.length,
                    content: newContent,
                    stepsAfterInitialSnapshot: entry.stepsAfterInitialSnapshot,
                }));
            },
        };
    }
}

type DocumentContentCacheForUpdateEntry = {
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
        readonly clientId: Id;
    }>;
};

/**
 * Small helper for managing `DocumentContentCacheForUpdate` that handles
 * cache eviction.
 *
 * You shouldn't have to worry about cache eviction outside of this class.
 */
class DocumentContentCacheForUpdateEntries {
    private readonly _entryByDocumentId = new Map<
        Id,
        {
            evictionTimeoutId: number;
            evict: () => void;
            promise: Promise<DocumentContentCacheForUpdateEntry | null>;
        }
    >();

    constructor() {
        // In our test environment, add a hook to evict all cached content at the end
        // of every test. That way we don't have timeouts sitting around and firing
        // randomly.
        if (typeof jest !== "undefined") {
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
        id: Id,
        getData: () => Promise<DocumentContentCacheForUpdateEntry | null>,
    ): Promise<DocumentContentCacheForUpdateEntry | null> {
        const entry = this._entryByDocumentId.get(id);
        if (!entry) return this.setEntry(id, getData);
        return entry.promise;
    }

    /**
     * Set the entry in our map for the provided id. If there is already an entry
     * for the provided id then we will evict that entry. Calling this method will
     * start an eviction timer at which point the entry you added will be evicted
     * from the cache.
     */
    public setEntry(
        id: Id,
        getEntry: () => Promise<DocumentContentCacheForUpdateEntry | null>,
    ): Promise<DocumentContentCacheForUpdateEntry | null> {
        // Evict the last entry before setting the new entry.
        const lastEntry = this._entryByDocumentId.get(id);
        lastEntry?.evict();

        const evict = () => {
            // If our entry was already evicted then don't evict it again.
            if (this._entryByDocumentId.get(id) !== nextEntry) return;

            clearTimeout(nextEntry.evictionTimeoutId);
            this._entryByDocumentId.delete(id);
        };

        const evictionTimeoutId = setTimeout(() => {
            evict();
        }, documentContentCacheEvictionTimeoutMs) as any as number;

        const nextEntry = {
            evictionTimeoutId,
            evict,
            promise: getEntry().then(
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

        return nextEntry.promise;
    }

    /**
     * Evict the entry for the provided id. noop if the entry doesn't exist.
     */
    public evictEntry(id: Id) {
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
    id: Id;
    clientId: Id;
}>();

declare module "prosemirror-transform" {
    interface Mapping {
        // We know this exists but `prosemirror-transform` marks it as internal:
        // https://github.com/ProseMirror/prosemirror-transform/blob/4372fb6de489ee6c8c6a8756682a9464ecde8f1b/src/map.ts#L221-L225
        //
        // We want to call this function in the same place as `prosemirror-collab`:
        // https://github.com/ProseMirror/prosemirror-collab/blob/94df0cc9288960e7e64dc9721abbf8f656df444f/src/collab.ts#L22
        setMirror(n: number, m: number): void;
    }
}

/**
 * Updates our document by applying some steps.
 *
 * - You may update a document no more than 20 steps at a time.
 * - The version number must be less than or equal to the current document
 *   version. If the version is less than we will rebase the steps you provided
 *   against the new document steps.
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
export async function updateDocumentContent({
    id,
    version: clientVersion,
    steps: clientSteps,
    clientId,
    editorPresenceUpdate,
    cacheOverrideForTest,
    fastForwardOnly = false,
}: {
    id: Id;
    version: number;
    steps: ReadonlyArray<Step>;
    clientId: Id;
    editorPresenceUpdate?: SchemaType<typeof DocumentEditorPresenceUpdateSchema>;
    cacheOverrideForTest?: DocumentContentCacheForUpdate;
    fastForwardOnly?: boolean;
}): Promise<{
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
    conflictingSteps: ReadonlyArray<{step: Step; clientId: Id}>;
    /**
     * The same `editorPresenceUpdate` sent in the `DocumentChannel` update for
     * this message.
     *
     * It is not necessarily the same as the `editorPresenceUpdate` in `input`
     * since the selection may have been transformed.
     */
    newEditorPresenceUpdate: SchemaType<typeof DocumentEditorPresenceUpdateSchema> | null;
}> {
    // TODO(calebmer): We need to validate that `editorPresenceUpdate.presenceStateKey`
    // starts with the session browser id!! This is important for permissions. Otherwise a
    // user could use this method to impersonate another user's presence update.

    if (editorPresenceUpdate?.presenceState) {
        if (editorPresenceUpdate.presenceState.version !== clientVersion)
            throw new InvalidArgumentError(
                "Editor presence update version should match the client version",
            );
    }

    const result = await retryDynamoConditionCheckErrors(async () => {
        if (!Number.isSafeInteger(clientVersion) || clientVersion < 0)
            throw new InvalidArgumentError("Expected a positive integer version number");

        const cache = cacheOverrideForTest ?? globalDocumentContentCacheForUpdate;
        assert(
            cache === globalDocumentContentCacheForUpdate || typeof jest !== "undefined",
            "Can only override the cache in Jest tests",
        );

        const internalDocument = await cache.getAndCacheDocument(id);
        if (!internalDocument)
            throw new NotFoundError("Can not update document that doesn't exist");

        if (clientVersion > internalDocument.version)
            throw new FailedPreconditionError(
                "Can not update document with steps at version ahead of the document's current version",
            );

        let content = internalDocument.content;
        let newSteps: ReadonlyArray<Step>;
        let newInvertedSteps: Array<Step>;
        let conflictingSteps: ReadonlyArray<{step: Step; invertedStep: Step; clientId: Id}>;
        let newEditorPresenceUpdateTextSelection: TextSelection | null;

        // If the client's version is the same as our server version then we can
        // directly apply the client's steps to the content.
        if (clientVersion === internalDocument.version) {
            const invertedClientSteps = [];

            for (const step of clientSteps) {
                const stepResult = step.apply(content);
                if (!stepResult.doc)
                    throw new FailedPreconditionError(
                        `Could not apply step to document: ${stepResult.failed!}`,
                    );

                invertedClientSteps.push(step.invert(content));

                assert(isDocumentContent(stepResult.doc));
                content = stepResult.doc;
            }

            newSteps = clientSteps;
            newInvertedSteps = invertedClientSteps;
            conflictingSteps = [];

            // We don't need to transform the selection when there's no conflict so just
            // validate it.
            if (!editorPresenceUpdate?.presenceState.textSelection) {
                newEditorPresenceUpdateTextSelection = null;
            } else {
                try {
                    newEditorPresenceUpdateTextSelection = new TextSelection(
                        content.resolve(editorPresenceUpdate.presenceState.textSelection.anchor),
                        content.resolve(editorPresenceUpdate.presenceState.textSelection.head),
                    );
                } catch (error) {
                    if (!(error instanceof RangeError)) throw error;
                    throw new InvalidArgumentError(
                        "Editor presence update selection positions are outside the document's contents",
                    );
                }
            }
        }
        // If the client is trying to update an older document version then we need to
        // rebase the client steps against steps which were applied before it.
        else {
            if (fastForwardOnly)
                throw new FailedPreconditionError("Non-fast-forward document content update received");

            assert(clientVersion < internalDocument.version);

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

                conflictingSteps = Array.from(
                    internalDocument.stepsAfterInitialSnapshot.slice(
                        internalDocument.stepsAfterInitialSnapshot.length - stepCount,
                    ),
                );
            } else {
                const otherSteps = await getDocumentStepsBetweenValidatedVersionRange({
                    id,
                    startVersion: clientVersion,
                    endVersion:
                        internalDocument.version -
                        internalDocument.stepsAfterInitialSnapshot.length,
                });

                conflictingSteps = [...otherSteps, ...internalDocument.stepsAfterInitialSnapshot];
            }

            assert(conflictingSteps.length === internalDocument.version - clientVersion);

            const invertedClientSteps = [];

            // Make sure all steps from the client were valid against the document at
            // `clientVersion`. So revert back to to that version and try applying our
            // client steps.
            //
            // We will drop any steps we can't rebase. But we still want to validate that
            // the original steps were ok.
            {
                let clientContent = content;

                for (let i = conflictingSteps.length - 1; i >= 0; i--) {
                    const {invertedStep} = conflictingSteps[i]!;
                    const invertedStepResult = invertedStep.apply(clientContent);
                    if (!invertedStepResult.doc)
                        throw new DataLossError(
                            `Could not apply inverse of saved document step: ${invertedStepResult.failed!}`,
                        );

                    assert(isDocumentContent(invertedStepResult.doc));
                    clientContent = invertedStepResult.doc;
                }

                for (const step of clientSteps) {
                    const stepResult = step.apply(clientContent);
                    if (!stepResult.doc)
                        throw new FailedPreconditionError(
                            `Could not apply step to document: ${stepResult.failed!}`,
                        );

                    invertedClientSteps.push(step.invert(clientContent));

                    assert(isDocumentContent(stepResult.doc));
                    clientContent = stepResult.doc;
                }

                // When there's a conflict, initialize the presence update selection with the
                // document content as the client sees it. We will need to map this selection
                // before returning!
                if (!editorPresenceUpdate?.presenceState.textSelection) {
                    newEditorPresenceUpdateTextSelection = null;
                } else {
                    try {
                        newEditorPresenceUpdateTextSelection = new TextSelection(
                            clientContent.resolve(
                                editorPresenceUpdate.presenceState.textSelection.anchor,
                            ),
                            clientContent.resolve(
                                editorPresenceUpdate.presenceState.textSelection.head,
                            ),
                        );
                    } catch (error) {
                        if (!(error instanceof RangeError)) throw error;
                        throw new InvalidArgumentError(
                            "Editor presence update selection positions are outside the document's contents",
                        );
                    }
                }
            }

            // See the guide for information on how to rebase a chain of steps against
            // another chain of steps:
            // https://prosemirror.net/docs/guide/#transform.rebasing
            //
            // Also see the client-side rebasing implementation:
            // https://github.com/ProseMirror/prosemirror-collab/blob/ed039eb7e62fd0079b51406863931c6f67046881/src/collab.ts#L14-L27
            const mapping = new Mapping();

            for (let i = invertedClientSteps.length - 1; i >= 0; i--)
                mapping.appendMap(invertedClientSteps[i]!.getMap());
            for (let i = 0; i < conflictingSteps.length; i++)
                mapping.appendMap(conflictingSteps[i]!.step.getMap());

            const rebasedSteps = [];
            const invertedRebasedSteps = [];
            let mapFrom = clientSteps.length;

            for (let i = 0; i < clientSteps.length; i++) {
                const rebasedStep = clientSteps[i]!.map(mapping.slice(mapFrom));
                mapFrom--;

                // Silently ignore steps we can't rebase. That's what the client
                // implementation does:
                // https://github.com/ProseMirror/prosemirror-collab/blob/ed039eb7e62fd0079b51406863931c6f67046881/src/collab.ts#L21
                if (!rebasedStep) continue;

                const rebasedStepResult = rebasedStep.apply(content);

                // Silently ignore steps we can't rebase. That's what the client
                // implementation does:
                // https://github.com/ProseMirror/prosemirror-collab/blob/ed039eb7e62fd0079b51406863931c6f67046881/src/collab.ts#L21
                if (!rebasedStepResult.doc) continue;

                invertedRebasedSteps.push(rebasedStep.invert(content));

                assert(isDocumentContent(rebasedStepResult.doc));
                content = rebasedStepResult.doc;
                rebasedSteps.push(rebasedStep);
                mapping.appendMap(rebasedStep.getMap());
                mapping.setMirror(mapFrom, mapping.maps.length - 1);
            }

            newSteps = rebasedSteps;
            newInvertedSteps = invertedRebasedSteps;

            // Map our selection which is using positions from client content to a
            // selection on the new document with resolved conflicts. While mapping we may
            // lose the selection so in that case update to null.
            if (newEditorPresenceUpdateTextSelection) {
                const selection = newEditorPresenceUpdateTextSelection.map(content, mapping);
                newEditorPresenceUpdateTextSelection =
                    selection instanceof TextSelection ? selection : null;
            }
        }

        // We want the inverted steps to be stored in reverse order of our steps. We
        // added the inverted steps in forward step order.
        newInvertedSteps.reverse();

        // This checkpoint allows us to write a test against our transaction's
        // condition.
        await updateDocumentContentBeforeExecuteTransactionTestCheckpoint.waitForTest({
            id,
            clientId,
        });

        if (newSteps.length > 0) {
            await DynamoTableSchema.executeTransaction([
                DocumentsTable.transactionPutItem(
                    {
                        partitionType: "Document",
                        documentId: id,
                        sortRangeType: "Attributes",
                        version: internalDocument.version + newSteps.length,
                        titleWithoutFallback: getDocumentContentTitleWithoutFallback(content),
                    },
                    {
                        condition: {
                            // Make sure a concurrent writer hasn't updated the document version before us.
                            version: internalDocument.version,
                        },
                    },
                ),
                DocumentsTable.transactionPutItem({
                    partitionType: "Document",
                    documentId: id,
                    sortRangeType: "StepTransactionsAfterSnapshot",
                    startVersion: internalDocument.version,
                    steps: newSteps,
                    invertedSteps: newInvertedSteps,
                    clientId,
                }),
            ]);

            // Update our cache so that the next update from this process doesn't need to
            // read content from the database.
            await internalDocument.updateCache({
                newContent: content,
                newSteps,
                newInvertedSteps,
                clientId,
            });
        }

        return {
            oldVersion: internalDocument.version,
            newVersion: internalDocument.version + newSteps.length,
            newContent: content,
            newSteps,
            conflictingSteps,
            newEditorPresenceUpdateTextSelection,
        };
    });

    const {
        oldVersion,
        newVersion,
        newContent,
        newSteps,
        conflictingSteps,
        newEditorPresenceUpdateTextSelection,
    } = result;

    const newEditorPresenceUpdate = editorPresenceUpdate
        ? {
              presenceStateKey: editorPresenceUpdate.presenceStateKey,
              presenceState: {
                  version: newVersion,
                  textSelection: newEditorPresenceUpdateTextSelection
                      ? {
                            anchor: newEditorPresenceUpdateTextSelection.$anchor.pos,
                            head: newEditorPresenceUpdateTextSelection.$head.pos,
                        }
                      : null,
              },
          }
        : null;

    // TODO(calebmer): Lint rule that all `await`s which can be parallelized are
    // indeed parallelized.
    await runAllPromises([
        publishToNetworkChannel(
            DocumentChannel,
            {documentId: id},
            {
                type: "UpdateContent",
                newVersion,
                steps: newSteps,
                clientId,
                editorPresenceUpdate: newEditorPresenceUpdate,
            },
        ),
        // We add a blocking update to our snapshot within the
        // `updateDocumentContent()` call. We don't pay the price of updating the
        // snapshot every update but rather every N updates (where N is 20-100 steps).
        //
        // We need a blocking update since we can't schedule a background task in a
        // serverless function. The function will be paused if there is no activity. We
        // could in the future use a task queue to update the snapshot as a background
        // job, but occasionally paying the snapshot update price within the
        // `updateDocumentContent()` function doesn't seem too bad.
        maybeUpdateDocumentSnapshotAfterUpdatingContent({
            id,
            oldVersion,
            newVersion,
            newContent,
        }),
    ]);

    return {
        newVersion,
        newSteps,
        conflictingSteps,
        newEditorPresenceUpdate,
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

export const updateDocumentSnapshotBeforeDeletingStepsTestCheckpoint = new TestCheckpoint<Id>();

async function maybeUpdateDocumentSnapshotAfterUpdatingContent({
    id,
    oldVersion,
    newVersion,
    newContent,
}: {
    id: Id;
    oldVersion: number;
    newVersion: number;
    newContent: DocumentContent;
}) {
    // Get the last version before `newVersion` which should trigger a snapshot.
    const lastVersionToTriggerSnapshot =
        Math.floor(newVersion / updateDocumentSnapshotAfterStepCount) *
        updateDocumentSnapshotAfterStepCount;

    // If we've already passed the last version number to trigger a snapshot then
    // we don't need to save a new snapshot.
    if (oldVersion >= lastVersionToTriggerSnapshot) return;

    const snapshot = await DocumentsTable.getPartialItem(
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
        await DocumentsTable.putItem(
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

    // Then, for all steps before our new snapshot version, move them into the
    // `StepTransactionsBeforeSnapshot` range so in the future when we read the
    // full document we don't read those steps.
    const stepTransactions = await arrayFromAsyncIterable(
        DocumentsTable.query({
            startKey: {
                partitionType: "Document",
                documentId: id,
                sortRangeType: "StepTransactionsAfterSnapshot",
                startVersion: 0,
            },
            endKey: {
                partitionType: "Document",
                documentId: id,
                sortRangeType: "StepTransactionsAfterSnapshot",
                startVersion: newVersion - 1,
            },
        }),
    );

    // Our writes should be batched under the hood if we dispatch them
    // in parallel like this.
    await runAllPromises(
        stepTransactions.map(async stepTransaction => {
            await DocumentsTable.putItem({
                ...stepTransaction,
                sortRangeType: "StepTransactionsBeforeSnapshot",
            });

            await updateDocumentSnapshotBeforeDeletingStepsTestCheckpoint.waitForTest(id);

            // It's important that we wait for our put in the
            // `StepTransactionsBeforeSnapshot` to successfully complete before we delete.
            await DocumentsTable.deleteItem(stepTransaction);
        }),
    );
}

/**
 * Reads all steps between `startVersion` (inclusive) and `endVersion` (exclusive).
 */
export async function getDocumentContentSteps({
    id,
    startVersion,
    endVersion,
}: {
    id: Id;
    startVersion: number;
    endVersion: number;
}) {
    // TODO(calebmer): Authorization!!!

    const document = await DocumentsTable.getPartialItem(
        {partitionType: "Document", documentId: id, sortRangeType: "Attributes"},
        {attributes: ["version"]},
    );

    if (!document) throw new NotFoundError("Document does not exist");

    if (startVersion < 0) throw new InvalidArgumentError("Start version is less than zero");
    if (startVersion > endVersion)
        throw new InvalidArgumentError("End version is greater than start version");
    if (startVersion === endVersion)
        throw new InvalidArgumentError("Start version is equal to end version");
    if (endVersion > document.version)
        throw new FailedPreconditionError(
            "End version is greater than the last version in the document",
        );

    return getDocumentStepsBetweenValidatedVersionRange({id, startVersion, endVersion});
}

/**
 * Reads all steps between `versionStart` (inclusive) and `endVersion` (exclusive).
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
async function getDocumentStepsBetweenValidatedVersionRange({
    id,
    startVersion,
    endVersion,
}: {
    id: Id;
    startVersion: number;
    endVersion: number;
}): Promise<Array<{step: Step; invertedStep: Step; clientId: Id}>> {
    const stepByVersion = new Map<number, {step: Step; invertedStep: Step; clientId: Id}>();

    for await (const stepTransaction of getDocumentStepTransactionsBetweenValidatedVersionRange({
        id,
        startVersion,
        endVersion,
    })) {
        for (let i = 0; i < stepTransaction.steps.length; i++) {
            const version = stepTransaction.startVersion + i;
            const step = stepTransaction.steps[i]!;
            const invertedStep =
                stepTransaction.invertedSteps[stepTransaction.steps.length - i - 1];
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
async function* getDocumentStepTransactionsBetweenValidatedVersionRange({
    id,
    startVersion,
    endVersion,
}: {
    id: Id;
    startVersion: number;
    endVersion: number;
}): AsyncIterableIterator<DocumentStepTransactionItem> {
    assert(Number.isSafeInteger(startVersion));
    assert(Number.isSafeInteger(endVersion));
    assert(startVersion < endVersion);
    assert(startVersion >= 0);

    const stepTransactionContainingStartVersion =
        await getDocumentStepTransactionContainingValidatedVersion(id, startVersion);

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
            for await (const stepTransaction of DocumentsTable.query({
                startKey: {
                    partitionType: "Document",
                    documentId: id,
                    sortRangeType: "StepTransactionsAfterSnapshot",
                    startVersion:
                        stepTransactionContainingStartVersion.startVersion +
                        stepTransactionContainingStartVersion.steps.length,
                },
                endKey: {
                    partitionType: "Document",
                    documentId: id,
                    sortRangeType: "StepTransactionsAfterSnapshot",
                    startVersion: endVersion - 1,
                },
            })) {
                yield stepTransaction;
            }
            return;
        }
        // If we start in the before snapshot range then we might not have all the
        // steps we need in the before snapshot range. So query the before snapshot
        // range and then determine if we also need to query the after snapshot range.
        case "StepTransactionsBeforeSnapshot": {
            const stepTransactionBeforeSnapshotIterator = DocumentsTable.query({
                startKey: {
                    partitionType: "Document",
                    documentId: id,
                    sortRangeType: "StepTransactionsBeforeSnapshot",
                    startVersion:
                        stepTransactionContainingStartVersion.startVersion +
                        stepTransactionContainingStartVersion.steps.length,
                },
                endKey: {
                    partitionType: "Document",
                    documentId: id,
                    sortRangeType: "StepTransactionsBeforeSnapshot",
                    startVersion: endVersion - 1,
                },
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

            const stepTransactionAfterSnapshotIterator = DocumentsTable.query({
                startKey: {
                    partitionType: "Document",
                    documentId: id,
                    sortRangeType: "StepTransactionsAfterSnapshot",
                    startVersion:
                        stepTransactionContainingStartVersion.startVersion +
                        stepTransactionContainingStartVersion.steps.length,
                },
                endKey: {
                    partitionType: "Document",
                    documentId: id,
                    sortRangeType: "StepTransactionsAfterSnapshot",
                    startVersion: endVersion - 1,
                },
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
    id: Id,
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
            DocumentsTable.query({
                limit: 1,
                descending: true,
                startKey: {
                    partitionType: "Document",
                    documentId: id,
                    sortRangeType: "StepTransactionsBeforeSnapshot",
                    startVersion: 0,
                },
                endKey: {
                    partitionType: "Document",
                    documentId: id,
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
            DocumentsTable.query({
                limit: 1,
                descending: true,
                startKey: {
                    partitionType: "Document",
                    documentId: id,
                    sortRangeType: "StepTransactionsAfterSnapshot",
                    startVersion: 0,
                },
                endKey: {
                    partitionType: "Document",
                    documentId: id,
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
