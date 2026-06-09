import sqlite3InitModule from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import {databasePlainTextFieldProvider} from "~/shared/databases/fields/database_plain_text_field.js";
import {sql} from "~/shared/databases/sql.js";

const sqlite3Promise = sqlite3InitModule();
let dbCounter = 0;

async function createDbWithCheckedColumn() {
    const sqlite3 = await sqlite3Promise;
    const db = new sqlite3.oo1.DB(`/test-plain-text-${dbCounter++}.sqlite3`, "ct");
    const check = databasePlainTextFieldProvider.generateCheckConstraint("v");
    sql`
        CREATE TABLE t (
            v TEXT NOT NULL DEFAULT '' ${check}
        )
    `.exec(db);
    return db;
}

describe("databasePlainTextFieldProvider", () => {
    test("getDefaultConfig returns just the type discriminant", () => {
        expect(databasePlainTextFieldProvider.getDefaultConfig()).toEqual({type: "plainText"});
    });

    describe("parseString", () => {
        test("any input is ok", () => {
            const config = databasePlainTextFieldProvider.getDefaultConfig();
            expect(databasePlainTextFieldProvider.parseString("hello", config)).toEqual({
                ok: true,
                value: "hello",
            });
            expect(databasePlainTextFieldProvider.parseString("", config)).toEqual({
                ok: true,
                value: "",
            });
            expect(databasePlainTextFieldProvider.parseString("  spaces  ", config)).toEqual({
                ok: true,
                value: "  spaces  ",
            });
        });
    });

    describe("formatString", () => {
        test("returns the value unchanged", () => {
            const config = databasePlainTextFieldProvider.getDefaultConfig();
            expect(databasePlainTextFieldProvider.formatString("hello", config)).toBe("hello");
            expect(databasePlainTextFieldProvider.formatString("", config)).toBe("");
        });
    });

    describe("toSqlValue / fromSqlValue", () => {
        test("identity round-trip", () => {
            expect(databasePlainTextFieldProvider.toSqlValue("hi")).toBe("hi");
            expect(databasePlainTextFieldProvider.fromSqlValue("hi")).toBe("hi");
        });
    });

    describe("generateCheckConstraint", () => {
        test("accepts text", async () => {
            const db = await createDbWithCheckedColumn();
            sql`
                INSERT INTO
                    t (v)
                VALUES
                    ('hello')
            `.exec(db);
            db.close();
        });

        test("rejects blobs (which TEXT affinity does not coerce)", async () => {
            const db = await createDbWithCheckedColumn();
            expect(() =>
                sql`
                    INSERT INTO
                        t (v)
                    VALUES
                        (x'00')
                `.exec(db),
            ).toThrow("CHECK constraint failed");
            db.close();
        });
    });
});
