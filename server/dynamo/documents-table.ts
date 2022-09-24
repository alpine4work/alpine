import {Step} from "prosemirror-transform";
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
                 * `StepsBeforeSnapshot`.
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
                    }),
                },
            },
        },
    },
});

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

async function readDocumentAndAttributes(
    context: RequestContext,
    id: Id,
): Promise<{
    attributes: DynamoTableItemType<typeof DocumentsTable, "Document", "Attributes">;
    document: Document;
} | null> {
    let attributes: DynamoTableItemType<typeof DocumentsTable, "Document", "Attributes"> | null =
        null;

    const stepByVersion = new Map<
        number,
        DynamoTableItemType<typeof DocumentsTable, "Document", "StepsAfterSnapshot">
    >();

    let snapshot: DynamoTableItemType<typeof DocumentsTable, "Document", "Snapshot"> | null = null;

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
                stepByVersion.set(item.version, item);
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
            !snapshot && stepByVersion.size === 0,
            "Document with no attributes should not have snapshot",
        );
        return null;
    }

    if (!snapshot) throw new DataLossError("Document with attributes should also have a snapshot");

    if (snapshot.version > attributes.version)
        throw new DataLossError("Document snapshot version is ahead of version attribute");

    let content = snapshot.content;

    for (let version = snapshot.version; version < attributes.version; version++) {
        const step = stepByVersion.get(version);
        if (!step) throw new DataLossError("Missing step after document snapshot");

        const stepResult = step.step.apply(content);
        if (!stepResult.doc)
            throw new DataLossError(
                `Step after document snapshot could not be applied: ${stepResult.failed!}`,
            );

        assert(isDocumentContent(stepResult.doc));
        content = stepResult.doc;
    }

    return {
        attributes,
        document: {
            id: id,
            title: attributes.title,
            version: attributes.version,
            content,
        },
    };
}

/**
 * Read the full document with the provided id.
 */
export async function readDocument(context: RequestContext, id: Id): Promise<Document | null> {
    const documentAndAttributes = await readDocumentAndAttributes(context, id);
    return documentAndAttributes?.document ?? null;
}

export const updateDocumentBeforeExecuteTransactionTestCheckpoint = new RequestTextCheckpoint();

/**
 * Updates our document by applying some steps. You may update a document no
 * more than 20 steps at a time. The version number must match the current
 * document version. Otherwise you will get an error.
 */
export async function updateDocument(
    context: RequestContext,
    {
        id,
        version,
        steps,
    }: {
        id: Id;
        version: number;
        steps: ReadonlyArray<Step>;
    },
) {
    // This limit is in place because of [`TransactWriteItem`s][1] 25 action limit.
    //
    // [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_TransactWriteItems.html
    if (steps.length > 20)
        throw new InvalidArgumentError("Can not update a document more than 20 steps at a time");

    // TODO(calebmer): Implement synchronous cache for recently updated documents?
    const documentAndAttributes = await readDocumentAndAttributes(context, id);
    if (!documentAndAttributes)
        throw new NotFoundError("Can not update document that doesn't exist");
    const {attributes, document} = documentAndAttributes;

    // TODO(calebmer): Rebase steps instead of failing
    if (document.version !== version)
        throw new FailedPreconditionError(
            "Incorrect document version, try rebasing your steps on the current document version",
        );

    // TODO(calebmer): Save new snapshot

    let content = document.content;
    for (const step of steps) {
        const stepResult = step.apply(content);
        if (!stepResult.doc)
            throw new FailedPreconditionError(
                `Could not apply step to document: ${stepResult.failed!}`,
            );

        assert(isDocumentContent(stepResult.doc));
        content = stepResult.doc;
    }

    // This checkpoint allows us to write a test against our transaction's
    // condition.
    await updateDocumentBeforeExecuteTransactionTestCheckpoint.waitForTest(context);

    await context.executeTransaction([
        DocumentsTable.transactionPutItem(
            context,
            {
                ...attributes,
                version: attributes.version + steps.length,
                title: getDocumentContentTitle(content),
            },
            {
                condition: {
                    // Make sure a concurrent writer hasn't updated the document version before us.
                    version: attributes.version,
                },
            },
        ),
        ...steps.map((step, index) =>
            DocumentsTable.transactionPutItem(context, {
                partitionType: "Document",
                documentId: id,
                sortRangeType: "StepsAfterSnapshot",
                version: attributes.version + index,
                step,
            }),
        ),
    ]);
}
