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

// -- parseString --------------------------------------------------------------

/** Maximum non-whitespace decoration chars per side. */
const maxDecorationNonWhitespace = 4;

/**
 * Splits an input into `<prefix><body><suffix>`. The body
 * is a number-shaped run that must contain at least one
 * digit; everything before and after is decoration. The
 * prefix is non-greedy so the body anchors as early as
 * possible. Body alternatives, in order:
 *
 * 1. Digit + (`,.eE+-` and digits) + digit — the usual case.
 * 2. Leading-decimal forms like `.5` or `.5e-3`.
 * 3. Trailing-decimal form `3.`.
 * 4. Single digit fallback.
 */
const numberStructurePattern =
    /^(?<prefix>.*?)(?<body>\d[\d,.eE+-]*\d|\.\d+(?:[eE][+-]?\d+)?|\d+\.|\d)(?<suffix>.*)$/;

/** Comma pattern for unambiguous US thousands grouping. */
const usThousandsPattern = /^\d{1,3}(,\d{3})+(\.\d+)?$/;

/**
 * Parse a string into a nullable number. Forgiving for
 * common copy-paste shapes; assumes en-US conventions
 * (`,` thousands, `.` decimal). Tolerates:
 *
 * - Empty string → `null`.
 * - Whitespace anywhere on the outside.
 * - Sign variants in decoration: ASCII `-`/`+` and
 *   U+2212 `−` (multiple signs combine).
 * - Accounting parens at the outermost ends only:
 *   `(3.14)` → `-3.14`. Inner parens (`USD (3.14)`) are
 *   plain decoration, not negation.
 * - Trailing `%` immediately after the number (allowing
 *   whitespace): `3.14%` and `3.14 %` scale by `1/100`.
 *   Anything between the number and the `%` (e.g.
 *   `3.14 USD%`) rejects.
 * - Up to {@link maxDecorationNonWhitespace} non-whitespace
 *   decoration chars per side, of any kind (currency
 *   codes, symbols, single letters). `USD$ 3.14` parses;
 *   `UnitedStatesDollars 3.14` does not.
 * - US thousands separators when unambiguous (`1,234.56`).
 *   Mismatched comma patterns like `1,23` are rejected,
 *   not silently reinterpreted.
 *
 * Rejects `Infinity`, `NaN`, leading `%`, multiple `%`
 * signs, and decoration containing digits (a digit in
 * decoration means a number was missed).
 */
function parseNumberString(input: string): Result<number | null, void> {
    let s = input.trim();
    if (s === "") return {ok: true, value: null};

    let parenSign = 1;
    if (s.startsWith("(") && s.endsWith(")")) {
        parenSign = -1;
        s = s.slice(1, -1).trim();
    }

    const match = numberStructurePattern.exec(s);
    if (match === null || match.groups === undefined) return {ok: false, error: undefined};

    const prefix = analyseDecoration(match.groups.prefix);
    const suffix = analyseDecoration(match.groups.suffix);
    if (!prefix.ok || !suffix.ok) return {ok: false, error: undefined};

    // Percent rules:
    // - Leading `%` is invalid.
    // - At most one `%` total.
    // - When present in the suffix, `%` must be the first
    //   non-whitespace char (immediately after the number,
    //   modulo whitespace).
    if (prefix.percentCount > 0) return {ok: false, error: undefined};
    if (suffix.percentCount > 1) return {ok: false, error: undefined};
    if (suffix.percentCount === 1 && match.groups.suffix.trimStart()[0] !== "%") {
        return {ok: false, error: undefined};
    }

    let body = match.groups.body;
    if (body.includes(",") && usThousandsPattern.test(body)) {
        body = body.replace(/,/g, "");
    }

    const n = Number(body);
    if (!Number.isFinite(n)) return {ok: false, error: undefined};

    const sign = parenSign * prefix.sign * suffix.sign;
    const scale = suffix.percentCount === 1 ? 0.01 : 1;
    return {ok: true, value: n * sign * scale};
}

/**
 * Inspect a decoration substring. Returns the accumulated
 * sign and percent count; rejects (`ok: false`) if the
 * decoration has more than {@link maxDecorationNonWhitespace}
 * non-whitespace chars or contains a digit (which would
 * mean the number extraction missed something).
 */
function analyseDecoration(decoration: string): {
    ok: boolean;
    sign: number;
    percentCount: number;
} {
    let sign = 1;
    let percentCount = 0;
    let nonWs = 0;
    for (const ch of decoration) {
        if (/\s/.test(ch)) continue;
        if (ch >= "0" && ch <= "9") return {ok: false, sign, percentCount};
        nonWs++;
        if (ch === "-" || ch === "−") sign *= -1;
        else if (ch === "%") percentCount++;
    }
    return {ok: nonWs <= maxDecorationNonWhitespace, sign, percentCount};
}
