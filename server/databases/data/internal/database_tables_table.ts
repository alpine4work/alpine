import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {AccessPolicySchema} from "~/shared/access/access_policy.js";
import type {
    DatabaseFieldId,
    DatabaseGroupId,
    DatabaseTableId,
    SpaceId,
} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";

export const DatabaseTablesTable = DynamoTableSchema.new({
    name: "DatabaseTables",
    partitions: [
        {
            name: "DatabaseGroup",
            partitionKeyAttributes: {
                databaseGroupId: DynamoKeyAttributeSchema.id<DatabaseGroupId>(),
            },
            sortRanges: [
                {
                    name: "Table",
                    sortKeyAttributes: {
                        tableId: DynamoKeyAttributeSchema.id<DatabaseTableId>(),
                    },
                    attributes: Schema.object({
                        name: Schema.string.nullable(),
                        spaceId: Schema.id<SpaceId>().nullable(),
                        tableName: Schema.string.nullable(),
                        nameFieldId: Schema.id<DatabaseFieldId>().nullable(),
                        isDeleted: Schema.boolean,
                        lastReplicatedStorageVersion: Schema.integer,
                        accessPolicy: AccessPolicySchema,
                    }),
                },
            ],
        },
    ],
});
