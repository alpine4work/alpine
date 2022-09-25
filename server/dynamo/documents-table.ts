import {Mapping, Step} from "prosemirror-transform";
import {DynamoConditionExpression} from "~/server/dynamo/internal/dynamo-condition";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/internal/dynamo-key-attribute-schema";
import {DynamoTableItemType, DynamoTableSchema} from "~/server/dynamo/internal/dynamo-table-schema";
import {RequestContext} from "~/server/request/request-context";
import {RequestTextCheckpoint} from "~/server/request/request-text-checkpoint";
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

/**
 * Read the full document with the provided id.
 *
 * Not only returns the `Document` but also returns some of the document's
 * internal representation.
 */
async function readInternalDocument(
    context: RequestContext,
    id: Id,
): Promise<{
    attributes: DocumentAttributesItem;
    stepsAfterSnapshot: ReadonlyArray<DocumentStepAfterSnapshotItem>;
    snapshot: DocumentSnapshotItem;
    document: Document;
} | null> {
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

export const updateDocumentBeforeExecuteTransactionTestCheckpoint = new RequestTextCheckpoint();

/**
 * Updates our document by applying some steps.
 *
 * - You may update a document no more than 20 steps at a time.
 * - The version number must be less than or equal to the current document
 *   version. If the version is less than we will rebase the steps you provided
 *   against the new document steps.
 */
export async function updateDocument(
    context: RequestContext,
    {
        id,
        version: clientVersion,
        steps: clientSteps,
        clientId,
    }: {
        id: Id;
        version: number;
        steps: ReadonlyArray<Step>;
        clientId: Id;
    },
) {
    // This limit is in place because of [`TransactWriteItem`s][1] 25 action limit.
    //
    // [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_TransactWriteItems.html
    if (clientSteps.length > 20)
        throw new InvalidArgumentError("Can not update a document more than 20 steps at a time");

    // TODO(calebmer): Implement synchronous cache for recently updated documents?
    const internalDocument = await readInternalDocument(context, id);
    if (!internalDocument) throw new NotFoundError("Can not update document that doesn't exist");
    const {document} = internalDocument;

    if (clientVersion > document.version)
        throw new FailedPreconditionError(
            "Can not update document with steps at version ahead of the document's current version",
        );

    let content = document.content;
    let newSteps: ReadonlyArray<Step>;

    // If the client's version is the same as our server version then we can
    // directly apply the client's steps to the content.
    if (clientVersion === document.version) {
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
        assert(clientVersion < document.version);

        // Get the steps that were applied to bring our document from the provided
        // version to the document's current version.
        //
        // If we're lucky then the version we're trying to update is after our snapshot
        // so we've already loaded all the steps after the snapshot. Otherwise we need
        // to read new steps.
        let stepsToRebaseAgainst: Array<
            DocumentStepAfterSnapshotItem | DocumentStepBeforeSnapshotItem
        >;
        if (clientVersion >= internalDocument.snapshot.version) {
            const stepCount = document.version - clientVersion;

            stepsToRebaseAgainst = internalDocument.stepsAfterSnapshot.slice(
                internalDocument.stepsAfterSnapshot.length - stepCount,
            );
        } else {
            // TODO(calebmer): Test this code path!
            const stepsBeforeSnapshot = await readDocumentStepsBeforeSnapshot(context, {
                id,
                versionStart: clientVersion,
                versionEnd: internalDocument.snapshot.version - 1,
            });

            stepsToRebaseAgainst = [...stepsBeforeSnapshot, ...internalDocument.stepsAfterSnapshot];
        }

        assert(stepsToRebaseAgainst.length === document.version - clientVersion);

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
                const stepResult = step.step.invert(clientContent).apply(clientContent);
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
            mapping.appendMap(stepsToRebaseAgainst[i]!.step.getMap());

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

    // TODO(calebmer): Save new snapshot

    // TODO(calebmer): Retry on write condition failure

    // This checkpoint allows us to write a test against our transaction's
    // condition.
    await updateDocumentBeforeExecuteTransactionTestCheckpoint.waitForTest(context);

    await context.executeTransaction([
        DocumentsTable.transactionPutItem(
            context,
            {
                ...internalDocument.attributes,
                version: internalDocument.attributes.version + newSteps.length,
                // TODO(calebmer): Test title updates
                title: getDocumentContentTitle(content),
            },
            {
                condition: {
                    // Make sure a concurrent writer hasn't updated the document version before us.
                    version: internalDocument.attributes.version,
                },
            },
        ),
        ...newSteps.map((step, index) =>
            DocumentsTable.transactionPutItem(context, {
                partitionType: "Document",
                documentId: id,
                sortRangeType: "StepsAfterSnapshot",
                version: internalDocument.attributes.version + index,
                step,
                clientId,
            }),
        ),
    ]);
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
