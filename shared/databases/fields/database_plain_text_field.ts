/* eslint-disable cyberworlds/string-quotes -- SQL literals */

import {ColumnBackedDatabaseFieldProvider} from "~/shared/databases/fields/base/database_field_provider_base.js";
import {sql, SqlQuery} from "~/shared/databases/sql.js";
import {Result} from "~/shared/helpers/control/result.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

export const DatabasePlainTextFieldConfigSchema = Schema.object({type: Schema.value("plainText")});
export type DatabasePlainTextFieldConfig = SchemaType<typeof DatabasePlainTextFieldConfigSchema>;

export const DatabasePlainTextFieldValueSchema = Schema.string;
export type DatabasePlainTextFieldValue = SchemaType<typeof DatabasePlainTextFieldValueSchema>;

export class DatabasePlainTextFieldProvider extends ColumnBackedDatabaseFieldProvider<
    "plainText",
    DatabasePlainTextFieldValue,
    DatabasePlainTextFieldConfig
> {
    readonly type = "plainText";
    readonly valueSchema = DatabasePlainTextFieldValueSchema;
    readonly configSchema = DatabasePlainTextFieldConfigSchema;
    readonly sqliteType = "TEXT";
    readonly nullable = false;
    readonly defaultValue = sql`''`;

    generateCheckConstraint(columnName: SqlQuery): SqlQuery {
        return sql`
            CHECK (
                TYPEOF(${columnName}) = 'text'
            )
        `;
    }

    parseValueString(input: string): Result<string, void> {
        return {ok: true, value: input};
    }

    valueToString(value: string): string {
        return value;
    }
}
