import type {DatabaseFieldColumn} from "~/shared/databases/fields/all_database_field_providers.js";
import type {DatabaseFieldModelOfType} from "~/shared/databases/model/database_field_model.js";
import {type SqlQuery, sql} from "~/shared/databases/sql.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import type {Result} from "~/shared/helpers/control/result.open_source.js";
import {Schema, type SchemaType} from "~/shared/schema/schema.open_source.js";

export const DatabaseNumberFieldConfigSchema = Schema.object({
    type: Schema.value("number"),
    decimalPlaces: Schema.integer.min(0).max(10).nullable(),
});
export type DatabaseNumberFieldConfig = SchemaType<typeof DatabaseNumberFieldConfigSchema>;

export const DatabaseNumberFieldValueSchema = Schema.float.nullable();
export type DatabaseNumberFieldValue = SchemaType<typeof DatabaseNumberFieldValueSchema>;

export const databaseNumberFieldColumn: DatabaseFieldColumn = {
    sqliteType: "REAL",
    nullable: true,
    defaultValue: sql`NULL`,
    generateCheckConstraint: columnName => sql`
        CHECK (
            TYPEOF(${columnName}) IN ('real', 'integer', 'null')
        )
    `,
};

export function databaseNumberFieldValueToString(
    value: DatabaseNumberFieldValue,
    config: DatabaseNumberFieldConfig,
): string {
    if (value == null) return "";
    return config.decimalPlaces == null ? String(value) : value.toFixed(config.decimalPlaces);
}

export function selectDatabaseNumberFieldColumnAsString(
    field: DatabaseFieldModelOfType<"number">,
    dataRow: SqlQuery,
): SqlQuery {
    const column = sql`${dataRow}.${field.column()}`;
    if (field.config.decimalPlaces == null) {
        return sql`
            CASE
                WHEN ${column} IS NULL THEN ''
                ELSE CAST(${column} AS TEXT)
            END
        `;
    }
    return sql`
        CASE
            WHEN ${column} IS NULL THEN ''
            ELSE PRINTF(
                ${`%.${field.config.decimalPlaces}f`},
                ${column}
            )
        END
    `;
}

// -- parseString --------------------------------------------------------------

/** Maximum non-whitespace decoration chars per side. */
const maxDecorationNonWhitespace = 4;

/**
 * Splits an input into `<prefix><body><suffix>`. The body is a number-shaped run
 * that must contain at least one digit; everything before and after is decoration.
 * The prefix is non-greedy so the body anchors as early as possible. Body
 * alternatives, in order:
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
 * Parse a string into a nullable number. Forgiving for common copy-paste shapes;
 * assumes en-US conventions (`,` thousands, `.` decimal). Tolerates:
 *
 * - Empty string → `null`.
 * - Whitespace anywhere on the outside.
 * - Sign variants in decoration: ASCII `-`/`+` and U+2212 `−` (multiple signs
 *   combine).
 * - Accounting parens around the number — outer (`(USD 3.14)`) or inner
 *   (`USD (3.14)`, `(3.14) USD`). Combined inner + outer parens nest (cancel each
 *   other). Imbalanced or interspersed parens (`(US)D 3.14`, `(3.14`, `3.14)`)
 *   reject. Parens may not be combined with `%` or `-`/`−`: they're the sole way
 *   to indicate negative when used.
 * - Trailing `%` immediately after the number (allowing whitespace): `3.14%` and
 *   `3.14 %` scale by `1/100`. Anything between the number and the `%` (e.g.
 *   `3.14 USD%`) rejects.
 * - Up to {@link maxDecorationNonWhitespace} non-whitespace decoration chars per
 *   side, of any kind (currency codes, symbols, single letters). `USD$ 3.14`
 *   parses; `UnitedStatesDollars 3.14` does not.
 * - US thousands separators when unambiguous (`1,234.56`). Mismatched comma
 *   patterns like `1,23` are rejected, not silently reinterpreted.
 *
 * Rejects `Infinity`, `NaN`, leading `%`, multiple `%` signs, and decoration
 * containing digits (a digit in decoration means a number was missed).
 */
export function parseDatabaseNumberFieldValueString(input: string): Result<number | null, void> {
    let s = input.trim();
    if (s === "") return {ok: true, value: null};

    let outerSign = 1;
    if (s.startsWith("(") && s.endsWith(")")) {
        outerSign = -1;
        s = s.slice(1, -1).trim();
    }

    const match = numberStructurePattern.exec(s);
    if (match === null || match.groups === undefined) return {ok: false, error: undefined};

    const prefix = splitPrefix(assertExists(match.groups.prefix));
    const suffix = splitSuffix(assertExists(match.groups.suffix));
    if (!prefix.ok || !suffix.ok) return {ok: false, error: undefined};

    // Inner parens must be balanced.
    if (prefix.hasOpenParen !== suffix.hasCloseParen) return {ok: false, error: undefined};
    const innerSign = prefix.hasOpenParen ? -1 : 1;

    const prefixOuter = analyseDecoration(prefix.outerDecoration);
    const suffixOuter = analyseDecoration(suffix.outerDecoration);
    if (!prefixOuter.ok || !suffixOuter.ok) return {ok: false, error: undefined};

    // Accounting parens (outer or inner) are the sole way to indicate negative when
    // used: combining them with an explicit `-`/`−` or with `%` is ambiguous, so we
    // reject those combinations.
    const hasAnyParens = outerSign === -1 || prefix.hasOpenParen;
    if (hasAnyParens && (prefixOuter.hasNegativeSign || suffixOuter.hasNegativeSign)) {
        return {ok: false, error: undefined};
    }
    if (hasAnyParens && suffix.hasPercent) return {ok: false, error: undefined};

    let body = assertExists(match.groups.body);
    if (body.includes(",") && usThousandsPattern.test(body)) {
        body = body.replace(/,/g, "");
    }

    const n = Number(body);
    if (!Number.isFinite(n)) return {ok: false, error: undefined};

    const sign = outerSign * innerSign * prefixOuter.sign * suffixOuter.sign;
    const scale = suffix.hasPercent ? 0.01 : 1;
    return {ok: true, value: n * sign * scale};
}

/**
 * Split a prefix into an optional inner-paren `(` (which must be the last
 * non-whitespace char) and the outer decoration that comes before it. Rejects if
 * any stray `(`, `)`, or `%` appears in the outer decoration.
 */
function splitPrefix(prefix: string): {
    ok: boolean;
    hasOpenParen: boolean;
    outerDecoration: string;
} {
    let s = prefix.trimEnd();
    let hasOpenParen = false;
    if (s.endsWith("(")) {
        hasOpenParen = true;
        s = s.slice(0, -1).trimEnd();
    }
    if (/[(%)]/.test(s)) return {ok: false, hasOpenParen, outerDecoration: ""};
    return {ok: true, hasOpenParen, outerDecoration: s};
}

/**
 * Split a suffix into (in order) an optional `%` (which must be the first
 * non-whitespace char), an optional inner-paren `)` (which must come immediately
 * after the `%` if any), and the outer decoration that follows. Rejects if any
 * stray `(`, `)`, or `%` appears in the outer decoration.
 */
function splitSuffix(suffix: string): {
    ok: boolean;
    hasPercent: boolean;
    hasCloseParen: boolean;
    outerDecoration: string;
} {
    let s = suffix.trimStart();
    let hasPercent = false;
    let hasCloseParen = false;
    if (s.startsWith("%")) {
        hasPercent = true;
        s = s.slice(1).trimStart();
    }
    if (s.startsWith(")")) {
        hasCloseParen = true;
        s = s.slice(1).trimStart();
    }
    if (/[(%)]/.test(s)) {
        return {ok: false, hasPercent, hasCloseParen, outerDecoration: ""};
    }
    return {ok: true, hasPercent, hasCloseParen, outerDecoration: s};
}

/**
 * Inspect outer decoration (after `splitPrefix` / `splitSuffix` extracted parens
 * and percent). Returns the accumulated sign and a flag for whether any negative
 * sign char was seen; rejects if more than {@link maxDecorationNonWhitespace}
 * non-whitespace chars or any digit.
 */
function analyseDecoration(decoration: string): {
    ok: boolean;
    sign: number;
    hasNegativeSign: boolean;
} {
    let sign = 1;
    let hasNegativeSign = false;
    let nonWs = 0;
    for (const ch of decoration) {
        if (/\s/.test(ch)) continue;
        if (ch >= "0" && ch <= "9") return {ok: false, sign, hasNegativeSign};
        nonWs++;
        if (ch === "-" || ch === "−") {
            sign *= -1;
            hasNegativeSign = true;
        }
    }
    return {ok: nonWs <= maxDecorationNonWhitespace, sign, hasNegativeSign};
}
