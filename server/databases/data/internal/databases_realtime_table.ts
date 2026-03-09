import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {
    DynamoGeneralRealtimeTableItemType,
    DynamoGeneralRealtimeTableSchema,
} from "~/server/dynamo/core/general_realtime/dynamo_general_realtime_table_schema.js";
import {DatabaseModel} from "~/shared/databases/database_model.js";
import {AccountId, DatabaseId, SpaceId} from "~/shared/id/types/id_types.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";
import {createModelUnionSchema} from "~/shared/schema/model/create_model_union_schema.js";
import {Schema} from "~/shared/schema/schema.js";

export const DatabasesRealtimeTable = DynamoGeneralRealtimeTableSchema.new({
    features: {},
    name: "DatabasesRealtime",
    partitions: [
        {
            name: "Database",
            partitionKeyAttributes: {
                databaseId: DynamoKeyAttributeSchema.id<DatabaseId>(),
            },
            sortRanges: [
                {
                    name: "Attributes",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        spaceId: Schema.id<SpaceId>(),

                        /** When was this database created? */
                        createdTime: Schema.date,

                        /** Account who created the database. */
                        creatorId: Schema.id<AccountId>().nullable().default(null),

                        /** The name of this database. */
                        name: LabelStringSchema,
                    }),
                },
            ],
        },
    ],
    modelSchema: createModelUnionSchema({
        Database: DatabaseModel,
    }),
    models: {
        Database: {
            Attributes: {
                build: async (_context, item) => {
                    return new DatabaseModel({
                        id: item.databaseId,
                        spaceId: item.spaceId,
                        version: item.updateLockVersion ?? 0,
                        createdTime: item.createdTime,
                        name: item.name,
                    });
                },
            },
        },
    },
    broadcastEventTransaction: async () => {
        // No realtime broadcasting for database metadata yet.
        // Database content changes are handled by the durable object.
    },
});

export type DatabaseAttributesItem = DynamoGeneralRealtimeTableItemType<
    typeof DatabasesRealtimeTable,
    "Database",
    "Attributes"
>;
