import type {DatabaseFieldType} from "~/shared/databases/fields/database_field_config.js";

/** All field types, in the order shown in the field type picker. */
export const allDatabaseFieldTypes: ReadonlyArray<DatabaseFieldType> = [
    "PlainText",
    "Checkbox",
    "Number",
    "Relation",
];
