import {Mapping, Step} from "prosemirror-transform";
import {DynamoConditionExpression} from "~/server/dynamo/internal/dynamo-condition";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/internal/dynamo-key-attribute-schema";
import {DynamoTableItemType, DynamoTableSchema} from "~/server/dynamo/internal/dynamo-table-schema";
import {retryDynamoConditionCheckErrors} from "~/server/dynamo/internal/retry-dynamo-condition-check-errors";
import {TestCheckpoint} from "~/server/helpers/test/test-checkpoint";
import {TestCounter} from "~/server/helpers/test/test-counter";
import {
    DocumentContent,
    DocumentContentSchema,
    DocumentContentStepSchema,
    isDocumentContent,
} from "~/shared/documents/document-content-schema";
import {
    DocumentModel,
    DocumentPreviewModel,
    getDocumentContentTitleWithoutFallback,
} from "~/shared/documents/document-model";
import {
    DataLossError,
    FailedPreconditionError,
    InternalError,
    InvalidArgumentError,
    NotFoundError,
} from "~/shared/error/error";
import {assert} from "~/shared/helpers/control/assert";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array-from-async-iterable";
import {iterableFlatMap} from "~/shared/helpers/iterable/iterable-flat-map";
import {iterableMap} from "~/shared/helpers/iterable/iterable-map";
import {clamp} from "~/shared/helpers/number/clamp";
import {Id} from "~/shared/id/id";
import {Schema} from "~/shared/schema/schema";

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
                         * The version this step transaction is applied onto. The document version will
                         * always be one greater than the latest step.
                         */
                        version: DynamoKeyAttributeSchema.integer,
                    },
                    attributes: Schema.object({
                        /**
                         * The steps applied to the document in this transaction.
                         */
                        steps: Schema.array(DocumentContentStepSchema),

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
                         * The version this step is applied onto. The document version will always be
                         * one greater than the latest step.
                         */
                        version: DynamoKeyAttributeSchema.integer,
                    },
                    attributes: Schema.object({
                        /**
                         * The steps applied to the document.
                         */
                        steps: Schema.array(DocumentContentStepSchema),

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
 * Read the full document with the provided id.
 */
export async function readDocument(id: Id): Promise<DocumentModel | null> {
    const internalDocument = await readInternalDocument(id);
    return internalDocument?.model ?? null;
}

/**
 * Read a preview of the document with the provided id.
 *
 * Cheaper than `readDocument()` since we don't return the full content.
 */
export async function readDocumentPreview(id: Id): Promise<DocumentPreviewModel | null> {
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

export const readInternalDocumentTestCounter = new TestCounter();

/**
 * Read the full document with the provided id.
 *
 * Not only returns the `Document` but also returns some of the document's
 * internal representation.
 */
async function readInternalDocument(id: Id): Promise<InternalDocument | null> {
    readInternalDocumentTestCounter.incrementForTest(id);

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
        if (stepTransaction.version < snapshot.version) {
            // We assume step transactions are applied to the snapshot atomically. We don't
            // support some steps in a transaction being before the snapshot and some steps
            // in a transaction being after the snapshot. It's all or nothing for now.
            if (stepTransaction.version + stepTransaction.steps.length > snapshot.version)
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
        if (stepTransaction.version !== version)
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

    public async readAndCacheDocument(id: Id): Promise<{
        readonly version: number;
        readonly content: DocumentContent;

        /**
         * Steps after the snapshot the content was loaded at.
         *
         * Some of these steps may be before the current document snapshot if the
         * document snapshot was updated after our cache loaded the document.
         */
        readonly stepsAfterInitialSnapshot: PushOnlyArraySlice<{
            readonly clientId: Id;
            readonly step: Step;
        }>;

        /**
         * Update the cache with the provided content object and steps. We do not
         * validate that the new content or steps are correct and trust the caller to
         * do that!
         */
        updateCache(options: {
            newContent: DocumentContent;
            newSteps: ReadonlyArray<Step>;
            clientId: Id;
        }): Promise<void>;
    } | null> {
        let wasEntryCached = true;

        const nullableEntry = await this._entries.getOrSetEntry(id, async () => {
            wasEntryCached = false;

            const internalDocument = await readInternalDocument(id);
            if (!internalDocument) return null;

            return {
                version: internalDocument.model.version,
                content: internalDocument.model.content,
                stepsAfterInitialSnapshot: new PushOnlyArray(
                    iterableFlatMap(
                        internalDocument.stepTransactionsAfterSnapshot,
                        ({clientId, steps}) => iterableMap(steps, step => ({step, clientId})),
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
                    const stepTransactions = await arrayFromAsyncIterable(
                        DocumentsTable.query({
                            startKey: {
                                partitionType: "Document",
                                documentId: id,
                                sortRangeType: "StepTransactionsAfterSnapshot",
                                version: entry.version,
                            },
                            endKey: {
                                partitionType: "Document",
                                documentId: id,
                                sortRangeType: "StepTransactionsAfterSnapshot",
                                version: attributes.version - 1,
                            },
                        }),
                    );

                    let version = entry.version;
                    let content = entry.content;

                    // Make sure we have all the right steps and apply them to our cached content.
                    for (const stepTransaction of stepTransactions) {
                        if (stepTransaction.version !== version)
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

                        for (const step of stepTransaction.steps) {
                            entry.stepsAfterInitialSnapshot.push({
                                clientId: stepTransaction.clientId,
                                step,
                            });
                        }
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

            updateCache: async ({newContent, newSteps, clientId}) => {
                for (const step of newSteps) entry.stepsAfterInitialSnapshot.push({clientId, step});

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
        readonly clientId: Id;
        readonly step: Step;
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
            evictionTimeoutId: NodeJS.Timer;
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
        }, documentContentCacheEvictionTimeoutMs);

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
        this._start = clamp(Math.floor(start), 0, array.length);
        this._end = clamp(Math.floor(end), this._start, array.length);
    }

    public get length() {
        return this._end - this._start;
    }

    public slice(start: number = 0, end: number = this.length): PushOnlyArraySlice<Item> {
        return new PushOnlyArraySlice(
            this._array,
            this._start + clamp(start, 0, this.length),
            this._start + clamp(end, 0, this.length),
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
    cacheOverrideForTest,
}: {
    id: Id;
    version: number;
    steps: ReadonlyArray<Step>;
    clientId: Id;
    cacheOverrideForTest?: DocumentContentCacheForUpdate;
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
    rebasedSteps: ReadonlyArray<Step>;
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
}> {
    const result = await retryDynamoConditionCheckErrors(async () => {
        if (!Number.isSafeInteger(clientVersion) || clientVersion < 0)
            throw new InvalidArgumentError("Expected a positive integer version number");

        const cache = cacheOverrideForTest ?? globalDocumentContentCacheForUpdate;
        assert(
            cache === globalDocumentContentCacheForUpdate || typeof jest !== "undefined",
            "Can only override the cache in Jest tests",
        );

        const internalDocument = await cache.readAndCacheDocument(id);
        if (!internalDocument)
            throw new NotFoundError("Can not update document that doesn't exist");

        if (clientVersion > internalDocument.version)
            throw new FailedPreconditionError(
                "Can not update document with steps at version ahead of the document's current version",
            );

        let content = internalDocument.content;
        let rebasedSteps: ReadonlyArray<Step>;
        let conflictingSteps: ReadonlyArray<{step: Step; clientId: Id}>;

        // If the client's version is the same as our server version then we can
        // directly apply the client's steps to the content.
        if (clientVersion === internalDocument.version) {
            for (const step of clientSteps) {
                const stepResult = step.apply(content);
                if (!stepResult.doc)
                    throw new FailedPreconditionError(
                        `Could not apply step to document: ${stepResult.failed!}`,
                    );

                assert(isDocumentContent(stepResult.doc));
                content = stepResult.doc;
            }

            rebasedSteps = clientSteps;
            conflictingSteps = [];
        }
        // If the client is trying to update an older document version then we need to
        // rebase the client steps against steps which were applied before it.
        else {
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
                const otherSteps = await readDocumentStepsForValidatedVersionRange({
                    id,
                    versionStart: clientVersion,
                    versionEnd:
                        internalDocument.version -
                        internalDocument.stepsAfterInitialSnapshot.length -
                        1,
                });

                conflictingSteps = [
                    ...otherSteps.map(({step, clientId}) => ({step, clientId})),
                    ...internalDocument.stepsAfterInitialSnapshot,
                ];
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
                    const {step} = conflictingSteps[i]!;
                    const stepResult = step.invert(clientContent).apply(clientContent);
                    if (!stepResult.doc)
                        throw new DataLossError(
                            `Could not apply inverse of saved document step: ${stepResult.failed!}`,
                        );

                    assert(isDocumentContent(stepResult.doc));
                    clientContent = stepResult.doc;
                }

                for (const step of clientSteps) {
                    const stepResult = step.apply(clientContent);
                    if (!stepResult.doc)
                        throw new FailedPreconditionError(
                            `Could not apply step to document: ${stepResult.failed!}`,
                        );

                    assert(isDocumentContent(stepResult.doc));
                    clientContent = stepResult.doc;
                    invertedClientSteps.push(step.invert(clientContent));
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

            const newRebasedSteps = [];
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

                assert(isDocumentContent(rebasedStepResult.doc));
                content = rebasedStepResult.doc;
                newRebasedSteps.push(rebasedStep);
                mapping.appendMap(rebasedStep.getMap());
            }

            rebasedSteps = newRebasedSteps;
        }

        // This checkpoint allows us to write a test against our transaction's
        // condition.
        await updateDocumentContentBeforeExecuteTransactionTestCheckpoint.waitForTest({
            id,
            clientId,
        });

        if (rebasedSteps.length > 0) {
            await DynamoTableSchema.executeTransaction([
                DocumentsTable.transactionPutItem(
                    {
                        partitionType: "Document",
                        documentId: id,
                        sortRangeType: "Attributes",
                        version: internalDocument.version + rebasedSteps.length,
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
                    version: internalDocument.version,
                    steps: rebasedSteps,
                    clientId,
                }),
            ]);

            // Update our cache so that the next update from this process doesn't need to
            // read content from the database.
            await internalDocument.updateCache({
                newContent: content,
                newSteps: rebasedSteps,
                clientId,
            });
        }

        return {
            oldVersion: internalDocument.version,
            newVersion: internalDocument.version + rebasedSteps.length,
            newContent: content,
            rebasedSteps,
            conflictingSteps,
        };
    });

    const {oldVersion, newVersion, newContent, rebasedSteps, conflictingSteps} = result;

    // We add a blocking update to our snapshot within the
    // `updateDocumentContent()` call. We don't pay the price of updating the
    // snapshot every update but rather every N updates (where N is 20-100 steps).
    //
    // We need a blocking update since we can't schedule a background task in a
    // serverless function. The function will be paused if there is no activity. We
    // could in the future use a task queue to update the snapshot as a background
    // job, but occasionally paying the snapshot update price within the
    // `updateDocumentContent()` function doesn't seem too bad.
    await maybeUpdateDocumentSnapshotAfterUpdatingContent({
        id,
        oldVersion,
        newVersion,
        newContent,
    });

    return {
        newVersion,
        rebasedSteps,
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

    // First, update the snapshot. We can't start moving steps until we know the
    // snapshot has successfully updated.
    await DocumentsTable.putItem({
        partitionType: "Document",
        documentId: id,
        sortRangeType: "Snapshot",
        version: newVersion,
        content: newContent,
    });

    // Then, for all steps between our snapshot and new version, move them into the
    // `StepTransactionsBeforeSnapshot` range so in the future when read read the
    // full document we don't read those steps.
    const stepTransactions = await arrayFromAsyncIterable(
        DocumentsTable.query({
            startKey: {
                partitionType: "Document",
                documentId: id,
                sortRangeType: "StepTransactionsAfterSnapshot",
                version: snapshot.version,
            },
            endKey: {
                partitionType: "Document",
                documentId: id,
                sortRangeType: "StepTransactionsAfterSnapshot",
                version: newVersion - 1,
            },
        }),
    );

    // Our writes should be batched under the hood if we dispatch them
    // in parallel like this.
    //
    // TODO(calebmer): Lint rule against `Promise.all()`. Replace with a utility
    // like `Promise.allSettled()`.
    await Promise.all(
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
 * Reads all steps between `versionStart` and `versionEnd` inclusive.
 *
 * We assume you have checked that `versionEnd` is a version that exists! We
 * will throw a `DataLossError` if we don't find steps up to `versionEnd`.
 *
 * We also assert that `versionStart` is less than `versionEnd` and
 * `versionStart` is greater than zero.
 *
 * We call this function "for validated version range" because we assume
 * `versionStart` and `versionEnd` are valid.
 *
 * We start by looking in the `StepsBeforeSnapshot` range since it has all our
 * historical steps. If we can't find all the steps we need then we check the
 * `StepsAfterSnapshot` range.
 */
async function readDocumentStepsForValidatedVersionRange({
    id,
    versionStart,
    versionEnd,
}: {
    id: Id;
    versionStart: number;
    versionEnd: number;
}): Promise<Array<{step: Step; clientId: Id}>> {
    assert(Number.isSafeInteger(versionStart));
    assert(Number.isSafeInteger(versionEnd));
    assert(versionStart <= versionEnd);
    assert(versionStart >= 0);

    const stepByVersion = new Map<number, {step: Step; clientId: Id}>();

    const stepTransactionBeforeSnapshotItems = await arrayFromAsyncIterable(
        DocumentsTable.query({
            startKey: {
                partitionType: "Document",
                documentId: id,
                sortRangeType: "StepTransactionsBeforeSnapshot",
                version: versionStart,
            },
            endKey: {
                partitionType: "Document",
                documentId: id,
                sortRangeType: "StepTransactionsBeforeSnapshot",
                version: versionEnd,
            },
        }),
    );

    for (const item of stepTransactionBeforeSnapshotItems) {
        for (let i = 0; i < item.steps.length; i++) {
            const version = item.version + i;
            const step = item.steps[i]!;

            stepByVersion.set(version, {step, clientId: item.clientId});
        }
    }

    // Did we get all the steps from our before snapshot range? If yes we don't
    // need to query the after snapshot range.
    if (stepByVersion.size < versionEnd - versionStart) {
        const stepTransactionAfterSnapshotItems = await arrayFromAsyncIterable(
            DocumentsTable.query({
                startKey: {
                    partitionType: "Document",
                    documentId: id,
                    sortRangeType: "StepTransactionsAfterSnapshot",
                    version: versionStart,
                },
                endKey: {
                    partitionType: "Document",
                    documentId: id,
                    sortRangeType: "StepTransactionsAfterSnapshot",
                    version: versionEnd,
                },
            }),
        );

        for (const item of stepTransactionAfterSnapshotItems) {
            for (let i = 0; i < item.steps.length; i++) {
                const version = item.version + i;
                const step = item.steps[i]!;

                // We may have a step in both the before snapshot range and the after snapshot
                // range while we are updating our snapshot. Prefer items in the before
                // snapshot range.
                if (stepByVersion.has(version)) continue;

                stepByVersion.set(version, {step, clientId: item.clientId});
            }
        }
    }

    const steps = [];

    for (let version = versionStart; version <= versionEnd; version++) {
        const step = stepByVersion.get(version);
        if (!step) throw new DataLossError("Missing a document step");
        steps.push(step);
    }

    return steps;
}
