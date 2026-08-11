import type {DatabaseFieldColumn} from "~/shared/databases/fields/all_database_field_providers.js";
import {sql} from "~/shared/databases/sql.js";
import {Schema, type SchemaType} from "~/shared/schema/schema.open_source.js";

export const DatabaseCheckboxFieldConfigSchema = Schema.object({type: Schema.value("checkbox")});
export type DatabaseCheckboxFieldConfig = SchemaType<typeof DatabaseCheckboxFieldConfigSchema>;

export const DatabaseCheckboxFieldValueSchema = Schema.boolean;
export type DatabaseCheckboxFieldValue = SchemaType<typeof DatabaseCheckboxFieldValueSchema>;

export const databaseCheckboxFieldColumn: DatabaseFieldColumn = {
    sqliteType: "INTEGER",
    nullable: false,
    defaultValue: sql`0`,
    generateCheckConstraint: columnName => sql`
        CHECK (
            TYPEOF(${columnName}) = 'integer'
        )
    `,
};

/**
 * Parses a string as a checkbox value. Match is on a trimmed, lower-cased input
 * against {@link checkboxFalseStrings}. Empty (whitespace only) input is also
 * `false`. Anything else is `true`.
 */
export function parseDatabaseCheckboxFieldValueString(input: string): boolean {
    return !checkboxFalseStrings.has(input.trim().toLowerCase());
}

/**
 * Strings interpreted as `false` by `parseDatabaseCheckboxFieldValueString`.
 */
const checkboxFalseStrings: ReadonlySet<string> = new Set([
    "",
    "0",
    "f",
    "false",
    "n",
    "no",
    "off",
    "unchecked",
    "✗",
    "✘",
    "☐",
]);
