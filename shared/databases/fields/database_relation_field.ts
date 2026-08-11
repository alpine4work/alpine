import type {DatabaseFieldModelOfType} from "~/shared/databases/model/database_field_model.js";
import {SqlJsonSchema} from "~/shared/databases/model/sqlite_schema.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
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

/**
 * Resolves a relation field against its join table, validating the field's config
 * against the join table's topology and returning the column names for the field's
 * own side (`our`) and the linked side (`their`).
 */
export function resolveDatabaseRelation(field: DatabaseFieldModelOfType<"relation">) {
    const joinTable = field.root.getJoinTable(field.config.joinTableId);

    let linkedTableId: DatabaseTableId | null = null;
    switch (field.config.side) {
        case "source":
            assert(joinTable.sourceTableId === field.table.id, "relation source table mismatch");
            assert(joinTable.sourceFieldId === field.id, "relation source field mismatch");
            linkedTableId = joinTable.targetTableId;
            break;
        case "target":
            assert(joinTable.targetTableId === field.table.id, "relation target table mismatch");
            assert(joinTable.targetFieldId === field.id, "relation target field mismatch");
            linkedTableId = joinTable.sourceTableId;
            break;
        default:
            exhaustive(field.config.side);
    }
    assert(linkedTableId !== null, "relation linked table is missing");
    assert(field.config.linkedTableId === linkedTableId, "relation linked table mismatch");

    const sourceColumnNames = {
        rowIdColumn: joinTable.sourceRowIdColumn(),
        positionColumn: joinTable.sourcePositionColumn(),
    };
    const targetColumnNames = {
        rowIdColumn: joinTable.targetRowIdColumn(),
        positionColumn: joinTable.targetPositionColumn(),
    };

    return {
        config: field.config,
        joinTable,
        linkedTableId,
        our: field.config.side === "source" ? sourceColumnNames : targetColumnNames,
        their: field.config.side === "source" ? targetColumnNames : sourceColumnNames,
    };
}

export type ResolvedDatabaseRelation = ReturnType<typeof resolveDatabaseRelation>;
