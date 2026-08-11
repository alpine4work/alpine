import type {DatabaseFieldColumn} from "~/shared/databases/fields/all_database_field_providers.js";
import {sql} from "~/shared/databases/sql.js";
import {Schema, type SchemaType} from "~/shared/schema/schema.open_source.js";

export const DatabasePlainTextFieldConfigSchema = Schema.object({type: Schema.value("plainText")});
export type DatabasePlainTextFieldConfig = SchemaType<typeof DatabasePlainTextFieldConfigSchema>;

export const DatabasePlainTextFieldValueSchema = Schema.string;
export type DatabasePlainTextFieldValue = SchemaType<typeof DatabasePlainTextFieldValueSchema>;

export const databasePlainTextFieldColumn: DatabaseFieldColumn = {
    sqliteType: "TEXT",
    nullable: false,
    defaultValue: sql`''`,
    generateCheckConstraint: columnName => sql`
        CHECK (
            TYPEOF(${columnName}) = 'text'
        )
    `,
};
