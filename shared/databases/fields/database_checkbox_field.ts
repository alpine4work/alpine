import {defineDatabaseFieldProvider} from "~/shared/databases/fields/database_field_provider.js";
import {sql} from "~/shared/databases/sql.js";
import {Schema} from "~/shared/schema/schema.js";

export const databaseCheckboxFieldProvider = defineDatabaseFieldProvider({
    type: "checkbox",
    valueSchema: Schema.boolean,
    configSchema: Schema.object({type: Schema.value("checkbox")}),
    sqliteType: "INTEGER",
    defaultValue: "0",
    generateCheckConstraint: columnName => sql`
        CHECK (
            TYPEOF(${sql.identifier(columnName)}) = 'integer'
        )
    `,
    toSqlValue: value => (value ? 1 : 0),
    fromSqlValue: sqlValue => sqlValue !== 0,
});
