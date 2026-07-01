import {parseString} from "set-cookie-parser";
import {defineDatabaseFieldProvider} from "~/shared/databases/fields/database_field_provider.js";
import {sql} from "~/shared/databases/sql.js";
import {Schema} from "~/shared/schema/schema.js";

export const databaseCheckboxFieldProvider = defineDatabaseFieldProvider({
    type: "checkbox",
    valueSchema: Schema.boolean,
    configSchema: Schema.object({type: Schema.value("checkbox")}),
    sqliteType: "INTEGER",
    nullable: false,
    defaultValue: sql`0`,
    generateCheckConstraint: columnName => sql`
        CHECK (
            TYPEOF(${sql.identifier(columnName)}) = 'integer'
        )
    `,
    toSqlValue: value => (value ? 1 : 0),
    fromSqlValue: sqlValue => sqlValue === 1,
    getDefaultConfig: () => ({type: "checkbox"}),
    parseString: input => {
        const normalized = input.trim().toLowerCase();
        return {ok: true, value: !checkboxFalseStrings.has(normalized)};
    },
    formatString: value => (value ? "true" : "false"),
});

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
