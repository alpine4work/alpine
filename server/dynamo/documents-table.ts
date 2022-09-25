import {Mapping, Step} from "prosemirror-transform";
import {DynamoConditionExpression} from "~/server/dynamo/internal/dynamo-condition";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/internal/dynamo-key-attribute-schema";
import {DynamoTableItemType, DynamoTableSchema} from "~/server/dynamo/internal/dynamo-table-schema";
import {retryDynamoConditionCheckErrors} from "~/server/dynamo/internal/retry-dynamo-condition-check-errors";
import {RequestContext} from "~/server/request/request-context";
import {RequestTestCheckpoint} from "~/server/request/request-test-checkpoint";
import {RequestTestCounter} from "~/server/request/request-test-counter";
import {
    DocumentContent,
    DocumentContentSchema,
    DocumentContentStepSchema,
    isDocumentContent,
} from "~/shared/content/document-content-schema";
import {
    DataLossError,
    FailedPreconditionError,
    InvalidArgumentError,
    NotFoundError,
} from "~/shared/error/error";
import {assert} from "~/shared/helpers/control/assert";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array-from-async-iterable";
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
                        title: Schema.string,
                    }),
                },

                /**
                 * Steps applied to the document after our latest snapshot.
                 *
                 * As a user is actively typing in the document we don't save the full snapshot
                 * to the database as that would be expensive. Instead we schedule a new
                 * snapshot to be taken later.
                 *
                 * When we update our snapshot, steps in this sort range will be moved to
                 * `StepsBeforeSnapshot` asynchronously. Since this happens asynchronously, keep
                 * in mind that:
                 *
                 * - Steps before the snapshot may temporarily exist in `StepsAfterSnapshot`
                 *   after the snapshot was updated.
                 * - Steps may temporarily exist in both `StepsAfterSnapshot` and
                 *   `StepsBeforeSnapshot`.
                 */
                StepsAfterSnapshot: {
                    sortKeyAttributes: {
                        /**
                         * The version this step is applied onto. The document version will always be
                         * one greater than the latest step.
                         */
                        version: DynamoKeyAttributeSchema.integer,
                    },
                    attributes: Schema.object({
                        /**
                         * The step applied to the document.
                         */
                        step: DocumentContentStepSchema,

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
                 * Steps applied to the document before our latest snapshot.
                 *
                 * We keep around old steps for historical purposes. We will read these steps
                 * when showing the document history.
                 */
                StepsBeforeSnapshot: {
                    sortKeyAttributes: {
                        /**
                         * The version this step is applied onto. The document version will always be
                         * one greater than the latest step.
                         */
                        version: DynamoKeyAttributeSchema.integer,
                    },
                    attributes: Schema.object({
                        /**
                         * The step applied to the document.
                         */
                        step: DocumentContentStepSchema,

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

type DocumentStepAfterSnapshotItem = DynamoTableItemType<
    typeof DocumentsTable,
    "Document",
    "StepsAfterSnapshot"
>;

type DocumentSnapshotItem = DynamoTableItemType<typeof DocumentsTable, "Document", "Snapshot">;

type DocumentStepBeforeSnapshotItem = DynamoTableItemType<
    typeof DocumentsTable,
    "Document",
    "StepsBeforeSnapshot"
>;

function getDocumentContentTitle(content: DocumentContent): string {
    const childNode = content.child(0);
    assert(childNode.type.name === "title");
    return childNode.textContent;
}

/**
 * Creates a new document with no history using the initial content provided.
 */
export async function createDocument(
    context: RequestContext,
    {
        id,
        content,
    }: {
        id: Id;
        content: DocumentContent;
    },
) {
    await context.executeTransaction([
        DocumentsTable.transactionPutItem(
            context,
            {
                partitionType: "Document",
                documentId: id,
                sortRangeType: "Attributes",
                version: 0,
                title: getDocumentContentTitle(content),
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
        DocumentsTable.transactionPutItem(context, {
            partitionType: "Document",
            documentId: id,
            sortRangeType: "Snapshot",
            version: 0,
            content,
        }),
    ]);
}

export type Document = {
    readonly id: Id;
    readonly title: string;
    readonly version: number;
    readonly content: DocumentContent;
};

/**
 * Read the full document with the provided id.
 */
export async function readDocument(context: RequestContext, id: Id): Promise<Document | null> {
    const internalDocument = await readInternalDocument(context, id);
    return internalDocument?.document ?? null;
}

type InternalDocument = {
    readonly attributes: DocumentAttributesItem;
    readonly stepsAfterSnapshot: ReadonlyArray<DocumentStepAfterSnapshotItem>;
    readonly snapshot: DocumentSnapshotItem;
    readonly document: Document;
};

export const readInternalDocumentTestCounter = new RequestTestCounter();

/**
 * Read the full document with the provided id.
 *
 * Not only returns the `Document` but also returns some of the document's
 * internal representation.
 */
async function readInternalDocument(
    context: RequestContext,
    id: Id,
): Promise<InternalDocument | null> {
    readInternalDocumentTestCounter.incrementForTest(context);

    let attributes: DocumentAttributesItem | null = null;
    let stepsAfterSnapshot: Array<
        DynamoTableItemType<typeof DocumentsTable, "Document", "StepsAfterSnapshot">
    > = [];
    let snapshot: DocumentSnapshotItem | null = null;

    for await (const item of DocumentsTable.query(context, {
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
            case "StepsAfterSnapshot":
                stepsAfterSnapshot.push(item);
                break;
            case "Snapshot":
                snapshot = item;
                break;
            default:
                throw exhaustive(item);
        }
    }

    if (attributes === null) {
        assert(
            !snapshot && stepsAfterSnapshot.length === 0,
            "Document with no attributes should not have snapshot",
        );
        return null;
    }

    if (!snapshot) throw new DataLossError("Document with attributes should also have a snapshot");

    if (snapshot.version > attributes.version)
        throw new DataLossError("Document snapshot version is ahead of version attribute");

    // If we have some steps before the snapshot in `stepsAfterSnapshot`, that's
    // fine. We may be in the middle of moving steps into the `StepsBeforeSnapshot`
    // short range.
    //
    // Drop any steps before the snapshot.
    if (stepsAfterSnapshot.length > attributes.version - snapshot.version) {
        // TODO(calebmer): Test this
        stepsAfterSnapshot = stepsAfterSnapshot.slice(
            stepsAfterSnapshot.length - attributes.version - snapshot.version,
        );
    }

    let content = snapshot.content;

    for (let version = snapshot.version; version < attributes.version; version++) {
        const step = stepsAfterSnapshot[version - snapshot.version];
        if (!step) throw new DataLossError("Missing step after document snapshot");

        if (step.version !== version)
            throw new DataLossError("Unexpected version for document step");

        const stepResult = step.step.apply(content);
        if (!stepResult.doc)
            throw new DataLossError(
                `Step after document snapshot could not be applied: ${stepResult.failed!}`,
            );

        assert(isDocumentContent(stepResult.doc));
        content = stepResult.doc;
        stepsAfterSnapshot.push(step);
    }

    return {
        attributes,
        stepsAfterSnapshot,
        snapshot,
        document: {
            id: id,
            title: attributes.title,
            version: attributes.version,
            content,
        },
    };
}

export const updateDocumentBeforeExecuteTransactionTestCheckpoint = new RequestTestCheckpoint();

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
    private readonly _cachedContentPromiseByDocumentId = new Map<
        Id,
        Promise<{
            evictionTimeoutId: NodeJS.Timer;
            version: number;
            content: DocumentContent;
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
            stepsAfterInitialSnapshot: PushOnlyArray<Step>;
        } | null>
    >();

    constructor() {
        // In our test environment, add a hook to evict all cached content at the end
        // of every test. That way we don't have timeouts sitting around and firing
        // randomly.
        if (typeof jest !== "undefined") {
            afterEach(() => {
                for (const [id, cachedContentPromise] of this._cachedContentPromiseByDocumentId) {
                    this._cachedContentPromiseByDocumentId.delete(id);
                    void cachedContentPromise.then(cachedContent => {
                        if (cachedContent) clearTimeout(cachedContent.evictionTimeoutId);
                    });
                }
            });
        }
    }

    public async readAndCacheDocument(
        context: RequestContext,
        id: Id,
    ): Promise<{
        version: number;
        content: DocumentContent;

        /**
         * Steps after the snapshot the content was loaded at.
         *
         * Some of these steps may be before the current document snapshot if the
         * document snapshot was updated after our cache loaded the document.
         */
        stepsAfterInitialSnapshot: PushOnlyArraySlice<Step>;

        /**
         * Update the cache with the provided content object and steps. We do not
         * validate that the new content or steps are correct and trust the caller to
         * do that!
         */
        updateCache: (newContent: DocumentContent, newSteps: ReadonlyArray<Step>) => void;
    } | null> {
        let cachedContentPromise = this._cachedContentPromiseByDocumentId.get(id);
        const wasContentCached = !!cachedContentPromise;

        if (!cachedContentPromise) {
            // Set a timeout that will remove this content from our cache.
            const evictionTimeoutId = setTimeout(() => {
                // Make sure the entry for our document id hasn't changed. We don't want to
                // touch someone else's state.
                if (this._cachedContentPromiseByDocumentId.get(id) !== cachedContentPromise) return;

                this._cachedContentPromiseByDocumentId.delete(id);
            }, documentContentCacheEvictionTimeoutMs);

            cachedContentPromise = readInternalDocument(context, id).then(
                internalDocument => {
                    // If the document doesn't exist, immediately evict the promise from the cache.
                    if (!internalDocument) {
                        clearTimeout(evictionTimeoutId);
                        this._cachedContentPromiseByDocumentId.delete(id);
                        return null;
                    }

                    return {
                        evictionTimeoutId,
                        version: internalDocument.document.version,
                        content: internalDocument.document.content,
                        stepsAfterInitialSnapshot: new PushOnlyArray(
                            iterableMap(internalDocument.stepsAfterSnapshot, ({step}) => step),
                        ),
                    };
                },
                error => {
                    // If we threw an error reading the document, immediately evict the promise
                    // from the cache.
                    clearTimeout(evictionTimeoutId);
                    this._cachedContentPromiseByDocumentId.delete(id);
                    throw error;
                },
            );
            this._cachedContentPromiseByDocumentId.set(id, cachedContentPromise);
        }

        const cachedContent = await cachedContentPromise;
        if (!cachedContent) return null;

        // If our content was already cached, then we want to verify that the cached
        // content version is the same as the content version in the database.
        //
        // Another process may have written to the database in which case the cache in
        // this process wouldn't know. If another process wrote to the database we
        // can't use our cached value and should instead do a full read from the
        // database.
        if (wasContentCached) {
            const attributes = await DocumentsTable.getItem(context, {
                partitionType: "Document",
                documentId: id,
                sortRangeType: "Attributes",
            });

            // The document was deleted from the database but not our cache.
            if (!attributes) {
                clearTimeout(cachedContent.evictionTimeoutId);
                this._cachedContentPromiseByDocumentId.delete(id);
                return null;
            }

            // If the version in our cache does not match the version in the database,
            // clear our cache and call this function again. That should read the full
            // document fresh and put it in the cache.
            //
            // TODO(calebmer): Instead of clearing the cache, what if we loaded the new
            // steps into it?
            if (cachedContent.version !== attributes.version) {
                clearTimeout(cachedContent.evictionTimeoutId);
                this._cachedContentPromiseByDocumentId.delete(id);
                return this.readAndCacheDocument(context, id);
            }
        }

        return {
            version: cachedContent.version,
            content: cachedContent.content,
            // Create a slice of `stepsAfterInitialSnapshot` so that when we mutate the
            // array from within this function, other code with a reference to the array
            // won't see the new values.
            stepsAfterInitialSnapshot: cachedContent.stepsAfterInitialSnapshot.slice(),

            updateCache: (newContent, newSteps) => {
                // Make sure the entry for our document id hasn't changed. We don't want to
                // touch someone else's state.
                if (this._cachedContentPromiseByDocumentId.get(id) !== cachedContentPromise) return;

                cachedContent.version += newSteps.length;
                cachedContent.content = newContent;
                for (const step of newSteps) cachedContent.stepsAfterInitialSnapshot.push(step);

                // Reset the eviction timeout every time our cached content updates. So while a
                // user is continuously updating, we keep the content around in the cache.
                clearTimeout(cachedContent.evictionTimeoutId);
                cachedContent.evictionTimeoutId = setTimeout(() => {
                    // Make sure the entry for our document id hasn't changed. We don't want to
                    // touch someone else's state.
                    if (this._cachedContentPromiseByDocumentId.get(id) !== cachedContentPromise)
                        return;

                    this._cachedContentPromiseByDocumentId.delete(id);
                }, documentContentCacheEvictionTimeoutMs);
            },
        };
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
export async function updateDocumentContent(
    context: RequestContext,
    {
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
    },
) {
    const result = await retryDynamoConditionCheckErrors(async () => {
        // This limit is in place because of [`TransactWriteItem`s][1] 25 action limit.
        //
        // [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_TransactWriteItems.html
        if (clientSteps.length > 20)
            throw new InvalidArgumentError(
                "Can not update a document more than 20 steps at a time",
            );

        const cache = cacheOverrideForTest ?? globalDocumentContentCacheForUpdate;
        assert(
            cache === globalDocumentContentCacheForUpdate || typeof jest !== "undefined",
            "Can only override the cache in Jest tests",
        );

        const internalDocument = await cache.readAndCacheDocument(context, id);
        if (!internalDocument)
            throw new NotFoundError("Can not update document that doesn't exist");

        if (clientVersion > internalDocument.version)
            throw new FailedPreconditionError(
                "Can not update document with steps at version ahead of the document's current version",
            );

        let content = internalDocument.content;
        let newSteps: ReadonlyArray<Step>;

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

            newSteps = clientSteps;
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
            let stepsToRebaseAgainst: Array<Step>;
            if (
                clientVersion >=
                internalDocument.version - internalDocument.stepsAfterInitialSnapshot.length
            ) {
                const stepCount = internalDocument.version - clientVersion;

                stepsToRebaseAgainst = Array.from(
                    internalDocument.stepsAfterInitialSnapshot.slice(
                        internalDocument.stepsAfterInitialSnapshot.length - stepCount,
                    ),
                );
            } else {
                // TODO(calebmer): Test this code path!
                const stepsBeforeSnapshot = await readDocumentStepsBeforeSnapshot(context, {
                    id,
                    versionStart: clientVersion,
                    versionEnd:
                        internalDocument.version -
                        internalDocument.stepsAfterInitialSnapshot.length -
                        1,
                });

                stepsToRebaseAgainst = [
                    ...stepsBeforeSnapshot.map(({step}) => step),
                    ...internalDocument.stepsAfterInitialSnapshot,
                ];
            }

            assert(stepsToRebaseAgainst.length === internalDocument.version - clientVersion);

            const invertedClientSteps = [];

            // Make sure all steps from the client were valid against the document at
            // `clientVersion`. So revert back to to that version and try applying our
            // client steps.
            //
            // We will drop any steps we can't rebase. But we still want to validate that
            // the original steps were ok.
            {
                let clientContent = content;

                for (let i = stepsToRebaseAgainst.length - 1; i >= 0; i--) {
                    const step = stepsToRebaseAgainst[i]!;
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
            for (let i = 0; i < stepsToRebaseAgainst.length; i++)
                mapping.appendMap(stepsToRebaseAgainst[i]!.getMap());

            const rebasedSteps = [];
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
                rebasedSteps.push(rebasedStep);
                mapping.appendMap(rebasedStep.getMap());
            }

            newSteps = rebasedSteps;
        }

        // This checkpoint allows us to write a test against our transaction's
        // condition.
        await updateDocumentBeforeExecuteTransactionTestCheckpoint.waitForTest(context);

        if (newSteps.length > 0) {
            await context.executeTransaction([
                DocumentsTable.transactionPutItem(
                    context,
                    {
                        partitionType: "Document",
                        documentId: id,
                        sortRangeType: "Attributes",
                        version: internalDocument.version + newSteps.length,
                        title: getDocumentContentTitle(content),
                    },
                    {
                        condition: {
                            // Make sure a concurrent writer hasn't updated the document version before us.
                            version: internalDocument.version,
                        },
                    },
                ),
                ...newSteps.map((step, index) =>
                    DocumentsTable.transactionPutItem(context, {
                        partitionType: "Document",
                        documentId: id,
                        sortRangeType: "StepsAfterSnapshot",
                        version: internalDocument.version + index,
                        step,
                        clientId,
                    }),
                ),
            ]);

            // Update our cache so that the next update from this process doesn't need to
            // read content from the database.
            internalDocument.updateCache(content, newSteps);
        }

        return {
            newVersion: internalDocument.version + newSteps.length,
            newSteps,
        };
    });

    // We add a blocking update to our snapshot within the
    // `updateDocumentContent()` call. We don't pay the price of updating the
    // snapshot every update but rather every N updates (where N is 20-100 steps).
    //
    // We need a blocking update since we can't schedule a background task in a
    // serverless function. The function will be paused if there is no activity. We
    // could in the future use a task queue to update the snapshot as a background
    // job, but occasionally paying the snapshot update price within the
    // `updateDocumentContent()` function doesn't seem too bad.
    await maybeUpdateDocumentSnapshotAfterUpdatingContent(context, result);
}

const updateDocumentSnapshotAfterStepCount = 100;

async function maybeUpdateDocumentSnapshotAfterUpdatingContent(
    context: RequestContext,
    {
        newVersion,
        newSteps,
    }: {
        newVersion: number;
        newSteps: ReadonlyArray<Step>;
    },
) {
    // Get the last version before `newVersion` which should trigger a snapshot.
    const lastVersionToTriggerSnapshot =
        Math.floor(newVersion / updateDocumentSnapshotAfterStepCount) *
        updateDocumentSnapshotAfterStepCount;

    const oldVersion = newVersion - newSteps.length;

    // If we've already passed the last version number to trigger a snapshot then
    // we don't need to save a new snapshot.
    if (oldVersion >= lastVersionToTriggerSnapshot) return;

    // TODO(calebmer): Implement
}

/**
 * Reads all steps between `versionStart` and `versionEnd` before the document
 * snapshot. Inclusive of `versionStart` and `versionEnd`. Make sure
 * `versionEnd` is after the document snapshot!
 */
async function readDocumentStepsBeforeSnapshot(
    context: RequestContext,
    {
        id,
        versionStart,
        versionEnd,
    }: {
        id: Id;
        versionStart: number;
        versionEnd: number;
    },
): Promise<Array<DocumentStepBeforeSnapshotItem>> {
    assert(versionStart <= versionEnd);

    const items = await arrayFromAsyncIterable(
        DocumentsTable.query(context, {
            startKey: {
                partitionType: "Document",
                documentId: id,
                sortRangeType: "StepsBeforeSnapshot",
                version: versionStart,
            },
            endKey: {
                partitionType: "Document",
                documentId: id,
                sortRangeType: "StepsBeforeSnapshot",
                version: versionEnd,
            },
        }),
    );

    // TODO(calebmer): This doesn't work if we're incrementally moving steps from
    // before the snapshot to after the snapshot...
    if (items.length !== versionEnd - versionStart) {
        const snapshot = await DocumentsTable.getItem(context, {
            partitionType: "Document",
            documentId: id,
            sortRangeType: "Snapshot",
        });

        if (!snapshot) throw new NotFoundError("Document does not exist");

        if (!(versionEnd <= snapshot.version))
            throw new FailedPreconditionError(
                "Should have provided an end version before the document snapshot but instead the end version was after the document snapshot",
            );

        throw new DataLossError("Missing some steps before document snapshot");
    }

    return items;
}
