import {
    DatabaseFieldConfig,
    DatabaseFieldConfigSqlSchema,
    DatabaseFieldType,
    getDatabaseFieldProvider,
} from "~/shared/databases/fields/all_database_field_providers.js";
import {ColumnBackedDatabaseFieldProvider} from "~/shared/databases/fields/base/database_field_provider_base.js";
import {formatSqliteColumnType} from "~/shared/databases/internal/format_sqlite_column_type.js";
import {formatUniqueSqlName} from "~/shared/databases/internal/format_unique_sql_name.js";
import {
    DatabaseFieldRow,
    DatabaseJoinTableRow,
    DatabaseTableKind,
    DatabaseTableRow,
    DatabaseViewFieldRow,
    DatabaseViewRow,
} from "~/shared/databases/model/database_row_schemas.js";
import {SqlBooleanSchema} from "~/shared/databases/model/sqlite_schema.js";
import {SqlQuery, databaseTableSchemaName, sql} from "~/shared/databases/sql.js";
import {SqliteDatabase} from "~/shared/databases/sqlite.js";
import {databaseViewDefaultColumnWidth} from "~/shared/databases/sqlite_constants.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {OrderKey} from "~/shared/helpers/sort/order_key.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {
    DatabaseFieldId,
    DatabaseRowId,
    DatabaseTableId,
    DatabaseViewId,
} from "~/shared/id/types/id_types.js";
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
        for (const tableId of this.getTableIds("all")) {
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
            CREATE TABLE ${table.tableRef} (
                _id TEXT PRIMARY KEY DEFAULT (generate_id ()),
                _created_at TEXT NOT NULL DEFAULT (DATETIME('now')),
                CHECK (is_id (_id)),
                CHECK (DATETIME(_created_at) IS NOT NULL)
            ) WITHOUT ROWID
        `.exec(this.db);
        sql`
            CREATE INDEX ${table.schema}._alpine_rows_created_at ON ${table.tableRef} (_created_at)
        `.exec(this.db);

        const nameField = table.createField(nameFieldId, "Name", {type: "plainText"});
        const defaultView = table.createView(defaultViewId, "Grid view");

        return {table, nameField, defaultView};
    }

    getJoinTable(tableId: DatabaseTableId) {
        assert(this.tableExists(tableId, "join"));
        const row = sql`
            SELECT
                id,
                source_table_id,
                source_field_id,
                target_table_id,
                target_field_id,
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

        const joinTableId = generateChronologicalId<DatabaseTableId>();
        sql`
            INSERT INTO
                _alpine_tables (id, kind)
            VALUES
                (${joinTableId}, 'join')
        `.exec(this.db);

        const schema = sql.identifier(databaseTableSchemaName(joinTableId));
        const joinTableName = this.formatUniqueTableName(`${source.name} ${target.name}`);

        const sourceRowIdColumnName = `${source.table.tableName}_id`;
        const sourcePositionColumnName = `${source.table.tableName}_position`;
        const targetRowIdColumnName = `${target.table.tableName}_id`;
        const targetPositionColumnName = `${target.table.tableName}_position`;

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
                    ${sourceRowIdColumnName},
                    ${sourcePositionColumnName},
                    ${targetRowIdColumnName},
                    ${targetPositionColumnName}
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
            CREATE INDEX ${joinTable.schema}._alpine_join_table_source_row_id ON ${joinTable.tableRef} (
                ${sourceRowIdColumn},
                ${sourcePositionColumn}
            )
        `.exec(this.db);

        sql`
            CREATE INDEX ${joinTable.schema}._alpine_join_table_target_row_id ON ${joinTable.tableRef} (
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

        // fallback: table ID. take the first view from the table:
        const table = this.getTable(tableOrViewId as DatabaseTableId);
        return {table, view: table.getFirstView()};
    }
}

abstract class DatabaseSchemaScopedBaseModel {
    readonly db: SqliteDatabase;

    constructor(
        readonly schema: SqlQuery,
        readonly root: DatabaseModel,
    ) {
        this.db = root.db;
    }
}
abstract class DatabaseTableScopedBaseModel extends DatabaseSchemaScopedBaseModel {
    constructor(readonly table: DatabaseTableModel) {
        super(table.schema, table.root);
    }
}

export class DatabaseTableModel extends DatabaseSchemaScopedBaseModel {
    readonly tableRef: SqlQuery;

    constructor(
        root: DatabaseModel,
        readonly row: DatabaseTableRow,
    ) {
        const schema = sql.identifier(databaseTableSchemaName(row.id));
        super(schema, root);
        this.tableRef = sql.identifier(databaseTableSchemaName(this.id), this.tableName);
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

    rowExists(rowId: DatabaseRowId) {
        return sql`
            SELECT
                1
            FROM
                ${this.tableRef}
            WHERE
                _id = ${rowId}
        `.selectValueIfExists(this.db, SqlBooleanSchema);
    }

    updateName(name: string) {
        const newTableName = this.root.formatUniqueTableName(name, this.tableName);
        if (newTableName !== this.tableName) {
            sql`
                ALTER TABLE ${this.tableRef}
                RENAME TO ${newTableName}
            `.exec(this.db);
        }
        sql`
            UPDATE ${this.tableRef}
            SET
                name = ${name},
                table_name = ${newTableName}
            WHERE
                id = ${this.id}
        `.exec(this.db);

        for (const joinTable of this.getRelatedJoinTables()) {
            joinTable.ensureColumnNamesAreUpToDate();
        }

        return this.root.getTable(this.id);
    }

    getView(viewId: DatabaseViewId) {
        const row = sql`
            SELECT
                id,
                name,
            FROM
                ${this.schema}._alpine_views
            WHERE
                id = ${viewId}
        `.selectOne(this.db, DatabaseViewRow);
        return new DatabaseViewModel(this, row);
    }

    createView(viewId: DatabaseViewId, name: string): DatabaseViewModel {
        sql`
            INSERT INTO
                ${this.schema}._alpine_views (id, table_id, name)
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
            FROM
                ${this.schema}._alpine_views
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
                name,
                column_name,
                JSON(config) AS config,
            FROM
                ${this.schema}._alpine_fields
            WHERE
                id = ${fieldId}
        `.selectOne(this.db, DatabaseFieldRow);
        return new DatabaseFieldModel(this, row);
    }

    getFields() {
        return sql`
            SELECT
                id,
                name,
                column_name,
                JSON(config) AS config,
            FROM
                ${this.schema}._alpine_fields
        `
            .selectAll(this.db, DatabaseFieldRow)
            .map(row => new DatabaseFieldModel(this, row));
    }

    getNameField() {
        return this.getField(this.nameFieldId);
    }

    formatUniqueFieldName(name: string, existing?: string) {
        const existingFieldNames = new Set<string>(
            sql`
                SELECT
                    name
                FROM
                    ${this.schema}._alpine_fields
            `.selectValues(this.db, Schema.string),
        );
        if (existing) {
            existingFieldNames.delete(existing);
        }
        return formatUniqueSqlName(name, existingFieldNames);
    }

    createField(
        fieldId: DatabaseFieldId,
        name: string,
        config: DatabaseFieldConfig,
    ): DatabaseFieldModel {
        const columnName = this.formatUniqueFieldName(name);
        const provider = getDatabaseFieldProvider(config.type);

        sql`
            INSERT INTO
                ${this.schema}._alpine_fields (id, table_id, name, column_name, config)
            VALUES
                (
                    ${fieldId},
                    ${this.id},
                    ${name},
                    ${columnName},
                    ${config}
                )
        `.exec(this.db);

        if (provider instanceof ColumnBackedDatabaseFieldProvider) {
            const column = sql.identifier(columnName);

            const columnType = formatSqliteColumnType(provider.sqliteType, this.id, fieldId);
            const notNullClause = provider.nullable ? sql`` : sql`NOT NULL`;
            const check = provider.generateCheckConstraint(column);

            sql`
                ALTER TABLE ${this.tableRef}
                ADD COLUMN ${sql.identifier(
                    columnName,
                )} ${columnType} ${notNullClause} DEFAULT ${provider.defaultValue} ${check}
            `.exec(this.db);
        }

        return this.getField(fieldId);
    }

    appendFieldToAllViews(field: DatabaseFieldModel) {
        assert(field.table.id === this.id);
        sql`
            INSERT INTO
                ${this.schema}._alpine_view_fields (view_id, field_id, position)
            SELECT
                views.id,
                ${field.id},
                generate_order_key (MAX(view_fields.position), NULL)
            FROM
                ${this.schema}._alpine_views views
                LEFT JOIN ${this
                .schema}._alpine_view_fields view_fields ON view_field.view_id = view.id
            GROUP BY
                views.id
        `.exec(this.db);
    }

    getRelatedJoinTables() {
        const joinTableIds = sql`
            SELECT DISTINCT
                config ->> 'joinTableId'
            FROM
                ${this.schema}._alpine_fields
            WHERE
                config ->> 'type' = 'relation'
        `.selectValues(this.db, Schema.id<DatabaseTableId>());

        return joinTableIds.map(joinTableId => this.root.getJoinTable(joinTableId));
    }
}

export class DatabaseViewModel extends DatabaseTableScopedBaseModel {
    constructor(
        table: DatabaseTableModel,
        readonly row: DatabaseViewRow,
    ) {
        super(table);
    }

    get id() {
        return this.row.id;
    }
    get name() {
        return this.row.name;
    }

    getFields() {
        return sql`
            SELECT
                fields.id,
                fields.name,
                fields.column_name,
                JSON(fields.config) AS config,
            FROM
                ${this.schema}._alpine_view_fields view_fields
                JOIN ${this.schema}._alpine_fields fields ON fields.id = view_fields.field_id
            WHERE
                view_fields.view_id = ${this.id}
            ORDER BY
                view_fields.position
        `
            .selectAll(this.db, DatabaseFieldRow)
            .map(row => new DatabaseFieldModel(this.table, row));
    }

    getFieldsWithViewMetadata() {
        return sql`
            SELECT
                fields.id,
                fields.name,
                fields.column_name,
                JSON(fields.config) AS config,
                view_fields.position,
                view_fields.width,
                view_fields.hidden
            FROM
                ${this.schema}._alpine_view_fields view_fields
                JOIN ${this.schema}._alpine_fields fields ON fields.id = view_fields.field_id
            WHERE
                view_fields.view_id = ${this.id}
            ORDER BY
                view_fields.position
        `.selectAll(this.db, {
            id: DatabaseFieldRow.id,
            name: DatabaseFieldRow.name,
            columnName: DatabaseFieldRow.columnName,
            config: DatabaseFieldRow.config,
            position: DatabaseViewFieldRow.position,
            width: DatabaseViewFieldRow.width,
            isVisible: DatabaseViewFieldRow.isVisible,
        });
    }

    updateFieldWidth(field: DatabaseFieldModel, width: number) {
        assert(field.table.id === this.table.id);
        sql`
            UPDATE ${this.schema}._alpine_view_fields
            SET
                width = ${width}
            WHERE
                view_id = ${this.id}
                AND field_id = ${field.id}
        `.exec(this.db);
    }

    updateFieldVisibility(field: DatabaseFieldModel, visible: boolean, position: OrderKey) {
        assert(field.table.id === this.table.id);
        sql`
            INSERT INTO
                ${this.schema}._alpine_view_fields (view_id, field_id, visible, position, width)
            VALUES
                (
                    ${this.id},
                    ${field.id},
                    ${SqlBooleanSchema.serialize(visible)},
                    ${position},
                    ${databaseViewDefaultColumnWidth}
                )
            ON CONFLICT (view_id, field_id) DO UPDATE
            SET
                visible = excluded.visible,
                position = excluded.position
        `.exec(this.db);
    }
}

export class DatabaseFieldModel extends DatabaseTableScopedBaseModel {
    constructor(
        table: DatabaseTableModel,
        readonly row: DatabaseFieldRow,
    ) {
        super(table);
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

    column() {
        return sql.identifier(this.columnName);
    }

    isType<const Type extends DatabaseFieldType>(
        type: Type,
    ): this is DatabaseFieldModelOfType<Type> {
        return this.config.type === type;
    }

    updateName(newName: string) {
        const newColumnName = this.table.formatUniqueFieldName(newName, this.columnName);

        sql`
            UPDATE ${this.schema}._alpine_fields
            SET
                name = ${newName},
                column_name = ${newColumnName}
            WHERE
                id = ${this.id}
        `.exec(this.db);

        const provider = getDatabaseFieldProvider(this.config.type);

        const newField = this.table.getField(this.id);
        provider.renameFieldInSchema(this, newField);

        return newField;
    }

    updateConfig(config: DatabaseFieldConfig) {
        sql`
            UPDATE ${this.schema}._alpine_fields
            SET
                config = jsonb (${DatabaseFieldConfigSqlSchema.serialize(config)})
            WHERE
                id = ${this.id}
        `.exec(this.db);

        return this.table.getField(this.id);
    }
}

export type DatabaseFieldModelOfType<Type extends DatabaseFieldType> = DatabaseFieldModel & {
    config: DatabaseFieldConfig<Type>;
};

export class DatabaseJoinTableModel extends DatabaseSchemaScopedBaseModel {
    readonly tableRef: SqlQuery;

    constructor(
        root: DatabaseModel,
        readonly row: DatabaseJoinTableRow,
    ) {
        const schema = sql.identifier(databaseTableSchemaName(row.id));
        super(schema, root);
        this.tableRef = sql.identifier(databaseTableSchemaName(this.id), this.tableName);
    }

    get id() {
        return this.row.id;
    }
    get tableName() {
        return this.row.tableName;
    }
    get sourceTableId() {
        return this.row.sourceTableId;
    }
    get sourceFieldId() {
        return this.row.sourceFieldId;
    }
    get targetTableId() {
        return this.row.targetTableId;
    }
    get targetFieldId() {
        return this.row.targetFieldId;
    }
    get sourceRowIdColumnName() {
        return this.row.sourceRowIdColumnName;
    }
    sourceRowIdColumn() {
        return sql.identifier(this.sourceRowIdColumnName);
    }
    get sourcePositionColumnName() {
        return this.row.sourcePositionColumnName;
    }
    sourcePositionColumn() {
        return sql.identifier(this.sourcePositionColumnName);
    }
    get targetRowIdColumnName() {
        return this.row.targetRowIdColumnName;
    }
    targetRowIdColumn() {
        return sql.identifier(this.targetRowIdColumnName);
    }
    get targetPositionColumnName() {
        return this.row.targetPositionColumnName;
    }
    targetPositionColumn() {
        return sql.identifier(this.targetPositionColumnName);
    }

    getSource() {}

    ensureTableNameIsUpToDate() {
        const sourceName = this.root.getTable(this.sourceTableId).getField(this.sourceFieldId).name;
        const targetName = this.root.getTable(this.targetTableId).getField(this.targetFieldId).name;

        const joinTableName = this.root.formatUniqueTableName(
            `${sourceName} ${targetName}`,
            this.tableName,
        );

        if (joinTableName === this.tableName) return;

        sql`
            ALTER TABLE ${this.tableRef}
            RENAME TO ${joinTableName}
        `.exec(this.db);

        sql`
            UPDATE ${this.tableRef}
            SET
                table_name = ${joinTableName}
            WHERE
                id = ${this.id}
        `.exec(this.db);
    }

    ensureColumnNamesAreUpToDate() {
        const sourceTable = this.root.getTable(this.sourceTableId);
        const sourceRowIdColumnName = `${sourceTable.tableName}_id`;
        const sourcePositionColumnName = `${sourceTable.tableName}_position`;

        const targetTable = this.root.getTable(this.targetTableId);
        const targetRowIdColumnName = `${targetTable.tableName}_id`;
        const targetPositionColumnName = `${targetTable.tableName}_position`;

        if (
            sourceRowIdColumnName === this.sourceRowIdColumnName &&
            sourcePositionColumnName === this.sourcePositionColumnName &&
            targetRowIdColumnName === this.targetRowIdColumnName &&
            targetPositionColumnName === this.targetPositionColumnName
        ) {
            return;
        }

        sql`
            UPDATE ${this.schema}._alpine_join_table
            SET
                source_row_id_column_name = ${sourceRowIdColumnName},
                source_position_column_name = ${sourcePositionColumnName},
                target_row_id_column_name = ${targetRowIdColumnName},
                target_position_column_name = ${targetPositionColumnName}
            WHERE
                id = ${this.id}
        `.exec(this.db);

        const updated = this.root.getJoinTable(this.id);

        if (sourceRowIdColumnName !== this.sourceRowIdColumnName) {
            sql`
                ALTER TABLE ${this.tableRef}
                RENAME COLUMN ${this.sourceRowIdColumn()} TO ${updated.sourceRowIdColumn()}
            `.exec(this.db);
        }
        if (sourcePositionColumnName !== this.sourcePositionColumnName) {
            sql`
                ALTER TABLE ${this.tableRef}
                RENAME COLUMN ${this.sourcePositionColumn()} TO ${updated.sourcePositionColumn()}
            `.exec(this.db);
        }
        if (targetRowIdColumnName !== this.targetRowIdColumnName) {
            sql`
                ALTER TABLE ${this.tableRef}
                RENAME COLUMN ${this.targetRowIdColumn()} TO ${updated.targetRowIdColumn()}
            `.exec(this.db);
        }
        if (targetPositionColumnName !== this.targetPositionColumnName) {
            sql`
                ALTER TABLE ${this.tableRef}
                RENAME COLUMN ${this.targetPositionColumn()} TO ${updated.targetPositionColumn()}
            `.exec(this.db);
        }

        return updated;
    }
}
