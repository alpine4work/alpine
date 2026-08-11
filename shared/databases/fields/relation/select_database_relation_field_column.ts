import {hasAccessLevel} from "~/shared/access/access_policy.js";
import {resolveDatabaseRelation} from "~/shared/databases/fields/relation/resolve_database_relation.js";
import {selectDatabaseFieldColumnAsString} from "~/shared/databases/fields/select_database_field_column_as_string.js";
import type {DatabaseFieldModelOfType} from "~/shared/databases/model/database_field_model.js";
import {type SqlQuery, sql} from "~/shared/databases/sql.js";

/**
 * Returns a SQL expression that selects a relation as an ordered JSON value. The
 * expression contains the join and access-control behavior so callers can treat
 * relation fields like other typed fields.
 */
export function selectDatabaseRelationFieldColumn(
    field: DatabaseFieldModelOfType<"Relation">,
    dataRow: SqlQuery,
): SqlQuery {
    const relation = resolveDatabaseRelation(field);
    const joinRow = sql.identifier(`_join_${field.id}`);

    // Without read access to the linked table, project ids only from the join file —
    // never touching the linked table's file, which the authorizer would deny (server)
    // or which isn't replicated at all (client). Both sides decide from the same
    // server-computed access state, so local execution and server fallback return the
    // same shape.
    if (!hasAccessLevel(field.root.ctx.getTableAccessLevel(relation.linkedTableId), "View")) {
        return sql`
            (
                SELECT
                    JSON(
                        COALESCE(
                            jsonb_group_array (
                                jsonb_object (
                                    'id',
                                    ${joinRow}.${relation.their.rowIdColumn},
                                    'name',
                                    NULL
                                )
                                ORDER BY
                                    ${joinRow}.${relation.our.positionColumn}
                            ),
                            jsonb ('[]')
                        )
                    )
                FROM
                    ${relation.joinTable.tableRef} AS ${joinRow}
                WHERE
                    ${joinRow}.${relation.our.rowIdColumn} = ${dataRow}._id
            )
        `;
    }

    const linkedTable = field.root.getTable(relation.linkedTableId);
    const linkedNameField = linkedTable.getNameField();
    const linkedRow = sql.identifier(`_linked_${field.id}`);

    const linkedNameColumnSql = selectDatabaseFieldColumnAsString(linkedNameField, linkedRow);

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
