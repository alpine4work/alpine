import type {DatabaseRelationFieldProvider} from "~/shared/databases/fields/database_relation_field.js";
import {sql} from "~/shared/databases/sql.js";
import type {SqliteDatabase} from "~/shared/databases/sqlite.js";
import type {DatabaseRowId} from "~/shared/id/types/id_types.open_source.js";
import {Schema} from "~/shared/schema/schema.open_source.js";

type ResolvedDatabaseRelation = ReturnType<DatabaseRelationFieldProvider["resolveRelation"]>;

/**
 * Inserts a link row into a relation's join table, generating fresh order keys
 * that append the link to the end of both sides' orderings. A no-op if the link
 * already exists (`INSERT OR IGNORE`).
 *
 * Shared by the `addLink` and `createAndLinkRow` actions. Does not enforce
 * cardinality — callers handle replacing existing links for `cardinality: "one"`
 * fields before inserting.
 */
export function insertJoinLink({
    db,
    relation,
    rowId,
    linkedRowId,
}: {
    db: SqliteDatabase;
    relation: ResolvedDatabaseRelation;
    rowId: DatabaseRowId;
    linkedRowId: DatabaseRowId;
}) {
    const joinTable = relation.joinTable;

    const ourPosition = sql`
        SELECT
            generate_order_key (MAX(${relation.our.positionColumn}), NULL)
        FROM
            ${joinTable.tableRef}
        WHERE
            ${relation.our.rowIdColumn} = ${rowId}
        ORDER BY
            ${relation.our.positionColumn} DESC
        LIMIT
            1
    `.selectValue(db, Schema.string);

    const theirPosition = sql`
        SELECT
            generate_order_key (MAX(${relation.their.positionColumn}), NULL)
        FROM
            ${joinTable.tableRef}
        WHERE
            ${relation.their.rowIdColumn} = ${linkedRowId}
        ORDER BY
            ${relation.their.positionColumn} DESC
        LIMIT
            1
    `.selectValue(db, Schema.string);

    sql`
        INSERT OR IGNORE INTO
            ${joinTable.tableRef} (
                ${relation.our.rowIdColumn},
                ${relation.their.rowIdColumn},
                ${relation.our.positionColumn},
                ${relation.their.positionColumn}
            )
        VALUES
            (
                ${rowId},
                ${linkedRowId},
                ${ourPosition},
                ${theirPosition}
            )
    `.exec(db);
}
