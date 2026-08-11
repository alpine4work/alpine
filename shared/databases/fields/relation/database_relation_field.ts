import {SqlJsonSchema} from "~/shared/databases/model/sqlite_schema.js";
import type {DatabaseRowId, DatabaseTableId} from "~/shared/id/types/id_types.open_source.js";
import {OrderKeySchema} from "~/shared/schema/helpers/order_key_schema.js";
import {Schema, type SchemaType} from "~/shared/schema/schema.open_source.js";

export const DatabaseRelationFieldConfigSchema = Schema.object({
    type: Schema.value("relation"),
    joinTableId: Schema.id<DatabaseTableId>(),
    side: Schema.enum(["source", "target"]),
    cardinality: Schema.enum(["one", "many"]),
    linkedTableId: Schema.id<DatabaseTableId>(),
});
export type DatabaseRelationFieldConfig = SchemaType<typeof DatabaseRelationFieldConfigSchema>;

export const DatabaseRelationFieldValueSchema = Schema.array(
    Schema.object({
        id: Schema.id<DatabaseRowId>(),
        name: Schema.string.nullable(),
        // Absent for links to an unreadable table: those rows are projected from the join
        // file alone (see `selectDatabaseRelationFieldColumn`), which carries the order
        // key but the no-access branch doesn't emit it. Present for readable rows.
        position: OrderKeySchema.optional(),
    }),
);
export type DatabaseRelationFieldValue = SchemaType<typeof DatabaseRelationFieldValueSchema>;

export const DatabaseRelationFieldSqlValueSchema = SqlJsonSchema(DatabaseRelationFieldValueSchema);
