import {databaseCheckboxFieldProvider} from "~/shared/databases/fields/database_checkbox_field.js";
import type {SqliteStorageType} from "~/shared/databases/fields/database_field_provider.js";
import {databaseNumberFieldProvider} from "~/shared/databases/fields/database_number_field.js";
import {databasePlainTextFieldProvider} from "~/shared/databases/fields/database_plain_text_field.js";
import type {SqlQuery} from "~/shared/databases/sql.js";
import {assert} from "~/shared/helpers/control/assert.js";
import type {Result} from "~/shared/helpers/control/result.js";
import {Schema, type SchemaSerializedValue, type SchemaType} from "~/shared/schema/schema.js";

// -- Provider registry --------------------------------------------------------

const allProviders = [
    databasePlainTextFieldProvider,
    databaseCheckboxFieldProvider,
    databaseNumberFieldProvider,
] as const;

/**
 * Registry of all known field providers, keyed by the
 * field type discriminant.
 */
export const databaseFieldProviders = new Map<DatabaseFieldType, DatabaseFieldProviderBase>(
    allProviders.map(p => [p.type, p] as any),
);

/**
 * Look up the field provider for a given field type.
 * Returns {@link DatabaseFieldProviderBase} so schema
 * methods like `.serialize()` are callable. For typed
 * per-field-type usage, use `DatabaseFieldProvider<Type>`
 * instead.
 */
export function getDatabaseFieldProvider(type: DatabaseFieldType): DatabaseFieldProviderBase {
    const provider = databaseFieldProviders.get(type);
    assert(provider != null, `unknown field type: ${type}`);
    return provider;
}

// -- Derived types and schemas ------------------------------------------------

/**
 * The type discriminant of a field. A string like
 * `"plainText"` or `"checkbox"`. Derived from the
 * registered providers.
 */
export type DatabaseFieldType = (typeof allProviders)[number]["type"];

/**
 * Non-generic base type for dynamic contexts where the
 * field type is not statically known (e.g. the provider
 * registry, action handlers). Schema fields use `any`
 * so methods like `.serialize()` are callable.
 *
 * For statically typed per-field-type usage, use the
 * generic `DatabaseFieldProvider<Type>` instead.
 */
export type DatabaseFieldProviderBase = {
    readonly type: DatabaseFieldType;
    readonly valueSchema: Schema<unknown>;
    readonly configSchema: Schema<unknown>;
    readonly sqliteType: SqliteStorageType;
    readonly nullable: boolean;
    readonly defaultValue: string;
    readonly generateCheckConstraint: (columnName: string) => SqlQuery;
    readonly toSqlValue: (value: unknown) => unknown;
    readonly fromSqlValue: (sqlValue: unknown) => unknown;
    readonly sqlValueSchema: Schema<any>;
    readonly getDefaultConfig: () => any;
    readonly parseString: (input: string, config: any) => Result<unknown, void>;
    readonly formatString: (value: unknown, config: any) => string;
};

export type DatabaseFieldProvider<Type extends DatabaseFieldType = DatabaseFieldType> = Extract<
    (typeof allProviders)[number],
    {type: Type}
>;

export type DatabaseCellValue<Type extends DatabaseFieldType = DatabaseFieldType> = SchemaType<
    DatabaseFieldProvider<Type>["valueSchema"]
>;

/**
 * Schema that deserializes a {@link DatabaseFieldType}
 * string. Validates that the value is a known field
 * type discriminant.
 */
export const DatabaseFieldTypeSchema: Schema<DatabaseFieldType> = Schema.enum(
    allProviders.map(p => p.type),
);

/**
 * The configuration of a field in an Alpine database
 * table. Discriminated on `type`. Derived from the
 * registered providers' config schemas.
 */
export const DatabaseFieldConfigSchema = Schema.union({
    plainText: databasePlainTextFieldProvider.configSchema,
    checkbox: databaseCheckboxFieldProvider.configSchema,
    number: databaseNumberFieldProvider.configSchema,
});

export type DatabaseFieldConfig<Type extends DatabaseFieldType = DatabaseFieldType> = Extract<
    SchemaType<typeof DatabaseFieldConfigSchema>,
    {type: Type}
>;

/**
 * Schema that serializes a {@link DatabaseFieldConfig}
 * to/from a JSON string for storage in the
 * `_alpine_fields.type` SQLite column.
 */
export const DatabaseFieldConfigSqlSchema = DatabaseFieldConfigSchema.migration({
    serialize: (serialized: SchemaSerializedValue) => JSON.stringify(serialized),
    deserialize: (raw: SchemaSerializedValue) => JSON.parse(raw as string),
});
