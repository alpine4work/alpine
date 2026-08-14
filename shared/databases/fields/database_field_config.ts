import {
    type DatabaseCheckboxFieldConfig,
    DatabaseCheckboxFieldConfigSchema,
} from "~/shared/databases/fields/checkbox/database_checkbox_field.js";
import {
    type DatabaseNumberFieldConfig,
    DatabaseNumberFieldConfigSchema,
} from "~/shared/databases/fields/number/database_number_field.js";
import {
    type DatabasePlainTextFieldConfig,
    DatabasePlainTextFieldConfigSchema,
} from "~/shared/databases/fields/plain_text/database_plain_text_field.js";
import {
    type DatabaseRelationFieldConfig,
    DatabaseRelationFieldConfigSchema,
} from "~/shared/databases/fields/relation/database_relation_field.js";
import {SqlJsonSchema} from "~/shared/databases/model/sqlite_schema.js";
import {Schema} from "~/shared/schema/schema.js";

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

export const DatabaseFieldConfigSchema = Schema.union({
    PlainText: DatabasePlainTextFieldConfigSchema,
    Checkbox: DatabaseCheckboxFieldConfigSchema,
    Number: DatabaseNumberFieldConfigSchema,
    Relation: DatabaseRelationFieldConfigSchema,
});

export const DatabaseFieldConfigSqlSchema = SqlJsonSchema(DatabaseFieldConfigSchema);
