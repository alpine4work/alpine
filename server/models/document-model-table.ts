import {Id} from "~/shared/id/id";

type DocumentSnapshot = {
    readonly type: "Snapshot";
    readonly documentId: Id;
    readonly version: number;
    readonly doc: unknown;
};

type DocumentStep = {
    readonly type: "StepAfterSnapshot";
    readonly documentId: Id;
    readonly clientId: Id;
    readonly version: number;
    readonly step: unknown;
};

type DocumentOldStep = {
    readonly type: "StepBeforeSnapshot";
    readonly documentId: Id;
    readonly clientId: Id;
    readonly version: number;
    readonly step: unknown;
};

DynamodbTable.new({
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
