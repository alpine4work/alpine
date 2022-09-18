import {DynamoKeyAttributeSchema} from "~/server/dynamo/internal/dynamo-key-attribute-schema";
import {
    DynamoTableSchema,
    DynamoTableSchemaGetTypes,
} from "~/server/dynamo/internal/dynamo-table-schema";
import {generateId} from "~/shared/id/id";
import {Schema} from "~/shared/schema/schema";

const DocumentsTable = DynamoTableSchema.new({
    name: "Documents",
    partitions: {
        Document: {
            partitionKeyAttributes: {
                documentId: DynamoKeyAttributeSchema.id,
            },
            sortRanges: {
                Attributes: {
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        version: Schema.integer,
                        title: Schema.string,
                    }),
                },
                StepsAfterSnapshot: {
                    sortKeyAttributes: {
                        version: DynamoKeyAttributeSchema.integer,
                    },
                    attributes: Schema.object({
                        // TODO(calebmer): step
                    }),
                },
                Snapshot: {
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        version: Schema.integer,
                        // TODO(calebmer): doc
                    }),
                },
                StepsBeforeSnapshot: {
                    sortKeyAttributes: {
                        version: DynamoKeyAttributeSchema.integer,
                    },
                    attributes: Schema.object({
                        // TODO(calebmer): step
                    }),
                },
            },
        },
    },
});

type T1 = DynamoTableSchemaGetTypes<typeof DocumentsTable>["QueryKeyMap"]["Document"]["Attributes"];
type T2 = DynamoTableSchemaGetTypes<
    typeof DocumentsTable
>["QueryKeyMap"]["Document"]["StepsAfterSnapshot"];
type T3 = DynamoTableSchemaGetTypes<typeof DocumentsTable>["QueryKeyMap"]["Document"]["Snapshot"];
type T4 = DynamoTableSchemaGetTypes<
    typeof DocumentsTable
>["QueryKeyMap"]["Document"]["StepsBeforeSnapshot"];

async function test() {
    const metadata = await DocumentsTable.getItem(null as any, {
        partitionType: "Document",
        sortRangeType: "Attributes",
        documentId: generateId(),
    });

    const items = await DocumentsTable.query({
        startKey: {
            partitionType: "Document",
            sortRangeType: "Attributes",
            documentId: generateId(),
        },
        endKey: {
            partitionType: "Document",
            sortRangeType: "Snapshot",
            documentId: generateId(),
        },
    });

    const item = items[0]!;
}
