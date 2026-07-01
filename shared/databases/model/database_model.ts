import {
    DatabaseFieldConfig,
    getDatabaseFieldProvider,
} from "~/shared/databases/fields/database_field_providers.js";
import {formatSqliteColumnType} from "~/shared/databases/internal/format_sqlite_column_type.js";
import {formatUniqueSqlName} from "~/shared/databases/internal/format_unique_sql_name.js";
import {
    DatabaseFieldRow,
    DatabaseJoinTableRow,
    DatabaseTableKind,
    DatabaseTableRow,
    DatabaseViewRow,
} from "~/shared/databases/model/database_row_schemas.js";
import {SqlBooleanSchema} from "~/shared/databases/model/sqlite_schema.js";
import {sql} from "~/shared/databases/sql.js";
import {SqliteDatabase} from "~/shared/databases/sqlite.js";
import {databaseViewDefaultColumnWidth} from "~/shared/databases/sqlite_constants.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {generateOrderKeyBetween} from "~/shared/helpers/sort/order_key.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {
    DatabaseFieldId,
    DatabaseRowId,
    DatabaseTableId,
    DatabaseViewId,
} from "~/shared/id/types/id_types.js";
import {OrderKeySchema} from "~/shared/schema/helpers/order_key_schema.js";
import {Schema} from "~/shared/schema/schema.js";

export class DatabaseModel {
    constructor(readonly db: SqliteDatabase) {}

    getTableIds(kind: DatabaseTableKind = "table") {
        return sql`
            SELECT
                id
            FROM
                _alpine_tables
            WHERE
                kind = ${kind}
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

    formatUniqueTableName(name: string, oldName?: string) {
        const existingTableNames = new Set<string>();
        for (const tableId of this.getTableIds()) {
            existingTableNames.add(this.getTable(tableId).tableName);
        }
        if (oldName) {
            existingTableNames.delete(oldName);
        }
        return formatUniqueSqlName(name, existingTableNames);
    }

    createTable(tableId: DatabaseTableId, name: string) {
        const defaultViewId = generateChronologicalId<DatabaseViewId>();
        const nameFieldId = generateChronologicalId<DatabaseFieldId>();

        const tableName = this.formatUniqueTableName(name);

        sql`
            INSERT INTO
                _alpine_tables (id)
            VALUES
                (${tableId})
        `.exec(this.db);
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
            CREATE TABLE ${table.ref()} (
                _id TEXT PRIMARY KEY DEFAULT (generate_id ()),
                _created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
                CHECK (is_id (_id)),
                CHECK (DATETIME(_created_at) IS NOT NULL)
            ) WITHOUT ROWID
        `.exec(this.db);
        sql`
            CREATE INDEX ${table.ref(
                `_alpine_index_${tableId}_created_at`,
            )} ON ${table.ref()} (_created_at)
        `.exec(this.db);

        const nameField = table.insertField(nameFieldId, "Name", {type: "plainText"});
        const defaultView = table.insertView(defaultViewId, "Grid view");

        return {table, nameField, defaultView};
    }

    getJoinTable(tableId: DatabaseTableId) {
        assert(this.tableExists(tableId, "join"));
        return sql`
            SELECT
                id,
                source_table_id,
                source_field_id,
                target_table_id,
                target_field_id,
            FROM
                ${sql.tableRef(tableId, "_alpine_join_table")}
        `.selectOne(this.db, DatabaseJoinTableRow);
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

        // fallback: table ID. take the first view from the table:
        const table = this.getTable(tableOrViewId as DatabaseTableId);
        return {table, view: table.getFirstView()};
    }
}

export class DatabaseTableModel {
    private db: SqliteDatabase;

    constructor(
        readonly schema: DatabaseModel,
        readonly row: DatabaseTableRow,
    ) {
        this.db = schema.db;
    }

    get id() {
        return this.row.id;
    }
    get name() {
        return this.row.name;
    }
    get tableName() {
        return this.row.tableName;
    }
    get nameFieldId() {
        return this.row.nameFieldId;
    }

    ref(name = this.tableName) {
        return sql.tableRef(this.id, name);
    }

    rowExists(rowId: DatabaseRowId) {
        return sql`
            SELECT
                1
            FROM
                ${this.ref()}
            WHERE
                _id = ${rowId}
        `.selectValueIfExists(this.db, SqlBooleanSchema);
    }

    updateName(name: string) {
        const newTableName = this.schema.formatUniqueTableName(name, this.tableName);
        if (newTableName !== this.tableName) {
            sql`
                ALTER TABLE ${this.ref()}
                RENAME TO ${newTableName}
            `.exec(this.db);
        }
        sql`
            UPDATE ${this.ref()}
            SET
                name = ${name},
                table_name = ${newTableName}
            WHERE
                id = ${this.id}
        `.exec(this.db);

        return this.schema.getTable(this.id);
    }

    getView(viewId: DatabaseViewId) {
        const row = sql`
            SELECT
                id,
                name,
                table_id,
            FROM
                ${sql.tableRef(this.id, "_alpine_views")}
            WHERE
                id = ${viewId}
        `.selectOne(this.db, DatabaseViewRow);
        return new DatabaseViewModel(this, row);
    }

    insertView(viewId: DatabaseViewId, name: string): DatabaseViewModel {
        sql`
            INSERT INTO
                ${this.ref("_alpine_views")} (id, table_id, name)
            VALUES
                (
                    ${viewId},
                    ${this.id},
                    ${name}
                )
        `.exec(this.db);
        return this.getView(viewId);
    }

    getFirstView() {
        const row = sql`
            SELECT
                id,
                name,
                table_id,
            FROM
                ${sql.tableRef(this.id, "_alpine_views")}
            ORDER BY
                id
            LIMIT
                1
        `.selectOne(this.db, DatabaseViewRow);
        return new DatabaseViewModel(this, row);
    }

    getField(fieldId: DatabaseFieldId) {
        const row = sql`
            SELECT
                id,
                table_id,
                name,
                column_name,
                JSON(config) AS config,
            FROM
                ${sql.tableRef(this.id, "_alpine_fields")}
            WHERE
                id = ${fieldId}
        `.selectOne(this.db, DatabaseFieldRow);
        return new DatabaseFieldModel(this, row);
    }

    getNameField() {
        return this.getField(this.nameFieldId);
    }

    formatUniqueFieldName(name: string) {
        const existingFieldNames = new Set<string>(
            sql`
                SELECT
                    name
                FROM
                    ${sql.tableRef(this.id, "_alpine_fields")}
            `.selectValues(this.db, Schema.string),
        );
        return formatUniqueSqlName(name, existingFieldNames);
    }

    insertField(
        fieldId: DatabaseFieldId,
        name: string,
        config: DatabaseFieldConfig,
    ): DatabaseFieldModel {
        const columnName = this.formatUniqueFieldName(name);
        const provider = getDatabaseFieldProvider(config.type);

        sql`
            INSERT INTO
                ${this.ref("_alpine_fields")} (id, table_id, name, column_name, config)
            VALUES
                (
                    ${fieldId},
                    ${this.id},
                    ${name},
                    ${columnName},
                    ${config}
                )
        `.exec(this.db);

        if (provider.storage === "column") {
            const {sqliteType, defaultValue, nullable, generateCheckConstraint} = provider;

            const columnType = formatSqliteColumnType(sqliteType, this.id, fieldId);
            const notNullClause = nullable ? sql`` : sql`NOT NULL`;
            const check = generateCheckConstraint(columnName);

            sql`
                ALTER TABLE ${this.ref()}
                ADD COLUMN ${sql.identifier(
                    columnName,
                )} ${columnType} ${notNullClause} DEFAULT ${defaultValue} ${check}
            `.exec(this.db);
        }

        return this.getField(fieldId);
    }
}

export class DatabaseViewModel {
    private db: SqliteDatabase;
    readonly schema: DatabaseModel;
    readonly table: DatabaseTableModel;

    constructor(
        table: DatabaseTableModel,
        readonly row: DatabaseViewRow,
    ) {
        this.schema = table.schema;
        this.db = this.schema.db;
        this.table = table;
    }

    get id() {
        return this.row.id;
    }
    get name() {
        return this.row.name;
    }
    get tableId() {
        return this.row.tableId;
    }

    getFields() {
        return sql`
            SELECT
                field.id,
                field.table_id,
                field.name,
                field.column_name,
                JSON(field.config) AS config,
            FROM
                ${this.table.ref("_alpine_view_fields")} view_field
                JOIN ${this.table.ref("_alpine_fields")} field ON field.id = view_field.field_id
            WHERE
                view_field.view_id = ${this.id}
            ORDER BY
                view_field.position
        `
            .selectAll(this.db, DatabaseFieldRow)
            .map(row => new DatabaseFieldModel(this.table, row));
    }

    insertFieldAtEnd(field: DatabaseFieldModel) {
        const maxPosition = sql`
            SELECT
                MAX(position)
            FROM
                ${this.table.ref("_alpine_view_fields")}
            WHERE
                view_id = ${this.id}
        `.selectValue(this.db, OrderKeySchema.nullable());

        const nextPosition = generateOrderKeyBetween(maxPosition, null);

        sql`
            INSERT INTO
                ${this.table.ref("_alpine_view_fields")} (view_id, field_id, position, width)
            VALUES
                (
                    ${this.id},
                    ${field.id},
                    ${nextPosition},
                    ${databaseViewDefaultColumnWidth}
                )
        `.exec(this.db);
    }
}

export class DatabaseFieldModel {
    private db: SqliteDatabase;
    readonly schema: DatabaseModel;
    readonly table: DatabaseTableModel;

    constructor(
        table: DatabaseTableModel,
        readonly row: DatabaseFieldRow,
    ) {
        this.schema = table.schema;
        this.db = this.schema.db;
        this.table = table;
    }

    get id() {
        return this.row.id;
    }
    get name() {
        return this.row.name;
    }
    get columnName() {
        return this.row.columnName;
    }
    get config() {
        return this.row.config;
    }

    getProvider() {
        return getDatabaseFieldProvider(this.config.type);
    }

    resolveRelation() {
        assert(this.config.type === "relation", "field is not a relation field");

        const joinTable = this.schema.getJoinTable(this.config.joinTableId);

        let linkedTableId: DatabaseTableId;
        switch (this.config.side) {
            case "source":
                assert(joinTable.sourceTableId === this.table.id, "relation source table mismatch");
                assert(joinTable.sourceFieldId === this.id, "relation source field mismatch");
                linkedTableId = joinTable.targetTableId;
                break;
            case "target":
                assert(joinTable.targetTableId === this.table.id, "relation target table mismatch");
                assert(joinTable.targetFieldId === this.id, "relation target field mismatch");
                linkedTableId = joinTable.sourceTableId;
                break;
        }
        assert(this.config.linkedTableId === linkedTableId, "relation linked table mismatch");

        return {
            config: this.config,
            joinTable,
            linkedTableId,
            ourColumnName:
                this.config.side === "source"
                    ? ("source_row_id" as const)
                    : ("target_row_id" as const),
            theirColumnName:
                this.config.side === "source"
                    ? ("target_row_id" as const)
                    : ("source_row_id" as const),
        };
    }
}
