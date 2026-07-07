import type {AccessPolicy} from "~/shared/access/access_policy.js";
import {DatabaseTableAccessPolicySqlSchema} from "~/shared/databases/database_table_access_policy.js";
import {formatUniqueSqlName} from "~/shared/databases/internal/format_unique_sql_name.js";
import type {DatabaseFieldModel} from "~/shared/databases/model/database_field_model.js";
import {DatabaseJoinTableModel} from "~/shared/databases/model/database_join_table_model.js";
import {
    DatabaseJoinTableRow,
    DatabaseTableKind,
    DatabaseTableRow,
} from "~/shared/databases/model/database_row_schemas.js";
import {DatabaseTableModel} from "~/shared/databases/model/database_table_model.js";
import {SqlBooleanSchema} from "~/shared/databases/model/sqlite_schema.js";
import {databaseTableSchemaName, sql} from "~/shared/databases/sql.js";
import {SqliteDatabase} from "~/shared/databases/sqlite.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {DatabaseFieldId, DatabaseTableId, DatabaseViewId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";

export class DatabaseModel {
    constructor(readonly db: SqliteDatabase) {}

    getTableIds(kind: DatabaseTableKind | "all") {
        const whereClause =
            kind === "all"
                ? sql``
                : sql`
                      WHERE
                          kind = ${kind}
                  `;

        return sql`
            SELECT
                id
            FROM
                _alpine_tables ${whereClause}
            ORDER BY
                id
        `.selectValues(this.db, Schema.id<DatabaseTableId>());
    }

    tableExists(tableId: DatabaseTableId, kind: DatabaseTableKind = "table") {
        return sql`
            SELECT
                1
            FROM
                _alpine_tables
            WHERE
                id = ${tableId}
                AND kind = ${kind}
        `.selectValueIfExists(this.db, SqlBooleanSchema);
    }

    getTableIfExists(tableId: DatabaseTableId) {
        if (!this.tableExists(tableId)) return null;
        const row = sql`
            SELECT
                id,
                name,
                table_name,
                name_field_id,
                JSON(access_policy) AS access_policy
            FROM
                ${sql.tableRef(tableId, "_alpine_table")}
        `.selectOne(this.db, DatabaseTableRow);
        return new DatabaseTableModel(this, row);
    }

    getTable(tableId: DatabaseTableId) {
        return assertExists(this.getTableIfExists(tableId));
    }

    formatUniqueTableName(name: string, oldName?: string) {
        // Both loops tolerate a registered table whose metadata row doesn't exist
        // yet: during createTable/createJoinTable the migration runner registers the
        // table in `_alpine_tables` before its `_alpine_table` / `_alpine_join_table`
        // singleton row is inserted — and this method runs inside that window to
        // name the very table being created.
        const existingTableNames = new Set<string>();
        for (const tableId of this.getTableIds("table")) {
            const schema = sql.identifier(databaseTableSchemaName(tableId));
            const tableName = sql`
                SELECT
                    table_name
                FROM
                    ${schema}._alpine_table
            `.selectValueIfExists(this.db, Schema.string);
            if (tableName) {
                existingTableNames.add(tableName);
            }
        }
        for (const joinTableId of this.getTableIds("join")) {
            const schema = sql.identifier(databaseTableSchemaName(joinTableId));
            const tableName = sql`
                SELECT
                    table_name
                FROM
                    ${schema}._alpine_join_table
            `.selectValueIfExists(this.db, Schema.string);
            if (tableName) {
                existingTableNames.add(tableName);
            }
        }
        if (oldName) {
            existingTableNames.delete(oldName);
        }
        return formatUniqueSqlName(name, existingTableNames);
    }

    createTable(tableId: DatabaseTableId, name: string, accessPolicy: AccessPolicy) {
        const defaultViewId = generateChronologicalId<DatabaseViewId>();
        const nameFieldId = generateChronologicalId<DatabaseFieldId>();

        const tableName = this.formatUniqueTableName(name);

        // The caller (the createTable action) migrated the table's per-db file before
        // this runs; the migration runner registered the table in main's
        // `_alpine_tables` as part of that.
        sql`
            INSERT INTO
                ${sql.tableRef(tableId, "_alpine_table")} (
                    id,
                    name,
                    table_name,
                    name_field_id,
                    access_policy
                )
            VALUES
                (
                    ${tableId},
                    ${name},
                    ${tableName},
                    ${nameFieldId},
                    jsonb (${DatabaseTableAccessPolicySqlSchema.serialize(accessPolicy)})
                )
        `.exec(this.db);

        const table = this.getTable(tableId);
        sql`
            CREATE TABLE ${table.tableRef} (
                _id TEXT PRIMARY KEY DEFAULT (generate_id ()),
                _created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
                CHECK (is_id (_id)),
                CHECK (DATETIME(_created_at) IS NOT NULL)
            ) WITHOUT ROWID
        `.exec(this.db);
        sql`
            CREATE INDEX ${table.schema}._alpine_rows_created_at ON ${sql.identifier(
                table.tableName,
            )} (_created_at)
        `.exec(this.db);

        const defaultView = table.createView(defaultViewId, "Grid view");
        const nameField = table.createField(nameFieldId, "Name", {type: "plainText"});
        table.appendFieldToAllViews(nameField);

        return {table, nameField, defaultView};
    }

    getJoinTable(tableId: DatabaseTableId) {
        assert(this.tableExists(tableId, "join"));
        const row = sql`
            SELECT
                id,
                table_name,
                source_table_id,
                source_field_id,
                target_table_id,
                target_field_id,
                source_row_id_column_name,
                source_position_column_name,
                target_row_id_column_name,
                target_position_column_name
            FROM
                ${sql.tableRef(tableId, "_alpine_join_table")}
        `.selectOne(this.db, DatabaseJoinTableRow);
        return new DatabaseJoinTableModel(this, row);
    }

    createJoinTable(source: DatabaseFieldModel, target: DatabaseFieldModel) {
        assert(source.config.type === "relation", "source field is not a relation field");
        assert(target.config.type === "relation", "target field is not a relation field");
        assert(source.config.joinTableId === target.config.joinTableId, "join table mismatch");
        assert(source.config.linkedTableId === target.table.id, "source linked table mismatch");
        assert(target.config.linkedTableId === source.table.id, "target linked table mismatch");

        const joinTableId = source.config.joinTableId;
        const schema = sql.identifier(databaseTableSchemaName(joinTableId));
        const joinTableName = this.formatUniqueTableName(`${source.name} ${target.name}`);

        // Like createTable: the migration runner already registered the join table in
        // main's `_alpine_tables`.
        const sourceColumnNames = this.formatJoinTableColumnNames(source.table, target.table);

        const row = sql`
            INSERT INTO
                ${schema}._alpine_join_table (
                    id,
                    table_name,
                    source_table_id,
                    source_field_id,
                    target_table_id,
                    target_field_id,
                    source_row_id_column_name,
                    source_position_column_name,
                    target_row_id_column_name,
                    target_position_column_name
                )
            VALUES
                (
                    ${joinTableId},
                    ${joinTableName},
                    ${source.table.id},
                    ${source.id},
                    ${target.table.id},
                    ${target.id},
                    ${sourceColumnNames.sourceRowIdColumnName},
                    ${sourceColumnNames.sourcePositionColumnName},
                    ${sourceColumnNames.targetRowIdColumnName},
                    ${sourceColumnNames.targetPositionColumnName}
                )
            RETURNING
                *
        `.selectOne(this.db, DatabaseJoinTableRow);

        const joinTable = new DatabaseJoinTableModel(this, row);

        const sourceRowIdColumn = joinTable.sourceRowIdColumn();
        const targetRowIdColumn = joinTable.targetRowIdColumn();
        const sourcePositionColumn = joinTable.sourcePositionColumn();
        const targetPositionColumn = joinTable.targetPositionColumn();

        sql`
            CREATE TABLE ${joinTable.tableRef} (
                ${sourceRowIdColumn} TEXT NOT NULL,
                ${targetRowIdColumn} TEXT NOT NULL,
                ${sourcePositionColumn} TEXT NOT NULL,
                ${targetPositionColumn} TEXT NOT NULL,
                PRIMARY KEY (
                    ${sourceRowIdColumn},
                    ${targetRowIdColumn}
                ),
                CHECK (is_id (${sourceRowIdColumn})),
                CHECK (is_id (${targetRowIdColumn})),
                CHECK (is_order_key (${sourcePositionColumn})),
                CHECK (
                    is_order_key (${targetPositionColumn})
                )
            ) STRICT,
            WITHOUT ROWID
        `.exec(this.db);

        sql`
            CREATE INDEX ${joinTable.schema}._alpine_join_table_source_row_id ON ${sql.identifier(
                joinTable.tableName,
            )} (
                ${sourceRowIdColumn},
                ${sourcePositionColumn}
            )
        `.exec(this.db);

        sql`
            CREATE INDEX ${joinTable.schema}._alpine_join_table_target_row_id ON ${sql.identifier(
                joinTable.tableName,
            )} (
                ${targetRowIdColumn},
                ${targetPositionColumn}
            )
        `.exec(this.db);

        return row;
    }

    resolveTableOrViewId(tableOrViewId: string) {
        const tableId = sql`
            SELECT
                table_id
            FROM
                _alpine_views
            WHERE
                id = ${tableOrViewId}
        `.selectValueIfExists(this.db, Schema.id<DatabaseTableId>());

        if (tableId) {
            const table = this.getTable(tableId);
            return {table, view: table.getView(tableOrViewId as DatabaseViewId)};
        }

        const table = this.getTable(tableOrViewId as DatabaseTableId);
        return {table, view: table.getFirstView()};
    }

    formatJoinTableColumnNames(sourceTable: DatabaseTableModel, targetTable: DatabaseTableModel) {
        const sourceRowIdColumnName = `${sourceTable.tableName}_id`;
        const sourcePositionColumnName = `${sourceTable.tableName}_position`;
        const existingColumnNames = new Set([sourceRowIdColumnName, sourcePositionColumnName]);
        const targetRowIdColumnName = formatUniqueSqlName(
            `${targetTable.tableName} id`,
            existingColumnNames,
        );
        existingColumnNames.add(targetRowIdColumnName);
        const targetPositionColumnName = formatUniqueSqlName(
            `${targetTable.tableName} position`,
            existingColumnNames,
        );

        return {
            sourceRowIdColumnName,
            sourcePositionColumnName,
            targetRowIdColumnName,
            targetPositionColumnName,
        };
    }
}
