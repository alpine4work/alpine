import type {DatabaseCheckboxFieldValue} from "~/shared/databases/fields/checkbox/database_checkbox_field.js";
import type {DatabaseFieldType} from "~/shared/databases/fields/database_field_config.js";
import type {DatabaseNumberFieldValue} from "~/shared/databases/fields/number/database_number_field.js";
import type {DatabasePlainTextFieldValue} from "~/shared/databases/fields/plain_text/database_plain_text_field.js";
import type {DatabaseRelationFieldValue} from "~/shared/databases/fields/relation/database_relation_field.js";

type DatabaseFieldValues = {
    plainText: DatabasePlainTextFieldValue;
    checkbox: DatabaseCheckboxFieldValue;
    number: DatabaseNumberFieldValue;
    relation: DatabaseRelationFieldValue;
};

export type DatabaseFieldValue<Type extends DatabaseFieldType = DatabaseFieldType> =
    DatabaseFieldValues[Type];
