import {getDatabaseFieldProvider} from "~/shared/databases/fields/all_database_field_providers.js";
import {DatabaseFieldProviderBase} from "~/shared/databases/fields/base/database_field_provider_base.js";
import type {DatabaseFieldModelOfType} from "~/shared/databases/model/database_field_model.js";
import {SqlJsonSchema} from "~/shared/databases/model/sqlite_schema.js";
import {type SqlQuery, sql} from "~/shared/databases/sql.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {Result} from "~/shared/helpers/control/result.js";
import type {DatabaseRowId, DatabaseTableId} from "~/shared/id/types/id_types.js";
import {OrderKeySchema} from "~/shared/schema/helpers/order_key_schema.js";
import {Schema, type SchemaType} from "~/shared/schema/schema.js";

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
        position: OrderKeySchema,
    }),
);
export type DatabaseRelationFieldValue = SchemaType<typeof DatabaseRelationFieldValueSchema>;

export class DatabaseRelationFieldProvider extends DatabaseFieldProviderBase<
    "relation",
    DatabaseRelationFieldValue,
    DatabaseRelationFieldConfig
> {
    static readonly instance = new DatabaseRelationFieldProvider();

    override readonly type = "relation";
    override readonly configSchema = DatabaseRelationFieldConfigSchema;
    override readonly valueSchema = DatabaseRelationFieldValueSchema;
    override readonly sqlValueSchema = SqlJsonSchema(DatabaseRelationFieldValueSchema);

    override parseValueString(): Result<DatabaseRelationFieldValue, void> {
        // TODO(alex): implement this
        return {ok: false, error: undefined};
    }

    override valueToString(value: DatabaseRelationFieldValue) {
        return value.map(link => link.name ?? "Untitled").join(", ");
    }

    _selectColumn(field: DatabaseFieldModelOfType<"relation">, dataRow: SqlQuery) {
        const relation = this.resolveRelation(field);
        const linkedTable = field.root.getTable(relation.linkedTableId);
        const linkedNameField = linkedTable.getNameField();

        const joinRow = sql.identifier(`_join_${field.id}`);
        const linkedRow = sql.identifier(`_linked_${field.id}`);

        const linkedNameColumnSql = getDatabaseFieldProvider(
            linkedNameField.config.type,
        ).selectColumnAsString(linkedNameField, linkedRow);

        return sql`
            (
                SELECT
                    JSON(
                        COALESCE(
                            jsonb_group_array (
                                jsonb_object (
                                    'id',
                                    ${linkedRow}._id,
                                    'name',
                                    ${linkedNameColumnSql},
                                    'position',
                                    ${joinRow}.${relation.our.positionColumn}
                                )
                                ORDER BY
                                    ${joinRow}.${relation.our.positionColumn}
                            ),
                            jsonb ('[]')
                        )
                    )
                FROM
                    ${relation.joinTable.tableRef} AS ${joinRow}
                    JOIN ${linkedTable.tableRef} ${linkedRow} ON ${linkedRow}._id = ${joinRow}.${relation
                .their.rowIdColumn}
                WHERE
                    ${joinRow}.${relation.our.rowIdColumn} = ${dataRow}._id
            )
        `;
    }

    _selectColumnAsString(field: DatabaseFieldModelOfType<"relation">, dataRow: SqlQuery) {
        const relation = this.resolveRelation(field);
        const linkedTable = field.root.getTable(relation.linkedTableId);
        const linkedNameField = linkedTable.getNameField();

        const joinRow = sql.identifier(`_join_${field.id}`);
        const linkedRow = sql.identifier(`_linked_${field.id}`);

        const linkedNameColumnSql = getDatabaseFieldProvider(
            linkedNameField.config.type,
        ).selectColumnAsString(linkedNameField, linkedRow);

        return sql`
            (
                SELECT
                    COALESCE(
                        GROUP_CONCAT(
                            COALESCE(${linkedNameColumnSql}, 'Untitled'),
                            ', '
                            ORDER BY
                                ${joinRow}.${relation.our.positionColumn}
                        ),
                        ''
                    )
                FROM
                    ${relation.joinTable.tableRef} AS ${joinRow}
                    JOIN ${linkedTable.tableRef} ${linkedRow} ON ${linkedRow}._id = ${joinRow}.${relation
                .their.rowIdColumn}
                WHERE
                    ${joinRow}.${relation.our.rowIdColumn} = ${dataRow}._id
            )
        `;
    }

    override assertConfigChangeValid(
        existingConfig: DatabaseRelationFieldConfig,
        nextConfig: DatabaseRelationFieldConfig,
    ) {
        assert(
            nextConfig.joinTableId === existingConfig.joinTableId,
            "cannot update relation field joinTableId",
        );
        assert(nextConfig.side === existingConfig.side, "cannot update relation field side");
        assert(
            nextConfig.linkedTableId === existingConfig.linkedTableId,
            "cannot update relation field linkedTableId",
        );
    }

    override _renameFieldInSchema(
        oldField: DatabaseFieldModelOfType<"relation">,
        newField: DatabaseFieldModelOfType<"relation">,
    ) {
        const relation = this.resolveRelation(newField);
        relation.joinTable.ensureTableNameIsUpToDate();
    }

    resolveRelation(field: DatabaseFieldModelOfType<"relation">) {
        const joinTable = field.root.getJoinTable(field.config.joinTableId);

        let linkedTableId!: DatabaseTableId;
        switch (field.config.side) {
            case "source":
                assert(
                    joinTable.sourceTableId === field.table.id,
                    "relation source table mismatch",
                );
                assert(joinTable.sourceFieldId === field.id, "relation source field mismatch");
                linkedTableId = joinTable.targetTableId;
                break;
            case "target":
                assert(
                    joinTable.targetTableId === field.table.id,
                    "relation target table mismatch",
                );
                assert(joinTable.targetFieldId === field.id, "relation target field mismatch");
                linkedTableId = joinTable.sourceTableId;
                break;
            default:
                exhaustive(field.config.side);
        }
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
}

export const databaseRelationFieldProvider: DatabaseRelationFieldProvider =
    DatabaseRelationFieldProvider.instance;
