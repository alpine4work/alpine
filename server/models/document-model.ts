import {emptyContent} from "~/shared/content/content-schema";
import {generateId, Id} from "~/shared/id/id";

type DocumentSnapshot = {
    readonly type: "Snapshot";
    readonly documentId: Id;
    readonly version: number;
    readonly doc: unknown;
};

type DocumentStepAfterSnapshot = {
    readonly type: "StepAfterSnapshot";
    readonly documentId: Id;
    readonly clientId: Id;
    readonly version: number;
    readonly step: unknown;
};

type DocumentStepBeforeSnapshot = {
    readonly type: "StepBeforeSnapshot";
    readonly documentId: Id;
    readonly clientId: Id;
    readonly version: number;
    readonly step: unknown;
};

const DocumentTable = DynamodbTable.new({
    name: "documents",
    partitionKey: IdSchema,
    items: [
        {
            name: "snapshot",
            sortKey: null,
            attributes: {
                version: IntegerSchema,
                doc: ProsemirrorDocSchema.new(DocumentProsemirrorSchema),
            },
        },
        {
            name: "steps",
            sortKey: IntegerSchema,
            attributes: {},
        },
    ],
});

export async function createDocument() {
    const documentId = generateId();

    await DocumentTable.put({
        type: "Snapshot",
        documentId,
        version: 0,
        doc: emptyContent.toJSON(),
    });
}
