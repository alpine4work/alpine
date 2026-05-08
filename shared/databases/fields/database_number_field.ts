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
 * Non-alphabetic currency symbols stripped from the start
 * or end of a number string. Letter-based currency tokens
 * (`USD`, `AU$`, `Fr.`, `kr`, etc.) are handled by the
 * generic alphabetic-prefix/suffix stripping in
 * `parseNumberString` and don't need to be enumerated here.
 */
const currencySymbols: ReadonlyArray<string> = ["$", "£", "€", "¥", "¢", "₩", "₹"];

/** Match an alphabetic prefix, optionally followed by a `.` (e.g. `Fr.`). */
const leadingAlphaPattern = /^[A-Za-z]+\.?/;

/** Match an alphabetic suffix, optionally followed by a `.` (e.g. `Fr.`). */
const trailingAlphaPattern = /[A-Za-z]+\.?$/;

/**
 * Maximum non-whitespace characters allowed in the
 * leading or trailing decoration around a number.
 * `USD$ 3.14` (4) parses; `USDXX 3.14` (5) does not.
 */
const maxDecorationNonWhitespace = 4;

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
 *   `¥`, `¢`, `₩`, `₹`).
 * - Any alphabetic prefix/suffix (currency codes like
 *   `USD`, `JPY`, `AU$`, `Fr.`, `kr`), capped at 4
 *   non-whitespace characters total per side. So
 *   `USD$ 3.14` parses but `USDXX 3.14` does not.
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

    // Trailing alphabetic suffix and/or non-alpha currency
    // symbol, in any order. Iterates so `3.14 USD$` (alpha
    // then symbol) and `3.14 $USD` strip cleanly.
    let trailingNonWs = 0;
    let trailingChanged = true;
    while (trailingChanged) {
        trailingChanged = false;
        s = s.trimEnd();
        const trailingAlphaMatch = trailingAlphaPattern.exec(s);
        if (trailingAlphaMatch !== null) {
            trailingNonWs += trailingAlphaMatch[0].length;
            s = s.slice(0, -trailingAlphaMatch[0].length);
            trailingChanged = true;
        }
        s = s.trimEnd();
        for (const sym of currencySymbols) {
            if (s.endsWith(sym)) {
                trailingNonWs += sym.length;
                s = s.slice(0, -sym.length);
                trailingChanged = true;
                break;
            }
        }
    }
    if (trailingNonWs > maxDecorationNonWhitespace) {
        return {ok: false, error: undefined};
    }

    // Leading currency and/or sign in any order. Iterates so
    // arrangements like `- £ 3.14`, `£ -3.14`, `+$10`, or
    // `AU$3.14` (alpha then symbol) all strip cleanly.
    let leadingNonWs = 0;
    let changed = true;
    while (changed) {
        changed = false;
        s = s.trimStart();
        const leadingAlphaMatch = leadingAlphaPattern.exec(s);
        if (leadingAlphaMatch !== null) {
            leadingNonWs += leadingAlphaMatch[0].length;
            s = s.slice(leadingAlphaMatch[0].length);
            changed = true;
        }
        s = s.trimStart();
        for (const sym of currencySymbols) {
            if (s.startsWith(sym)) {
                leadingNonWs += sym.length;
                s = s.slice(sym.length);
                changed = true;
                break;
            }
        }
        s = s.trimStart();
        if (s.startsWith("-") || s.startsWith("−")) {
            sign = -sign;
            leadingNonWs += 1;
            s = s.slice(1);
            changed = true;
        } else if (s.startsWith("+")) {
            leadingNonWs += 1;
            s = s.slice(1);
            changed = true;
        }
    }
    if (leadingNonWs > maxDecorationNonWhitespace) {
        return {ok: false, error: undefined};
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
