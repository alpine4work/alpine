import {DatabaseFieldConfigSqlSchema} from "~/shared/databases/fields/database_field_providers.js";
import {SqlBooleanSchema} from "~/shared/databases/model/sqlite_schema.js";
import {DatabaseFieldId, DatabaseTableId, DatabaseViewId} from "~/shared/id/types/id_types.js";
import {OrderKeySchema} from "~/shared/schema/helpers/order_key_schema.js";
import {ObjectSchemaConfigType, Schema} from "~/shared/schema/schema.js";

export type DatabaseTableKind = "table" | "join";

export const DatabaseTableRow = {
    name: Schema.string,
    tableName: Schema.string.originalPropertyKey("table_name"),
    nameFieldId: Schema.id<DatabaseFieldId>().originalPropertyKey("name_field_id"),
};
export type DatabaseTableRow = ObjectSchemaConfigType<typeof DatabaseTableRow>;

export const DatabaseJoinTableRow = {
    id: Schema.id<DatabaseTableId>(),
    sourceTableId: Schema.id<DatabaseTableId>().originalPropertyKey("source_table_id"),
    sourceFieldId: Schema.id<DatabaseFieldId>().originalPropertyKey("source_field_id"),
    targetTableId: Schema.id<DatabaseTableId>().originalPropertyKey("target_table_id"),
    targetFieldId: Schema.id<DatabaseFieldId>().originalPropertyKey("target_field_id"),
};
export type DatabaseJoinTableRow = ObjectSchemaConfigType<typeof DatabaseJoinTableRow>;

export const DatabaseViewRow = {
    id: Schema.id<DatabaseViewId>(),
    name: Schema.string,
};
export type DatabaseViewRow = ObjectSchemaConfigType<typeof DatabaseViewRow>;

export const DatabaseFieldRow = {
    id: Schema.id<DatabaseFieldId>(),
    name: Schema.string,
    columnName: Schema.string.originalPropertyKey("column_name"),
    config: DatabaseFieldConfigSqlSchema,
};
export type DatabaseFieldRow = ObjectSchemaConfigType<typeof DatabaseFieldRow>;

export const DatabaseViewFieldRow = {
    viewId: Schema.id<DatabaseViewId>().originalPropertyKey("view_id"),
    fieldId: Schema.id<DatabaseFieldId>().originalPropertyKey("field_id"),
    position: OrderKeySchema,
    width: Schema.integer,
    hidden: SqlBooleanSchema,
};
export type DatabaseViewFieldRow = ObjectSchemaConfigType<typeof DatabaseViewFieldRow>;
