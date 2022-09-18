import {DynamoKeyAttributeSchema} from "~/server/dynamo/internal/dynamo-key-attribute-schema";
import {DynamoTableSchema} from "~/server/dynamo/internal/dynamo-table-schema";
import {Schema} from "~/shared/schema/schema";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
