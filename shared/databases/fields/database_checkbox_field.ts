import {ColumnBackedDatabaseFieldProvider} from "~/shared/databases/fields/base/database_field_provider_base.js";
import {DatabaseFieldModelOfType} from "~/shared/databases/model/database_field_model.js";
import {SqlBooleanSchema} from "~/shared/databases/model/sqlite_schema.js";
import {type SqlQuery, sql} from "~/shared/databases/sql.js";
import {Result} from "~/shared/helpers/control/result.js";
import {Schema, type SchemaType} from "~/shared/schema/schema.js";

export const DatabaseCheckboxFieldConfigSchema = Schema.object({type: Schema.value("checkbox")});
export type DatabaseCheckboxFieldConfig = SchemaType<typeof DatabaseCheckboxFieldConfigSchema>;

export const DatabaseCheckboxFieldValueSchema = Schema.boolean;
export type DatabaseCheckboxFieldValue = SchemaType<typeof DatabaseCheckboxFieldValueSchema>;

export class DatabaseCheckboxFieldProvider extends ColumnBackedDatabaseFieldProvider<
    "checkbox",
    DatabaseCheckboxFieldValue,
    DatabaseCheckboxFieldConfig
> {
    static readonly instance = new DatabaseCheckboxFieldProvider();

    override readonly type = "checkbox";
    override readonly valueSchema = DatabaseCheckboxFieldValueSchema;
    override readonly configSchema = DatabaseCheckboxFieldConfigSchema;
    override readonly sqlValueSchema = SqlBooleanSchema;
    override readonly sqliteType = "INTEGER";
    override readonly nullable = false;
    override readonly defaultValue = sql`0`;

    override generateCheckConstraint(columnName: SqlQuery) {
        return sql`
            CHECK (
                TYPEOF(${columnName}) = 'integer'
            )
        `;
    }

    override parseValueString(input: string): Result<boolean, void> {
        const normalized = input.trim().toLowerCase();
        return {ok: true, value: !checkboxFalseStrings.has(normalized)};
    }

    override valueToString(value: boolean): string {
        return value ? "true" : "false";
    }

    override _selectColumnAsString(field: DatabaseFieldModelOfType<"checkbox">, dataRow: SqlQuery) {
        return sql`
            CASE ${this.selectColumn(field, dataRow)}
                WHEN 1 THEN 'true'
                ELSE 'false'
            END
        `;
    }
}

export const databaseCheckboxFieldProvider: DatabaseCheckboxFieldProvider =
    DatabaseCheckboxFieldProvider.instance;

/**
 * Strings interpreted as `false` by `parseString`. Match is on a trimmed,
 * lower-cased input. Empty (whitespace only) input is also `false`. Anything else
 * is `true`.
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
