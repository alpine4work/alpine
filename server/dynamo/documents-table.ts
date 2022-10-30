import {Mapping, Step} from "prosemirror-transform";
import {DynamoConditionExpression} from "~/server/dynamo/internal/dynamo-condition";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/internal/dynamo-key-attribute-schema";
import {DynamoTableItemType, DynamoTableSchema} from "~/server/dynamo/internal/dynamo-table-schema";
import {isDynamoConditionCheckError} from "~/server/dynamo/internal/is-dynamo-condition-check-error";
import {retryDynamoConditionCheckErrors} from "~/server/dynamo/internal/retry-dynamo-condition-check-errors";
import {TestCheckpoint} from "~/server/helpers/test/test-checkpoint";
import {TestCounter} from "~/server/helpers/test/test-counter";
import {publishToNetworkChannel} from "~/server/network/publish-to-network-channel";
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
import {runAllPromises} from "~/shared/helpers/async/run-all-promises";
import {assert} from "~/shared/helpers/control/assert";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array-from-async-iterable";
import {iterableFlatMap} from "~/shared/helpers/iterable/iterable-flat-map";
import {iterableMap} from "~/shared/helpers/iterable/iterable-map";
import {clamp} from "~/shared/helpers/number/clamp";
import {Id} from "~/shared/id/id";
import {DocumentChannel} from "~/shared/network/documents-network-definition";
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
            case "Snapshot":
                maybeSnapshot = item;
                break;
            default:
                throw exhaustive(item);
        }
    }

    if (attributes === null) {
        assert(!maybeSnapshot, "Document with no attributes should not have snapshot");
        return null;
    }

    if (!maybeSnapshot)
        throw new DataLossError("Document with attributes should also have a snapshot");
    const snapshot = maybeSnapshot;

    if (snapshot.version > attributes.version)
        throw new DataLossError("Document snapshot version is ahead of version attribute");

    return {
        attributes,
        snapshot,
        model: new DocumentModel({
            id: id,
            version: attributes.version,
            content: snapshot.content,
        }),
    };
}

export const updateDocumentContentBeforeExecuteTransactionTestCheckpoint = new TestCheckpoint<{
    id: Id;
    clientId: Id;
}>();

/**
 * Updates our document by applying some steps. Only supports fast-forward updates, and shouldn't
 * be called from anything other than the collaboration worker which acts as a source of truth
 * for the very latest document version/steps.
 */
export async function updateDocumentContentByFastForwardFromCollaborationWorker({
    id,
    version: clientVersion,
    steps: clientSteps,
    clientId,
}: {
    id: Id;
    version: number;
    steps: ReadonlyArray<Step>;
    clientId: Id;
}): Promise<{
    /**
     * The new version of the document after applying our update.
     *
     * If there are no `conflictingSteps` then this should be
     * `version + steps.length`.
     */
    newVersion: number;
}> {
    const result = await retryDynamoConditionCheckErrors(async () => {
        if (!Number.isSafeInteger(clientVersion) || clientVersion < 0)
            throw new InvalidArgumentError("Expected a positive integer version number");

        const internalDocument = await readDocument(id);
        if (!internalDocument)
            throw new NotFoundError("Can not update document that doesn't exist");

        if (clientVersion !== internalDocument.version)
            throw new FailedPreconditionError("Can not fast-forward document from this version");

        let content = internalDocument.content;

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

        const newSteps = clientSteps;
        const newInvertedSteps = invertedClientSteps;

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
                    version: internalDocument.version,
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
        };
    });

    const {oldVersion, newVersion, newContent, newSteps, conflictingSteps} = result;

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
                version: 0,
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
}): Promise<Array<{step: Step; invertedStep: Step; clientId: Id}>> {
    assert(Number.isSafeInteger(versionStart));
    assert(Number.isSafeInteger(versionEnd));
    assert(versionStart <= versionEnd);
    assert(versionStart >= 0);

    const stepByVersion = new Map<number, {step: Step; invertedStep: Step; clientId: Id}>();

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
            const invertedStep = item.invertedSteps[item.steps.length - i - 1];
            if (!invertedStep) throw new DataLossError("Missing inverted document step");

            stepByVersion.set(version, {step, invertedStep, clientId: item.clientId});
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
                const invertedStep = item.invertedSteps[item.steps.length - i - 1];
                if (!invertedStep) throw new DataLossError("Missing inverted document step");

                // We may have a step in both the before snapshot range and the after snapshot
                // range while we are updating our snapshot. Prefer items in the before
                // snapshot range.
                if (stepByVersion.has(version)) continue;

                stepByVersion.set(version, {step, invertedStep, clientId: item.clientId});
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
