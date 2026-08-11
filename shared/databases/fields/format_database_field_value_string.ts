import type {
    DatabaseFieldConfig,
    DatabaseFieldType,
} from "~/shared/databases/fields/database_field_config.js";
import type {DatabaseFieldValue} from "~/shared/databases/fields/database_field_value.js";
import type {DatabaseNumberFieldValue} from "~/shared/databases/fields/number/database_number_field.js";
import {formatDatabaseNumberFieldValueString} from "~/shared/databases/fields/number/format_database_number_field_value_string.js";
import type {DatabasePlainTextFieldValue} from "~/shared/databases/fields/plain_text/database_plain_text_field.js";
import type {DatabaseRelationFieldValue} from "~/shared/databases/fields/relation/database_relation_field.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";

export function formatDatabaseFieldValueString<Type extends DatabaseFieldType>(
    config: DatabaseFieldConfig<Type>,
    value: DatabaseFieldValue<Type>,
): string;
export function formatDatabaseFieldValueString(
    config: DatabaseFieldConfig,
    value: DatabaseFieldValue,
): string {
    switch (config.type) {
        case "plainText":
            return value as DatabasePlainTextFieldValue;
        case "checkbox":
            return value ? "true" : "false";
        case "number":
            return formatDatabaseNumberFieldValueString(value as DatabaseNumberFieldValue, config);
        case "relation":
            return (value as DatabaseRelationFieldValue)
                .map(link => link.name ?? "Untitled")
                .join(", ");
        default:
            throw exhaustive(config);
    }
}
