import {defineDatabaseFieldProvider} from "~/shared/databases/fields/database_field_provider.js";
import {sql} from "~/shared/databases/sql.js";
import {Schema} from "~/shared/schema/schema.js";

export const databaseNumberFieldProvider = defineDatabaseFieldProvider({
    type: "number",
    valueSchema: Schema.float.nullable(),
    configSchema: Schema.object({
        type: Schema.value("number"),
        decimalPlaces: Schema.integer.nullable(),
    }),
    sqliteType: "REAL",
    nullable: true,
    defaultValue: "NULL",
    generateCheckConstraint: columnName => sql`
        CHECK (
            TYPEOF(${sql.identifier(columnName)}) IN ('real', 'integer', 'null')
        )
    `,
    toSqlValue: value => value,
    fromSqlValue: sqlValue => sqlValue,
    getDefaultConfig: () => ({type: "number", decimalPlaces: null}),
    parseString: input => {
        if (input === "") return {ok: true, value: null};
        const n = Number(input);
        return Number.isFinite(n) ? {ok: true, value: n} : {ok: false, error: undefined};
    },
    formatString: (value, config) => {
        if (value == null) return "";
        return config.decimalPlaces == null ? String(value) : value.toFixed(config.decimalPlaces);
    },
});
