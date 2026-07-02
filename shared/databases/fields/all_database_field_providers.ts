import {type} from "os";
import {Type} from "typescript";
import {DatabaseFieldProviderBase} from "~/shared/databases/fields/base/database_field_provider_base.js";
import {DatabaseCheckboxFieldProvider} from "~/shared/databases/fields/database_checkbox_field.js";
import {DatabaseNumberFieldProvider} from "~/shared/databases/fields/database_number_field.js";
import {DatabasePlainTextFieldProvider} from "~/shared/databases/fields/database_plain_text_field.js";
import {DatabaseRelationFieldProvider} from "~/shared/databases/fields/database_relation_field.js";
import {SqlJsonSchema} from "~/shared/databases/model/sqlite_schema.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {createObjectFromKeys} from "~/shared/helpers/object/create_object_from_keys.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

const allDatabaseFieldProviders = [
    new DatabaseCheckboxFieldProvider(),
    new DatabaseNumberFieldProvider(),
    new DatabasePlainTextFieldProvider(),
    new DatabaseRelationFieldProvider(),
] as const;

export type DatabaseFieldType = (typeof allDatabaseFieldProviders)[number]["type"];
export type DatabaseFieldProvider<Type extends DatabaseFieldType = DatabaseFieldType> = Extract<
    (typeof allDatabaseFieldProviders)[number],
    {type: Type}
>;
export type DatabaseFieldConfig<Type extends DatabaseFieldType = DatabaseFieldType> = SchemaType<
    DatabaseFieldProvider<Type>["configSchema"]
>;
export type DatabaseFieldValue<Type extends DatabaseFieldType = DatabaseFieldType> = SchemaType<
    DatabaseFieldProvider<Type>["valueSchema"]
>;
export type UnknownDatabaseFieldProvider = DatabaseFieldProviderBase<
    DatabaseFieldType,
    unknown,
    {type: DatabaseFieldType}
>;

const databaseFieldProviderMap = new Map<DatabaseFieldType, DatabaseFieldProvider>(
    allDatabaseFieldProviders.map(provider => [provider.type, provider]),
);

export function getDatabaseFieldProvider<Type extends DatabaseFieldType | void = void>(
    type: Type extends DatabaseFieldType ? Type : DatabaseFieldType,
): Type extends DatabaseFieldType ? DatabaseFieldProvider<Type> : UnknownDatabaseFieldProvider {
    const provider = databaseFieldProviderMap.get(type);
    assert(provider != null, `unknown field type: ${type}`);
    return provider as any;
}

const configSchemas = Object.fromEntries(
    allDatabaseFieldProviders.map(provider => [provider.type, provider.configSchema]),
) as unknown as {[K in DatabaseFieldConfig as K["type"]]: Schema<K>};
export const DatabaseFieldConfigSchema = Schema.union(configSchemas);

export const DatabaseFieldConfigSqlSchema = SqlJsonSchema(DatabaseFieldConfigSchema);
