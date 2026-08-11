import {
    type DatabaseCheckboxFieldConfig,
    DatabaseCheckboxFieldConfigSchema,
    type DatabaseCheckboxFieldValue,
    DatabaseCheckboxFieldValueSchema,
    databaseCheckboxFieldColumn,
    parseDatabaseCheckboxFieldValueString,
} from "~/shared/databases/fields/database_checkbox_field.js";
import {
    type DatabaseNumberFieldConfig,
    DatabaseNumberFieldConfigSchema,
    type DatabaseNumberFieldValue,
    DatabaseNumberFieldValueSchema,
    databaseNumberFieldColumn,
    databaseNumberFieldValueToString,
    parseDatabaseNumberFieldValueString,
    selectDatabaseNumberFieldColumnAsString,
} from "~/shared/databases/fields/database_number_field.js";
import {
    type DatabasePlainTextFieldConfig,
    DatabasePlainTextFieldConfigSchema,
    type DatabasePlainTextFieldValue,
    DatabasePlainTextFieldValueSchema,
    databasePlainTextFieldColumn,
} from "~/shared/databases/fields/database_plain_text_field.js";
import {
    type DatabaseRelationFieldConfig,
    DatabaseRelationFieldConfigSchema,
    DatabaseRelationFieldSqlValueSchema,
    type DatabaseRelationFieldValue,
    DatabaseRelationFieldValueSchema,
    resolveDatabaseRelation,
} from "~/shared/databases/fields/database_relation_field.js";
import {
    selectDatabaseRelationFieldColumn,
    selectDatabaseRelationFieldColumnAsString,
} from "~/shared/databases/fields/select_database_relation_field_column.js";
import type {DatabaseFieldModel} from "~/shared/databases/model/database_field_model.js";
import {SqlBooleanSchema, SqlJsonSchema} from "~/shared/databases/model/sqlite_schema.js";
import {type SqlQuery, sql} from "~/shared/databases/sql.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import type {Result} from "~/shared/helpers/control/result.open_source.js";
import {Schema, type SchemaSerializedValue} from "~/shared/schema/schema.open_source.js";

// -- Types --------------------------------------------------------------------

type AnyDatabaseFieldConfig =
    | DatabasePlainTextFieldConfig
    | DatabaseCheckboxFieldConfig
    | DatabaseNumberFieldConfig
    | DatabaseRelationFieldConfig;

export type DatabaseFieldType = AnyDatabaseFieldConfig["type"];

export type DatabaseFieldConfig<Type extends DatabaseFieldType = DatabaseFieldType> = Extract<
    AnyDatabaseFieldConfig,
    {type: Type}
>;

type DatabaseFieldValues = {
    plainText: DatabasePlainTextFieldValue;
    checkbox: DatabaseCheckboxFieldValue;
    number: DatabaseNumberFieldValue;
    relation: DatabaseRelationFieldValue;
};

export type DatabaseFieldValue<Type extends DatabaseFieldType = DatabaseFieldType> =
    DatabaseFieldValues[Type];

export type SqliteStorageType = "INTEGER" | "REAL" | "TEXT" | "BLOB";

/**
 * SQLite column storage for a column-backed field type. Virtual field types
 * (relation) have no column of their own and no `DatabaseFieldColumn`.
 */
export type DatabaseFieldColumn = {
    readonly sqliteType: SqliteStorageType;
    readonly nullable: boolean;
    readonly defaultValue: SqlQuery;
    readonly generateCheckConstraint: (columnName: SqlQuery) => SqlQuery;
};

// -- Config schemas -----------------------------------------------------------

export const DatabaseFieldConfigSchema = Schema.union({
    plainText: DatabasePlainTextFieldConfigSchema,
    checkbox: DatabaseCheckboxFieldConfigSchema,
    number: DatabaseNumberFieldConfigSchema,
    relation: DatabaseRelationFieldConfigSchema,
});

export const DatabaseFieldConfigSqlSchema = SqlJsonSchema(DatabaseFieldConfigSchema);

// -- Per-type dispatch --------------------------------------------------------

/** The column storage of a field type, or `null` for virtual field types. */
export function databaseFieldColumn(type: DatabaseFieldType): DatabaseFieldColumn | null {
    switch (type) {
        case "plainText":
            return databasePlainTextFieldColumn;
        case "checkbox":
            return databaseCheckboxFieldColumn;
        case "number":
            return databaseNumberFieldColumn;
        case "relation":
            return null;
        default:
            throw exhaustive(type);
    }
}

const databaseFieldValueSchemas: {[Type in DatabaseFieldType]: Schema<DatabaseFieldValue<Type>>} = {
    plainText: DatabasePlainTextFieldValueSchema,
    checkbox: DatabaseCheckboxFieldValueSchema,
    number: DatabaseNumberFieldValueSchema,
    relation: DatabaseRelationFieldValueSchema,
};

export function databaseFieldValueSchema<Type extends DatabaseFieldType>(
    type: Type,
): Schema<DatabaseFieldValue<Type>> {
    return databaseFieldValueSchemas[type];
}

const databaseFieldSqlValueSchemas: {
    [Type in DatabaseFieldType]: Schema<DatabaseFieldValue<Type>>;
} = {
    plainText: DatabasePlainTextFieldValueSchema,
    checkbox: SqlBooleanSchema,
    number: DatabaseNumberFieldValueSchema,
    relation: DatabaseRelationFieldSqlValueSchema,
};

/**
 * The schema for a field type's values as stored in SQLite. Differs from {@link
 * databaseFieldValueSchema} for types with a SQL-specific encoding (e.g. booleans
 * stored as integers).
 */
export function databaseFieldSqlValueSchema<Type extends DatabaseFieldType>(
    type: Type,
): Schema<DatabaseFieldValue<Type>> {
    return databaseFieldSqlValueSchemas[type];
}

export function parseDatabaseFieldValueString<Type extends DatabaseFieldType>(
    config: DatabaseFieldConfig<Type>,
    input: string,
): Result<DatabaseFieldValue<Type>, void>;
export function parseDatabaseFieldValueString(
    config: DatabaseFieldConfig,
    input: string,
): Result<DatabaseFieldValue, void> {
    switch (config.type) {
        case "plainText":
            return {ok: true, value: input};
        case "checkbox":
            return {ok: true, value: parseDatabaseCheckboxFieldValueString(input)};
        case "number":
            return parseDatabaseNumberFieldValueString(input);
        case "relation":
            // TODO(alex): implement this
            return {ok: false, error: undefined};
        default:
            throw exhaustive(config);
    }
}

export function databaseFieldValueToString<Type extends DatabaseFieldType>(
    config: DatabaseFieldConfig<Type>,
    value: DatabaseFieldValue<Type>,
): string;
export function databaseFieldValueToString(
    config: DatabaseFieldConfig,
    value: DatabaseFieldValue,
): string {
    switch (config.type) {
        case "plainText":
            return value as DatabasePlainTextFieldValue;
        case "checkbox":
            return value ? "true" : "false";
        case "number":
            return databaseNumberFieldValueToString(value as DatabaseNumberFieldValue, config);
        case "relation":
            return (value as DatabaseRelationFieldValue)
                .map(link => link.name ?? "Untitled")
                .join(", ");
        default:
            throw exhaustive(config);
    }
}

export function databaseFieldValueToSql<Type extends DatabaseFieldType>(
    type: Type,
    value: DatabaseFieldValue<Type>,
): SqlQuery {
    return sql`${databaseFieldSqlValueSchema(type).serialize(value)}`;
}

export function unknownDatabaseFieldValueToSql(
    type: DatabaseFieldType,
    value: SchemaSerializedValue,
): SqlQuery {
    return databaseFieldValueToSql(type, databaseFieldValueSchema(type).deserialize(value));
}

/**
 * The SQL expression selecting a field's typed value for a row of `dataRow`.
 */
export function selectDatabaseFieldColumn(field: DatabaseFieldModel, dataRow: SqlQuery): SqlQuery {
    switch (field.config.type) {
        case "plainText":
        case "checkbox":
        case "number":
            return sql`${dataRow}.${field.column()}`;
        case "relation":
            assert(field.isType("relation"));
            return selectDatabaseRelationFieldColumn(field, dataRow);
        default:
            throw exhaustive(field.config);
    }
}

/** The SQL expression selecting a field's value formatted as display text. */
export function selectDatabaseFieldColumnAsString(
    field: DatabaseFieldModel,
    dataRow: SqlQuery,
): SqlQuery {
    switch (field.config.type) {
        case "plainText":
            return sql`${dataRow}.${field.column()}`;
        case "checkbox":
            return sql`
                CASE ${dataRow}.${field.column()}
                    WHEN 1 THEN 'true'
                    ELSE 'false'
                END
            `;
        case "number":
            assert(field.isType("number"));
            return selectDatabaseNumberFieldColumnAsString(field, dataRow);
        case "relation":
            assert(field.isType("relation"));
            return selectDatabaseRelationFieldColumnAsString(field, dataRow);
        default:
            throw exhaustive(field.config);
    }
}

/** Applies the schema changes needed when a field is renamed. */
export function renameDatabaseFieldInSchema(
    oldField: DatabaseFieldModel,
    newField: DatabaseFieldModel,
) {
    switch (newField.config.type) {
        case "plainText":
        case "checkbox":
        case "number":
            sql`
                ALTER TABLE ${oldField.table.tableRef}
                RENAME COLUMN ${sql.identifier(oldField.columnName)} TO ${sql.identifier(
                    newField.columnName,
                )}
            `.exec(oldField.db);
            return;
        case "relation":
            assert(newField.isType("relation"));
            resolveDatabaseRelation(newField).joinTable.ensureTableNameIsUpToDate();
            return;
        default:
            throw exhaustive(newField.config);
    }
}

/**
 * Asserts that updating a field's config from `existingConfig` to `nextConfig` is
 * allowed. Callers guarantee both configs have the same type.
 */
export function assertDatabaseFieldConfigChangeValid(
    existingConfig: DatabaseFieldConfig,
    nextConfig: DatabaseFieldConfig,
) {
    switch (existingConfig.type) {
        case "plainText":
        case "checkbox":
        case "number":
            return;
        case "relation":
            assert(nextConfig.type === "relation", "cannot change field type");
            assert(
                nextConfig.joinTableId === existingConfig.joinTableId,
                "cannot update relation field joinTableId",
            );
            assert(nextConfig.side === existingConfig.side, "cannot update relation field side");
            assert(
                nextConfig.linkedTableId === existingConfig.linkedTableId,
                "cannot update relation field linkedTableId",
            );
            return;
        default:
            throw exhaustive(existingConfig);
    }
}
