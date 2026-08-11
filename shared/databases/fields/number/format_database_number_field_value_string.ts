import type {
    DatabaseNumberFieldConfig,
    DatabaseNumberFieldValue,
} from "~/shared/databases/fields/number/database_number_field.js";

export function formatDatabaseNumberFieldValueString(
    value: DatabaseNumberFieldValue,
    config: DatabaseNumberFieldConfig,
): string {
    if (value == null) return "";
    return config.decimalPlaces == null ? String(value) : value.toFixed(config.decimalPlaces);
}
