/* eslint-disable cyberworlds/string-quotes -- SQL literals */

import {defineDatabaseFieldProvider} from "~/shared/databases/fields/database_field_provider.js";
import {sql} from "~/shared/databases/sql.js";
import {Schema} from "~/shared/schema/schema.js";

export const databasePlainTextFieldProvider = defineDatabaseFieldProvider({
    type: "plainText",
    valueSchema: Schema.string,
    configSchema: Schema.object({type: Schema.value("plainText")}),
    sqliteType: "TEXT",
    defaultValue: "''",
    generateCheckConstraint: columnName => sql`
        CHECK (
            TYPEOF(${sql.identifier(columnName)}) = 'text'
        )
    `,
    toSqlValue: value => value,
    fromSqlValue: sqlValue => sqlValue,
});
