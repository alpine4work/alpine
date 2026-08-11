import {
    DatabaseFieldConfig,
    DatabaseFieldConfigSqlSchema,
    DatabaseFieldType,
    getDatabaseFieldProvider,
} from "~/shared/databases/fields/all_database_field_providers.js";
import {DatabaseFieldRow} from "~/shared/databases/model/database_row_schemas.js";
import type {DatabaseTableModel} from "~/shared/databases/model/database_table_model.js";
import {DatabaseTableScopedBaseModel} from "~/shared/databases/model/database_table_scoped_base_model.js";
import {sql} from "~/shared/databases/sql.js";

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
    get humanName() {
        return this.row.name;
    }
    get sqlName() {
        return this.row.columnName;
    }
    get config() {
        return this.row.config;
    }

    column() {
        return sql.identifier(this.sqlName);
    }

    isType<const Type extends DatabaseFieldType>(
        type: Type,
    ): this is DatabaseFieldModelOfType<Type> {
        return this.config.type === type;
    }

    updateName(newName: string) {
        const newColumnName = this.table.formatUniqueFieldName(newName, this.sqlName);

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
