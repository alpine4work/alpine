import type {AccessLevel} from "~/shared/access/access_policy.js";
import type {
    DatabaseActionContext,
    DatabaseActionServerContext,
    DatabaseServerTableRegistration,
} from "~/shared/databases/database_action_context.js";
import {DatabaseActionRequiresServerError} from "~/shared/databases/database_action_requires_server_error.js";
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
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.open_source.js";
import {
    DatabaseFieldId,
    DatabaseTableId,
    DatabaseViewId,
} from "~/shared/id/types/id_types.open_source.js";
import {Schema} from "~/shared/schema/schema.open_source.js";

export class DatabaseModel {
    /**
     * The action context this model runs in — `ctx.model` is this model, and
     * `ctx.server()` exposes server-only capabilities (the salted name hasher,
     * attach). On the client `ctx.server()` throws
     * `DatabaseActionRequiresServerError`, routing the calling action to the server.
     * Omit `server` for read-only constructions (e.g. change-trigger refresh) that
     * never touch server-only paths.
     */
    readonly ctx: DatabaseActionContext;

    constructor(
        db: SqliteDatabase,
        server: DatabaseActionServerContext | null,
        getTableAccessLevel: (tableId: DatabaseTableId) => AccessLevel | null,
    ) {
        this.ctx = {
            db,
            server: () => {
                if (server === null) {
                    throw new DatabaseActionRequiresServerError("action is server-only");
                }
                return server;
            },
            model: this,
            getTableAccessLevel,
        };
    }

    get db(): SqliteDatabase {
        return this.ctx.db;
    }

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
                name_field_id
            FROM
                ${sql.tableRef(tableId, "_alpine_table")}
        `.selectOne(this.db, DatabaseTableRow);
        return new DatabaseTableModel(this, row);
    }

    getTable(tableId: DatabaseTableId) {
        return assertExists(this.getTableIfExists(tableId));
    }

    /**
     * Register a table id in main's `_alpine_tables` and in the server's table store.
     * Create flows call this _before_ attaching + migrating the per-table file: the
     * main row is what attach validates against, and the store row is what the
     * authorizer resolves the new schema's access from — both must exist by the time
     * any statement can touch the schema. The registration carries the resolved SQLite
     * `tableName` (see `formatUniqueTableName`), so the name-uniqueness probe covers
     * the table from this moment, plus the table's access metadata (a policy copy, or
     * a join file's two sides).
     */
    registerTable(tableId: DatabaseTableId, registration: DatabaseServerTableRegistration) {
        sql`
            INSERT INTO
                _alpine_tables (id, kind)
            VALUES
                (
                    ${tableId},
                    ${registration.kind}
                )
        `.exec(this.db);
        this.ctx.server().tables.registerTable(tableId, registration);
    }

    /**
     * `tableName` is resolved by the calling action via `formatUniqueTableName`
     * (alongside the hash it registered the table with).
     */
    createTable(tableId: DatabaseTableId, {name, tableName}: {name: string; tableName: string}) {
        const defaultViewId = generateChronologicalId<DatabaseViewId>();
        const nameFieldId = generateChronologicalId<DatabaseFieldId>();

        // The caller (the createTable action) registered the table in main's
        // `_alpine_tables` (see `registerTable`) and migrated its per-db file before this
        // runs.
        sql`
            INSERT INTO
                ${sql.tableRef(tableId, "_alpine_table")} (id, name, table_name, name_field_id)
            VALUES
                (
                    ${tableId},
                    ${name},
                    ${tableName},
                    ${nameFieldId}
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
                table.sqlName,
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

    /**
     * `tableName` is resolved by the calling action via `formatUniqueTableName`
     * (alongside the hash it registered the join table with).
     */
    createJoinTable(
        source: DatabaseFieldModel,
        target: DatabaseFieldModel,
        {tableName: joinTableName}: {tableName: string},
    ) {
        assert(source.config.type === "relation", "source field is not a relation field");
        assert(target.config.type === "relation", "target field is not a relation field");
        assert(source.config.joinTableId === target.config.joinTableId, "join table mismatch");
        assert(source.config.linkedTableId === target.table.id, "source linked table mismatch");
        assert(target.config.linkedTableId === source.table.id, "target linked table mismatch");

        const joinTableId = source.config.joinTableId;
        const schema = sql.identifier(databaseTableSchemaName(joinTableId));

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
                joinTable.sqlName,
            )} (
                ${sourceRowIdColumn},
                ${sourcePositionColumn}
            )
        `.exec(this.db);

        sql`
            CREATE INDEX ${joinTable.schema}._alpine_join_table_target_row_id ON ${sql.identifier(
                joinTable.sqlName,
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
        const sourceRowIdColumnName = `${sourceTable.sqlName}_id`;
        const sourcePositionColumnName = `${sourceTable.sqlName}_position`;
        const existingColumnNames = new Set([sourceRowIdColumnName, sourcePositionColumnName]);
        const targetRowIdColumnName = formatUniqueSqlName(
            `${targetTable.sqlName} id`,
            existingColumnNames,
        );
        existingColumnNames.add(targetRowIdColumnName);
        const targetPositionColumnName = formatUniqueSqlName(
            `${targetTable.sqlName} position`,
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
