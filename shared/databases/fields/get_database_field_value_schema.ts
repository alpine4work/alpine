import {DatabaseCheckboxFieldValueSchema} from "~/shared/databases/fields/checkbox/database_checkbox_field.js";
import type {DatabaseFieldType} from "~/shared/databases/fields/database_field_config.js";
import type {DatabaseFieldValue} from "~/shared/databases/fields/database_field_value.js";
import {DatabaseNumberFieldValueSchema} from "~/shared/databases/fields/number/database_number_field.js";
import {DatabasePlainTextFieldValueSchema} from "~/shared/databases/fields/plain_text/database_plain_text_field.js";
import {DatabaseRelationFieldValueSchema} from "~/shared/databases/fields/relation/database_relation_field.js";
import type {Schema} from "~/shared/schema/schema.open_source.js";

const databaseFieldValueSchemas: {[Type in DatabaseFieldType]: Schema<DatabaseFieldValue<Type>>} = {
    PlainText: DatabasePlainTextFieldValueSchema,
    Checkbox: DatabaseCheckboxFieldValueSchema,
    Number: DatabaseNumberFieldValueSchema,
    Relation: DatabaseRelationFieldValueSchema,
};

export function getDatabaseFieldValueSchema<Type extends DatabaseFieldType>(
    type: Type,
): Schema<DatabaseFieldValue<Type>> {
    return databaseFieldValueSchemas[type];
}
