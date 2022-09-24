import {DynamoConditionExpression} from "~/server/dynamo/internal/dynamo-condition";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/internal/dynamo-key-attribute-schema";
import {DynamoTableSchema} from "~/server/dynamo/internal/dynamo-table-schema";
import {RequestContext} from "~/server/request/request-context";
import {
    DocumentContent,
    DocumentContentSchema,
    DocumentContentStepSchema,
} from "~/shared/content/document-content-schema";
import {assert} from "~/shared/helpers/control/assert";
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

export type DocumentForCreate = {
    readonly id: Id;
    readonly content: DocumentContent;
};

/**
 * Creates a new document with no history using the initial content provided.
 */
export async function createDocument(context: RequestContext, document: DocumentForCreate) {
    await context.executeTransaction([
        DocumentsTable.transactionPutItem(
            context,
            {
                partitionType: "Document",
                documentId: document.id,
                sortRangeType: "Attributes",
                version: 0,
                title: getDocumentContentTitle(document.content),
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
            documentId: document.id,
            sortRangeType: "Snapshot",
            version: 0,
            content: document.content,
        }),
    ]);
}
