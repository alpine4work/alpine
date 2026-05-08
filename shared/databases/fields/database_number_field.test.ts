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

        test("empty string parses to null", () => {
            expect(databaseNumberFieldProvider.parseString("", config)).toEqual({
                ok: true,
                value: null,
            });
        });

        test("integers and decimals parse to numbers", () => {
            expect(databaseNumberFieldProvider.parseString("0", config)).toEqual({
                ok: true,
                value: 0,
            });
            expect(databaseNumberFieldProvider.parseString("42", config)).toEqual({
                ok: true,
                value: 42,
            });
            expect(databaseNumberFieldProvider.parseString("3.14", config)).toEqual({
                ok: true,
                value: 3.14,
            });
            expect(databaseNumberFieldProvider.parseString("-2.5", config)).toEqual({
                ok: true,
                value: -2.5,
            });
        });

        test("non-numeric strings are not ok", () => {
            expect(databaseNumberFieldProvider.parseString("abc", config).ok).toBe(false);
            expect(databaseNumberFieldProvider.parseString("1.2.3", config).ok).toBe(false);
        });

        test("Infinity and NaN are not ok", () => {
            expect(databaseNumberFieldProvider.parseString("Infinity", config).ok).toBe(false);
            expect(databaseNumberFieldProvider.parseString("-Infinity", config).ok).toBe(false);
            expect(databaseNumberFieldProvider.parseString("NaN", config).ok).toBe(false);
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
