import {
    DatabaseFieldConfig,
    DatabaseFieldConfigSqlSchema,
    getDatabaseFieldProvider,
} from "~/shared/databases/fields/all_database_field_providers.js";
import {ColumnBackedDatabaseFieldProvider} from "~/shared/databases/fields/base/database_field_provider_base.js";
import {formatSqliteColumnType} from "~/shared/databases/internal/format_sqlite_column_type.js";
import {formatUniqueSqlName} from "~/shared/databases/internal/format_unique_sql_name.js";
import {DatabaseFieldModel} from "~/shared/databases/model/database_field_model.js";
import type {DatabaseModel} from "~/shared/databases/model/database_root_model.js";
import {
    DatabaseFieldRow,
    DatabaseTableRow,
    DatabaseViewRow,
} from "~/shared/databases/model/database_row_schemas.js";
import {DatabaseSchemaScopedBaseModel} from "~/shared/databases/model/database_schema_scoped_base_model.js";
import {DatabaseViewModel} from "~/shared/databases/model/database_view_model.js";
import {SqlBooleanSchema} from "~/shared/databases/model/sqlite_schema.js";
import {SqlQuery, databaseTableSchemaName, sql} from "~/shared/databases/sql.js";
import {databaseViewDefaultColumnWidth} from "~/shared/databases/sqlite_constants.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {
    DatabaseFieldId,
    DatabaseRowId,
    DatabaseTableId,
    DatabaseViewId,
} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";

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
    get accessPolicy() {
        return this.row.accessPolicy;
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
        const newTableName = this.root.formatUniqueTableName(name, this.id);
        if (newTableName !== this.tableName) {
            sql`
                ALTER TABLE ${this.tableRef}
                RENAME TO ${sql.identifier(newTableName)}
            `.exec(this.db);
            this.root.writeTableNameHash(this.id, newTableName);
        }
        sql`
            UPDATE ${this.schema}._alpine_table
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
                name
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
                ${this.schema}._alpine_views (id, name)
            VALUES
                (
                    ${viewId},
                    ${name}
                )
        `.exec(this.db);
        sql`
            INSERT INTO
                _alpine_views (id, table_id)
            VALUES
                (
                    ${viewId},
                    ${this.id}
                )
        `.exec(this.db);
        return this.getView(viewId);
    }

    getFirstView() {
        const row = sql`
            SELECT
                id,
                name
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
                JSON(config) AS config
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
                JSON(config) AS config
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
        const existingColumnNames = new Set<string>(
            sql`
                SELECT
                    column_name
                FROM
                    ${this.schema}._alpine_fields
            `.selectValues(this.db, Schema.string),
        );
        if (existing) {
            existingColumnNames.delete(existing);
        }
        return formatUniqueSqlName(name, existingColumnNames);
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
                ${this.schema}._alpine_fields (id, name, column_name, config)
            VALUES
                (
                    ${fieldId},
                    ${name},
                    ${columnName},
                    jsonb (${DatabaseFieldConfigSqlSchema.serialize(config)})
                )
        `.exec(this.db);

        if (provider instanceof ColumnBackedDatabaseFieldProvider) {
            const column = sql.identifier(columnName);

            const columnType = sql.raw(
                formatSqliteColumnType(provider.sqliteType, this.id, fieldId),
            );
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
                ${this.schema}._alpine_view_fields (view_id, field_id, position, width)
            SELECT
                views.id,
                ${field.id},
                generate_order_key (MAX(view_fields.position), NULL),
                ${databaseViewDefaultColumnWidth}
            FROM
                ${this.schema}._alpine_views views
                LEFT JOIN ${this
                .schema}._alpine_view_fields view_fields ON view_fields.view_id = views.id
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
