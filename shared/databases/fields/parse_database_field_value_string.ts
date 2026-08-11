import {parseDatabaseCheckboxFieldValueString} from "~/shared/databases/fields/checkbox/parse_database_checkbox_field_value_string.js";
import type {
    DatabaseFieldConfig,
    DatabaseFieldType,
} from "~/shared/databases/fields/database_field_config.js";
import type {DatabaseFieldValue} from "~/shared/databases/fields/database_field_value.js";
import {parseDatabaseNumberFieldValueString} from "~/shared/databases/fields/number/parse_database_number_field_value_string.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import type {Result} from "~/shared/helpers/control/result.open_source.js";

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
