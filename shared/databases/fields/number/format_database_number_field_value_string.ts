import type {
    DatabaseNumberFieldConfig,
    DatabaseNumberFieldValue,
} from "~/shared/databases/fields/number/database_number_field.js";

/**
 * Formats a number field value as display text. The field's `decimalPlaces`
 * setting controls the output so all in-memory formatting has the same precision.
 */
export function formatDatabaseNumberFieldValueString(
    value: DatabaseNumberFieldValue,
    config: DatabaseNumberFieldConfig,
): string {
    if (value == null) return "";
    return config.decimalPlaces == null ? String(value) : value.toFixed(config.decimalPlaces);
}
