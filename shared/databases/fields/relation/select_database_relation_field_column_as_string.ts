import {hasAccessLevel} from "~/shared/access/access_policy.js";
import {resolveDatabaseRelation} from "~/shared/databases/fields/relation/resolve_database_relation.js";
import {selectDatabaseFieldColumnAsString} from "~/shared/databases/fields/select_database_field_column_as_string.js";
import type {DatabaseFieldModelOfType} from "~/shared/databases/model/database_field_model.js";
import {type SqlQuery, sql} from "~/shared/databases/sql.js";

export function selectDatabaseRelationFieldColumnAsString(
    field: DatabaseFieldModelOfType<"relation">,
    dataRow: SqlQuery,
): SqlQuery {
    const relation = resolveDatabaseRelation(field);
    const joinRow = sql.identifier(`_join_${field.id}`);

    // See `selectDatabaseRelationFieldColumn`: ids-only when the linked table isn't
    // readable.
    if (!hasAccessLevel(field.root.ctx.getTableAccessLevel(relation.linkedTableId), "View")) {
        return sql`
            (
                SELECT
                    COALESCE(
                        GROUP_CONCAT(
                            'No access',
                            ', '
                            ORDER BY
                                ${joinRow}.${relation.our.positionColumn}
                        ),
                        ''
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
