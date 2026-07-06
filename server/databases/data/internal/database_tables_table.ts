import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {RynamoTableItemType, RynamoTableSchema} from "~/server/rynamo/rynamo_table_schema.js";
import {AccessPolicySchema} from "~/shared/access/access_policy.js";
import {DatabaseTableMetadataModel} from "~/shared/databases/database_table_metadata_model.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import type {DatabaseGroupId, DatabaseTableId, SpaceId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";

export const DatabaseTablesTable = RynamoTableSchema.new({
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
                        isDeleted: Schema.boolean,
                        accessPolicy: AccessPolicySchema,
                    }),
                },
            ],
        },
    ],
    modelSchema: DatabaseTableMetadataModel.schema(),
    models: {
        DatabaseGroup: {
            Table: {
                build: async (_context, item) =>
                    new DatabaseTableMetadataModel({
                        databaseGroupId: item.databaseGroupId,
                        tableId: item.tableId,
                        spaceId: assertExists(item.spaceId),
                        name: item.name,
                        isDeleted: item.isDeleted,
                        accessPolicy: item.accessPolicy,
                        version: item.updateLockVersion ?? 0,
                    }),
            },
        },
    },
    broadcastEvents: async () => {},
});

export type DatabaseTableItem = RynamoTableItemType<
    typeof DatabaseTablesTable,
    "DatabaseGroup",
    "Table"
>;
