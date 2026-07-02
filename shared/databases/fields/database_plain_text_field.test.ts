import sqlite3InitModule from "~/external/sqlite/ext/wasm/jswasm/sqlite3.mjs";
import {DatabasePlainTextFieldProvider} from "~/shared/databases/fields/database_plain_text_field.js";
import {sql} from "~/shared/databases/sql.js";

const databasePlainTextFieldProvider = new DatabasePlainTextFieldProvider();
const sqlite3Promise = sqlite3InitModule();
let dbCounter = 0;

async function createDbWithCheckedColumn() {
    const sqlite3 = await sqlite3Promise;
    const db = new sqlite3.oo1.DB(`/test-plain-text-${dbCounter++}.sqlite3`, "ct");
    const check = databasePlainTextFieldProvider.generateCheckConstraint(sql.identifier("v"));
    sql`
        CREATE TABLE t (
            v TEXT NOT NULL DEFAULT '' ${check}
        )
    `.exec(db);
    return db;
}

describe("databasePlainTextFieldProvider", () => {
    describe("parseString", () => {
        test("any input is ok", () => {
            expect(databasePlainTextFieldProvider.parseValueString("hello")).toEqual({
                ok: true,
                value: "hello",
            });
            expect(databasePlainTextFieldProvider.parseValueString("")).toEqual({
                ok: true,
                value: "",
            });
            expect(databasePlainTextFieldProvider.parseValueString("  spaces  ")).toEqual({
                ok: true,
                value: "  spaces  ",
            });
        });
    });

    describe("formatString", () => {
        test("returns the value unchanged", () => {
            expect(databasePlainTextFieldProvider.valueToString("hello")).toBe("hello");
            expect(databasePlainTextFieldProvider.valueToString("")).toBe("");
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
