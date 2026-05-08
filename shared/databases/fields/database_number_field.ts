import {defineDatabaseFieldProvider} from "~/shared/databases/fields/database_field_provider.js";
import {sql} from "~/shared/databases/sql.js";
import type {Result} from "~/shared/helpers/control/result.js";
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
    parseString: input => parseNumberString(input),
    formatString: (value, config) => {
        if (value == null) return "";
        return config.decimalPlaces == null ? String(value) : value.toFixed(config.decimalPlaces);
    },
});

// -- parseString helpers ------------------------------------------------------

/**
 * Currency symbols stripped from the start or end of a
 * number string. Order matters: longer prefixes (e.g.
 * `R$`) must come before single-character ones (`$`)
 * so the longer match wins.
 */
const currencySymbols: ReadonlyArray<string> = [
    "R$",
    "Fr.",
    "kr",
    "$",
    "£",
    "€",
    "¥",
    "¢",
    "₩",
    "₹",
];

/**
 * Parse a string into a nullable number. Forgiving for
 * common copy-paste shapes; assumes en-US conventions
 * (`,` thousands, `.` decimal). Specifically tolerates:
 *
 * - Whitespace (leading, trailing, around signs/symbols).
 * - Empty string → `null`.
 * - Sign variants: ASCII `-`/`+` and U+2212 `−`.
 * - Accounting negatives: `(3.14)` → `-3.14`.
 * - Trailing `%`: scales by `1/100` (`50%` → `0.5`).
 * - Currency symbols at either end (`$`, `£`, `€`,
 *   `¥`, `¢`, `₩`, `₹`, `R$`, `kr`, `Fr.`).
 * - US thousands separators when the comma pattern is
 *   unambiguous (`1,234.56` → `1234.56`). Mismatched
 *   patterns like `1,23` are rejected, not silently
 *   reinterpreted.
 * - Trailing or leading decimal point (`3.`, `.5`).
 *
 * Rejects `Infinity`, `NaN`, and any leftover
 * non-numeric content.
 */
function parseNumberString(input: string): Result<number | null, void> {
    let s = input.trim();
    if (s === "") return {ok: true, value: null};

    let sign = 1;
    let scale = 1;

    // Accounting negative: `(...)` wraps a negative.
    if (s.startsWith("(") && s.endsWith(")")) {
        sign = -1;
        s = s.slice(1, -1).trim();
    }

    // Trailing percent: `50%` → 0.5.
    if (s.endsWith("%")) {
        scale = 0.01;
        s = s.slice(0, -1).trimEnd();
    }

    // Trailing currency symbol: `3.14 kr`.
    for (const sym of currencySymbols) {
        if (s.endsWith(sym)) {
            s = s.slice(0, -sym.length).trimEnd();
            break;
        }
    }

    // Leading currency and/or sign in any order. Iterates so
    // arrangements like `- £ 3.14`, `£ -3.14`, or `+$10` all
    // strip cleanly.
    let changed = true;
    while (changed) {
        changed = false;
        s = s.trimStart();
        for (const sym of currencySymbols) {
            if (s.startsWith(sym)) {
                s = s.slice(sym.length);
                changed = true;
                break;
            }
        }
        s = s.trimStart();
        if (s.startsWith("-") || s.startsWith("−")) {
            sign = -sign;
            s = s.slice(1);
            changed = true;
        } else if (s.startsWith("+")) {
            s = s.slice(1);
            changed = true;
        }
    }

    // US thousands separators: only strip when commas group
    // exactly 3 digits each. Ambiguous shapes like `1,23`
    // fall through and are rejected by `Number()`.
    if (s.includes(",") && /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) {
        s = s.replace(/,/g, "");
    }

    if (s === "") return {ok: false, error: undefined};
    const n = Number(s);
    if (!Number.isFinite(n)) return {ok: false, error: undefined};
    return {ok: true, value: n * sign * scale};
}
