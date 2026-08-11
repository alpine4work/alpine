import {
    DatabaseFieldConfig,
    DatabaseFieldConfigSqlSchema,
    DatabaseFieldType,
} from "~/shared/databases/fields/database_field_config.js";
import {resolveDatabaseRelation} from "~/shared/databases/fields/relation/resolve_database_relation.js";
import {DatabaseFieldRow} from "~/shared/databases/model/database_row_schemas.js";
import type {DatabaseTableModel} from "~/shared/databases/model/database_table_model.js";
import {DatabaseTableScopedBaseModel} from "~/shared/databases/model/database_table_scoped_base_model.js";
import {sql} from "~/shared/databases/sql.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";

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

        const newField = this.table.getField(this.id);

        // Apply the schema changes the rename implies: column-backed fields rename their
        // column; relation fields rename their join table's file.
        switch (newField.config.type) {
            case "plainText":
            case "checkbox":
            case "number":
                sql`
                    ALTER TABLE ${this.table.tableRef}
                    RENAME COLUMN ${sql.identifier(this.columnName)} TO ${sql.identifier(
                        newField.columnName,
                    )}
                `.exec(this.db);
                break;
            case "relation":
                assert(newField.isType("relation"));
                resolveDatabaseRelation(newField).joinTable.ensureTableNameIsUpToDate();
                break;
            default:
                throw exhaustive(newField.config);
        }

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
