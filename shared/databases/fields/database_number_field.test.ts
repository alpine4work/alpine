import sqlite3InitModule from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import {databaseNumberFieldProvider} from "~/shared/databases/fields/database_number_field.js";
import {sql} from "~/shared/databases/sql.js";

const sqlite3Promise = sqlite3InitModule();
let dbCounter = 0;

async function createDbWithCheckedColumn() {
    const sqlite3 = await sqlite3Promise;
    const db = new sqlite3.oo1.DB(`/test-number-${dbCounter++}.sqlite3`, "ct");
    const check = databaseNumberFieldProvider.generateCheckConstraint("v");
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

    test("getDefaultConfig is unlimited (null) decimal places", () => {
        expect(databaseNumberFieldProvider.getDefaultConfig()).toEqual({
            type: "number",
            decimalPlaces: null,
        });
    });

    describe("parseString", () => {
        const config = {type: "number" as const, decimalPlaces: null};

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
            // Permissive alpha — even non-currency letters strip.
            ["abc 3.14", 3.14],
            ["3.14 xyz", 3.14],
            // Sign + currency in either order, with whitespace
            ["-£3.14", -3.14],
            ["£-3.14", -3.14],
            ["- £ 3.14", -3.14],
            ["+ $10", 10],
            // Accounting negatives
            ["(3.14)", -3.14],
            ["(£3.14)", -3.14],
            ["($1,234.56)", -1234.56],
            // Percent (cases where `× 0.01` is exact in IEEE-754).
            ["50%", 0.5],
            ["-25%", -0.25],
            // US thousands separators
            ["1,234", 1234],
            ["1,234.56", 1234.56],
            ["1,234,567", 1234567],
            ["$1,234.56", 1234.56],
        ])("parses %j as %s", (input, expected) => {
            expect(databaseNumberFieldProvider.parseString(input, config)).toEqual({
                ok: true,
                value: expected,
            });
        });

        test("percent of a non-power-of-two scales approximately", () => {
            // `3.14 × 0.01` isn't exact in IEEE-754, so use
            // a tolerant compare instead of `toEqual`.
            const result = databaseNumberFieldProvider.parseString("3.14%", config);
            expect(result.ok).toBe(true);
            if (result.ok) expect(result.value!).toBeCloseTo(0.0314, 10);
        });

        test.each([
            ["abc"],
            ["1.2.3"],
            ["Infinity"],
            ["-Infinity"],
            ["NaN"],
            ["$"],
            ["%"],
            ["()"],
            // Ambiguous comma pattern: not stripped, then Number() rejects.
            ["1,23"],
            ["1,2345"],
            // European decimal — we don't guess.
            ["3,14"],
        ])("rejects %j", input => {
            expect(databaseNumberFieldProvider.parseString(input, config).ok).toBe(false);
        });
    });

    describe("formatString", () => {
        test("null renders blank", () => {
            const config = {type: "number" as const, decimalPlaces: null};
            expect(databaseNumberFieldProvider.formatString(null, config)).toBe("");
        });

        test("with null decimalPlaces, full precision is preserved", () => {
            const config = {type: "number" as const, decimalPlaces: null};
            expect(databaseNumberFieldProvider.formatString(3.14159, config)).toBe("3.14159");
            expect(databaseNumberFieldProvider.formatString(0, config)).toBe("0");
            expect(databaseNumberFieldProvider.formatString(-1.5, config)).toBe("-1.5");
        });

        test("with decimalPlaces=2, rounds to 2 places", () => {
            const config = {type: "number" as const, decimalPlaces: 2};
            expect(databaseNumberFieldProvider.formatString(3.14159, config)).toBe("3.14");
            expect(databaseNumberFieldProvider.formatString(1, config)).toBe("1.00");
        });

        test("with decimalPlaces=0, rounds to integer", () => {
            const config = {type: "number" as const, decimalPlaces: 0};
            expect(databaseNumberFieldProvider.formatString(3.7, config)).toBe("4");
        });
    });

    describe("toSqlValue / fromSqlValue", () => {
        test("identity for numbers and null", () => {
            expect(databaseNumberFieldProvider.toSqlValue(3.14)).toBe(3.14);
            expect(databaseNumberFieldProvider.toSqlValue(null)).toBeNull();
            expect(databaseNumberFieldProvider.fromSqlValue(42)).toBe(42);
            expect(databaseNumberFieldProvider.fromSqlValue(null)).toBeNull();
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
