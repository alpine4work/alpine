import sqlite3InitModule from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import {databaseNumberFieldProvider} from "~/shared/databases/fields/database_number_field.js";
import {sql} from "~/shared/databases/sql.js";

const sqlite3Promise = sqlite3InitModule();
let dbCounter = 0;

async function createDbWithCheckedColumn() {
    const sqlite3 = await sqlite3Promise;
    const db = new sqlite3.oo1.DB(`/test-number-${dbCounter++}.sqlite3`, "ct");
    const check = databaseNumberFieldProvider.generateCheckConstraint(sql.identifier("v"));
    // Match the production DDL: nullable REAL with no NOT NULL clause.
    sql`
        CREATE TABLE t (
            v REAL DEFAULT NULL ${check}
        )
    `.exec(db);
    return db;
}

describe("databaseNumberFieldProvider", () => {
    test("nullable is true", () => {
        expect(databaseNumberFieldProvider.nullable).toBe(true);
    });

    describe("parseString", () => {
        test.each([
            ["", null],
            ["   ", null],
            ["0", 0],
            ["42", 42],
            ["3.14", 3.14],
            ["-2.5", -2.5],
            ["+7", 7],
            ["−3.14", -3.14], // U+2212 minus
            [".5", 0.5],
            ["3.", 3],
            ["1.2e3", 1200],
            ["  3.14  ", 3.14],
            // Currency symbols
            ["$3.14", 3.14],
            ["£3.14", 3.14],
            ["€3.14", 3.14],
            ["¥3.14", 3.14],
            ["3.14 kr", 3.14],
            ["R$3.14", 3.14],
            // Alphabetic currency codes (any letters strip)
            ["USD3.14", 3.14],
            ["USD 3.14", 3.14],
            ["3.14 USD", 3.14],
            ["AU$3.14", 3.14],
            ["NZ$1,234.56", 1234.56],
            ["JPY1200", 1200],
            ["Fr. 3.14", 3.14],
            ["3.14 Fr.", 3.14],
            // Permissive alpha within the 4-char limit — even non-currency letters strip.
            ["abc 3.14", 3.14],
            ["3.14 xyz", 3.14],
            ["USD$ 3.14", 3.14],
            ["3.14 USD$", 3.14],
            ["abcd 3.14", 3.14],
            // Sign + currency in either order, with whitespace
            ["-£3.14", -3.14],
            ["£-3.14", -3.14],
            ["- £ 3.14", -3.14],
            ["+ $10", 10],
            // Accounting negatives — outer parens.
            ["(3.14)", -3.14],
            ["(£3.14)", -3.14],
            ["($1,234.56)", -1234.56],
            ["(USD 3.14)", -3.14],
            // Inner parens (immediately around the number) also negate.
            ["USD (3.14)", -3.14],
            ["(3.14) USD", -3.14],
            ["( 3.14 ) USD", -3.14],
            // Outer + inner parens nest (cancel out).
            ["((3.14))", 3.14],
            ["(USD (3.14))", 3.14],
            // Percent — must be the first non-whitespace character after the number.
            ["50%", 0.5],
            ["-25%", -0.25],
            // US thousands separators
            ["1,234", 1234],
            ["1,234.56", 1234.56],
            ["1,234,567", 1234567],
            ["$1,234.56", 1234.56],
        ])("parses %j as %s", (input, expected) => {
            expect(databaseNumberFieldProvider.parseValueString(input)).toEqual({
                ok: true,
                value: expected,
            });
        });

        test.each([
            ["3.14%"],
            ["3.14 %"],
            // `%` is the first non-whitespace char of the suffix — followup decoration after
            // `%` is fine.
            ["3.14 %USD"],
        ])("scales %j as ~0.0314", input => {
            // `3.14 × 0.01` isn't exact in IEEE-754, so use a tolerant compare instead of
            // `toEqual`.
            const result = databaseNumberFieldProvider.parseValueString(input);
            expect(result.ok).toBe(true);
            if (result.ok) expect(result.value!).toBeCloseTo(0.0314, 10);
        });

        test.each([
            // Pure non-numeric input.
            ["abc"],
            ["hello world"],
            // Multiple decimal points.
            ["1.2.3"],
            // Special float values JS understands but we reject.
            ["Infinity"],
            ["-Infinity"],
            ["NaN"],
            // Decoration only, no number.
            ["$"],
            ["%"],
            ["()"],
            ["USD"],
            // Ambiguous comma pattern: not stripped, then Number() rejects.
            ["1,23"],
            ["1,2345"],
            ["1,234,56"],
            // European decimal — we don't guess locale.
            ["3,14"],
            ["1.234,56"],
            // Decoration longer than 4 non-whitespace chars on either side: looks more like
            // text than a number.
            ["abcde 3.14"],
            ["USDXX 3.14"],
            ["3.14 abcde"],
            ["3.14 USDXX"],
            ["UnitedStatesDollars 3.14"],
            // Stray non-numeric junk inside the number portion.
            ["3.14 dollars and cents"],
            ["1 2 3"],
            ["3..14"],
            ["3.1.4"],
            // Percent placement rules:
            //
            // - Multiple `%` signs.
            ["50%%"],
            // - Leading `%` not allowed.
            ["%50"],
            ["% 3.14"],
            // - Trailing `%` must be the first non-whitespace char of the suffix; anything
            //   between rejects.
            ["3.14 USD%"],
            ["3.14USD%"],
            // - `%` after a closing inner paren rejects.
            ["(3.14)%"],
            // Paren placement rules:
            //
            // - Imbalanced inner parens.
            ["(3.14"],
            ["3.14)"],
            ["USD (3.14"],
            ["3.14) USD"],
            // - Interspersed parens (not flanking the number).
            ["(US)D 3.14"],
            ["3.14 U(S)D"],
            // - Multiple inner-paren layers without an outer wrap to absorb them.
            ["((3.14)"],
            ["(3.14))"],
            // Parens combined with `%` or `-` reject — parens are the sole indicator of
            // negative.
            ["(-3.14)"],
            ["-(3.14)"],
            ["(USD -3.14)"],
            ["USD (-3.14)"],
            ["(3.14%)"],
            ["USD (3.14%)"],
            ["USD ( 3.14% )"],
            ["(USD (3.14%))"],
        ])("rejects %j", input => {
            expect(databaseNumberFieldProvider.parseValueString(input).ok).toBe(false);
        });
    });

    describe("formatString", () => {
        test("null renders blank", () => {
            const config = {type: "number" as const, decimalPlaces: null};
            expect(databaseNumberFieldProvider.valueToString(null, config)).toBe("");
        });

        test("with null decimalPlaces, full precision is preserved", () => {
            const config = {type: "number" as const, decimalPlaces: null};
            expect(databaseNumberFieldProvider.valueToString(3.14159, config)).toBe("3.14159");
            expect(databaseNumberFieldProvider.valueToString(0, config)).toBe("0");
            expect(databaseNumberFieldProvider.valueToString(-1.5, config)).toBe("-1.5");
        });

        test("with decimalPlaces=2, rounds to 2 places", () => {
            const config = {type: "number" as const, decimalPlaces: 2};
            expect(databaseNumberFieldProvider.valueToString(3.14159, config)).toBe("3.14");
            expect(databaseNumberFieldProvider.valueToString(1, config)).toBe("1.00");
        });

        test("with decimalPlaces=0, rounds to integer", () => {
            const config = {type: "number" as const, decimalPlaces: 0};
            expect(databaseNumberFieldProvider.valueToString(3.7, config)).toBe("4");
        });
    });

    describe("generateCheckConstraint", () => {
        test("accepts real, integer, and NULL", async () => {
            const db = await createDbWithCheckedColumn();
            sql`
                INSERT INTO
                    t (v)
                VALUES
                    (1.5)
            `.exec(db);
            sql`
                INSERT INTO
                    t (v)
                VALUES
                    (42)
            `.exec(db);
            sql`
                INSERT INTO
                    t (v)
                VALUES
                    (NULL)
            `.exec(db);
            db.close();
        });

        test("rejects text", async () => {
            const db = await createDbWithCheckedColumn();
            expect(() =>
                sql`
                    INSERT INTO
                        t (v)
                    VALUES
                        ('hello')
                `.exec(db),
            ).toThrow("CHECK constraint failed");
            db.close();
        });
    });
});
