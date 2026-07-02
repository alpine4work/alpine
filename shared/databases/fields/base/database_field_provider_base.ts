import type {DatabaseFieldType} from "~/shared/databases/fields/all_database_field_providers.js";
import {
    type DatabaseFieldModel,
    type DatabaseFieldModelOfType,
} from "~/shared/databases/model/database_model.js";
import {type SqlQuery, sql} from "~/shared/databases/sql.js";
import {assert} from "~/shared/helpers/control/assert.js";
import type {Result} from "~/shared/helpers/control/result.js";
import type {Schema, SchemaSerializedValue} from "~/shared/schema/schema.js";

export type SqliteStorageType = "INTEGER" | "REAL" | "TEXT" | "BLOB";

export abstract class DatabaseFieldProviderBase<
    const Type extends DatabaseFieldType,
    Value,
    Config extends {type: Type},
> {
    protected constructor() {}

    abstract readonly type: Type;
    abstract readonly valueSchema: Schema<Value>;
    abstract readonly configSchema: Schema<Config>;
    readonly sqlValueSchema?: Schema<Value>;
    abstract parseValueString(input: string, config: Config): Result<Value, void>;
    abstract valueToString(value: Value, config: Config): string;

    selectColumn(field: DatabaseFieldModel, dataRow: SqlQuery): SqlQuery {
        assert(field.isType(this.type));
        return this._selectColumn(field, dataRow);
    }
    protected abstract _selectColumn(
        field: DatabaseFieldModelOfType<Type>,
        dataRow: SqlQuery,
    ): SqlQuery;

    assertConfigChangeValid?(existingConfig: Config, nextConfig: Config): void;

    renameFieldInSchema(oldField: DatabaseFieldModel, newField: DatabaseFieldModel) {
        assert(oldField.isType(this.type));
        assert(newField.isType(this.type));
        this._renameFieldInSchema(oldField, newField);
    }
    protected abstract _renameFieldInSchema(
        oldField: DatabaseFieldModelOfType<Type>,
        newField: DatabaseFieldModelOfType<Type>,
    ): void;
}

export abstract class ColumnBackedDatabaseFieldProvider<
    const Type extends DatabaseFieldType,
    Value,
    Config extends {type: Type},
> extends DatabaseFieldProviderBase<Type, Value, Config> {
    abstract readonly nullable: boolean;
    abstract readonly defaultValue: SqlQuery;
    abstract readonly sqliteType: SqliteStorageType;

    _selectColumn(field: DatabaseFieldModel, dataRow: SqlQuery): SqlQuery {
        return sql`${dataRow}.${field.column()}`;
    }

    abstract generateCheckConstraint(columnName: SqlQuery, config: Config): SqlQuery;

    unknownValueToSql(value: SchemaSerializedValue): SqlQuery {
        return this.valueToSql(this.valueSchema.deserialize(value));
    }

    valueToSql(value: Value): SqlQuery {
        const schema = this.sqlValueSchema ?? this.valueSchema;
        return sql`${schema.serialize(value)}`;
    }

    _renameFieldInSchema(
        oldField: DatabaseFieldModelOfType<Type>,
        newField: DatabaseFieldModelOfType<Type>,
    ) {
        sql`
            ALTER TABLE ${oldField.table.tableRef}
            RENAME COLUMN ${sql.identifier(oldField.columnName)} TO ${sql.identifier(
                newField.columnName,
            )}
        `.exec(oldField.db);
    }
}
