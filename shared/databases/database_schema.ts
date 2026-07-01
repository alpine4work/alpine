import {getDatabaseFieldProvider} from "~/shared/databases/fields/database_field_providers.js";
import {
    DatabaseFieldRow,
    DatabaseJoinTableRow,
    DatabaseTableKind,
    DatabaseTableRow,
    DatabaseViewRow,
} from "~/shared/databases/schema/database_row_schemas.js";
import {SqlBooleanSchema} from "~/shared/databases/schema/sqlite_schema.js";
import {sql} from "~/shared/databases/sql.js";
import {SqliteDatabase} from "~/shared/databases/sqlite.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {
    DatabaseFieldId,
    DatabaseRowId,
    DatabaseTableId,
    DatabaseViewId,
} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";

export class DatabaseSchema {
    constructor(readonly db: SqliteDatabase) {}

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
                *
            FROM
                ${sql.tableRef(tableId, "_alpine_table")}
        `.selectOne(this.db, DatabaseTableRow);
        return new DatabaseTableSchema(this, row);
    }

    getTable(tableId: DatabaseTableId) {
        return assertExists(this.getTableIfExists(tableId));
    }

    getJoinTable(tableId: DatabaseTableId) {
        assert(this.tableExists(tableId, "join"));
        return sql`
            SELECT
                *
            FROM
                ${sql.tableRef(tableId, "_alpine_join_table")}
        `.selectOne(this.db, DatabaseJoinTableRow);
    }

    getTableIds(kind: DatabaseTableKind = "table") {
        return sql`
            SELECT
                id
            FROM
                _alpine_tables
            WHERE
                kind = 'table'
            ORDER BY
                id
        `.selectValues(this.db, Schema.id<DatabaseTableId>());
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

export class DatabaseTableSchema {
    private db: SqliteDatabase;

    constructor(
        readonly schema: DatabaseSchema,
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

    identifier() {
        return sql.tableRef(this.id, this.tableName);
    }

    rowExists(rowId: DatabaseRowId) {
        return sql`
            SELECT
                1
            FROM
                ${this.identifier()}
            WHERE
                _id = ${rowId}
        `.selectValueIfExists(this.db, SqlBooleanSchema);
    }

    getView(viewId: DatabaseViewId) {
        const row = sql`
            SELECT
                *
            FROM
                ${sql.tableRef(this.id, "_alpine_views")}
            WHERE
                id = ${viewId}
        `.selectOne(this.db, DatabaseViewRow);
        return new DatabaseViewSchema(this, row);
    }

    getFirstView() {
        const row = sql`
            SELECT
                *
            FROM
                ${sql.tableRef(this.id, "_alpine_views")}
            ORDER BY
                id
            LIMIT
                1
        `.selectOne(this.db, DatabaseViewRow);
        return new DatabaseViewSchema(this, row);
    }

    getField(fieldId: DatabaseFieldId) {
        const row = sql`
            SELECT
                *
            FROM
                ${sql.tableRef(this.id, "_alpine_fields")}
            WHERE
                id = ${fieldId}
        `.selectOne(this.db, DatabaseFieldRow);
        return new DatabaseFieldSchema(this, row);
    }

    getNameField() {
        return this.getField(this.nameFieldId);
    }
}

export class DatabaseViewSchema {
    private db: SqliteDatabase;
    readonly schema: DatabaseSchema;
    readonly table: DatabaseTableSchema;

    constructor(
        table: DatabaseTableSchema,
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
                field.*,
            FROM
                ${sql.tableRef(this.table.id, "_alpine_view_fields")} view_field
                JOIN ${sql.tableRef(
                this.table.id,
                "_alpine_fields",
            )} field ON field.id = view_field.field_id
            WHERE
                view_field.view_id = ${this.id}
            ORDER BY
                view_field.position
        `
            .selectAll(this.db, DatabaseFieldRow)
            .map(row => new DatabaseFieldSchema(this.table, row));
    }
}

export class DatabaseFieldSchema {
    private db: SqliteDatabase;
    readonly schema: DatabaseSchema;
    readonly table: DatabaseTableSchema;

    constructor(
        table: DatabaseTableSchema,
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
